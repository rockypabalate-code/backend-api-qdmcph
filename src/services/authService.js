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

  try {
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

    if (!user || !isAccountActive(user)) {
      return null;
    }

    if (user.role === 'user') {
      const employeeProfile = await overtimeDbService.getEmployeeByUserId(user.id);

      if (!employeeProfile) {
        return null;
      }
    }

    return user;
  } catch (error) {
    return null;
  }
}

function isAccountActive(user) {
  return user.status === 'active';
}

async function login(email, password) {
  const normalizedEmail = String(email || '').toLowerCase().trim();
  const user = await userDbService.getUserByEmail(normalizedEmail);

  if (!user || !verifyPassword(String(password || ''), user.passwordHash)) {
    throw new AppError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
  }

  if (!isAccountActive(user)) {
    throw new AppError(
      'Your account is not active. Please contact the administrator.',
      403,
      'ACCOUNT_NOT_ACTIVE'
    );
  }

  const employeeProfile = user.role === 'user'
    ? await overtimeDbService.getEmployeeByUserId(user.id)
    : null;

  if (user.role === 'user' && !employeeProfile) {
    throw new AppError(
      'Employee profile is required before this user can log in. Please contact the administrator.',
      403,
      'EMPLOYEE_PROFILE_REQUIRED'
    );
  }

  return {
    token: createToken(user),
    user: {
      ...user.toJSON(),
      hasEmployeeProfile: user.role !== 'user' || Boolean(employeeProfile),
      employeeId: employeeProfile ? employeeProfile.employeeId : null,
    },
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
  const normalizedStatus = String(status || 'active').toLowerCase().trim();
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
    message: user.role === 'user'
      ? 'Account created by admin. Create the employee profile before the user can log in.'
      : 'Account created by admin.',
  };
}

async function listAccounts({ requestedBy }) {
  if (!requestedBy || requestedBy.role !== 'admin') {
    throw new AppError('Only admin users can view accounts.', 403, 'ADMIN_ONLY_ACCOUNT_LIST');
  }

  const users = await userDbService.getUsers();
  return {
    users: users.map((user) => user.toJSON()),
  };
}

function requireNonEmptyNameForUpdate(updates) {
  if (Object.prototype.hasOwnProperty.call(updates, 'firstName') && !String(updates.firstName || '').trim()) {
    throw new AppError('First name cannot be empty.', 400, 'FIRST_NAME_REQUIRED');
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'lastName') && !String(updates.lastName || '').trim()) {
    throw new AppError('Last name cannot be empty.', 400, 'LAST_NAME_REQUIRED');
  }
}

async function updateAccount(userId, updates, { updatedBy }) {
  if (!updatedBy || updatedBy.role !== 'admin') {
    throw new AppError('Only admin users can update accounts.', 403, 'ADMIN_ONLY_ACCOUNT_UPDATE');
  }

  const existingUser = await userDbService.getUserById(userId);

  if (!existingUser) {
    throw new AppError('Account not found.', 404, 'ACCOUNT_NOT_FOUND');
  }

  const allowedUpdates = {};

  if (Object.prototype.hasOwnProperty.call(updates, 'firstName')) {
    allowedUpdates.firstName = updates.firstName;
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'middleName')) {
    allowedUpdates.middleName = updates.middleName;
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'lastName')) {
    allowedUpdates.lastName = updates.lastName;
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'email')) {
    const email = String(updates.email || '').toLowerCase().trim();

    if (!email) {
      throw new AppError('Email cannot be empty.', 400, 'EMAIL_REQUIRED');
    }

    allowedUpdates.email = email;
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'password')) {
    if (!String(updates.password || '').trim()) {
      throw new AppError('Password cannot be empty.', 400, 'PASSWORD_REQUIRED');
    }

    allowedUpdates.password = updates.password;
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'role')) {
    allowedUpdates.role = normalizeRole(updates.role);
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'status')) {
    allowedUpdates.status = normalizeStatus(updates.status);
  }

  requireNonEmptyNameForUpdate(allowedUpdates);

  const nextRole = allowedUpdates.role || existingUser.role;
  const nextStatus = allowedUpdates.status || existingUser.status;

  if (updatedBy.id === existingUser.id && (nextRole !== 'admin' || nextStatus !== 'active')) {
    throw new AppError('You cannot remove your own active admin access.', 400, 'CANNOT_REMOVE_OWN_ADMIN_ACCESS');
  }

  if (existingUser.role === 'admin' && existingUser.status === 'active' && (nextRole !== 'admin' || nextStatus !== 'active')) {
    const activeAdminCount = await userDbService.countActiveAdmins();

    if (activeAdminCount <= 1) {
      throw new AppError('Cannot remove the last active admin account.', 400, 'LAST_ACTIVE_ADMIN');
    }
  }

  const user = await userDbService.updateUser(existingUser.id, allowedUpdates);

  return {
    user: user.toJSON(),
    message: 'Account updated successfully.',
  };
}

async function deleteAccount(userId, { deletedBy }) {
  const result = await userDbService.deleteUserAccount(userId, deletedBy);

  return {
    deletedUser: result.user,
    deletedEmployeeId: result.deletedEmployeeId,
    message: result.deletedEmployeeId
      ? 'Account and linked employee profile were deleted successfully.'
      : 'Account deleted successfully.',
  };
}


async function forceDeleteAccount(userId, { deletedBy, adminPassword }) {
  if (!deletedBy || deletedBy.role !== 'admin') {
    throw new AppError('Only admin users can force delete accounts.', 403, 'ADMIN_ONLY_FORCE_ACCOUNT_DELETE');
  }

  if (!String(adminPassword || '').trim()) {
    throw new AppError('Admin password is required to force delete an account.', 400, 'ADMIN_PASSWORD_REQUIRED');
  }

  const adminUser = await userDbService.getUserById(deletedBy.id);

  if (!adminUser || !verifyPassword(String(adminPassword || ''), adminUser.passwordHash)) {
    throw new AppError('Admin password is incorrect.', 401, 'INVALID_ADMIN_PASSWORD');
  }

  const result = await userDbService.forceDeleteUserAccount(userId, deletedBy);

  return {
    deletedUser: result.user,
    deletedEmployeeId: result.deletedEmployeeId,
    deletedOvertimeCount: result.deletedOvertimeCount,
    reassignedReferences: result.reassignedReferences,
    message: 'Account was force deleted successfully. Linked employee overtime records were deleted and remaining user references were reassigned to the deleting admin account.',
  };
}

module.exports = {
  createAccount,
  deleteAccount,
  forceDeleteAccount,
  listAccounts,
  login,
  register: createAccount,
  updateAccount,
  verifyToken,
};
