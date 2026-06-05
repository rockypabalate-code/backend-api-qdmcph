const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const { overtimeWorkbookPath, overtimeWorksheets } = require('../config/auth');
const userExcelService = require('./userExcelService');

const sheetHeaders = {
  [overtimeWorksheets.departments]: ['departmentId', 'departmentName', 'headEmployeeId', 'status'],
  [overtimeWorksheets.employees]: [
    'employeeId',
    'userId',
    'employeeNo',
    'fullName',
    'departmentId',
    'position',
    'managerId',
    'employmentType',
    'hourlyRate',
    'status',
    'createdAt',
  ],
  [overtimeWorksheets.overtimeRequests]: [
    'overtimeId',
    'employeeId',
    'date',
    'startTime',
    'endTime',
    'breakMinutes',
    'totalHours',
    'reason',
    'status',
    'submittedBy',
    'submittedAt',
    'approvedBy',
    'approvedAt',
    'rejectedBy',
    'rejectedAt',
    'paidBy',
    'paidAt',
    'hourlyRate',
    'rateMultiplier',
    'overtimePay',
    'remarks',
  ],
  [overtimeWorksheets.approvalLogs]: ['logId', 'overtimeId', 'action', 'actionBy', 'actionAt', 'remarks'],
  [overtimeWorksheets.policies]: [
    'policyId',
    'name',
    'minimumHours',
    'maximumHoursPerDay',
    'requiresManagerApproval',
    'requiresHrApproval',
    'rateMultiplier',
    'status',
  ],
};

