const db = require('../config/db');

async function create({ nom, prenom, email, telephone, password, photo }) {
  const [result] = await db.execute(
    'INSERT INTO users (nom, prenom, email, telephone, password, photo) VALUES (?, ?, ?, ?, ?, ?)',
    [nom, prenom, email, telephone, password, photo || null]
  );
  return findById(result.insertId);
}

async function findByEmail(email) {
  const [rows] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);
  return rows[0];
}

async function findById(id) {
  const [rows] = await db.execute(
    'SELECT id, nom, prenom, email, telephone, photo, created_at, updated_at FROM users WHERE id = ?',
    [id]
  );
  return rows[0];
}

async function search(query, currentUserId) {
  const like = `%${query}%`;
  const [rows] = await db.execute(
    `SELECT id, nom, prenom, email, telephone, photo
     FROM users
     WHERE id <> ? AND (nom LIKE ? OR prenom LIKE ? OR email LIKE ?)
     ORDER BY prenom, nom
     LIMIT 20`,
    [currentUserId, like, like, like]
  );
  return rows;
}

module.exports = { create, findByEmail, findById, search };
