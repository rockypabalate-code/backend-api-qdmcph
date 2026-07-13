const { query, transaction } = require('../../config/database');
const { getEmployeeById, getEmployeeByUserId } = require('./employeeService');
const { addApprovalLog } = require('./approvalLogService');
const { getActivePolicy } = require('./policyService');
const AppError = require('../../utils/appError');

const VALID_OVERTIME_STATUSES = ['pending', 'approved', 'rejected', 'paid', 'cancelled'];
const ALLOWED_STATUS_TRANSITIONS = {
  pending: ['approved', 'rejected'],
  approved: ['paid'],
  rejected: [],
  paid: [],
  cancelled: [],
};

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

function dateOnly(value) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return value || '';
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isExecutor(value) {
  return value && typeof value.query === 'function';
}

function getRequestedTotalHours(requestData) {
  const rawHours = requestData.totalHours ?? requestData.overtimeHours;
  const totalHours = Number(rawHours);

  if (!Number.isFinite(totalHours)) {
    throw new AppError('Overtime hours must be a valid number.', 400, 'INVALID_OVERTIME_HOURS');
  }

  if (totalHours <= 0) {
    throw new AppError('Overtime hours must be greater than zero.', 400, 'INVALID_OVERTIME_HOURS');
  }

  return Math.round(totalHours * 100) / 100;
}

function normalizeStatusFilter(status) {
  if (status === undefined || status === null || status === '') {
    return [];
  }

  const rawValues = Array.isArray(status) ? status : [status];
  const statuses = rawValues
    .flatMap((value) => String(value).split(','))
    .map((value) => normalize(value).toLowerCase())
    .filter(Boolean);

  const invalidStatus = statuses.find((value) => !VALID_OVERTIME_STATUSES.includes(value));

  if (invalidStatus) {
    throw new AppError(`Invalid overtime status filter: ${invalidStatus}.`, 400, 'INVALID_STATUS_FILTER');
  }

  return [...new Set(statuses)];
}


function normalizePaidStatusFilter(value) {
  const normalized = normalize(value).toLowerCase();

  if (!normalized) {
    return null;
  }

  if (!['paid', 'unpaid'].includes(normalized)) {
    throw new AppError('paidStatus must be either paid or unpaid.', 400, 'INVALID_PAID_STATUS_FILTER');
  }

  return normalized;
}

function normalizeDateFilter(value, fieldName) {
  const normalized = normalize(value);

  if (!normalized) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new AppError(`${fieldName} must use YYYY-MM-DD format.`, 400, 'INVALID_DATE_FILTER');
  }

  return normalized;
}

function normalizeYear(value) {
  const normalized = normalize(value);

  if (!normalized) {
    return null;
  }

  const year = Number(normalized);

  if (!Number.isInteger(year) || year < 1900 || year > 3000) {
    throw new AppError('Year filter must be a valid year.', 400, 'INVALID_YEAR_FILTER');
  }

  return year;
}

function normalizeMonth(value) {
  const normalized = normalize(value);

  if (!normalized) {
    return null;
  }

  const month = Number(normalized);

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new AppError('Month filter must be from 1 to 12.', 400, 'INVALID_MONTH_FILTER');
  }

  return month;
}

function normalizeLimit(value) {
  const normalized = normalize(value);

  if (!normalized) {
    return null;
  }

  const limit = Number(normalized);

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new AppError('Limit must be a positive whole number.', 400, 'INVALID_LIMIT_FILTER');
  }

  return Math.min(limit, 100);
}

function normalizeOffset(value) {
  const normalized = normalize(value);

  if (!normalized) {
    return 0;
  }

  const offset = Number(normalized);

  if (!Number.isInteger(offset) || offset < 0) {
    throw new AppError('Offset must be zero or a positive whole number.', 400, 'INVALID_OFFSET_FILTER');
  }

  return offset;
}

function buildFullName({ firstName, middleName, lastName }) {
  return [firstName, middleName, lastName].map(normalize).filter(Boolean).join(' ');
}