const starterRows = {
  [overtimeWorksheets.departments]: [
    {
      departmentId: 'DEP-IT',
      departmentName: 'IT Department',
      headEmployeeId: '',
      status: 'active',
    },
  ],
  [overtimeWorksheets.employees]: [],
  [overtimeWorksheets.overtimeRequests]: [],
  [overtimeWorksheets.approvalLogs]: [],
  [overtimeWorksheets.policies]: [
    {
      policyId: 'POL-001',
      name: 'Regular Overtime',
      minimumHours: 1,
      maximumHoursPerDay: 4,
      requiresManagerApproval: 'yes',
      requiresHrApproval: 'yes',
      rateMultiplier: 1.25,
      status: 'active',
    },
  ],
};

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}`;
}

function buildWorksheet(sheetName, rows) {
  return xlsx.utils.json_to_sheet(rows, { header: sheetHeaders[sheetName] });
}

function ensureWorkbookExists() {
  if (fs.existsSync(overtimeWorkbookPath)) {
    return;
  }

  fs.mkdirSync(path.dirname(overtimeWorkbookPath), { recursive: true });

  const workbook = xlsx.utils.book_new();

  Object.values(overtimeWorksheets).forEach((sheetName) => {
    xlsx.utils.book_append_sheet(workbook, buildWorksheet(sheetName, starterRows[sheetName]), sheetName);
  });

  xlsx.writeFile(workbook, overtimeWorkbookPath);
}

function readWorkbook() {
  ensureWorkbookExists();
  return xlsx.readFile(overtimeWorkbookPath);
}

function readSheet(sheetName) {
  const workbook = readWorkbook();
  const worksheet = workbook.Sheets[sheetName];

  if (!worksheet) {
    return [];
  }

  return xlsx.utils.sheet_to_json(worksheet, { defval: '' });
}

function writeSheet(sheetName, rows) {
  const workbook = readWorkbook();
  workbook.Sheets[sheetName] = buildWorksheet(sheetName, rows);

  if (!workbook.SheetNames.includes(sheetName)) {
    workbook.SheetNames.push(sheetName);
  }

  xlsx.writeFile(workbook, overtimeWorkbookPath);
}

function normalize(value) {
  return String(value || '').trim();
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function calculateTotalHours(startTime, endTime, breakMinutes) {
  const [startHour, startMinute] = normalize(startTime).split(':').map(Number);
  const [endHour, endMinute] = normalize(endTime).split(':').map(Number);

  if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) {
    return 0;
  }

  const startTotalMinutes = startHour * 60 + startMinute;
  let endTotalMinutes = endHour * 60 + endMinute;

  if (endTotalMinutes < startTotalMinutes) {
    endTotalMinutes += 24 * 60;
  }

  const workedMinutes = endTotalMinutes - startTotalMinutes - toNumber(breakMinutes);
  return Math.max(0, Math.round((workedMinutes / 60) * 100) / 100);
}

function getDepartments() {
  return readSheet(overtimeWorksheets.departments);
}

function createDepartment({ departmentName, headEmployeeId }) {
  const rows = getDepartments();
  const department = {
    departmentId: makeId('DEP'),
    departmentName: normalize(departmentName),
    headEmployeeId: normalize(headEmployeeId),
    status: 'active',
  };

  rows.push(department);
  writeSheet(overtimeWorksheets.departments, rows);

  return department;
}

function getEmployees() {
  return readSheet(overtimeWorksheets.employees);
}

function getEmployeeByUserId(userId) {
  const normalizedUserId = normalize(userId);

  return getEmployees().find((employee) => normalize(employee.userId) === normalizedUserId) || null;
}

function getEmployeeById(employeeId) {
  const normalizedEmployeeId = normalize(employeeId);

  return getEmployees().find((employee) => normalize(employee.employeeId) === normalizedEmployeeId) || null;
}

function createEmployee(employeeData) {
  const userId = normalize(employeeData.userId);

  if (!userExcelService.getUserById(userId)) {
    return {
      error: 'user_not_found',
      message: 'User ID does not exist.',
    };
  }

  const existingEmployee = getEmployeeByUserId(userId);

  if (existingEmployee) {
    const rows = getEmployees();
    const existingEmployeeIndex = rows.findIndex((employee) => normalize(employee.userId) === userId);

    if (existingEmployeeIndex !== -1 && normalize(employeeData.hourlyRate)) {
      rows[existingEmployeeIndex].hourlyRate = toNumber(employeeData.hourlyRate);
      writeSheet(overtimeWorksheets.employees, rows);
      existingEmployee.hourlyRate = rows[existingEmployeeIndex].hourlyRate;
    }

    userExcelService.updateUserStatus(userId, 'active');

    return {
      alreadyExists: true,
      employee: existingEmployee,
      message: 'This user already has an employee profile. Account has been activated.',
    };
  }

  const rows = getEmployees();
  const employee = {
    employeeId: makeId('EMP'),
    userId,
    employeeNo: normalize(employeeData.employeeNo),
    fullName: normalize(employeeData.fullName),
    departmentId: normalize(employeeData.departmentId),
    position: normalize(employeeData.position),
    managerId: normalize(employeeData.managerId),
    employmentType: normalize(employeeData.employmentType) || 'regular',
    hourlyRate: toNumber(employeeData.hourlyRate),
    status: 'active',
    createdAt: nowIso(),
  };

  rows.push(employee);
  writeSheet(overtimeWorksheets.employees, rows);

  if (employee.userId) {
    userExcelService.updateUserStatus(employee.userId, 'active');
  }

  return employee;
}

function getOvertimeRequests() {
  return readSheet(overtimeWorksheets.overtimeRequests);
}

function getOvertimeRequest(overtimeId) {
  return getOvertimeRequests().find((request) => request.overtimeId === overtimeId) || null;
}

function createOvertimeRequest(requestData, submittedBy) {
  const rows = getOvertimeRequests();
  const request = {
    overtimeId: makeId('OT'),
    employeeId: normalize(requestData.employeeId),
    date: normalize(requestData.date),
    startTime: normalize(requestData.startTime),
    endTime: normalize(requestData.endTime),
    breakMinutes: toNumber(requestData.breakMinutes),
    totalHours: calculateTotalHours(requestData.startTime, requestData.endTime, requestData.breakMinutes),
    reason: normalize(requestData.reason),
    status: 'pending',
    submittedBy: normalize(submittedBy),
    submittedAt: nowIso(),
    approvedBy: '',
    approvedAt: '',
    rejectedBy: '',
    rejectedAt: '',
    paidBy: '',
    paidAt: '',
    hourlyRate: '',
    rateMultiplier: '',
    overtimePay: '',
    remarks: '',
  };

  rows.push(request);
  writeSheet(overtimeWorksheets.overtimeRequests, rows);

  return request;
}

function addApprovalLog(overtimeId, action, actionBy, remarks) {
  const rows = readSheet(overtimeWorksheets.approvalLogs);
  const log = {
    logId: makeId('LOG'),
    overtimeId,
    action,
    actionBy: normalize(actionBy),
    actionAt: nowIso(),
    remarks: normalize(remarks),
  };

  rows.push(log);
  writeSheet(overtimeWorksheets.approvalLogs, rows);

  return log;
}

function updateOvertimeStatus(overtimeId, status, actionBy, remarks) {
  const rows = getOvertimeRequests();
  const requestIndex = rows.findIndex((request) => request.overtimeId === overtimeId);

  if (requestIndex === -1) {
    return null;
  }

  const request = rows[requestIndex];
  const timestamp = nowIso();

  if (status === 'paid' && request.status !== 'approved') {
    return {
      error: 'invalid_status_transition',
      message: 'Only approved overtime requests can be marked as paid.',
    };
  }

  if (status === 'paid') {
    const employee = getEmployeeById(request.employeeId);
    const hourlyRate = employee ? toNumber(employee.hourlyRate) : 0;
    const policy = getActivePolicy();
    const rateMultiplier = policy ? toNumber(policy.rateMultiplier, 1) : 1;

    if (!employee) {
      return {
        error: 'employee_not_found',
        message: 'Employee ID does not exist.',
      };
    }

    if (hourlyRate <= 0) {
      return {
        error: 'hourly_rate_required',
        message: 'Employee hourly rate is required before marking overtime as paid.',
      };
    }

    request.hourlyRate = hourlyRate;
    request.rateMultiplier = rateMultiplier;
    request.overtimePay = roundMoney(toNumber(request.totalHours) * hourlyRate * rateMultiplier);
  }

  request.status = status;
  request.remarks = normalize(remarks);

  if (status === 'approved') {
    request.approvedBy = normalize(actionBy);
    request.approvedAt = timestamp;
  }

  if (status === 'rejected') {
    request.rejectedBy = normalize(actionBy);
    request.rejectedAt = timestamp;
  }

  if (status === 'paid') {
    request.paidBy = normalize(actionBy);
    request.paidAt = timestamp;
  }

  rows[requestIndex] = request;
  writeSheet(overtimeWorksheets.overtimeRequests, rows);
  addApprovalLog(overtimeId, status, actionBy, remarks);

  return request;
}

function getApprovalLogs(overtimeId) {
  const logs = readSheet(overtimeWorksheets.approvalLogs);

  if (!overtimeId) {
    return logs;
  }

  return logs.filter((log) => log.overtimeId === overtimeId);
}

function getPolicies() {
  return readSheet(overtimeWorksheets.policies);
}

function getActivePolicy() {
  return getPolicies().find((policy) => normalize(policy.status).toLowerCase() === 'active') || null;
}

module.exports = {
  createDepartment,
  createEmployee,
  createOvertimeRequest,
  getEmployeeById,
  getEmployeeByUserId,
  getApprovalLogs,
  getDepartments,
  getEmployees,
  getOvertimeRequest,
  getOvertimeRequests,
  getPolicies,
  updateOvertimeStatus,
};
