const crypto = require('crypto');
const { createPasswordHash, tokenExpiresInSeconds, tokenSecret } = require('../config/auth');
const overtimeExcelService = require('./overtimeExcelService');
const userExcelService = require('./userExcelService');

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

function verifyToken(token) {
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

  const user = userExcelService.getUsers().find((existingUser) => existingUser.id === decodedPayload.sub) || null;

  if (!user || !canAccessAccount(user)) {
    return null;
  }

  return user;
}

function canAccessAccount(user) {
  if (user.status !== 'active') {
    return false;
  }

  if (user.role === 'user') {
    return Boolean(overtimeExcelService.getEmployeeByUserId(user.id));
  }

  return true;
}

function login(email, password) {
  const normalizedEmail = String(email || '').toLowerCase().trim();
  const users = userExcelService.getUsers();
  const user = users.find((existingUser) => existingUser.email === normalizedEmail);

  if (!user || !verifyPassword(String(password || ''), user.passwordHash)) {
    return {
      error: 'invalid_credentials',
      message: 'Invalid email or password.',
    };
  }

  if (!canAccessAccount(user)) {
    return {
      error: 'pending_employee_verification',
      message: 'Your account is pending employee verification.',
    };
  }

  return {
    token: createToken(user),
    user: user.toJSON(),
  };
}

function register({ name, email, password }) {
  const user = userExcelService.createUser({ name, email, password });

  if (!user) {
    return null;
  }

  return {
    user: user.toJSON(),
    message: 'Account registered. Please wait for admin or HR employee verification before logging in.',
  };
}

module.exports = {
  login,
  register,
  verifyToken,
};
