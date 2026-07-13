const { query } = require('../../config/database');

function normalize(value) {
  return String(value || '').trim();
}

function nullable(value) {
  const normalized = normalize(value);
  return normalized || null;
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : value || '';
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

async function addApprovalLog(overtimeId, action, actionBy, remarks, executor = { query }) {
  const result = await executor.query(
    `
      INSERT INTO approval_logs (log_id, overtime_id, action, action_by, remarks)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING log_id, overtime_id, action, action_by, action_at, remarks;
    `,
    [makeId('LOG'), normalize(overtimeId), normalize(action), normalize(actionBy), nullable(remarks)]
  );

  return mapApprovalLog(result.rows[0]);
}

async function getApprovalLogs(overtimeId, executor = { query }) {
  const params = [];
  let whereClause = '';

  if (overtimeId) {
    params.push(normalize(overtimeId));
    whereClause = 'WHERE overtime_id = $1';
  }

  const result = await executor.query(
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

module.exports = {
  addApprovalLog,
  getApprovalLogs,
};
