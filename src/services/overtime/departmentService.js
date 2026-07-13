const { query } = require('../../config/database');

function normalize(value) {
  return String(value || '').trim();
}

function nullable(value) {
  const normalized = normalize(value);
  return normalized || null;
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

module.exports = {
  createDepartment,
  getDepartments,
};
