const User = require('../models/User');

const onlineUsers = new Map();

function setOnline(userId, socketId) {
  onlineUsers.set(String(userId), socketId);
}

function setOffline(userId) {
  onlineUsers.delete(String(userId));
}

function isOnline(userId) {
  return onlineUsers.has(String(userId));
}

function listOnlineIds() {
  return Array.from(onlineUsers.keys()).map(Number);
}

async function searchUsers(req, res) {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) {
      return res.json([]);
    }

    const users = await User.search(q, req.user.id);
    return res.json(users.map((user) => ({ ...user, online: isOnline(user.id) })));
  } catch (error) {
    return res.status(500).json({ message: 'Erreur lors de la recherche.', error: error.message });
  }
}

async function me(req, res) {
  try {
    const user = await User.findById(req.user.id);
    return res.json({ ...user, online: true });
  } catch (error) {
    return res.status(500).json({ message: 'Erreur utilisateur.', error: error.message });
  }
}

module.exports = { searchUsers, me, setOnline, setOffline, isOnline, listOnlineIds };
