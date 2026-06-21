const db = require('../config/db');

async function create(senderId, receiverId) {
  const [result] = await db.execute(
    'INSERT INTO meeting_requests (sender_id, receiver_id) VALUES (?, ?)',
    [senderId, receiverId]
  );
  return findById(result.insertId);
}

async function findById(id) {
  const [rows] = await db.execute(
    `SELECT mr.*, 
      sender.nom AS sender_nom, sender.prenom AS sender_prenom, sender.photo AS sender_photo,
      receiver.nom AS receiver_nom, receiver.prenom AS receiver_prenom, receiver.photo AS receiver_photo
     FROM meeting_requests mr
     JOIN users sender ON sender.id = mr.sender_id
     JOIN users receiver ON receiver.id = mr.receiver_id
     WHERE mr.id = ?`,
    [id]
  );
  return rows[0];
}

async function updateStatus(id, status) {
  await db.execute('UPDATE meeting_requests SET status = ? WHERE id = ?', [status, id]);
  return findById(id);
}

async function listForUser(userId) {
  const [rows] = await db.execute(
    `SELECT mr.*,
      sender.nom AS sender_nom, sender.prenom AS sender_prenom, sender.photo AS sender_photo,
      receiver.nom AS receiver_nom, receiver.prenom AS receiver_prenom, receiver.photo AS receiver_photo
     FROM meeting_requests mr
     JOIN users sender ON sender.id = mr.sender_id
     JOIN users receiver ON receiver.id = mr.receiver_id
     WHERE mr.sender_id = ? OR mr.receiver_id = ?
     ORDER BY mr.created_at DESC`,
    [userId, userId]
  );
  return rows;
}

module.exports = { create, findById, updateStatus, listForUser };
