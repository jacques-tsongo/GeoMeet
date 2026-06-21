const jwt = require('jsonwebtoken');
const Location = require('../models/Location');
const { setOnline, setOffline, listOnlineIds } = require('../controllers/userController');

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

    socket.on('session:join', (sessionId) => {
      socket.join(`session:${sessionId}`);
    });

    socket.on('location:update', async (payload) => {
      const { sessionId, latitude, longitude, accuracy, user } = payload || {};
      if (!sessionId || typeof latitude !== 'number' || typeof longitude !== 'number') {
        return;
      }

      await Location.upsert({ userId, latitude, longitude, accuracy });
      socket.to(`session:${sessionId}`).emit('location:updated', {
        sessionId,
        userId,
        latitude,
        longitude,
        accuracy,
        user,
        updatedAt: new Date().toISOString()
      });
    });

    socket.on('disconnect', () => {
      setOffline(userId);
      io.emit('users:online', listOnlineIds());
    });
  });
}

module.exports = attachLocationSocket;