function buildOvertimeFilterClause(filters = {}, baseClauses = [], baseParams = []) {
  const clauses = [...baseClauses];
  const params = [...baseParams];
  const statuses = normalizeStatusFilter(filters.status);
  const dateFrom = normalizeDateFilter(
    filters.dateFrom ?? filters.from ?? filters.startDate,
    'dateFrom'
  );
  const dateTo = normalizeDateFilter(
    filters.dateTo ?? filters.to ?? filters.endDate,
    'dateTo'
  );
  const year = normalizeYear(filters.year);
  const month = normalizeMonth(filters.month);
  const employeeId = normalize(filters.employeeId);
  const departmentId = normalize(filters.departmentId);
  const paidStatus = normalizePaidStatusFilter(filters.paidStatus ?? filters.paymentStatus);

  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new AppError('dateFrom cannot be later than dateTo.', 400, 'INVALID_DATE_RANGE');
  }

  if (statuses.length > 0) {
    params.push(statuses);
    clauses.push(`ot.status = ANY($${params.length})`);
  }

  if (dateFrom) {
    params.push(dateFrom);
    clauses.push(`ot.date >= $${params.length}`);
  }

  if (dateTo) {
    params.push(dateTo);
    clauses.push(`ot.date <= $${params.length}`);
  }

  if (year) {
    params.push(year);
    clauses.push(`EXTRACT(YEAR FROM ot.date)::INTEGER = $${params.length}`);
  }

  if (month) {
    params.push(month);
    clauses.push(`EXTRACT(MONTH FROM ot.date)::INTEGER = $${params.length}`);
  }

  if (employeeId) {
    params.push(employeeId);
    clauses.push(`ot.employee_id = $${params.length}`);
  }

  if (departmentId) {
    params.push(departmentId);
    clauses.push(`e.department_id = $${params.length}`);
  }

  if (paidStatus === 'paid') {
    clauses.push("ot.status = 'paid'");
  }

  if (paidStatus === 'unpaid') {
    clauses.push("ot.status = 'approved'");
  }

  return {
    params,
    whereClause: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
  };
}

