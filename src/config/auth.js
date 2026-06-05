const crypto = require('crypto');
const path = require('path');

const tokenSecret = process.env.AUTH_TOKEN_SECRET || 'change-this-secret-in-env';
const tokenExpiresInSeconds = Number(process.env.AUTH_TOKEN_EXPIRES_IN_SECONDS || 60 * 60);
const usersWorkbookPath = process.env.USERS_WORKBOOK_PATH || path.join(__dirname, '../../data/users.xlsx');
const usersWorksheetName = process.env.USERS_WORKSHEET_NAME || 'Users';
const overtimeWorkbookPath = process.env.OVERTIME_WORKBOOK_PATH || path.join(__dirname, '../../data/overtime.xlsx');
const overtimeWorksheets = {
  approvalLogs: process.env.OVERTIME_APPROVAL_LOGS_SHEET || 'ApprovalLogs',
  departments: process.env.OVERTIME_DEPARTMENTS_SHEET || 'Departments',
  employees: process.env.OVERTIME_EMPLOYEES_SHEET || 'Employees',
  overtimeRequests: process.env.OVERTIME_REQUESTS_SHEET || 'OvertimeRequests',
  policies: process.env.OVERTIME_POLICIES_SHEET || 'OvertimePolicies',
};

function createPasswordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');

  return `${salt}:${hash}`;
}

module.exports = {
  createPasswordHash,
  overtimeWorkbookPath,
  overtimeWorksheets,
  tokenExpiresInSeconds,
  tokenSecret,
  usersWorkbookPath,
  usersWorksheetName,
};
