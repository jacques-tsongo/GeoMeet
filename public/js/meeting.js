const token = localStorage.getItem('geomeet_token');
const currentUser = JSON.parse(localStorage.getItem('geomeet_user') || 'null');
const params = new URLSearchParams(window.location.search);
const sessionId = params.get('session');

if (!token || !currentUser || !sessionId) {
  // Page protégée : sans token ou sans identifiant de session, retour au tableau de bord.
  window.location.href = '/dashboard';
}

const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const socket = io({ auth: { token } });

// ---------------------------------------------------------------------------
// Carte Leaflet : tuiles OpenStreetMap, contrôle de zoom en bas à droite.
// Vue par défaut (avant que les positions ne soient connues) : la France
// métropolitaine, pour ne jamais ouvrir sur une zone vide (océan) tant que
// les deux marqueurs ne sont pas disponibles.
// ---------------------------------------------------------------------------
const DEFAULT_MAP_CENTER = [46.6, 2.4];
const DEFAULT_MAP_ZOOM = 6;
const map = L.map('map', {
  zoomControl: false,
  center: DEFAULT_MAP_CENTER,
  zoom: DEFAULT_MAP_ZOOM
});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap'
}).addTo(map);
L.control.zoom({ position: 'bottomright' }).addTo(map);

let session = null;
let sessionState = 'ACTIVE';
let watchId = null; // identifiant du watchPosition (permet de ne lancer qu'UNE seule fois)
let joined = false; // la page a-t-elle déjà rejoint le room de la session ?
let hasLiveFix = false; // un premier signal GPS a-t-il été reçu ?

const markers = {};       // userId -> marqueur Leaflet
const positions = {};     // userId -> dernière position réelle reçue
const participantUsers = {};
const animations = {};    // userId -> requestAnimationFrame en cours (animation marqueur)
const MARKER_ANIM_MS = 600; // durée d'interpolation d'un marqueur en ms

let routeLine = null;     // ligne de l'itinéraire OSRM
let connectorLine = null; // ligne pointillée reliant les deux participants
let routeTimer = null;    // temporisateur de chargement d'itinéraire (debounce)
let initialFitDone = false; // la carte a-t-elle déjà été cadrée sur la session ?
let userInteracted = false; // l'utilisateur a-t-il déplacé/zoomé la carte manuellement ?
let lastSentPosition = null; // dernière position envoyée (seuil anti-bruit GPS)
const MIN_MOVE_METERS = 3; // déplacement minimal (m) avant renvoi d'une position

const distanceText = document.getElementById('distanceText');
const durationText = document.getElementById('durationText');
const instructions = document.getElementById('instructions');
const meetingPeer = document.getElementById('meetingPeer');
const meetingState = document.getElementById('meetingState');
const meCard = document.getElementById('meCard');
const peerCard = document.getElementById('peerCard');

