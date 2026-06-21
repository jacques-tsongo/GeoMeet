const db = require('../config/db');

async function create(user1Id, user2Id, requestId) {
  const [result] = await db.execute(
    'INSERT INTO meeting_sessions (user1_id, user2_id, request_id) VALUES (?, ?, ?)',
    [user1Id, user2Id, requestId]
  );
  return findById(result.insertId);
}

async function findById(id) {
  const [rows] = await db.execute(
    `SELECT ms.*,
      u1.nom AS user1_nom, u1.prenom AS user1_prenom, u1.photo AS user1_photo,
      u2.nom AS user2_nom, u2.prenom AS user2_prenom, u2.photo AS user2_photo
     FROM meeting_sessions ms
     JOIN users u1 ON u1.id = ms.user1_id
     JOIN users u2 ON u2.id = ms.user2_id
     WHERE ms.id = ?`,
    [id]
  );
  return rows[0];
}

async function listActiveForUser(userId) {
  const [rows] = await db.execute(
    `SELECT ms.*,
      u1.nom AS user1_nom, u1.prenom AS user1_prenom, u1.photo AS user1_photo,
      u2.nom AS user2_nom, u2.prenom AS user2_prenom, u2.photo AS user2_photo
     FROM meeting_sessions ms
     JOIN users u1 ON u1.id = ms.user1_id
     JOIN users u2 ON u2.id = ms.user2_id
     WHERE ms.is_active = TRUE AND (ms.user1_id = ? OR ms.user2_id = ?)
     ORDER BY ms.started_at DESC`,
    [userId, userId]
  );
  return rows;
}

async function end(id, userId) {
  await db.execute(
    `UPDATE meeting_sessions
     SET is_active = FALSE, ended_at = NOW()
     WHERE id = ? AND (user1_id = ? OR user2_id = ?)`,
    [id, userId, userId]
  );
  return findById(id);
}

module.exports = { create, findById, listActiveForUser, end };
