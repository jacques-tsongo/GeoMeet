const token = localStorage.getItem('geomeet_token');
const currentUser = JSON.parse(localStorage.getItem('geomeet_user') || 'null');

if (!token || !currentUser) {
  // Page protégée : sans token, retour à la page de connexion.
  window.location.href = '/login';
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
const onlineCount = document.getElementById('onlineCount');
const toast = document.getElementById('toast');
const requestBanner = document.getElementById('requestBanner');

userName.textContent = `${currentUser.prenom} ${currentUser.nom}`;

document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.clear();
  window.location.href = '/login';
});

function avatar(user) {
  const src = user.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(`${user.prenom} ${user.nom}`)}&background=1f8a70&color=fff`;
  // La photo et les noms proviennent d'entrées utilisateurs : on échappe tout
  // attribut/texte inséré dans le DOM pour éviter toute injection HTML (XSS).
  return `<img src="${escapeAttr(src)}" alt="${escapeAttr(`${user.prenom} ${user.nom}`)}">`;
}

// Échappe une valeur destinée à un attribut HTML (guillemets inclus).
function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Échappe une valeur destinée au contenu texte d'un élément HTML.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function showToast(text) {
  toast.textContent = text;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 4000);
}

// ---------------------------------------------------------------------------
// Bannière de demande reçue : notification interactive affichée immédiatement
// (sans rechargement) avec les boutons [Accepter] / [Refuser] directement
// accessibles. Elle disparaît dès que la demande est traitée.
// ---------------------------------------------------------------------------
function showRequestBanner(request) {
  requestBanner.hidden = false;
  requestBanner.classList.add('show');
  requestBanner.dataset.requestId = request.id;
  requestBanner.innerHTML = `
    <div class="request-banner-top">
      <span class="request-banner-title">Nouvelle demande GeoMeet</span>
      <button class="request-banner-close" data-dismiss-banner aria-label="Fermer">&times;</button>
    </div>
    <div class="request-banner-body">
      ${avatar(request)}
      <div>
        <strong>${escapeHtml(request.sender_prenom || '')} ${escapeHtml(request.sender_nom || '')}</strong>
        <span>souhaite partager sa localisation avec vous</span>
      </div>
    </div>
    <div class="request-banner-actions">
      <button class="btn small primary" data-action="accept" data-id="${request.id}">Accepter</button>
      <button class="btn small ghost" data-action="reject" data-id="${request.id}">Refuser</button>
    </div>`;
}

function hideRequestBanner(requestId) {
  // On ne masque la bannière que si elle concerne la demande traitée :
  // une demande plus récente affichée dans la bannière est conservée.
  if (requestId == null || Number(requestBanner.dataset.requestId) === Number(requestId)) {
    requestBanner.classList.remove('show');
    requestBanner.hidden = true;
    requestBanner.dataset.requestId = '';
  }
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

// Badge d'état lisible pour une demande (PENDING / ACCEPTED / REJECTED).
function stateBadge(state) {
  return `<span class="badge ${String(state).toLowerCase()}">${String(state).toLowerCase()}</span>`;
}

// Affiche une demande reçue ou envoyée (le client peut accepter/refuser).
function renderRequest(request, type) {
  const other = request.peer || {};
  const canAct = type === 'received' && request.state === 'PENDING';
  const actions = canAct
    ? `<div class="row-actions">
        <button class="btn small primary" data-action="accept" data-id="${request.id}">Accepter</button>
        <button class="btn small ghost" data-action="reject" data-id="${request.id}">Refuser</button>
      </div>`
    : stateBadge(request.state || request.status);

  return `<article class="person-card">
    ${avatar(other)}
    <div><strong>${escapeHtml(other.prenom || '')} ${escapeHtml(other.nom || '')}</strong><span>${type === 'received' ? 'souhaite vous rencontrer' : 'demande envoyee'}</span></div>
    ${actions}
  </article>`;
}

// Affiche une session active : accès direct à la carte (bouton "Ouvrir").
function renderSession(session) {
  return `<article class="person-card">
    ${avatar(session.peer)}
    <div><strong>${escapeHtml(session.peer.prenom)} ${escapeHtml(session.peer.nom)}</strong><span>Session ${String(session.state || (session.is_active ? 'active' : 'terminee')).toLowerCase()}</span></div>
    <a class="btn small primary" href="/meeting?session=${session.id}">Ouvrir la carte</a>
  </article>`;
}

// Charge l'ensemble du tableau de bord une fois (puis à chaque mise à jour).
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
    <div><strong>${escapeHtml(user.prenom)} ${escapeHtml(user.nom)}</strong><span>${escapeHtml(user.email)}</span></div>
    <span class="presence ${user.online ? 'on' : ''}">${user.online ? 'En ligne' : 'Hors ligne'}</span>
    <button class="btn small primary" data-send="${user.id}">Demander</button>
  </article>`).join('') : '<p class="empty">Aucun utilisateur trouve.</p>';
});

// Délégation d'événements pour les boutons des listes (envoyer / accepter / refuser)
// et de la bannière de demande reçue (Accepter / Refuser / fermer).
document.body.addEventListener('click', async (event) => {
  if (event.target.dataset.dismissBanner !== undefined) {
    hideRequestBanner();
    return;
  }

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
      hideRequestBanner(requestId);
      // Après acceptation, la carte s'ouvre automatiquement ici (côté B).
      if (data.session) {
        window.location.href = `/meeting?session=${data.session.id}`;
      } else {
        await loadDashboard();
      }
    }
  } catch (error) {
    showToast(error.message);
    await loadDashboard().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Écouteurs Socket.IO : communication 100% temps réel, sans rechargement.
// ---------------------------------------------------------------------------

// Recharge le tableau de bord après une reconnexion Socket.IO pour retrouver
// l'état exact des demandes/sessions (resynchronisation).
socket.on('connect', () => {
  loadDashboard().catch(() => {});
});

// Nouvelle demande reçue : bannière interactive immédiate (Accepter/Refuser)
// + mise à jour de la liste, sans aucun rechargement de page.
socket.on('meeting:request', (request) => {
  showRequestBanner(request);
  loadDashboard().catch(() => {});
});

// Réponse à une demande envoyée : on informe et on ouvre la carte si acceptée.
socket.on('meeting:response', ({ request, session }) => {
  if (request.status === 'accepted') {
    showToast('Demande acceptee.');
    if (session) {
      // Ouverture automatique de la carte pour l'émetteur (A).
      window.location.href = `/meeting?session=${session.id}`;
    }
  } else {
    showToast('Demande refusee.');
    loadDashboard().catch(() => {});
  }
});

// Le serveur notifie explicitement le démarrage d'une session : les DEUX
// utilisateurs (A et B) ouvrent automatiquement la carte, sans clic.
socket.on('meeting:started', (data) => {
  const session = data && data.session;
  if (!session) return;
  if (window.location.pathname === '/meeting') return;
  window.location.href = `/meeting?session=${session.id}`;
});

// Session terminée par l'autre utilisateur : mise à jour immédiate du tableau
// de bord (la session active disparaît) sans rechargement manuel.
socket.on('meeting:ended', () => {
  showToast('La session est terminee.');
  loadDashboard().catch(() => {});
});

// Nombre d'utilisateurs en ligne (petit indicateur, plus de liste permanente).
socket.on('users:online', (ids) => {
  onlineCount.textContent = ids.length;
});

loadDashboard().catch((error) => showToast(error.message));