function avatar(user) {
  const src = user.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(`${user.prenom} ${user.nom}`)}&background=1f8a70&color=fff`;
  return `<img src="${src}" alt="${user.prenom} ${user.nom}">`;
}

function personCard(user, label) {
  return `${avatar(user)}<div><strong>${user.prenom} ${user.nom}</strong><span>${label}</span></div>`;
}

// Formate une distance en mètres de façon lisible (mètres < 1 km, sinon km).
function formatDistance(meters) {
  if (meters == null || !isFinite(meters)) return 'En attente...';
  return meters < 1000
    ? `${Math.round(meters)} m`
    : `${(meters / 1000).toFixed(1)} km`;
}

// Calcule la distance en mètres entre deux points (formule de haversine).
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

// ---------------------------------------------------------------------------
// Animation fluide des marqueurs : Interpole progressivement la position
// affichée entre l'ancienne et la nouvelle coordonnée pour éviter que le
// marqueur "saute" d'un point à un autre.
// ---------------------------------------------------------------------------
function animateMarkerTo(userId, targetLatLng, animate = true) {
  const marker = markers[userId];
  if (!marker) return;

  // Annule l'animation précédente du marqueur s'il en existe une.
  if (animations[userId]) {
    cancelAnimationFrame(animations[userId]);
    delete animations[userId];
  }

  if (!animate) {
    marker.setLatLng(targetLatLng);
    return;
  }

  const from = marker.getLatLng();
  const start = performance.now();

  function step(now) {
    const t = Math.min(1, (now - start) / MARKER_ANIM_MS);
    // easing simple : ralentissement en fin de course (t* (2 - t)).
    const eased = t * (2 - t);
    const lat = from.lat + (targetLatLng.lat - from.lat) * eased;
    const lng = from.lng + (targetLatLng.lng - from.lng) * eased;
    marker.setLatLng([lat, lng]);
    if (t < 1) {
      animations[userId] = requestAnimationFrame(step);
    } else {
      delete animations[userId];
    }
  }
  animations[userId] = requestAnimationFrame(step);
}

// Mémorise une position et crée/met à jour le marqueur correspondant.
// Les coordonnées sont converties en nombres et validées avant toute
// utilisation : une position invalide est simplement ignorée.
function setUserPosition(userId, user, position, animate = true) {
  if (position.latitude == null || position.longitude == null) return;

  const latitude = Number(position.latitude);
  const longitude = Number(position.longitude);
  if (!isFinite(latitude) || !isFinite(longitude)) return;

  const normalizedUserId = String(userId);
  participantUsers[normalizedUserId] = user;
  positions[normalizedUserId] = {
    userId: Number(userId),
    latitude,
    longitude,
    accuracy: position.accuracy,
    updatedAt: position.updatedAt || new Date().toISOString()
  };

  if (!markers[normalizedUserId]) {
    markers[normalizedUserId] = L.marker([latitude, longitude], {
      icon: iconFor(user, colorForUser(userId))
    }).addTo(map).bindPopup(`${user.prenom} ${user.nom}`);
  } else {
    animateMarkerTo(normalizedUserId, [latitude, longitude], animate);
  }
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

// Charge (avec temporisation) l'itinéraire marche à pied via OSRM.
async function loadRoute(a, b) {
  const url = `https://router.project-osrm.org/route/v1/foot/${a.longitude},${a.latitude};${b.longitude},${b.latitude}?overview=full&geometries=geojson&steps=true&language=fr`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    const route = data.routes && data.routes[0];
    if (!route) return;

    const coords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    if (routeLine) routeLine.remove();
    routeLine = L.polyline(coords, { color: '#1f8a70', weight: 5, opacity: 0.78 }).addTo(map);
    durationText.textContent = `${Math.round(route.duration / 60)} min`;
    instructions.innerHTML = route.legs[0].steps.slice(0, 8).map((step) => `<li>${formatStep(step)}</li>`).join('');
  } catch (error) {
    durationText.textContent = '--';
  }
}

// Planifie un chargement d'itinéraire : évite d'appeler l'API OSRM à chaque
// petit déplacement du GPS (debounce de 800 ms).
function scheduleRouteLoad(a, b) {
  clearTimeout(routeTimer);
  routeTimer = setTimeout(() => loadRoute(a, b), 800);
}

// ---------------------------------------------------------------------------
// Recalcul des métriques (distance + ligne de liaison) à CHAQUE nouvelle
// position, SANS recadrer la carte (le recadrage est géré séparément).
// ---------------------------------------------------------------------------
function updateOverlay() {
  const mine = positions[String(currentUser.id)];
  const peer = session && positions[String(session.peer.id)];
  if (!mine || !peer) return;

  const points = [[mine.latitude, mine.longitude], [peer.latitude, peer.longitude]];
  if (!connectorLine) {
    connectorLine = L.polyline(points, { color: '#263238', weight: 2, dashArray: '8 8', opacity: 0.55 }).addTo(map);
  } else {
    connectorLine.setLatLngs(points);
  }

  const d = distanceMeters(mine, peer);
  distanceText.textContent = formatDistance(d);
  scheduleRouteLoad(mine, peer);
}

// ---------------------------------------------------------------------------
// Ajustement automatique de la vue.
//
// L'objectif est d'afficher les DEUX marqueurs dès que leurs coordonnées sont
// réellement disponibles, quel que soit l'ordre d'arrivée (A puis B, ou
// B puis A) :
//   1. Les deux positions sont connues  -> fitBounds englobe les deux points.
//   2. Une seule position est connue    -> on centre dessus (zoom raisonnable)
//      pour ne jamais rester sur une vue vide ; le fit complet sera effectué
//      dès que la seconde position arrivera.
//
// Le "fit" n'est effectué qu'une fois par session (initialFitDone) afin de ne
// pas recadrer la carte à chaque petit déplacement, et les manipulations
// manuelles de l'utilisateur sont respectées sauf demande explicite (bouton
// "recenter" avec force = true).
// ---------------------------------------------------------------------------
const FIT_PADDING = [80, 80]; // marge autour des marqueurs (non collés aux bords)
const FIT_MAX_ZOOM = 16;      // zoom maximum autorisé pour le fitBounds
const FIT_SINGLE_ZOOM = 15;   // zoom utilisé quand une seule position est connue
const IDENTICAL_THRESHOLD_M = 2; // distance en dessous de laquelle on considère
                                  // les deux positions comme identiques

