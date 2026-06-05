const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const User = require('../models/userModel');
const { createPasswordHash, usersWorkbookPath, usersWorksheetName } = require('../config/auth');

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

function ensureWorkbookExists() {
  if (fs.existsSync(usersWorkbookPath)) {
    return;
  }

  fs.mkdirSync(path.dirname(usersWorkbookPath), { recursive: true });

  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.json_to_sheet(starterUsers);

  xlsx.utils.book_append_sheet(workbook, worksheet, usersWorksheetName);
  xlsx.writeFile(workbook, usersWorkbookPath);
}

function readRows() {
  ensureWorkbookExists();

  const workbook = xlsx.readFile(usersWorkbookPath);
  const worksheet = workbook.Sheets[usersWorksheetName] || workbook.Sheets[workbook.SheetNames[0]];

  if (!worksheet) {
    return [];
  }

  return xlsx.utils.sheet_to_json(worksheet, { defval: '' });
}

function writeRows(rows) {
  fs.mkdirSync(path.dirname(usersWorkbookPath), { recursive: true });

  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.json_to_sheet(rows);

  xlsx.utils.book_append_sheet(workbook, worksheet, usersWorksheetName);
  xlsx.writeFile(workbook, usersWorkbookPath);
}

function getUsers() {
  return readRows()
    .filter((row) => row.id && row.email && row.password && row.role)
    .map((row) => new User({
      id: String(row.id).trim(),
      name: String(row.name || '').trim(),
      email: String(row.email).toLowerCase().trim(),
      passwordHash: createPasswordHash(String(row.password)),
      role: String(row.role).toLowerCase().trim(),
      status: String(row.status || 'active').toLowerCase().trim(),
    }));
}

function getUserById(userId) {
  const normalizedUserId = String(userId || '').trim();

  return getUsers().find((user) => user.id === normalizedUserId) || null;
}

function createUser({ name, email, password }) {
  const rows = readRows();
  const normalizedEmail = String(email || '').toLowerCase().trim();
  const userExists = rows.some((row) => String(row.email || '').toLowerCase().trim() === normalizedEmail);

  if (userExists) {
    return null;
  }

  const userRow = {
    id: `user-${Date.now()}`,
    name: String(name || '').trim(),
    email: normalizedEmail,
    password: String(password || ''),
    role: 'user',
    status: 'pending',
  };

  rows.push(userRow);
  writeRows(rows);

  return new User({
    id: userRow.id,
    name: userRow.name,
    email: userRow.email,
    passwordHash: createPasswordHash(userRow.password),
    role: userRow.role,
    status: userRow.status,
  });
}

function updateUserStatus(userId, status) {
  const rows = readRows();
  const normalizedUserId = String(userId || '').trim();
  const userIndex = rows.findIndex((row) => String(row.id || '').trim() === normalizedUserId);

  if (userIndex === -1) {
    return null;
  }

  rows[userIndex].status = String(status || '').toLowerCase().trim();
  writeRows(rows);

  return getUserById(normalizedUserId);
}

module.exports = {
  createUser,
  getUserById,
  getUsers,
  updateUserStatus,
};
