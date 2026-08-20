const http = require('http');
const { io } = require('socket.io-client');

const BASE = 'http://localhost:5200';
let passed = 0;
let failed = 0;

function ok(name, cond, detail) {
  if (cond) {
    passed++;
    console.log('  PASS  ' + name + (detail ? '  -- ' + detail : ''));
  } else {
    failed++;
    console.log('  FAIL  ' + name + (detail ? '  -- ' + detail : ''));
  }
}

function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(BASE + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        let j = {};
        try { j = JSON.parse(b); } catch (e) {}
        resolve({ status: res.statusCode, data: j });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { auth: { token }, transports: ['websocket'], timeout: 3000 });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

function waitEvent(socket, name, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting ' + name)), timeout);
    socket.once(name, (payload) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

(async () => {
  console.log('=== TEST GEO-LOCATION APP (2 utilisateurs temps reel) ===\n');

  // 1. Inscription des deux utilisateurs
  const ts = Date.now();
  const regA = await req('POST', '/api/register', {
    nom: 'Durand', prenom: 'Alice', email: 'alice.' + ts + '@test.fr',
    telephone: '0600000001', password: 'pwAlice1234', confirmPassword: 'pwAlice1234'
  });
  ok('Inscription A', regA.status === 201 && regA.data.token, 'id=' + regA.data.user.id);

  const regB = await req('POST', '/api/register', {
    nom: 'Martin', prenom: 'Bob', email: 'bob.' + ts + '@test.fr',
    telephone: '0600000002', password: 'pwBob1234', confirmPassword: 'pwBob1234'
  });
  ok('Inscription B', regB.status === 201 && regB.data.token, 'id=' + regB.data.user.id);

  const tokenA = regA.data.token;
  const tokenB = regB.data.token;
  const idA = regA.data.user.id;
  const idB = regB.data.user.id;

  // 2. Connexion Socket.IO des deux utilisateurs
  const sa = await connectSocket(tokenA);
  ok('Socket A connecté', sa.connected, sa.id);
  const sb = await connectSocket(tokenB);
  ok('Socket B connecté', sb.connected, sb.id);

  // 3. A envoie une demande à B => B reçoit immédiatement meeting:request
  const pendingRecv = waitEvent(sb, 'meeting:request');
  const reqAB = await req('POST', '/api/meetings/request', { receiver_id: idB }, tokenA);
  ok('Demande créée (A->B)', reqAB.status === 201, 'request.id=' + reqAB.data.id);
  const incoming = await pendingRecv;
  ok('B reçoit meeting:request IMMÉDIATEMENT', incoming && Number(incoming.receiver_id) === idB, 'sender=' + incoming.sender_prenom);

  // 4. Le dashboard de B contient la demande
  const dashB = await req('GET', '/api/meetings/dashboard', null, tokenB);
  const recvFound = dashB.data.received.some((r) => Number(r.id) === reqAB.data.id);
  ok('Dashboard B contient la demande', recvFound, 'state=' + (dashB.data.received.find((r) => Number(r.id) === reqAB.data.id) || {}).state);

  // 5. B accepte => les DEUX reçoivent meeting:started (auto-ouverture carte)
  const startedA = waitEvent(sa, 'meeting:started');
  const startedB = waitEvent(sb, 'meeting:started');
  const resp = await req('PATCH', '/api/meetings/request/' + reqAB.data.id, { status: 'accepted' }, tokenB);
  ok('Acceptation API OK', resp.status === 200 && !!resp.data.session, 'session.id=' + (resp.data.session && resp.data.session.id));

  const evA = await startedA;
  const evB = await startedB;
  ok('A reçoit meeting:started (carte auto)', evA && evA.session && Number(evA.session.id) === resp.data.session.id, 'peer=' + evA.peer.prenom);
  ok('B reçoit meeting:started (carte auto)', evB && evB.session && Number(evB.session.id) === resp.data.session.id, 'peer=' + evB.peer.prenom);

  const sessionId = resp.data.session.id;

  // 6. Les deux rejoignent la session (comme le font les pages /meeting).
  // A rejoint en premier : le serveur lui renvoie les dernières positions.
  const joinA = new Promise((res) => sa.emit('meeting:join', sessionId, res));
  const ja = await joinA;
  ok('A rejoint la session room', ja && ja.ok === true, 'room=' + ja.roomId);

  // B rejoint ensuite : A (déjà présent) reçoit meeting:peer-joined avec l'id de B.
  const peerJoinedA = waitEvent(sa, 'meeting:peer-joined');
  const joinB = new Promise((res) => sb.emit('meeting:join', sessionId, res));
  const jb = await joinB;
  ok('B rejoint la session room', jb && jb.ok === true, 'room=' + jb.roomId);

  const pjB = await peerJoinedA;
  ok('A est notifié de l\'arrivée de B (peer-joined)', pjB && Number(pjB.userId) === idB, 'userId=' + pjB.userId);

  // Parce qu'il apprend l'arrivée de B, A lui renvoie immédiatement sa position
  // courante (comportement du frontend) => B reçoit location-update sans attendre.
  const posToLateJoiner = waitEvent(sb, 'location-update');
  sa.emit('location:update', { sessionId, latitude: 48.8590, longitude: 2.3550, accuracy: 3 });
  const lateJoinerPos = await posToLateJoiner;
  ok('B reçoit immédiatement la position de A en rejoignant', Number(lateJoinerPos.userId) === idA && lateJoinerPos.latitude === 48.8590);

  // 7. B envoie sa position => A la reçoit en temps réel
  const posA = waitEvent(sa, 'location-update');
  sb.emit('location:update', { sessionId, latitude: 48.8566, longitude: 2.3522, accuracy: 5 });
  const evPos = await posA;
  ok('A reçoit la position de B', evPos && Number(evPos.userId) === idB && evPos.latitude === 48.8566 && evPos.longitude === 2.3522, 'accuracy=' + evPos.accuracy);

  // 8. A envoie sa position => B la reçoit en temps réel
  const posB2 = waitEvent(sb, 'location-update');
  sa.emit('location:update', { sessionId, latitude: 48.8534, longitude: 2.3488, accuracy: 4 });
  const evPos2 = await posB2;
  ok('B reçoit la position de A', evPos2 && Number(evPos2.userId) === idA && evPos2.latitude === 48.8534, 'accuracy=' + evPos2.accuracy);

  // 9. Sécurité : un utilisateur extérieur ne peut PAS injecter de position dans la session
  const c = await req('POST', '/api/register', {
    nom: 'X', prenom: 'Xavier', email: 'x.' + ts + '@test.fr',
    telephone: '0600000003', password: 'pwX1234', confirmPassword: 'pwX1234'
  });
  const sx = await connectSocket(c.data.token);
  const posA2 = waitEvent(sa, 'location-update').then(() => 'RECEIVED') .then((v) => v, (e) => 'TIMEOUT');
  let gotFromX = 'no-event';
  const guard = waitEvent(sa, 'location-update', 1500).then(() => 'RECEIVED', () => 'TIMEOUT');
  sx.emit('location:update', { sessionId, latitude: 40.0, longitude: -3.0, accuracy: 1 });
  const outRes = await guard;
  ok('Un tiers ne peut PAS injecter de position', outRes === 'TIMEOUT', '=> aucune position reçue par la session');
  sx.disconnect();

  // 10. Reconnexion : B perd sa connexion puis se reconnecte (nouveau socket)
  sb.disconnect();
  await new Promise((r) => setTimeout(r, 300));
  const sb2 = await connectSocket(tokenB);
  ok('B se reconnecte (nouveau socket)', sb2.connected, sb2.id);

  // À la reconnexion, B rejoint à nouveau la session : le serveur lui renvoie
  // les dernières positions connues (resynchronisation d'état).
  const peerJoinedA2 = waitEvent(sa, 'meeting:peer-joined'); // A apprend l'arrivée de B
  const joinB3 = new Promise((res) => sb2.emit('meeting:join', sessionId, res));
  const jb3 = await joinB3;
  ok('B rejoint après reconnexion', jb3 && jb3.ok === true);
  const locs2 = jb3.locations || {};
  ok('Resync : serveur renvoie la position de A à B reconnecté', locs2[idA] && Number(locs2[idA].latitude) === 48.8534, 'lat=' + locs2[idA].latitude);

  // A reçoit meeting:peer-joined pour B et lui renvoie sa position
  await peerJoinedA2;
  ok('A est notifié de la reconnexion de B (peer-joined)', true);
  const posToB = waitEvent(sb2, 'location-update');
  sa.emit('location:update', { sessionId, latitude: 48.8520, longitude: 2.3500, accuracy: 3 });
  const bGotPos = await posToB;
  ok('B reconnecté reçoit la position de A', Number(bGotPos.userId) === idA && bGotPos.latitude === 48.8520);

  // 11. Fin de session par A => B (reconnecté) reçoit meeting:ended immédiatement
  const endedB2 = waitEvent(sb2, 'meeting:ended');
  const endedA2 = waitEvent(sa, 'meeting:ended');
  const endRes = await req('PATCH', '/api/meetings/session/' + sessionId + '/end', {}, tokenA);
  ok('Fin de session API OK', endRes.status === 200 && !endRes.data.is_active && endRes.data.ended_at);
  await endedB2;
  await endedA2;
  ok('B (reconnecté) reçoit meeting:ended immédiatement', true);

  sa.disconnect();
  sb2.disconnect();

  console.log('\n=== RÉSULTAT : ' + passed + ' passés, ' + failed + ' échoués ===');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERREUR TEST:', e.message); process.exit(2); });