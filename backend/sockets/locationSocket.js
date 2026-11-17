const jwt = require('jsonwebtoken');
const Location = require('../models/Location');
const MeetingSession = require('../models/MeetingSession');
const { setOnline, setOffline, listOnlineIds } = require('../controllers/userController');

function meetingRoom(sessionId) {
  return `meeting_${sessionId}`;
}

function attachLocationSocket(io) {
  // Authentification par JWT dans le handshake Socket.IO.
  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Token manquant.'));
    }

    try {
      socket.user = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret');
      return next();
    } catch (error) {
      return next(new Error('Token invalide.'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user.id;
    setOnline(userId, socket.id);
    // Chaque utilisateur est dans son propre "room" : cela permet d'envoyer
    // des événements ciblés (demandes, réponses, états) SANS diffuser à tous.
    socket.join(`user:${userId}`);
    io.emit('users:online', listOnlineIds());

    // Demande de rejoindre une session de rencontre.
    // On vérifie que l'utilisateur appartient bien à la session et que la
    // session est active avant de le faire entrer dans le "room" de la rencontre.
    socket.on('meeting:join', async (sessionId, callback) => {
      try {
        const session = await MeetingSession.findActiveForUser(sessionId, userId);
        if (!session) {
          if (callback) callback({ ok: false, message: 'Session introuvable ou non autorisee.' });
          return;
        }

        const roomId = meetingRoom(sessionId);
        socket.join(roomId);

        // Informe l'autre participant qu'un utilisateur vient de rejoindre :
        // il pourra lui envoyer immédiatement sa position courante, de sorte
        // que les DEUX marqueurs soient visibles dès l'ouverture de la carte.
        socket.to(roomId).emit('meeting:peer-joined', { userId, sessionId });

        // Renvoie les dernières positions connues des deux participants.
        // Cela permet au client de resynchroniser l'état dès la (re)connexion
        // sans attendre le prochain signal GPS. On ajoute un timestamp (epoch
        // ms) pour que le client puisse ignorer une position plus ancienne
        // que celle qu'il affiche déjà (évite les marqueurs qui "reculent").
        const [locUser1, locUser2] = await Promise.all([
          Location.findByUserId(session.user1_id),
          Location.findByUserId(session.user2_id)
        ]);
        const withTimestamp = (loc) => {
          if (!loc) return null;
          const ts = new Date(loc.updated_at).getTime();
          return { ...loc, timestamp: isFinite(ts) ? ts : Date.now() };
        };
        const locations = {
          [session.user1_id]: withTimestamp(locUser1),
          [session.user2_id]: withTimestamp(locUser2)
        };

        if (callback) callback({ ok: true, roomId, session, locations });
      } catch (error) {
        if (callback) callback({ ok: false, message: 'Impossible de rejoindre la rencontre.' });
      }
    });

    // Nouvelle position signalée par un participant.
    // Sécurité : on vérifie systématiquement que l'utilisateur connecté
    // appartient bien à la session, puis on émet UNIQUEMENT vers le room de
    // SA session (jamais vers tous les clients connectés).
    socket.on('location:update', async (payload) => {
      try {
        const { sessionId, latitude, longitude, accuracy } = payload || {};
        if (!sessionId || typeof latitude !== 'number' || typeof longitude !== 'number') {
          return;
        }

        // Bornes géographiques : une position hors des valeurs plausibles
        // (latitude -90..90, longitude -180..180) est simplement ignorée.
        if (!isFinite(latitude) || !isFinite(longitude) ||
            latitude < -90 || latitude > 90 ||
            longitude < -180 || longitude > 180) {
          return;
        }

        const session = await MeetingSession.findActiveForUser(sessionId, userId);
        if (!session) {
          return;
        }

        await Location.upsert({ userId, latitude, longitude, accuracy });

        const updatedAt = new Date().toISOString();
        // Le timestamp GPS fourni par le navigateur est relayé : il permet au
        // client distant de classer les positions et d'ignorer une position
        // obsolète (stale) qui arriverait après une plus récente.
        const timestamp = Number.isFinite(payload.timestamp) ? payload.timestamp : Date.now();
        // 'socket.to(...)' exclut l'émetteur : seul l'autre participant du room
        // reçoit la position. Le nom/photo ne transitent pas ici (données privées).
        socket.to(meetingRoom(sessionId)).emit('location-update', {
          sessionId,
          userId,
          latitude,
          longitude,
          accuracy,
          updatedAt,
          timestamp
        });
      } catch (error) {
        socket.emit('location:error', { message: 'Position non envoyee.' });
      }
    });

    socket.on('disconnect', () => {
      // setOffline reçoit l'identifiant du socket : un utilisateur ouvert dans
      // plusieurs onglets reste "en ligne" tant qu'au moins un socket subsiste.
      setOffline(userId, socket.id);
      io.emit('users:online', listOnlineIds());
    });
  });
}

module.exports = attachLocationSocket;