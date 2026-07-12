const { query } = require('../config/database');
const { createPasswordHash } = require('../config/auth');
const User = require('../models/userModel');

function normalizeEmail(email) {
  return String(email || '').toLowerCase().trim();
}

function normalizeText(value) {
  return String(value || '').trim();
}

function splitName(name) {
  const parts = normalizeText(name).split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return { firstName: '', middleName: '', lastName: '' };
  }

  if (parts.length === 1) {
    return { firstName: parts[0], middleName: '', lastName: parts[0] };
  }

  return {
    firstName: parts[0],
    middleName: parts.slice(1, -1).join(' '),
    lastName: parts[parts.length - 1],
  };
}

function normalizeNameParts({ firstName, middleName, lastName, name }) {
  const fallback = splitName(name);

  return {
    firstName: normalizeText(firstName) || fallback.firstName,
    middleName: normalizeText(middleName) || fallback.middleName,
    lastName: normalizeText(lastName) || fallback.lastName,
  };
}

function fullName({ firstName, middleName, lastName }) {
  return [firstName, middleName, lastName].map(normalizeText).filter(Boolean).join(' ');
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
    firstName: row.first_name,
    middleName: row.middle_name,
    lastName: row.last_name,
    name: row.name || fullName({
      firstName: row.first_name,
      middleName: row.middle_name,
      lastName: row.last_name,
    }),
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    status: row.status,
  });
}

async function getUsers() {
  const result = await query(`
    SELECT id, first_name, middle_name, last_name, email, password_hash, role, status
    FROM users
    ORDER BY created_at ASC;
  `);

  return result.rows.map(rowToUser);
}

async function getUserById(userId) {
  const result = await query(
    `
      SELECT id, first_name, middle_name, last_name, email, password_hash, role, status
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
      SELECT id, first_name, middle_name, last_name, email, password_hash, role, status
      FROM users
      WHERE email = $1
      LIMIT 1;
    `,
    [normalizeEmail(email)]
  );

  return rowToUser(result.rows[0]);
}

async function createUser({ firstName, middleName, lastName, name, email, password, role = 'user', status = 'pending' }) {
  const normalizedEmail = normalizeEmail(email);
  const names = normalizeNameParts({ firstName, middleName, lastName, name });
  const result = await query(
    `
      INSERT INTO users (id, first_name, middle_name, last_name, email, password_hash, role, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (email) DO NOTHING
      RETURNING id, first_name, middle_name, last_name, email, password_hash, role, status;
    `,
    [
      `user-${Date.now()}`,
      names.firstName,
      names.middleName || null,
      names.lastName,
      normalizedEmail,
      createPasswordHash(String(password || '')),
      normalizeRole(role),
      normalizeStatus(status),
    ]
  );

  return rowToUser(result.rows[0]);
}

async function updateUserStatus(userId, status, executor = { query }) {
  const result = await executor.query(
    `
      UPDATE users
      SET status = $2,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, first_name, middle_name, last_name, email, password_hash, role, status;
    `,
    [normalizeText(userId), normalizeStatus(status)]
  );

  return rowToUser(result.rows[0]);
}

async function upsertUser({ id, firstName, middleName, lastName, name, email, password, role, status }) {
  const names = normalizeNameParts({ firstName, middleName, lastName, name });
  const result = await query(
    `
      INSERT INTO users (id, first_name, middle_name, last_name, email, password_hash, role, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (email) DO NOTHING
      RETURNING id, first_name, middle_name, last_name, email, password_hash, role, status;
    `,
    [
      normalizeText(id),
      names.firstName,
      names.middleName || null,
      names.lastName,
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
