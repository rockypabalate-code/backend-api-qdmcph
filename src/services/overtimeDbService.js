const { query } = require('../config/database');
const userDbService = require('./userDbService');

function normalize(value) {
  return String(value || '').trim();
}

function nullable(value) {
  const normalized = normalize(value);
  return normalized || null;
}

function splitName(name) {
  const parts = normalize(name).split(/\s+/).filter(Boolean);

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

function normalizeNameParts({ firstName, middleName, lastName, fullName }) {
  const fallback = splitName(fullName);

  return {
    firstName: normalize(firstName) || fallback.firstName,
    middleName: normalize(middleName) || fallback.middleName,
    lastName: normalize(lastName) || fallback.lastName,
  };
}

function buildFullName({ firstName, middleName, lastName }) {
  return [firstName, middleName, lastName].map(normalize).filter(Boolean).join(' ');
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeShift(value) {
  const shift = normalize(value).toLowerCase();
  return ['day', 'night'].includes(shift) ? shift : 'day';
}

function toBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  return ['true', '1', 'yes', 'leader'].includes(normalize(value).toLowerCase());
}

function getLeaderFlag(employeeData) {
  if (Object.prototype.hasOwnProperty.call(employeeData, 'isDepartmentLeader')) {
    return employeeData.isDepartmentLeader;
  }

  return employeeData.isLeader;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : value || '';
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

function mapDepartment(row) {
  return {
    departmentId: row.department_id,
    departmentName: row.department_name,
    parentDepartmentId: row.parent_department_id || '',
    headEmployeeId: row.head_employee_id || '',
    status: row.status,
  };
}

function mapEmployee(row) {
  return {
    employeeId: row.employee_id,
    userId: row.user_id,
    employeeNo: row.employee_no || '',
    firstName: row.first_name,
    middleName: row.middle_name || '',
    lastName: row.last_name,
    fullName: buildFullName({
      firstName: row.first_name,
      middleName: row.middle_name,
      lastName: row.last_name,
    }),
    departmentId: row.department_id,
    position: row.position || '',
    managerId: row.manager_id || '',
    shift: row.shift,
    employmentType: row.employment_type,
    dailyRate: toNumber(row.daily_rate),
    isDepartmentLeader: Boolean(row.is_department_leader),
    status: row.status,
    createdAt: iso(row.created_at),
  };
}

function mapOvertimeRequest(row) {
  return {
    overtimeId: row.overtime_id,
    employeeId: row.employee_id,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    breakMinutes: toNumber(row.break_minutes),
    totalHours: toNumber(row.total_hours),
    reason: row.reason,
    status: row.status,
    submittedBy: row.submitted_by,
    submittedAt: iso(row.submitted_at),
    approvedBy: row.approved_by || '',
    approvedAt: iso(row.approved_at),
    rejectedBy: row.rejected_by || '',
    rejectedAt: iso(row.rejected_at),
    paidBy: row.paid_by || '',
    paidAt: iso(row.paid_at),
    hourlyRate: row.hourly_rate === null ? '' : toNumber(row.hourly_rate),
    rateMultiplier: row.rate_multiplier === null ? '' : toNumber(row.rate_multiplier),
    overtimePay: row.overtime_pay === null ? '' : toNumber(row.overtime_pay),
    remarks: row.remarks || '',
  };
}

function mapApprovalLog(row) {
  return {
    logId: row.log_id,
    overtimeId: row.overtime_id,
    action: row.action,
    actionBy: row.action_by,
    actionAt: iso(row.action_at),
    remarks: row.remarks || '',
  };
}

function mapPolicy(row) {
  return {
    policyId: row.policy_id,
    name: row.name,
    minimumHours: toNumber(row.minimum_hours),
    maximumHoursPerDay: toNumber(row.maximum_hours_per_day),
    requiresManagerApproval: row.requires_manager_approval ? 'yes' : 'no',
    requiresHrApproval: row.requires_hr_approval ? 'yes' : 'no',
    rateMultiplier: toNumber(row.rate_multiplier),
    status: row.status,
  };
}

async function getDepartments() {
  const result = await query(`
    SELECT department_id, department_name, parent_department_id, head_employee_id, status
    FROM departments
    ORDER BY COALESCE(parent_department_id, department_id) ASC, parent_department_id NULLS FIRST, department_name ASC;
  `);

  return result.rows.map(mapDepartment);
}

async function createDepartment({ departmentName, parentDepartmentId, headEmployeeId }) {
  const result = await query(
    `
      INSERT INTO departments (department_id, department_name, parent_department_id, head_employee_id, status)
      VALUES ($1, $2, $3, $4, 'active')
      RETURNING department_id, department_name, parent_department_id, head_employee_id, status;
    `,
    [makeId('DEP'), normalize(departmentName), nullable(parentDepartmentId), nullable(headEmployeeId)]
  );

  return mapDepartment(result.rows[0]);
}

async function getEmployees() {
  const result = await query(`
    SELECT employee_id, user_id, employee_no, first_name, middle_name, last_name, department_id, position,
           manager_id, shift, employment_type, daily_rate, is_department_leader, status, created_at
    FROM employees
    ORDER BY created_at ASC;
  `);

  return result.rows.map(mapEmployee);
}

async function getEmployeeByUserId(userId) {
  const result = await query(
    `
      SELECT employee_id, user_id, employee_no, first_name, middle_name, last_name, department_id, position,
             manager_id, shift, employment_type, daily_rate, is_department_leader, status, created_at
      FROM employees
      WHERE user_id = $1
      LIMIT 1;
    `,
    [normalize(userId)]
  );

  return result.rows[0] ? mapEmployee(result.rows[0]) : null;
}

async function getEmployeeById(employeeId) {
  const result = await query(
    `
      SELECT employee_id, user_id, employee_no, first_name, middle_name, last_name, department_id, position,
             manager_id, shift, employment_type, daily_rate, is_department_leader, status, created_at
      FROM employees
      WHERE employee_id = $1
      LIMIT 1;
    `,
    [normalize(employeeId)]
  );

  return result.rows[0] ? mapEmployee(result.rows[0]) : null;
}

async function generateEmployeeNo() {
  const result = await query(`
    SELECT COALESCE(MAX(substring(employee_no FROM '^EMP-([0-9]+)$')::INTEGER), 0) AS last_number
    FROM employees
    WHERE employee_no ~ '^EMP-[0-9]+$';
  `);

  const nextNumber = toNumber(result.rows[0].last_number) + 1;
  return `EMP-${String(nextNumber).padStart(3, '0')}`;
}

async function syncDepartmentLeader(employeeId, departmentId, isDepartmentLeader) {
  if (isDepartmentLeader) {
    await query(
      `
        UPDATE employees
        SET is_department_leader = false,
            updated_at = NOW()
        WHERE department_id = $1
          AND employee_id <> $2;
      `,
      [normalize(departmentId), normalize(employeeId)]
    );

    await query(
      `
        UPDATE departments
        SET head_employee_id = $2,
            updated_at = NOW()
        WHERE department_id = $1;
      `,
      [normalize(departmentId), normalize(employeeId)]
    );
    return;
  }

  await query(
    `
      UPDATE departments
      SET head_employee_id = NULL,
          updated_at = NOW()
      WHERE department_id = $1
        AND head_employee_id = $2;
    `,
    [normalize(departmentId), normalize(employeeId)]
  );
}

async function createEmployee(employeeData) {
  const userId = normalize(employeeData.userId);
  const hasLeaderFlag = Object.prototype.hasOwnProperty.call(employeeData, 'isDepartmentLeader')
    || Object.prototype.hasOwnProperty.call(employeeData, 'isLeader');

  if (!await userDbService.getUserById(userId)) {
    return {
      error: 'user_not_found',
      message: 'User ID does not exist.',
    };
  }

  const existingEmployee = await getEmployeeByUserId(userId);

  if (existingEmployee) {
    const isDepartmentLeader = hasLeaderFlag
      ? toBoolean(getLeaderFlag(employeeData))
      : existingEmployee.isDepartmentLeader;
    const names = normalizeNameParts({
      firstName: employeeData.firstName || existingEmployee.firstName,
      middleName: employeeData.middleName || existingEmployee.middleName,
      lastName: employeeData.lastName || existingEmployee.lastName,
      fullName: employeeData.fullName || existingEmployee.fullName,
    });
    const result = await query(
      `
        UPDATE employees
        SET first_name = $2,
            middle_name = $3,
            last_name = $4,
            department_id = $5,
            position = $6,
            manager_id = $7,
            shift = $8,
            employment_type = $9,
            daily_rate = $10,
            is_department_leader = $11,
            updated_at = NOW()
        WHERE user_id = $1
        RETURNING employee_id, user_id, employee_no, first_name, middle_name, last_name, department_id, position,
                  manager_id, shift, employment_type, daily_rate, is_department_leader, status, created_at;
      `,
      [
        userId,
        names.firstName,
        names.middleName || null,
        names.lastName,
        normalize(employeeData.departmentId) || existingEmployee.departmentId,
        nullable(employeeData.position) || existingEmployee.position || null,
        nullable(employeeData.managerId) || existingEmployee.managerId || null,
        normalizeShift(employeeData.shift || existingEmployee.shift),
        normalize(employeeData.employmentType) || existingEmployee.employmentType || 'regular',
        toNumber(employeeData.dailyRate, existingEmployee.dailyRate),
        isDepartmentLeader,
      ]
    );
    const employee = mapEmployee(result.rows[0]);

    await syncDepartmentLeader(employee.employeeId, employee.departmentId, employee.isDepartmentLeader);

    await userDbService.updateUserStatus(userId, 'active');

    return {
      alreadyExists: true,
      employee,
      message: 'This user already has an employee profile. Account has been activated.',
    };
  }

  const employeeNo = await generateEmployeeNo();
  const names = normalizeNameParts(employeeData);
  const isDepartmentLeader = hasLeaderFlag
    ? toBoolean(getLeaderFlag(employeeData))
    : false;
  const employeeId = makeId('EMP');

  const result = await query(
    `
      INSERT INTO employees (
        employee_id,
        user_id,
        employee_no,
        first_name,
        middle_name,
        last_name,
        department_id,
        position,
        manager_id,
        shift,
        employment_type,
        daily_rate,
        is_department_leader,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'active')
      RETURNING employee_id, user_id, employee_no, first_name, middle_name, last_name, department_id, position,
                manager_id, shift, employment_type, daily_rate, is_department_leader, status, created_at;
    `,
    [
      employeeId,
      userId,
      employeeNo,
      names.firstName,
      names.middleName || null,
      names.lastName,
      normalize(employeeData.departmentId),
      nullable(employeeData.position),
      nullable(employeeData.managerId),
      normalizeShift(employeeData.shift),
      normalize(employeeData.employmentType) || 'regular',
      toNumber(employeeData.dailyRate),
      isDepartmentLeader,
    ]
  );

  const employee = mapEmployee(result.rows[0]);
  await syncDepartmentLeader(employee.employeeId, employee.departmentId, employee.isDepartmentLeader);
  await userDbService.updateUserStatus(userId, 'active');

  return employee;
}

async function getOvertimeRequests() {
  const result = await query(`
    SELECT *
    FROM overtime_requests
    ORDER BY submitted_at DESC;
  `);

  return result.rows.map(mapOvertimeRequest);
}

async function getOvertimeRequest(overtimeId) {
  const result = await query(
    'SELECT * FROM overtime_requests WHERE overtime_id = $1 LIMIT 1;',
    [normalize(overtimeId)]
  );

  return result.rows[0] ? mapOvertimeRequest(result.rows[0]) : null;
}

async function createOvertimeRequest(requestData, submittedBy) {
  const result = await query(
    `
      INSERT INTO overtime_requests (
        overtime_id,
        employee_id,
        date,
        start_time,
        end_time,
        break_minutes,
        total_hours,
        reason,
        status,
        submitted_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)
      RETURNING *;
    `,
    [
      makeId('OT'),
      normalize(requestData.employeeId),
      normalize(requestData.date),
      normalize(requestData.startTime),
      normalize(requestData.endTime),
      toNumber(requestData.breakMinutes),
      calculateTotalHours(requestData.startTime, requestData.endTime, requestData.breakMinutes),
      normalize(requestData.reason),
      normalize(submittedBy),
    ]
  );

  return mapOvertimeRequest(result.rows[0]);
}

async function addApprovalLog(overtimeId, action, actionBy, remarks) {
  const result = await query(
    `
      INSERT INTO approval_logs (log_id, overtime_id, action, action_by, remarks)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING log_id, overtime_id, action, action_by, action_at, remarks;
    `,
    [makeId('LOG'), normalize(overtimeId), normalize(action), normalize(actionBy), nullable(remarks)]
  );

  return mapApprovalLog(result.rows[0]);
}

async function updateOvertimeStatus(overtimeId, status, actionBy, remarks) {
  const request = await getOvertimeRequest(overtimeId);

  if (!request) {
    return null;
  }

  if (status === 'paid' && request.status !== 'approved') {
    return {
      error: 'invalid_status_transition',
      message: 'Only approved overtime requests can be marked as paid.',
    };
  }

  let hourlyRate = request.hourlyRate || null;
  let rateMultiplier = request.rateMultiplier || null;
  let overtimePay = request.overtimePay || null;

  if (status === 'paid') {
    const employee = await getEmployeeById(request.employeeId);
    const policy = await getActivePolicy();

    if (!employee) {
      return {
        error: 'employee_not_found',
        message: 'Employee ID does not exist.',
      };
    }

    hourlyRate = roundMoney(toNumber(employee.dailyRate) / 8);
    rateMultiplier = policy ? toNumber(policy.rateMultiplier, 1) : 1;

    if (hourlyRate <= 0) {
      return {
        error: 'daily_rate_required',
        message: 'Employee daily rate is required before marking overtime as paid.',
      };
    }

    overtimePay = roundMoney(toNumber(request.totalHours) * hourlyRate * rateMultiplier);
  }

  const updateFields = {
    approved: 'approved_by = $4, approved_at = NOW()',
    rejected: 'rejected_by = $4, rejected_at = NOW()',
    paid: 'paid_by = $4, paid_at = NOW()',
  };

  const result = await query(
    `
      UPDATE overtime_requests
      SET status = $2,
          remarks = $3,
          hourly_rate = $5,
          rate_multiplier = $6,
          overtime_pay = $7,
          ${updateFields[status]},
          updated_at = NOW()
      WHERE overtime_id = $1
      RETURNING *;
    `,
    [
      normalize(overtimeId),
      normalize(status),
      nullable(remarks),
      normalize(actionBy),
      hourlyRate,
      rateMultiplier,
      overtimePay,
    ]
  );

  await addApprovalLog(overtimeId, status, actionBy, remarks);

  return mapOvertimeRequest(result.rows[0]);
}

async function getApprovalLogs(overtimeId) {
  const params = [];
  let whereClause = '';

  if (overtimeId) {
    params.push(normalize(overtimeId));
    whereClause = 'WHERE overtime_id = $1';
  }

  const result = await query(
    `
      SELECT log_id, overtime_id, action, action_by, action_at, remarks
      FROM approval_logs
      ${whereClause}
      ORDER BY action_at ASC;
    `,
    params
  );

  return result.rows.map(mapApprovalLog);
}

async function getPolicies() {
  const result = await query(`
    SELECT policy_id, name, minimum_hours, maximum_hours_per_day,
           requires_manager_approval, requires_hr_approval, rate_multiplier, status
    FROM overtime_policies
    ORDER BY created_at ASC;
  `);

  return result.rows.map(mapPolicy);
}

async function getActivePolicy() {
  const result = await query(`
    SELECT policy_id, name, minimum_hours, maximum_hours_per_day,
           requires_manager_approval, requires_hr_approval, rate_multiplier, status
    FROM overtime_policies
    WHERE status = 'active'
    ORDER BY created_at ASC
    LIMIT 1;
  `);

  return result.rows[0] ? mapPolicy(result.rows[0]) : null;
}

module.exports = {
  createDepartment,
  createEmployee,
  createOvertimeRequest,
  getApprovalLogs,
  getDepartments,
  getEmployeeById,
  getEmployeeByUserId,
  getEmployees,
  getOvertimeRequest,
  getOvertimeRequests,
  getPolicies,
  updateOvertimeStatus,
};
