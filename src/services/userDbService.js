const { query } = require('../config/database');
const { createPasswordHash } = require('../config/auth');
const User = require('../models/userModel');

function normalizeEmail(email) {
  return String(email || '').toLowerCase().trim();
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeRole(role) {
  return String(role || 'user').toLowerCase().trim();
}

function normalizeStatus(status) {
  return String(status || 'pending').toLowerCase().trim();
}

function rowToUser(row) {
  if (!row) {
    return null;
  }

  return new User({
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    status: row.status,
  });
}

async function getUsers() {
  const result = await query(`
    SELECT id, name, email, password_hash, role, status
    FROM users
    ORDER BY created_at ASC;
  `);

  return result.rows.map(rowToUser);
}

async function getUserById(userId) {
  const result = await query(
    `
      SELECT id, name, email, password_hash, role, status
      FROM users
      WHERE id = $1
      LIMIT 1;
    `,
    [normalizeText(userId)]
  );

  return rowToUser(result.rows[0]);
}

async function getUserByEmail(email) {
  const result = await query(
    `
      SELECT id, name, email, password_hash, role, status
      FROM users
      WHERE email = $1
      LIMIT 1;
    `,
    [normalizeEmail(email)]
  );

  return rowToUser(result.rows[0]);
}

async function createUser({ name, email, password }) {
  const normalizedEmail = normalizeEmail(email);
  const result = await query(
    `
      INSERT INTO users (id, name, email, password_hash, role, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (email) DO NOTHING
      RETURNING id, name, email, password_hash, role, status;
    `,
    [
      `user-${Date.now()}`,
      normalizeText(name),
      normalizedEmail,
      createPasswordHash(String(password || '')),
      'user',
      'pending',
    ]
  );

  return rowToUser(result.rows[0]);
}

async function updateUserStatus(userId, status) {
  const result = await query(
    `
      UPDATE users
      SET status = $2,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, name, email, password_hash, role, status;
    `,
    [normalizeText(userId), normalizeStatus(status)]
  );

  return rowToUser(result.rows[0]);
}

async function upsertUser({ id, name, email, password, role, status }) {
  const result = await query(
    `
      INSERT INTO users (id, name, email, password_hash, role, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (email) DO NOTHING
      RETURNING id, name, email, password_hash, role, status;
    `,
    [
      normalizeText(id),
      normalizeText(name),
      normalizeEmail(email),
      createPasswordHash(String(password || '')),
      normalizeRole(role),
      normalizeStatus(status),
    ]
  );

  return rowToUser(result.rows[0]);
}

module.exports = {
  createUser,
  getUserByEmail,
  getUserById,
  getUsers,
  updateUserStatus,
  upsertUser,
};