function fitMapToPositions(force = false) {
  if (!force && (userInteracted || initialFitDone)) return;

  const mine = positions[String(currentUser.id)];
  const peer = session && positions[String(session.peer.id)];

  // Cas 1 : les deux positions sont disponibles -> la vue doit les englober.
  if (mine && peer) {
    const latA = Number(mine.latitude);
    const lngA = Number(mine.longitude);
    const latB = Number(peer.latitude);
    const lngB = Number(peer.longitude);

    // Deux positions quasi identiques : un fitBounds produirait un zoom
    // excessif, on centre donc simplement avec un zoom raisonnable.
    if (distanceMeters({ latitude: latA, longitude: lngA }, { latitude: latB, longitude: lngB }) < IDENTICAL_THRESHOLD_M) {
      map.setView([latA, lngA], FIT_SINGLE_ZOOM);
    } else {
      map.fitBounds(L.latLngBounds([[latA, lngA], [latB, lngB]]), {
        padding: FIT_PADDING,
        maxZoom: FIT_MAX_ZOOM
      });
    }
    initialFitDone = true;
    return;
  }

  // Cas 2 : une seule position connue (l'autre arrive plus tard).
  // On centre sur la position disponible pour éviter une carte vide.
  const single = mine || peer;
  if (single) {
    map.setView([Number(single.latitude), Number(single.longitude)], FIT_SINGLE_ZOOM);
  }
}

// Marque la carte comme "manipulée par l'utilisateur".
map.on('dragstart', () => { userInteracted = true; });
map.on('zoomstart', () => { userInteracted = true; });

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Erreur serveur.');
  return data;
}

// ---------------------------------------------------------------------------
// Rejoint la session : le serveur renvoie les dernières positions connues des
// deux participants pour resynchroniser immédiatement l'affichage, y compris
// après une reconnexion Socket.IO.
// ---------------------------------------------------------------------------
function joinSession() {
  // Garde anti-doublon : une seule jointure par connexion Socket.IO
  // (ex. lorsque l'événement 'connect' et init() se chevauchent au chargement).
  if (joined) return Promise.resolve();

  return new Promise((resolve, reject) => {
    socket.emit('meeting:join', sessionId, (response) => {
      if (!response || !response.ok) {
        reject(new Error(response && response.message ? response.message : 'Session non autorisée.'));
        return;
      }
      joined = true;

      const locations = response.locations || {};
      const peerId = String(session.peer.id);
      const myId = String(currentUser.id);

      // Position connue de l'utilisateur : on crée immédiatement son marqueur
      // (il sera rafraîchi par le GPS) et on évite de renvoyer la même position
      // au serveur tant que le premier signal ne dépasse pas le seuil.
      const myLoc = locations[myId];
      if (myLoc && myLoc.latitude != null) {
        setUserPosition(myId, currentUser, {
          latitude: Number(myLoc.latitude),
          longitude: Number(myLoc.longitude),
          accuracy: myLoc.accuracy
        }, false);
        lastSentPosition = { latitude: Number(myLoc.latitude), longitude: Number(myLoc.longitude) };
      }

      // Position connue du partenaire : marqueur affiché sans animation.
      const peerLoc = locations[peerId];
      if (peerLoc && peerLoc.latitude != null) {
        setUserPosition(peerId, session.peer, {
          latitude: Number(peerLoc.latitude),
          longitude: Number(peerLoc.longitude),
          accuracy: peerLoc.accuracy
        }, false);
      }

      // Dès que les deux positions (ou une seule) sont connues, on ajuste la
      // vue : c'est ici que la carte s'auto-positionne après une acceptation
      // ou une reconnexion, sans attendre le prochain signal GPS.
      updateOverlay();
      fitMapToPositions();

      resolve(response.roomId);
    });
  });
}

