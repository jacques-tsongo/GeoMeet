const jwt = require('jsonwebtoken');
const Location = require('../models/Location');
const MeetingSession = require('../models/MeetingSession');
const { setOnline, setOffline, listOnlineIds } = require('../controllers/userController');

function meetingRoom(sessionId) {
  return `meeting_${sessionId}`;
}

function attachLocationSocket(io) {
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
    socket.join(`user:${userId}`);
    io.emit('users:online', listOnlineIds());

    socket.on('meeting:join', async (sessionId, callback) => {
      try {
        const session = await MeetingSession.findActiveForUser(sessionId, userId);
        if (!session) {
          if (callback) callback({ ok: false, message: 'Session introuvable ou non autorisee.' });
          return;
        }

        const roomId = meetingRoom(sessionId);
        socket.join(roomId);
        if (callback) callback({ ok: true, roomId });
      } catch (error) {
        if (callback) callback({ ok: false, message: 'Impossible de rejoindre la rencontre.' });
      }
    });

    socket.on('location:update', async (payload) => {
      try {
        const { sessionId, latitude, longitude, accuracy, user } = payload || {};
        if (!sessionId || typeof latitude !== 'number' || typeof longitude !== 'number') {
          return;
        }

        const session = await MeetingSession.findActiveForUser(sessionId, userId);
        if (!session) {
          return;
        }

        await Location.upsert({ userId, latitude, longitude, accuracy });
        socket.to(meetingRoom(sessionId)).emit('location-update', {
          sessionId,
          userId,
          latitude,
          longitude,
          accuracy,
          user,
          updatedAt: new Date().toISOString()
        });
      } catch (error) {
        socket.emit('location:error', { message: 'Position non envoyee.' });
      }
    });

    socket.on('disconnect', () => {
      setOffline(userId);
      io.emit('users:online', listOnlineIds());
    });
  });
}

module.exports = attachLocationSocket;
