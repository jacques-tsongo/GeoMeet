const db = require('../config/db');

async function upsert({ userId, latitude, longitude, accuracy }) {
  await db.execute(
    `INSERT INTO locations (user_id, latitude, longitude, accuracy)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       latitude = VALUES(latitude),
       longitude = VALUES(longitude),
       accuracy = VALUES(accuracy),
       updated_at = CURRENT_TIMESTAMP`,
    [userId, latitude, longitude, accuracy || null]
  );
}

async function findByUserId(userId) {
  const [rows] = await db.execute('SELECT * FROM locations WHERE user_id = ?', [userId]);
  return rows[0];
}

module.exports = { upsert, findByUserId };