function mapOvertimeRequest(row) {
  const employeeFirstName = row.employee_first_name || '';
  const employeeMiddleName = row.employee_middle_name || '';
  const employeeLastName = row.employee_last_name || '';

  return {
    overtimeId: row.overtime_id,
    employeeId: row.employee_id,
    employeeUserId: row.employee_user_id || '',
    employeeNo: row.employee_no || '',
    employeeName: buildFullName({
      firstName: employeeFirstName,
      middleName: employeeMiddleName,
      lastName: employeeLastName,
    }),
    employeeEmail: row.employee_email || '',
    departmentId: row.department_id || '',
    departmentName: row.department_name || '',
    date: row.date,
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

function mapTotalRow(row) {
  return {
    requestCount: toNumber(row.request_count),
    totalHours: toNumber(row.total_hours),
    pendingHours: toNumber(row.pending_hours),
    approvedHours: toNumber(row.approved_hours),
    paidHours: toNumber(row.paid_hours),
    rejectedHours: toNumber(row.rejected_hours),
    cancelledHours: toNumber(row.cancelled_hours),
    approvedPaidHours: toNumber(row.approved_paid_hours),
  };
}

function mapWeekRow(row) {
  return {
    weekStart: dateOnly(row.week_start),
    weekEnd: dateOnly(row.week_end),
    ...mapTotalRow(row),
  };
}

function mapMonthRow(row) {
  return {
    month: row.month,
    monthStart: dateOnly(row.month_start),
    ...mapTotalRow(row),
  };
}

function mapYearRow(row) {
  return {
    year: toNumber(row.year),
    ...mapTotalRow(row),
  };
}

function mapDepartmentSummaryRow(row) {
  return {
    departmentId: row.department_id || '',
    departmentName: row.department_name || '',
    ...mapTotalRow(row),
  };
}

function mapEmployeeSummaryRow(row) {
  const firstName = row.employee_first_name || '';
  const middleName = row.employee_middle_name || '';
  const lastName = row.employee_last_name || '';

  return {
    employeeId: row.employee_id || '',
    employeeNo: row.employee_no || '',
    employeeName: buildFullName({ firstName, middleName, lastName }),
    departmentId: row.department_id || '',
    departmentName: row.department_name || '',
    ...mapTotalRow(row),
  };
}

function emptyTotal() {
  return {
    requestCount: 0,
    totalHours: 0,
    pendingHours: 0,
    approvedHours: 0,
    paidHours: 0,
    rejectedHours: 0,
    cancelledHours: 0,
    approvedPaidHours: 0,
  };
}

function emptyStatusBreakdown() {
  return VALID_OVERTIME_STATUSES.reduce((accumulator, status) => {
    accumulator[status] = {
      requestCount: 0,
      totalHours: 0,
    };
    return accumulator;
  }, {});
}

const totalSelect = `
  COUNT(*)::INTEGER AS request_count,
  COALESCE(SUM(CASE WHEN ot.status NOT IN ('rejected', 'cancelled') THEN ot.total_hours ELSE 0 END), 0)::NUMERIC AS total_hours,
  COALESCE(SUM(CASE WHEN ot.status = 'pending' THEN ot.total_hours ELSE 0 END), 0)::NUMERIC AS pending_hours,
  COALESCE(SUM(CASE WHEN ot.status = 'approved' THEN ot.total_hours ELSE 0 END), 0)::NUMERIC AS approved_hours,
  COALESCE(SUM(CASE WHEN ot.status = 'paid' THEN ot.total_hours ELSE 0 END), 0)::NUMERIC AS paid_hours,
  COALESCE(SUM(CASE WHEN ot.status = 'rejected' THEN ot.total_hours ELSE 0 END), 0)::NUMERIC AS rejected_hours,
  COALESCE(SUM(CASE WHEN ot.status = 'cancelled' THEN ot.total_hours ELSE 0 END), 0)::NUMERIC AS cancelled_hours,
  COALESCE(SUM(CASE WHEN ot.status IN ('approved', 'paid') THEN ot.total_hours ELSE 0 END), 0)::NUMERIC AS approved_paid_hours
`;

const overtimeRequestSelect = `
  SELECT
    ot.*,
    e.user_id AS employee_user_id,
    e.employee_no,
    e.department_id,
    d.department_name,
    u.first_name AS employee_first_name,
    u.middle_name AS employee_middle_name,
    u.last_name AS employee_last_name,
    u.email AS employee_email
  FROM overtime_requests ot
  INNER JOIN employees e ON e.employee_id = ot.employee_id
  INNER JOIN users u ON u.id = e.user_id
  LEFT JOIN departments d ON d.department_id = e.department_id
`;

async function getOvertimeRequests(filters = {}, executor = { query }) {
  if (isExecutor(filters)) {
    executor = filters;
    filters = {};
  }

  const { whereClause, params } = buildOvertimeFilterClause(filters);
  const limit = normalizeLimit(filters.limit);
  const offset = normalizeOffset(filters.offset);

  let pagingClause = '';

  if (limit) {
    params.push(limit);
    pagingClause += ` LIMIT $${params.length}`;

    if (offset) {
      params.push(offset);
      pagingClause += ` OFFSET $${params.length}`;
    }
  }

  const result = await executor.query(
    `
      ${overtimeRequestSelect}
      ${whereClause}
      ORDER BY ot.submitted_at DESC
      ${pagingClause};
    `,
    params
  );

  return result.rows.map(mapOvertimeRequest);
}

async function getUserOvertimeRequests(userId, filters = {}, executor = { query }) {
  if (isExecutor(filters)) {
    executor = filters;
    filters = {};
  }

  const employee = await getEmployeeByUserId(userId, executor);

  if (!employee) {
    return [];
  }

  const baseParams = [employee.employeeId];
  const baseClauses = ['ot.employee_id = $1'];
  const { whereClause, params } = buildOvertimeFilterClause(filters, baseClauses, baseParams);
  const limit = normalizeLimit(filters.limit);
  const offset = normalizeOffset(filters.offset);

  let pagingClause = '';

  if (limit) {
    params.push(limit);
    pagingClause += ` LIMIT $${params.length}`;

    if (offset) {
      params.push(offset);
      pagingClause += ` OFFSET $${params.length}`;
    }
  }

  const result = await executor.query(
    `
      ${overtimeRequestSelect}
      ${whereClause}
      ORDER BY ot.submitted_at DESC
      ${pagingClause};
    `,
    params
  );

  return result.rows.map(mapOvertimeRequest);
}


async function getPendingApprovalOvertimeRequests(filters = {}, executor = { query }) {
  if (isExecutor(filters)) {
    executor = filters;
    filters = {};
  }

  const { status, paidStatus, paymentStatus, ...safeFilters } = filters;
  return getOvertimeRequests({ ...safeFilters, status: 'pending' }, executor);
}

async function getUnpaidApprovedOvertimeRequests(filters = {}, executor = { query }) {
  if (isExecutor(filters)) {
    executor = filters;
    filters = {};
  }

  const { status, paidStatus, paymentStatus, ...safeFilters } = filters;
  return getOvertimeRequests({ ...safeFilters, status: 'approved' }, executor);
}

async function getOvertimeRequest(overtimeId, executor = { query }) {
  const result = await executor.query(
    `
      ${overtimeRequestSelect}
      WHERE ot.overtime_id = $1
      LIMIT 1;
    `,
    [normalize(overtimeId)]
  );

  return result.rows[0] ? mapOvertimeRequest(result.rows[0]) : null;
}

async function getCurrentUserOvertimeTotals(employeeId, executor = { query }) {
  const result = await executor.query(
    `
      SELECT 'currentWeek' AS period, ${totalSelect}
      FROM overtime_requests ot
      WHERE ot.employee_id = $1
        AND ot.date >= date_trunc('week', CURRENT_DATE)::DATE
        AND ot.date < (date_trunc('week', CURRENT_DATE) + INTERVAL '1 week')::DATE

      UNION ALL

      SELECT 'currentMonth' AS period, ${totalSelect}
      FROM overtime_requests ot
      WHERE ot.employee_id = $1
        AND ot.date >= date_trunc('month', CURRENT_DATE)::DATE
        AND ot.date < (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month')::DATE

      UNION ALL

      SELECT 'currentYear' AS period, ${totalSelect}
      FROM overtime_requests ot
      WHERE ot.employee_id = $1
        AND ot.date >= date_trunc('year', CURRENT_DATE)::DATE
        AND ot.date < (date_trunc('year', CURRENT_DATE) + INTERVAL '1 year')::DATE;
    `,
    [normalize(employeeId)]
  );

  return result.rows.reduce(
    (accumulator, row) => {
      accumulator[row.period] = mapTotalRow(row);
      return accumulator;
    },
    {
      currentWeek: emptyTotal(),
      currentMonth: emptyTotal(),
      currentYear: emptyTotal(),
    }
  );
}

async function getUserOvertimeStatusBreakdown(employeeId, year, executor = { query }) {
  const result = await executor.query(
    `
      SELECT
        ot.status,
        COUNT(*)::INTEGER AS request_count,
        COALESCE(SUM(ot.total_hours), 0)::NUMERIC AS total_hours
      FROM overtime_requests ot
      WHERE ot.employee_id = $1
        AND EXTRACT(YEAR FROM ot.date)::INTEGER = $2
      GROUP BY ot.status
      ORDER BY ot.status ASC;
    `,
    [normalize(employeeId), year]
  );

  return result.rows.reduce((accumulator, row) => {
    accumulator[row.status] = {
      requestCount: toNumber(row.request_count),
      totalHours: toNumber(row.total_hours),
    };
    return accumulator;
  }, emptyStatusBreakdown());
}

async function getUserOvertimeTotalsByWeek(employeeId, year, executor = { query }) {
  const result = await executor.query(
    `
      SELECT
        date_trunc('week', ot.date)::DATE AS week_start,
        (date_trunc('week', ot.date)::DATE + INTERVAL '6 days')::DATE AS week_end,
        ${totalSelect}
      FROM overtime_requests ot
      WHERE ot.employee_id = $1
        AND EXTRACT(YEAR FROM ot.date)::INTEGER = $2
      GROUP BY date_trunc('week', ot.date)::DATE
      ORDER BY week_start ASC;
    `,
    [normalize(employeeId), year]
  );

  return result.rows.map(mapWeekRow);
}

async function getUserOvertimeTotalsByMonth(employeeId, year, executor = { query }) {
  const result = await executor.query(
    `
      SELECT
        TO_CHAR(date_trunc('month', ot.date), 'YYYY-MM') AS month,
        date_trunc('month', ot.date)::DATE AS month_start,
        ${totalSelect}
      FROM overtime_requests ot
      WHERE ot.employee_id = $1
        AND EXTRACT(YEAR FROM ot.date)::INTEGER = $2
      GROUP BY date_trunc('month', ot.date)::DATE
      ORDER BY month_start ASC;
    `,
    [normalize(employeeId), year]
  );

  return result.rows.map(mapMonthRow);
}

async function getUserOvertimeTotalsByYear(employeeId, executor = { query }) {
  const result = await executor.query(
    `
      SELECT
        EXTRACT(YEAR FROM ot.date)::INTEGER AS year,
        ${totalSelect}
      FROM overtime_requests ot
      WHERE ot.employee_id = $1
      GROUP BY EXTRACT(YEAR FROM ot.date)::INTEGER
      ORDER BY year ASC;
    `,
    [normalize(employeeId)]
  );

  return result.rows.map(mapYearRow);
}

async function getUserOvertimeDashboardSummary(userId, filters = {}, executor = { query }) {
  if (isExecutor(filters)) {
    executor = filters;
    filters = {};
  }

  const employee = await getEmployeeByUserId(userId, executor);
  const selectedYear = normalizeYear(filters.year) || new Date().getFullYear();

  if (!employee) {
    return {
      employee: null,
      selectedYear,
      current: {
        week: emptyTotal(),
        month: emptyTotal(),
        year: emptyTotal(),
      },
      statusBreakdown: emptyStatusBreakdown(),
      totalsByWeek: [],
      totalsByMonth: [],
      totalsByYear: [],
    };
  }

  const [currentTotals, statusBreakdown, totalsByWeek, totalsByMonth, totalsByYear] = await Promise.all([
    getCurrentUserOvertimeTotals(employee.employeeId, executor),
    getUserOvertimeStatusBreakdown(employee.employeeId, selectedYear, executor),
    getUserOvertimeTotalsByWeek(employee.employeeId, selectedYear, executor),
    getUserOvertimeTotalsByMonth(employee.employeeId, selectedYear, executor),
    getUserOvertimeTotalsByYear(employee.employeeId, executor),
  ]);

  return {
    employee: {
      employeeId: employee.employeeId,
      employeeNo: employee.employeeNo,
      fullName: employee.fullName,
      departmentId: employee.departmentId,
      departmentName: employee.departmentName,
      position: employee.position,
    },
    selectedYear,
    current: {
      week: currentTotals.currentWeek,
      month: currentTotals.currentMonth,
      year: currentTotals.currentYear,
    },
    statusBreakdown,
    totalsByWeek,
    totalsByMonth,
    totalsByYear,
  };
}


function stripStatusFilters(filters = {}) {
  const { status, paidStatus, paymentStatus, ...safeFilters } = filters;
  return safeFilters;
}

async function getOvertimeTotals(filters = {}, executor = { query }) {
  const { whereClause, params } = buildOvertimeFilterClause(filters);
  const result = await executor.query(
    `
      SELECT ${totalSelect}
      FROM overtime_requests ot
      INNER JOIN employees e ON e.employee_id = ot.employee_id
      INNER JOIN users u ON u.id = e.user_id
      LEFT JOIN departments d ON d.department_id = e.department_id
      ${whereClause};
    `,
    params
  );

  return result.rows[0] ? mapTotalRow(result.rows[0]) : emptyTotal();
}

async function getOvertimeStatusBreakdown(filters = {}, executor = { query }) {
  const { whereClause, params } = buildOvertimeFilterClause(stripStatusFilters(filters));
  const result = await executor.query(
    `
      SELECT
        ot.status,
        COUNT(*)::INTEGER AS request_count,
        COALESCE(SUM(ot.total_hours), 0)::NUMERIC AS total_hours
      FROM overtime_requests ot
      INNER JOIN employees e ON e.employee_id = ot.employee_id
      INNER JOIN users u ON u.id = e.user_id
      LEFT JOIN departments d ON d.department_id = e.department_id
      ${whereClause}
      GROUP BY ot.status
      ORDER BY ot.status ASC;
    `,
    params
  );

  return result.rows.reduce((accumulator, row) => {
    accumulator[row.status] = {
      requestCount: toNumber(row.request_count),
      totalHours: toNumber(row.total_hours),
    };
    return accumulator;
  }, emptyStatusBreakdown());
}

async function getOvertimeTotalsByDepartment(filters = {}, executor = { query }) {
  const { whereClause, params } = buildOvertimeFilterClause(filters);
  const result = await executor.query(
    `
      SELECT
        e.department_id,
        d.department_name,
        ${totalSelect}
      FROM overtime_requests ot
      INNER JOIN employees e ON e.employee_id = ot.employee_id
      INNER JOIN users u ON u.id = e.user_id
      LEFT JOIN departments d ON d.department_id = e.department_id
      ${whereClause}
      GROUP BY e.department_id, d.department_name
      ORDER BY d.department_name ASC NULLS LAST;
    `,
    params
  );

  return result.rows.map(mapDepartmentSummaryRow);
}

async function getOvertimeTotalsByEmployee(filters = {}, executor = { query }) {
  const { whereClause, params } = buildOvertimeFilterClause(filters);
  const result = await executor.query(
    `
      SELECT
        ot.employee_id,
        e.employee_no,
        e.department_id,
        d.department_name,
        u.first_name AS employee_first_name,
        u.middle_name AS employee_middle_name,
        u.last_name AS employee_last_name,
        ${totalSelect}
      FROM overtime_requests ot
      INNER JOIN employees e ON e.employee_id = ot.employee_id
      INNER JOIN users u ON u.id = e.user_id
      LEFT JOIN departments d ON d.department_id = e.department_id
      ${whereClause}
      GROUP BY ot.employee_id, e.employee_no, e.department_id, d.department_name,
               u.first_name, u.middle_name, u.last_name
      ORDER BY total_hours DESC, u.last_name ASC, u.first_name ASC;
    `,
    params
  );

  return result.rows.map(mapEmployeeSummaryRow);
}

async function getOvertimeTotalsByWeek(filters = {}, year, executor = { query }) {
  const selectedYear = normalizeYear(year) || new Date().getFullYear();
  const { whereClause, params } = buildOvertimeFilterClause({ ...filters, year: selectedYear });
  const result = await executor.query(
    `
      SELECT
        date_trunc('week', ot.date)::DATE AS week_start,
        (date_trunc('week', ot.date)::DATE + INTERVAL '6 days')::DATE AS week_end,
        ${totalSelect}
      FROM overtime_requests ot
      INNER JOIN employees e ON e.employee_id = ot.employee_id
      INNER JOIN users u ON u.id = e.user_id
      LEFT JOIN departments d ON d.department_id = e.department_id
      ${whereClause}
      GROUP BY date_trunc('week', ot.date)::DATE
      ORDER BY week_start ASC;
    `,
    params
  );

  return result.rows.map(mapWeekRow);
}

async function getOvertimeTotalsByMonth(filters = {}, year, executor = { query }) {
  const selectedYear = normalizeYear(year) || new Date().getFullYear();
  const { whereClause, params } = buildOvertimeFilterClause({ ...filters, year: selectedYear });
  const result = await executor.query(
    `
      SELECT
        TO_CHAR(date_trunc('month', ot.date), 'YYYY-MM') AS month,
        date_trunc('month', ot.date)::DATE AS month_start,
        ${totalSelect}
      FROM overtime_requests ot
      INNER JOIN employees e ON e.employee_id = ot.employee_id
      INNER JOIN users u ON u.id = e.user_id
      LEFT JOIN departments d ON d.department_id = e.department_id
      ${whereClause}
      GROUP BY date_trunc('month', ot.date)::DATE
      ORDER BY month_start ASC;
    `,
    params
  );

  return result.rows.map(mapMonthRow);
}

async function getOvertimeTotalsByYear(filters = {}, executor = { query }) {
  const { whereClause, params } = buildOvertimeFilterClause(filters);
  const result = await executor.query(
    `
      SELECT
        EXTRACT(YEAR FROM ot.date)::INTEGER AS year,
        ${totalSelect}
      FROM overtime_requests ot
      INNER JOIN employees e ON e.employee_id = ot.employee_id
      INNER JOIN users u ON u.id = e.user_id
      LEFT JOIN departments d ON d.department_id = e.department_id
      ${whereClause}
      GROUP BY EXTRACT(YEAR FROM ot.date)::INTEGER
      ORDER BY year ASC;
    `,
    params
  );

  return result.rows.map(mapYearRow);
}

async function getOvertimeDashboardSummary(filters = {}, executor = { query }) {
  if (isExecutor(filters)) {
    executor = filters;
    filters = {};
  }

  const selectedYear = normalizeYear(filters.year) || new Date().getFullYear();

  const [
    totals,
    statusBreakdown,
    totalsByDepartment,
    totalsByEmployee,
    totalsByWeek,
    totalsByMonth,
    totalsByYear,
  ] = await Promise.all([
    getOvertimeTotals(filters, executor),
    getOvertimeStatusBreakdown(filters, executor),
    getOvertimeTotalsByDepartment(filters, executor),
    getOvertimeTotalsByEmployee(filters, executor),
    getOvertimeTotalsByWeek(filters, selectedYear, executor),
    getOvertimeTotalsByMonth(filters, selectedYear, executor),
    getOvertimeTotalsByYear(stripStatusFilters(filters), executor),
  ]);

  return {
    selectedYear,
    filters: {
      status: filters.status || '',
      dateFrom: filters.dateFrom || filters.from || filters.startDate || '',
      dateTo: filters.dateTo || filters.to || filters.endDate || '',
      year: filters.year || '',
      month: filters.month || '',
      employeeId: filters.employeeId || '',
      departmentId: filters.departmentId || '',
      paidStatus: filters.paidStatus || filters.paymentStatus || '',
    },
    totals,
    statusBreakdown,
    totalsByDepartment,
    totalsByEmployee,
    totalsByWeek,
    totalsByMonth,
    totalsByYear,
  };
}

async function createOvertimeRequest(requestData, submittedBy) {
  return transaction(async (client) => {
    const result = await client.query(
      `
        INSERT INTO overtime_requests (
          overtime_id,
          employee_id,
          date,
          total_hours,
          reason,
          status,
          submitted_by
        )
        VALUES ($1, $2, $3, $4, $5, 'pending', $6)
        RETURNING *;
      `,
      [
        makeId('OT'),
        normalize(requestData.employeeId),
        normalize(requestData.date),
        getRequestedTotalHours(requestData),
        normalize(requestData.reason),
        normalize(submittedBy),
      ]
    );

    const overtimeId = result.rows[0].overtime_id;
    await addApprovalLog(overtimeId, 'created', submittedBy, 'Overtime request created.', client);

    return getOvertimeRequest(overtimeId, client);
  });
}

async function updatePendingOvertimeRequest(overtimeId, updateData, actionBy) {
  return transaction(async (client) => {
    const requestResult = await client.query(
      'SELECT * FROM overtime_requests WHERE overtime_id = $1 LIMIT 1 FOR UPDATE;',
      [normalize(overtimeId)]
    );

    if (!requestResult.rows[0]) {
      return null;
    }

    const currentRequest = requestResult.rows[0];

    if (currentRequest.status !== 'pending') {
      throw new AppError(
        'Only pending overtime requests can be edited.',
        400,
        'OVERTIME_NOT_EDITABLE'
      );
    }

    const nextDate = Object.prototype.hasOwnProperty.call(updateData, 'date')
      ? normalize(updateData.date)
      : currentRequest.date;
    const nextTotalHours = Object.prototype.hasOwnProperty.call(updateData, 'totalHours')
      || Object.prototype.hasOwnProperty.call(updateData, 'overtimeHours')
      ? getRequestedTotalHours(updateData)
      : toNumber(currentRequest.total_hours);
    const nextReason = Object.prototype.hasOwnProperty.call(updateData, 'reason')
      ? normalize(updateData.reason)
      : currentRequest.reason;

    if (!nextDate || !nextReason) {
      throw new AppError('Date and reason are required.', 400, 'INVALID_OVERTIME_REQUEST');
    }

    await client.query(
      `
        UPDATE overtime_requests
        SET date = $2,
            total_hours = $3,
            reason = $4,
            updated_at = NOW()
        WHERE overtime_id = $1;
      `,
      [normalize(overtimeId), nextDate, nextTotalHours, nextReason]
    );

    await addApprovalLog(overtimeId, 'updated', actionBy, 'Overtime request updated.', client);

    return getOvertimeRequest(overtimeId, client);
  });
}

async function deleteOvertimeRequest(overtimeId, options = {}) {
  const { pendingOnly = false, allowPaid = false } = options;

  return transaction(async (client) => {
    const requestResult = await client.query(
      'SELECT * FROM overtime_requests WHERE overtime_id = $1 LIMIT 1 FOR UPDATE;',
      [normalize(overtimeId)]
    );

    if (!requestResult.rows[0]) {
      return null;
    }

    const currentStatus = normalize(requestResult.rows[0].status);

    if (pendingOnly && currentStatus !== 'pending') {
      throw new AppError(
        'Only pending overtime requests can be deleted.',
        400,
        'OVERTIME_NOT_DELETABLE'
      );
    }

    if (!allowPaid && currentStatus === 'paid') {
      throw new AppError(
        'Paid overtime requests cannot be deleted.',
        400,
        'PAID_OVERTIME_NOT_DELETABLE'
      );
    }

    const overtimeRequest = await getOvertimeRequest(overtimeId, client);

    await client.query(
      'DELETE FROM overtime_requests WHERE overtime_id = $1;',
      [normalize(overtimeId)]
    );

    return overtimeRequest;
  });
}

async function updateOvertimeStatus(overtimeId, status, actionBy, remarks) {
  const normalizedStatus = normalize(status);
  const updateFields = {
    approved: 'approved_by = $4, approved_at = NOW()',
    rejected: 'rejected_by = $4, rejected_at = NOW()',
    paid: 'paid_by = $4, paid_at = NOW()',
  };

  if (!updateFields[normalizedStatus]) {
    throw new AppError('Invalid overtime status.', 400, 'INVALID_OVERTIME_STATUS');
  }

  return transaction(async (client) => {
    const requestResult = await client.query(
      'SELECT * FROM overtime_requests WHERE overtime_id = $1 LIMIT 1 FOR UPDATE;',
      [normalize(overtimeId)]
    );

    if (!requestResult.rows[0]) {
      return null;
    }

    const request = requestResult.rows[0];
    const currentStatus = normalize(request.status);
    const allowedNextStatuses = ALLOWED_STATUS_TRANSITIONS[currentStatus] || [];

    if (!allowedNextStatuses.includes(normalizedStatus)) {
      throw new AppError(
        `Cannot change overtime status from ${currentStatus} to ${normalizedStatus}.`,
        400,
        'INVALID_STATUS_TRANSITION'
      );
    }

    let hourlyRate = request.hourly_rate === null ? null : toNumber(request.hourly_rate);
    let rateMultiplier = request.rate_multiplier === null ? null : toNumber(request.rate_multiplier);
    let overtimePay = request.overtime_pay === null ? null : toNumber(request.overtime_pay);

    if (normalizedStatus === 'paid') {
      const employee = await getEmployeeById(request.employee_id, client);
      const policy = await getActivePolicy(client);

      if (!employee) {
        throw new AppError('Employee ID does not exist.', 404, 'EMPLOYEE_NOT_FOUND');
      }

      hourlyRate = roundMoney(toNumber(employee.dailyRate) / 8);
      rateMultiplier = policy ? toNumber(policy.rateMultiplier, 1) : 1;

      if (hourlyRate <= 0) {
        throw new AppError(
          'Employee daily rate is required before marking overtime as paid.',
          400,
          'DAILY_RATE_REQUIRED'
        );
      }

      overtimePay = roundMoney(toNumber(request.total_hours) * hourlyRate * rateMultiplier);
    }

    const result = await client.query(
      `
        UPDATE overtime_requests
        SET status = $2,
            remarks = $3,
            hourly_rate = $5,
            rate_multiplier = $6,
            overtime_pay = $7,
            ${updateFields[normalizedStatus]},
            updated_at = NOW()
        WHERE overtime_id = $1
        RETURNING *;
      `,
      [
        normalize(overtimeId),
        normalizedStatus,
        nullable(remarks),
        normalize(actionBy),
        hourlyRate,
        rateMultiplier,
        overtimePay,
      ]
    );

    await addApprovalLog(overtimeId, normalizedStatus, actionBy, remarks, client);

    return getOvertimeRequest(result.rows[0].overtime_id, client);
  });
}

module.exports = {
  deleteOvertimeRequest,
  createOvertimeRequest,
  getOvertimeRequest,
  getOvertimeDashboardSummary,
  getOvertimeRequests,
  getPendingApprovalOvertimeRequests,
  getUnpaidApprovedOvertimeRequests,
  getUserOvertimeDashboardSummary,
  getUserOvertimeRequests,
  updateOvertimeStatus,
  updatePendingOvertimeRequest,
};
