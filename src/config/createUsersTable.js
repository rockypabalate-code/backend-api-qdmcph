const { closePool, query } = require('./database');
const userDbService = require('../services/userDbService');

const starterUsers = [
  {
    id: 'admin-1',
    firstName: 'Admin',
    middleName: '',
    lastName: 'User',
    email: 'admin@example.com',
    password: 'Admin@123',
    role: 'admin',
    status: 'active',
  },
  {
    id: 'user-1',
    firstName: 'Regular',
    middleName: '',
    lastName: 'User',
    email: 'user@example.com',
    password: 'User@123',
    role: 'user',
    status: 'pending',
  },
];

async function createUsersTable() {
  // User names are stored here as the single source of truth.
  // Employee records should link to users through user_id instead of duplicating names.
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      middle_name TEXT,
      last_name TEXT NOT NULL,
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

  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;');
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS middle_name TEXT;');
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT;');
  await query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'users'
          AND column_name = 'name'
      ) THEN
        UPDATE users
        SET first_name = COALESCE(NULLIF(first_name, ''), split_part(name, ' ', 1), 'User'),
            last_name = COALESCE(NULLIF(last_name, ''), NULLIF(regexp_replace(name, '^.*\\s+', ''), ''), split_part(name, ' ', 1), 'User')
        WHERE first_name IS NULL
           OR last_name IS NULL;
      END IF;
    END $$;
  `);
  await query(`
    UPDATE users
    SET first_name = 'User'
    WHERE first_name IS NULL OR first_name = '';
  `);
  await query(`
    UPDATE users
    SET last_name = first_name
    WHERE last_name IS NULL OR last_name = '';
  `);
  await query('ALTER TABLE users ALTER COLUMN first_name SET NOT NULL;');
  await query('ALTER TABLE users ALTER COLUMN last_name SET NOT NULL;');
  await query('ALTER TABLE users DROP COLUMN IF EXISTS name;');

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
