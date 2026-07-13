const { query, transaction } = require('../../config/database');
const userDbService = require('../userDbService');
const AppError = require('../../utils/appError');

function normalize(value) {
  return String(value || '').trim();
}

function nullable(value) {
  const normalized = normalize(value);
  return normalized || null;
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

function iso(value) {
  return value instanceof Date ? value.toISOString() : value || '';
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function mapEmployee(row) {
  const firstName = row.user_first_name || '';
  const middleName = row.user_middle_name || '';
  const lastName = row.user_last_name || '';

  return {
    employeeId: row.employee_id,
    userId: row.user_id,
    employeeNo: row.employee_no || '',
    firstName,
    middleName,
    lastName,
    fullName: buildFullName({ firstName, middleName, lastName }),
    email: row.user_email || '',
    departmentId: row.department_id,
    departmentName: row.department_name || '',
    position: row.position || '',
    managerId: row.manager_id || '',
    shift: row.shift,
    employmentType: row.employment_type,
    dailyRate: toNumber(row.daily_rate),
    status: row.status,
    userStatus: row.user_status || '',
    createdAt: iso(row.created_at),
  };
}

const employeeSelect = `
  SELECT
    e.employee_id,
    e.user_id,
    e.employee_no,
    e.department_id,
    d.department_name,
    e.position,
    e.manager_id,
    e.shift,
    e.employment_type,
    e.daily_rate,
    e.status,
    e.created_at,
    u.first_name AS user_first_name,
    u.middle_name AS user_middle_name,
    u.last_name AS user_last_name,
    u.email AS user_email,
    u.status AS user_status
  FROM employees e
  INNER JOIN users u ON u.id = e.user_id
  LEFT JOIN departments d ON d.department_id = e.department_id
`;

async function getEmployees(executor = { query }) {
  const result = await executor.query(`
    ${employeeSelect}
    ORDER BY e.created_at ASC;
  `);

  return result.rows.map(mapEmployee);
}

async function getEmployeeByUserId(userId, executor = { query }) {
  const result = await executor.query(
    `
      ${employeeSelect}
      WHERE e.user_id = $1
      LIMIT 1;
    `,
    [normalize(userId)]
  );

  return result.rows[0] ? mapEmployee(result.rows[0]) : null;
}

async function getEmployeeById(employeeId, executor = { query }) {
  const result = await executor.query(
    `
      ${employeeSelect}
      WHERE e.employee_id = $1
      LIMIT 1;
    `,
    [normalize(employeeId)]
  );

  return result.rows[0] ? mapEmployee(result.rows[0]) : null;
}

async function generateEmployeeNo(executor = { query }) {
  const result = await executor.query(`
    SELECT COALESCE(MAX(substring(employee_no FROM '^EMP-([0-9]+)$')::INTEGER), 0) AS last_number
    FROM employees
    WHERE employee_no ~ '^EMP-[0-9]+$';
  `);

  const nextNumber = toNumber(result.rows[0].last_number) + 1;
  return `EMP-${String(nextNumber).padStart(3, '0')}`;
}

async function createEmployee(employeeData) {
  const userId = normalize(employeeData.userId);
  const user = await userDbService.getUserById(userId);

  if (!user) {
    throw new AppError('User ID does not exist.', 404, 'USER_NOT_FOUND');
  }

  return transaction(async (client) => {
    const existingEmployee = await getEmployeeByUserId(userId, client);

    if (existingEmployee) {
      const result = await client.query(
        `
          UPDATE employees
          SET department_id = $2,
              position = $3,
              manager_id = $4,
              shift = $5,
              employment_type = $6,
              daily_rate = $7,
              updated_at = NOW()
          WHERE user_id = $1
          RETURNING employee_id;
        `,
        [
          userId,
          normalize(employeeData.departmentId) || existingEmployee.departmentId,
          nullable(employeeData.position) || existingEmployee.position || null,
          nullable(employeeData.managerId) || existingEmployee.managerId || null,
          normalizeShift(employeeData.shift || existingEmployee.shift),
          normalize(employeeData.employmentType) || existingEmployee.employmentType || 'regular',
          toNumber(employeeData.dailyRate, existingEmployee.dailyRate),
        ]
      );

      const employee = await getEmployeeById(result.rows[0].employee_id, client);
      await userDbService.updateUserStatus(userId, 'active', client);

      return {
        created: false,
        employee,
        message: 'This user already has an employee profile. Account has been activated.',
      };
    }

    await client.query('LOCK TABLE employees IN SHARE ROW EXCLUSIVE MODE;');

    const employeeNo = await generateEmployeeNo(client);
    const employeeId = makeId('EMP');

    const result = await client.query(
      `
        INSERT INTO employees (
          employee_id,
          user_id,
          employee_no,
          department_id,
          position,
          manager_id,
          shift,
          employment_type,
          daily_rate,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')
        RETURNING employee_id;
      `,
      [
        employeeId,
        userId,
        employeeNo,
        normalize(employeeData.departmentId),
        nullable(employeeData.position),
        nullable(employeeData.managerId),
        normalizeShift(employeeData.shift),
        normalize(employeeData.employmentType) || 'regular',
        toNumber(employeeData.dailyRate),
      ]
    );

    const employee = await getEmployeeById(result.rows[0].employee_id, client);
    await userDbService.updateUserStatus(userId, 'active', client);

    return {
      created: true,
      employee,
      message: 'Employee profile created and account activated.',
    };
  });
}

function normalizeEmployeeStatus(value) {
  const status = normalize(value || 'active').toLowerCase();
  return ['active', 'inactive'].includes(status) ? status : null;
}

async function updateEmployee(employeeId, updates = {}) {
  const normalizedEmployeeId = normalize(employeeId);
  const existingEmployee = await getEmployeeById(normalizedEmployeeId);

  if (!existingEmployee) {
    throw new AppError('Employee profile not found.', 404, 'EMPLOYEE_NOT_FOUND');
  }

  const fields = [];
  const values = [normalizedEmployeeId];

  function addField(column, value) {
    values.push(value);
    fields.push(`${column} = $${values.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'departmentId')) {
    const departmentId = normalize(updates.departmentId);

    if (!departmentId) {
      throw new AppError('Department ID cannot be empty.', 400, 'DEPARTMENT_ID_REQUIRED');
    }

    addField('department_id', departmentId);
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'position')) {
    addField('position', nullable(updates.position));
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'managerId')) {
    addField('manager_id', nullable(updates.managerId));
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'shift')) {
    const shift = normalize(updates.shift).toLowerCase();

    if (!['day', 'night'].includes(shift)) {
      throw new AppError('Shift must be day or night.', 400, 'INVALID_SHIFT');
    }

    addField('shift', shift);
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'employmentType')) {
    addField('employment_type', normalize(updates.employmentType) || 'regular');
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'dailyRate')) {
    const dailyRate = Number(updates.dailyRate);

    if (!Number.isFinite(dailyRate) || dailyRate <= 0) {
      throw new AppError('Daily rate must be greater than 0.', 400, 'INVALID_DAILY_RATE');
    }

    addField('daily_rate', dailyRate);
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'status')) {
    const status = normalizeEmployeeStatus(updates.status);

    if (!status) {
      throw new AppError('Employee status must be active or inactive.', 400, 'INVALID_EMPLOYEE_STATUS');
    }

    addField('status', status);
  }

  if (fields.length === 0) {
    return {
      employee: existingEmployee,
      message: 'No employee profile changes were provided.',
    };
  }

  fields.push('updated_at = NOW()');

  const result = await query(
    `
      UPDATE employees
      SET ${fields.join(', ')}
      WHERE employee_id = $1
      RETURNING employee_id;
    `,
    values
  );

  const employee = await getEmployeeById(result.rows[0].employee_id);

  return {
    employee,
    message: 'Employee profile updated successfully.',
  };
}

module.exports = {
  createEmployee,
  getEmployeeById,
  getEmployeeByUserId,
  getEmployees,
  updateEmployee,
};
