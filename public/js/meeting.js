const token = localStorage.getItem('geomeet_token');
const currentUser = JSON.parse(localStorage.getItem('geomeet_user') || 'null');
const params = new URLSearchParams(window.location.search);
const sessionId = params.get('session');

if (!token || !currentUser || !sessionId) {
  // MIGRATION HTML -> EJS : redirection vers la route de page Express
  window.location.href = '/dashboard';
}

const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const socket = io({ auth: { token } });
const map = L.map('map', { zoomControl: false }).setView([48.8566, 2.3522], 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap'
}).addTo(map);
L.control.zoom({ position: 'bottomright' }).addTo(map);

let session = null;
let watchId = null;
let routeLine = null;
let connectorLine = null;
const positions = {};
const markers = {};
const participantUsers = {};

const distanceText = document.getElementById('distanceText');
const durationText = document.getElementById('durationText');
const instructions = document.getElementById('instructions');
const meetingPeer = document.getElementById('meetingPeer');
const meCard = document.getElementById('meCard');
const peerCard = document.getElementById('peerCard');

function avatar(user) {
  const src = user.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(`${user.prenom} ${user.nom}`)}&background=1f8a70&color=fff`;
  return `<img src="${src}" alt="${user.prenom} ${user.nom}">`;
}

function personCard(user, label) {
  return `${avatar(user)}<div><strong>${user.prenom} ${user.nom}</strong><span>${label}</span></div>`;
}

function formatDistance(meters) {
  return meters < 1000 ? `Vous etes a ${Math.round(meters)} metres` : `Vous etes a ${(meters / 1000).toFixed(1)} km`;
}

function formatStep(step) {
  const distance = step.distance < 1000 ? `${Math.round(step.distance)} metres` : `${(step.distance / 1000).toFixed(1)} km`;
  const modifier = step.maneuver && step.maneuver.modifier;
  const type = step.maneuver && step.maneuver.type;
  const direction = {
    right: 'a droite',
    left: 'a gauche',
    straight: 'tout droit',
    slight_right: 'legerement a droite',
    slight_left: 'legerement a gauche',
    sharp_right: 'fortement a droite',
    sharp_left: 'fortement a gauche'
  }[modifier] || '';

  if (type === 'arrive') return 'Vous etes arrive.';
  if (type === 'depart') return `Continuez ${distance}`;
  if (type === 'turn') return `Tournez ${direction}, puis continuez ${distance}`;
  if (type === 'new name') return `Continuez ${distance}`;
  return direction ? `Allez ${direction} sur ${distance}` : `Continuez ${distance}`;
}

function distanceMeters(a, b) {
  const earthRadius = 6371000;
  const dLat = (b.latitude - a.latitude) * Math.PI / 180;
  const dLon = (b.longitude - a.longitude) * Math.PI / 180;
  const lat1 = a.latitude * Math.PI / 180;
  const lat2 = b.latitude * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function colorForUser(userId) {
  return Number(userId) === Number(currentUser.id) ? '#1971c2' : '#d94848';
}

function iconFor(user, color) {
  return L.divIcon({
    className: 'user-marker',
    html: `<div style="border-color:${color}">${avatar(user)}</div>`,
    iconSize: [54, 54],
    iconAnchor: [27, 27]
  });
}

function upsertMarker(userId, user, position, color) {
  const latlng = [position.latitude, position.longitude];
  if (!markers[userId]) {
    markers[userId] = L.marker(latlng, { icon: iconFor(user, color) }).addTo(map).bindPopup(`${user.prenom} ${user.nom}`);
  } else {
    markers[userId].setLatLng(latlng);
  }
}

function setUserPosition(userId, user, position) {
  const normalizedUserId = String(userId);
  participantUsers[normalizedUserId] = user;
  positions[normalizedUserId] = {
    userId: Number(userId),
    latitude: position.latitude,
    longitude: position.longitude,
    accuracy: position.accuracy,
    updatedAt: position.updatedAt || new Date().toISOString()
  };
  upsertMarker(normalizedUserId, user, positions[normalizedUserId], colorForUser(userId));
}

async function loadRoute(a, b) {
  const url = `https://router.project-osrm.org/route/v1/foot/${a.longitude},${a.latitude};${b.longitude},${b.latitude}?overview=full&geometries=geojson&steps=true&language=fr`;
  const response = await fetch(url);
  const data = await response.json();
  const route = data.routes && data.routes[0];
  if (!route) return;

  const coords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
  if (routeLine) routeLine.remove();
  routeLine = L.polyline(coords, { color: '#1f8a70', weight: 5, opacity: 0.78 }).addTo(map);
  durationText.textContent = `${Math.round(route.duration / 60)} min`;
  instructions.innerHTML = route.legs[0].steps.slice(0, 8).map((step) => `<li>${formatStep(step)}</li>`).join('');
}

function refreshMap() {
  const mine = positions[String(currentUser.id)];
  const peer = session && positions[String(session.peer.id)];
  if (!mine || !peer) return;

  const latlngs = [[mine.latitude, mine.longitude], [peer.latitude, peer.longitude]];
  if (connectorLine) connectorLine.remove();
  connectorLine = L.polyline(latlngs, { color: '#263238', weight: 2, dashArray: '8 8', opacity: 0.55 }).addTo(map);
  map.fitBounds(L.latLngBounds(latlngs), { padding: [80, 80], maxZoom: 17 });
  distanceText.textContent = formatDistance(distanceMeters(mine, peer));
  loadRoute(mine, peer).catch(() => {
    durationText.textContent = '--';
  });
}

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Erreur serveur.');
  return data;
}

async function init() {
  session = await api(`/api/meetings/session/${sessionId}`);
  participantUsers[String(currentUser.id)] = currentUser;
  participantUsers[String(session.peer.id)] = session.peer;
  meetingPeer.textContent = `${session.peer.prenom} ${session.peer.nom}`;
  meCard.innerHTML = personCard(currentUser, 'Vous');
  peerCard.innerHTML = personCard(session.peer, 'Partenaire');
  await new Promise((resolve, reject) => {
    socket.emit('meeting:join', sessionId, (response) => {
      if (!response || !response.ok) {
        reject(new Error(response && response.message ? response.message : 'Session non autorisee.'));
        return;
      }
      resolve(response.roomId);
    });
  });

  if (!navigator.geolocation) {
    distanceText.textContent = 'Geolocalisation indisponible';
    return;
  }

  watchId = navigator.geolocation.watchPosition((pos) => {
    const payload = {
      sessionId,
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      user: currentUser
    };
    setUserPosition(currentUser.id, currentUser, payload);
    socket.emit('location:update', payload);
    refreshMap();
  }, () => {
    distanceText.textContent = 'Autorisez la localisation';
  }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 12000 });
}

socket.on('location-update', (payload) => {
  const user = payload.user || participantUsers[String(payload.userId)] || session.peer;
  setUserPosition(payload.userId, user, payload);
  refreshMap();
});

socket.on('meeting:ended', () => {
  if (watchId) navigator.geolocation.clearWatch(watchId);
  // MIGRATION HTML -> EJS : redirection vers la route de page Express
  window.location.href = '/dashboard';
});

document.getElementById('endSessionBtn').addEventListener('click', async () => {
  await api(`/api/meetings/session/${sessionId}/end`, { method: 'PATCH' });
  // MIGRATION HTML -> EJS : redirection vers la route de page Express
  window.location.href = '/dashboard';
});

init().catch(() => {
  // MIGRATION HTML -> EJS : redirection vers la route de page Express
  window.location.href = '/dashboard';
});
