const { query } = require('../config/database');
const userDbService = require('./userDbService');

function normalize(value) {
  return String(value || '').trim();
}

function nullable(value) {
  const normalized = normalize(value);
  return normalized || null;
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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
    headEmployeeId: row.head_employee_id || '',
    status: row.status,
  };
}

function mapEmployee(row) {
  return {
    employeeId: row.employee_id,
    userId: row.user_id,
    employeeNo: row.employee_no || '',
    fullName: row.full_name,
    departmentId: row.department_id,
    position: row.position || '',
    managerId: row.manager_id || '',
    employmentType: row.employment_type,
    hourlyRate: toNumber(row.hourly_rate),
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
    SELECT department_id, department_name, head_employee_id, status
    FROM departments
    ORDER BY department_name ASC;
  `);

  return result.rows.map(mapDepartment);
}

async function createDepartment({ departmentName, headEmployeeId }) {
  const result = await query(
    `
      INSERT INTO departments (department_id, department_name, head_employee_id, status)
      VALUES ($1, $2, $3, 'active')
      RETURNING department_id, department_name, head_employee_id, status;
    `,
    [makeId('DEP'), normalize(departmentName), nullable(headEmployeeId)]
  );

  return mapDepartment(result.rows[0]);
}

async function getEmployees() {
  const result = await query(`
    SELECT employee_id, user_id, employee_no, full_name, department_id, position,
           manager_id, employment_type, hourly_rate, status, created_at
    FROM employees
    ORDER BY created_at ASC;
  `);

  return result.rows.map(mapEmployee);
}

async function getEmployeeByUserId(userId) {
  const result = await query(
    `
      SELECT employee_id, user_id, employee_no, full_name, department_id, position,
             manager_id, employment_type, hourly_rate, status, created_at
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
      SELECT employee_id, user_id, employee_no, full_name, department_id, position,
             manager_id, employment_type, hourly_rate, status, created_at
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

async function createEmployee(employeeData) {
  const userId = normalize(employeeData.userId);

  if (!await userDbService.getUserById(userId)) {
    return {
      error: 'user_not_found',
      message: 'User ID does not exist.',
    };
  }

  const existingEmployee = await getEmployeeByUserId(userId);

  if (existingEmployee) {
    let employee = existingEmployee;

    if (normalize(employeeData.hourlyRate)) {
      const result = await query(
        `
          UPDATE employees
          SET hourly_rate = $2,
              updated_at = NOW()
          WHERE user_id = $1
          RETURNING employee_id, user_id, employee_no, full_name, department_id, position,
                    manager_id, employment_type, hourly_rate, status, created_at;
        `,
        [userId, toNumber(employeeData.hourlyRate)]
      );
      employee = mapEmployee(result.rows[0]);
    }

    await userDbService.updateUserStatus(userId, 'active');

    return {
      alreadyExists: true,
      employee,
      message: 'This user already has an employee profile. Account has been activated.',
    };
  }

  const employeeNo = await generateEmployeeNo();

  const result = await query(
    `
      INSERT INTO employees (
        employee_id,
        user_id,
        employee_no,
        full_name,
        department_id,
        position,
        manager_id,
        employment_type,
        hourly_rate,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')
      RETURNING employee_id, user_id, employee_no, full_name, department_id, position,
                manager_id, employment_type, hourly_rate, status, created_at;
    `,
    [
      makeId('EMP'),
      userId,
      employeeNo,
      normalize(employeeData.fullName),
      normalize(employeeData.departmentId),
      nullable(employeeData.position),
      nullable(employeeData.managerId),
      normalize(employeeData.employmentType) || 'regular',
      toNumber(employeeData.hourlyRate),
    ]
  );

  await userDbService.updateUserStatus(userId, 'active');

  return mapEmployee(result.rows[0]);
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

    hourlyRate = toNumber(employee.hourlyRate);
    rateMultiplier = policy ? toNumber(policy.rateMultiplier, 1) : 1;

    if (hourlyRate <= 0) {
      return {
        error: 'hourly_rate_required',
        message: 'Employee hourly rate is required before marking overtime as paid.',
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
