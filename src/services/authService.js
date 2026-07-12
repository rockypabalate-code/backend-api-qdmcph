const crypto = require('crypto');
const { createPasswordHash, tokenExpiresInSeconds, tokenSecret } = require('../config/auth');
const overtimeDbService = require('./overtimeDbService');
const userDbService = require('./userDbService');
const AppError = require('../utils/appError');

function base64UrlEncode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function base64UrlDecode(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function sign(value) {
  return crypto.createHmac('sha256', tokenSecret).update(value).digest('base64url');
}

function secureCompare(value, expectedValue) {
  const valueBuffer = Buffer.from(value);
  const expectedValueBuffer = Buffer.from(expectedValue);

  if (valueBuffer.length !== expectedValueBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(valueBuffer, expectedValueBuffer);
}

function createToken(user) {
  const header = base64UrlEncode({ alg: 'HS256', typ: 'JWT' });
  const payload = base64UrlEncode({
    sub: user.id,
    email: user.email,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + tokenExpiresInSeconds,
  });
  const unsignedToken = `${header}.${payload}`;

  return `${unsignedToken}.${sign(unsignedToken)}`;
}

function verifyPassword(password, storedPasswordHash) {
  const [salt, storedHash] = storedPasswordHash.split(':');
  const passwordHash = createPasswordHash(password, salt).split(':')[1];

  return secureCompare(passwordHash, storedHash);
}

async function verifyToken(token) {
  if (!token) {
    return null;
  }

  const [header, payload, signature] = token.split('.');

  if (!header || !payload || !signature) {
    return null;
  }

  const unsignedToken = `${header}.${payload}`;
  const expectedSignature = sign(unsignedToken);

  if (!secureCompare(signature, expectedSignature)) {
    return null;
  }

  const decodedPayload = base64UrlDecode(payload);

  if (decodedPayload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  const user = await userDbService.getUserById(decodedPayload.sub);

  if (!user || !await canAccessAccount(user)) {
    return null;
  }

  return user;
}

async function canAccessAccount(user) {
  if (user.status !== 'active') {
    return false;
  }

  if (user.role === 'user') {
    return Boolean(await overtimeDbService.getEmployeeByUserId(user.id));
  }

  return true;
}

async function login(email, password) {
  const normalizedEmail = String(email || '').toLowerCase().trim();
  const user = await userDbService.getUserByEmail(normalizedEmail);

  if (!user || !verifyPassword(String(password || ''), user.passwordHash)) {
    throw new AppError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
  }

  if (!await canAccessAccount(user)) {
    throw new AppError(
      'Your account is pending employee verification.',
      403,
      'PENDING_EMPLOYEE_VERIFICATION'
    );
  }

  return {
    token: createToken(user),
    user: user.toJSON(),
  };
}


function normalizeRole(role) {
  const normalizedRole = String(role || 'user').toLowerCase().trim();
  const allowedRoles = ['admin', 'hr', 'manager', 'user'];

  if (!allowedRoles.includes(normalizedRole)) {
    throw new AppError('Invalid role. Allowed roles are admin, hr, manager, and user.', 400, 'INVALID_ROLE');
  }

  return normalizedRole;
}

function normalizeStatus(status) {
  const normalizedStatus = String(status || 'pending').toLowerCase().trim();
  const allowedStatuses = ['active', 'pending', 'inactive'];

  if (!allowedStatuses.includes(normalizedStatus)) {
    throw new AppError('Invalid status. Allowed statuses are active, pending, and inactive.', 400, 'INVALID_STATUS');
  }

  return normalizedStatus;
}

async function createAccount({ firstName, middleName, lastName, name, email, password, role, status, createdBy }) {
  if (!createdBy || createdBy.role !== 'admin') {
    throw new AppError('Only admin users can create accounts.', 403, 'ADMIN_ONLY_ACCOUNT_CREATION');
  }

  const user = await userDbService.createUser({
    firstName,
    middleName,
    lastName,
    name,
    email,
    password,
    role: normalizeRole(role),
    status: normalizeStatus(status),
  });

  if (!user) {
    throw new AppError('Email is already registered.', 409, 'EMAIL_ALREADY_REGISTERED');
  }

  return {
    user: user.toJSON(),
    message: 'Account created by admin. Create the employee profile next to complete employee access.',
  };
}

module.exports = {
  createAccount,
  login,
  register: createAccount,
  verifyToken,
};