// ---------------------------------------------------------------------------
// Démarre le suivi continu de la position de l'utilisateur.
// watchPosition déclenche un événement dès que le navigateur détecte une
// nouvelle position. On garde le premier watchPosition et on ne crée JAMAIS de
// doublon après une reconnexion (test sur watchId).
// ---------------------------------------------------------------------------
function startWatching() {
  if (watchId !== null) return;

  if (!navigator.geolocation) {
    distanceText.textContent = 'Geolocalisation indisponible';
    return;
  }

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const payload = {
        sessionId,
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      };

      // Toujours mettre à jour le marqueur local, même si on n'envoie rien.
      setUserPosition(currentUser.id, currentUser, payload, false);
      updateOverlay();

      // Seuil anti-bruit : on ne transmet que les déplacements significatifs
      // pour éviter d'envoyer des centaines d'événements inutiles au serveur.
      // Exception : le TOUT PREMIER signal GPS de la page est toujours envoyé
      // (hasLiveFix false), sinon le marqueur ne serait jamais repris en réseau.
      if (hasLiveFix && lastSentPosition &&
          distanceMeters(lastSentPosition, payload) < MIN_MOVE_METERS) {
        return;
      }

      hasLiveFix = true;
      lastSentPosition = payload;
      socket.emit('location:update', payload);
      fitMapToPositions();
    },
    () => {
      distanceText.textContent = 'Autorisez la localisation';
    },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 12000 }
  );
}

function stopWatching() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

// Arrête proprement le suivi lorsque la page est quittée.
window.addEventListener('beforeunload', stopWatching);

// ---------------------------------------------------------------------------
// Initialisation de la page : chargement de la session, jointure du room
// Socket.IO puis démarrage du suivi GPS.
// ---------------------------------------------------------------------------
async function init() {
  session = await api(`/api/meetings/session/${sessionId}`);
  sessionState = session.is_active ? 'ACTIVE' : 'ENDED';
  meetingState.textContent = sessionState;

  participantUsers[String(currentUser.id)] = currentUser;
  participantUsers[String(session.peer.id)] = session.peer;
  meetingPeer.textContent = `${session.peer.prenom} ${session.peer.nom}`;
  meCard.innerHTML = personCard(currentUser, 'Vous');
  peerCard.innerHTML = personCard(session.peer, 'Partenaire');

  await joinSession();
  startWatching();
}

// ---------------------------------------------------------------------------
// Écouteurs Socket.IO (enregistrés UNE seule fois au chargement de la page).
// ---------------------------------------------------------------------------

// Reconnexion Socket.IO : on rejoint à nouveau la session pour resynchroniser
// l'état (positions, room) sans reproduire de doublons d'écouteurs ni de
// doublons de watchPosition (celui-ci est conservé par la page).
socket.on('disconnect', () => {
  joined = false; // une reconnexion nécessite une nouvelle jointure au room
});

socket.on('connect', () => {
  if (session) joinSession().catch(() => {});
});

// Position reçue du partenaire : on la mémorise, on anime le marqueur et on
// met à jour distance + éventuel recadrage (si c'est la première fois que les
// deux positions sont enfin disponibles).
socket.on('location-update', (payload) => {
  const userIdKey = String(payload.userId);
  const user = participantUsers[userIdKey] || (session && (Number(payload.userId) === Number(session.peer.id) ? session.peer : null));
  if (!user) return;
  setUserPosition(payload.userId, user, payload);
  updateOverlay();
  fitMapToPositions();
});

// Un participant vient de rejoindre la session : on lui envoie immédiatement
// notre position courante pour que les deux marqueurs s'affichent tout de suite.
socket.on('meeting:peer-joined', (payload) => {
  const myPos = positions[String(currentUser.id)];
  if (!myPos || payload.userId === currentUser.id) return;
  socket.emit('location:update', {
    sessionId,
    latitude: myPos.latitude,
    longitude: myPos.longitude,
    accuracy: myPos.accuracy
  });
});

// Session terminée par l'autre participant : arrêt du suivi et retour au
// tableau de bord, sans rechargement manuel.
socket.on('meeting:ended', () => {
  stopWatching();
  sessionState = 'ENDED';
  meetingState.textContent = sessionState;
  window.location.href = '/dashboard';
});

document.getElementById('sidebarToggle').addEventListener('click', () => {
  document.getElementById('meetingSidebar').classList.toggle('open');
});

document.getElementById('recenterBtn').addEventListener('click', () => {
  // Force le recadrage sur les deux marqueurs, même si l'utilisateur a déjà
  // manipulé la carte manuellement ou que le fit initial a déjà eu lieu.
  fitMapToPositions(true);
});

document.getElementById('endSessionBtn').addEventListener('click', async () => {
  try {
    await api(`/api/meetings/session/${sessionId}/end`, { method: 'PATCH' });
  } catch (error) {
    // La session peut déjà être terminée ; on redirige quand même.
  }
  window.location.href = '/dashboard';
});

init().catch(() => {
  window.location.href = '/dashboard';
});