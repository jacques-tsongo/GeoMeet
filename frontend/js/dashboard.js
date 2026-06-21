const token = localStorage.getItem('geomeet_token');
const currentUser = JSON.parse(localStorage.getItem('geomeet_user') || 'null');

if (!token || !currentUser) {
  window.location.href = 'login.html';
}

const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`
};

const socket = io({ auth: { token } });
const userName = document.getElementById('userName');
const searchForm = document.getElementById('searchForm');
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
const receivedRequests = document.getElementById('receivedRequests');
const sentRequests = document.getElementById('sentRequests');
const activeSessions = document.getElementById('activeSessions');
const onlineUsers = document.getElementById('onlineUsers');
const onlineCount = document.getElementById('onlineCount');
const toast = document.getElementById('toast');

let onlineIds = [];

userName.textContent = `${currentUser.prenom} ${currentUser.nom}`;

document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.clear();
  window.location.href = 'login.html';
});

function avatar(user) {
  const src = user.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(`${user.prenom} ${user.nom}`)}&background=1f8a70&color=fff`;
  return `<img src="${src}" alt="${user.prenom} ${user.nom}">`;
}

function showToast(text) {
  toast.textContent = text;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 4000);
}

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || 'Erreur serveur.');
  }
  return data;
}

function emptyText(container, text) {
  container.innerHTML = `<p class="empty">${text}</p>`;
}

function renderRequest(request, type) {
  const other = type === 'received'
    ? { id: request.sender_id, nom: request.sender_nom, prenom: request.sender_prenom, photo: request.sender_photo }
    : { id: request.receiver_id, nom: request.receiver_nom, prenom: request.receiver_prenom, photo: request.receiver_photo };

  const actions = type === 'received' && request.status === 'pending'
    ? `<div class="row-actions">
        <button class="btn small primary" data-action="accept" data-id="${request.id}">Accepter</button>
        <button class="btn small ghost" data-action="reject" data-id="${request.id}">Refuser</button>
      </div>`
    : `<span class="badge ${request.status}">${request.status}</span>`;

  return `<article class="person-card">
    ${avatar(other)}
    <div><strong>${other.prenom} ${other.nom}</strong><span>${type === 'received' ? 'souhaite vous rencontrer' : 'demande envoyee'}</span></div>
    ${actions}
  </article>`;
}

function renderSession(session) {
  return `<article class="person-card">
    ${avatar(session.peer)}
    <div><strong>${session.peer.prenom} ${session.peer.nom}</strong><span>Session active</span></div>
    <a class="btn small primary" href="meeting.html?session=${session.id}">Ouvrir</a>
  </article>`;
}

async function loadDashboard() {
  const data = await api('/api/meetings/dashboard');
  receivedRequests.innerHTML = data.received.length ? data.received.map((r) => renderRequest(r, 'received')).join('') : '';
  sentRequests.innerHTML = data.sent.length ? data.sent.map((r) => renderRequest(r, 'sent')).join('') : '';
  activeSessions.innerHTML = data.activeSessions.length ? data.activeSessions.map(renderSession).join('') : '';

  if (!data.received.length) emptyText(receivedRequests, 'Aucune demande recue.');
  if (!data.sent.length) emptyText(sentRequests, 'Aucune demande envoyee.');
  if (!data.activeSessions.length) emptyText(activeSessions, 'Aucune rencontre active.');
}

searchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const q = searchInput.value.trim();
  if (q.length < 2) return;

  const users = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
  searchResults.innerHTML = users.length ? users.map((user) => `<article class="person-card">
    ${avatar(user)}
    <div><strong>${user.prenom} ${user.nom}</strong><span>${user.email}</span></div>
    <span class="presence ${user.online ? 'on' : ''}">${user.online ? 'En ligne' : 'Hors ligne'}</span>
    <button class="btn small primary" data-send="${user.id}">Demander</button>
  </article>`).join('') : '<p class="empty">Aucun utilisateur trouve.</p>';
});

document.body.addEventListener('click', async (event) => {
  const sendId = event.target.dataset.send;
  const action = event.target.dataset.action;
  const requestId = event.target.dataset.id;

  try {
    if (sendId) {
      await api('/api/meetings/request', {
        method: 'POST',
        body: JSON.stringify({ receiver_id: sendId })
      });
      showToast('Demande envoyee.');
      await loadDashboard();
    }

    if (action && requestId) {
      const status = action === 'accept' ? 'accepted' : 'rejected';
      const data = await api(`/api/meetings/request/${requestId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      if (data.session) {
        window.location.href = `meeting.html?session=${data.session.id}`;
      } else {
        await loadDashboard();
      }
    }
  } catch (error) {
    showToast(error.message);
  }
});

socket.on('meeting:request', (request) => {
  showToast(`${request.sender_prenom} souhaite partager sa localisation avec vous`);
  loadDashboard();
});

socket.on('meeting:response', ({ request, session }) => {
  showToast(request.status === 'accepted' ? 'Demande acceptee.' : 'Demande refusee.');
  if (session && Number(request.sender_id) === Number(currentUser.id)) {
    window.location.href = `meeting.html?session=${session.id}`;
  } else {
    loadDashboard();
  }
});

socket.on('users:online', (ids) => {
  onlineIds = ids;
  onlineCount.textContent = ids.length;
  onlineUsers.innerHTML = ids.length
    ? ids.map((id) => `<article class="person-card"><div class="online-dot"></div><div><strong>Utilisateur #${id}</strong><span>Connecte maintenant</span></div></article>`).join('')
    : '<p class="empty">Aucun utilisateur en ligne.</p>';
});

loadDashboard().catch((error) => showToast(error.message));
