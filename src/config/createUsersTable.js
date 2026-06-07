const { closePool, query } = require('./database');
const userDbService = require('../services/userDbService');

const starterUsers = [
  {
    id: 'admin-1',
    name: 'Admin',
    email: 'admin@example.com',
    password: 'Admin@123',
    role: 'admin',
    status: 'active',
  },
  {
    id: 'user-1',
    name: 'User',
    email: 'user@example.com',
    password: 'User@123',
    role: 'user',
    status: 'pending',
  },
];

async function createUsersTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT users_role_check CHECK (role IN ('admin', 'user', 'hr', 'manager')),
      CONSTRAINT users_status_check CHECK (status IN ('active', 'pending', 'inactive'))
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS users_email_idx
    ON users (email);
  `);

  await Promise.all(starterUsers.map((user) => userDbService.upsertUser(user)));

  console.log('Users table is ready.');
}

createUsersTable()
  .catch((error) => {
    console.error('Failed to create users table.');
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
