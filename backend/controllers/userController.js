const User = require('../models/User');

// Présence en ligne : un utilisateur peut avoir PLUSIEURS sockets simultanés
// (plusieurs onglets/navigateurs). On mémorise un ensemble de socketId par
// utilisateur : il n'est considéré hors ligne que lorsque le DERNIER socket
// se déconnecte.
const onlineUsers = new Map(); // userId (string) -> Set de socketId

function setOnline(userId, socketId) {
  const key = String(userId);
  if (!onlineUsers.has(key)) {
    onlineUsers.set(key, new Set());
  }
  onlineUsers.get(key).add(socketId);
}

// Renvoie true si l'utilisateur n'a plus AUCUN socket connecté.
function setOffline(userId, socketId) {
  const key = String(userId);
  const sockets = onlineUsers.get(key);
  if (!sockets) return true;
  sockets.delete(socketId);
  if (sockets.size === 0) {
    onlineUsers.delete(key);
    return true;
  }
  return false; // il reste au moins un autre onglet connecté
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
