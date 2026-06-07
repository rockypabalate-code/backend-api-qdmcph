const { closePool, query } = require('./database');

async function createOvertimeTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS departments (
      department_id TEXT PRIMARY KEY,
      department_name TEXT NOT NULL,
      head_employee_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT departments_status_check CHECK (status IN ('active', 'inactive'))
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS employees (
      employee_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
      employee_no TEXT,
      full_name TEXT NOT NULL,
      department_id TEXT NOT NULL REFERENCES departments(department_id) ON DELETE RESTRICT,
      position TEXT,
      manager_id TEXT,
      employment_type TEXT NOT NULL DEFAULT 'regular',
      hourly_rate NUMERIC(12, 2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT employees_status_check CHECK (status IN ('active', 'inactive'))
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS overtime_policies (
      policy_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      minimum_hours NUMERIC(6, 2) NOT NULL DEFAULT 1,
      maximum_hours_per_day NUMERIC(6, 2) NOT NULL DEFAULT 4,
      requires_manager_approval BOOLEAN NOT NULL DEFAULT true,
      requires_hr_approval BOOLEAN NOT NULL DEFAULT true,
      rate_multiplier NUMERIC(6, 2) NOT NULL DEFAULT 1.25,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT overtime_policies_status_check CHECK (status IN ('active', 'inactive'))
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS overtime_requests (
      overtime_id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL REFERENCES employees(employee_id) ON DELETE RESTRICT,
      date DATE NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      break_minutes INTEGER NOT NULL DEFAULT 0,
      total_hours NUMERIC(6, 2) NOT NULL DEFAULT 0,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      submitted_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      approved_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      approved_at TIMESTAMPTZ,
      rejected_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      rejected_at TIMESTAMPTZ,
      paid_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      paid_at TIMESTAMPTZ,
      hourly_rate NUMERIC(12, 2),
      rate_multiplier NUMERIC(6, 2),
      overtime_pay NUMERIC(12, 2),
      remarks TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT overtime_requests_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'paid'))
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS approval_logs (
      log_id TEXT PRIMARY KEY,
      overtime_id TEXT NOT NULL REFERENCES overtime_requests(overtime_id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      action_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      action_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      remarks TEXT
    );
  `);

  await query('CREATE INDEX IF NOT EXISTS employees_user_id_idx ON employees (user_id);');
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS employees_employee_no_unique_idx
    ON employees (employee_no)
    WHERE employee_no IS NOT NULL;
  `);
  await query('CREATE INDEX IF NOT EXISTS overtime_requests_employee_id_idx ON overtime_requests (employee_id);');
  await query('CREATE INDEX IF NOT EXISTS overtime_requests_submitted_by_idx ON overtime_requests (submitted_by);');
  await query('CREATE INDEX IF NOT EXISTS approval_logs_overtime_id_idx ON approval_logs (overtime_id);');

  await query(`
    INSERT INTO departments (department_id, department_name, head_employee_id, status)
    VALUES ('DEP-IT', 'IT Department', NULL, 'active')
    ON CONFLICT (department_id) DO NOTHING;
  `);

  await query(`
    INSERT INTO overtime_policies (
      policy_id,
      name,
      minimum_hours,
      maximum_hours_per_day,
      requires_manager_approval,
      requires_hr_approval,
      rate_multiplier,
      status
    )
    VALUES ('POL-001', 'Regular Overtime', 1, 4, true, true, 1.25, 'active')
    ON CONFLICT (policy_id) DO NOTHING;
  `);

  console.log('Overtime tables are ready.');
}

createOvertimeTables()
  .catch((error) => {
    console.error('Failed to create overtime tables.');
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
