const { closePool, query } = require('./database');

async function createOvertimeTables() {
  const companyDepartments = [
    { id: 'DEP-ADMIN', name: 'Administration' },
    { id: 'DEP-ADMIN-ACCOUNTING', name: 'Accounting', parentId: 'DEP-ADMIN' },
    { id: 'DEP-ADMIN-HR', name: 'HR', parentId: 'DEP-ADMIN' },
    { id: 'DEP-ADMIN-IT', name: 'IT', parentId: 'DEP-ADMIN' },
    { id: 'DEP-ADMIN-WAREHOUSE-PURCHASING', name: 'Warehouse & Purchasing', parentId: 'DEP-ADMIN' },
    { id: 'DEP-ENGINEERING', name: 'Engineering' },
    { id: 'DEP-LABORATORY', name: 'Laboratory' },
    { id: 'DEP-LABORATORY-METAL-MOLD', name: 'Metal Mold', parentId: 'DEP-LABORATORY' },
    { id: 'DEP-LABORATORY-PED-QA', name: 'Ped-QA', parentId: 'DEP-LABORATORY' },
    { id: 'DEP-MAINTENANCE', name: 'Maintenance' },
    { id: 'DEP-PRODUCTION', name: 'Production' },
    { id: 'DEP-PRODUCTION-CMC', name: 'CMC', parentId: 'DEP-PRODUCTION' },
    { id: 'DEP-PRODUCTION-MOLDING', name: 'Molding', parentId: 'DEP-PRODUCTION' },
    { id: 'DEP-PRODUCTION-RTD', name: 'RTD', parentId: 'DEP-PRODUCTION' },
    { id: 'DEP-PRODUCTION-SANDING', name: 'Sanding', parentId: 'DEP-PRODUCTION' },
    { id: 'DEP-PRODUCTION-SMD', name: 'SMD', parentId: 'DEP-PRODUCTION' },
    { id: 'DEP-PRODUCTION-WAX', name: 'WAX', parentId: 'DEP-PRODUCTION' },
  ];

  await query(`
    CREATE TABLE IF NOT EXISTS departments (
      department_id TEXT PRIMARY KEY,
      department_name TEXT NOT NULL,
      parent_department_id TEXT REFERENCES departments(department_id) ON DELETE RESTRICT,
      head_employee_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT departments_status_check CHECK (status IN ('active', 'inactive'))
    );
  `);

  await query('ALTER TABLE departments ADD COLUMN IF NOT EXISTS parent_department_id TEXT;');
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'departments_parent_department_id_fkey'
      ) THEN
        ALTER TABLE departments
        ADD CONSTRAINT departments_parent_department_id_fkey
        FOREIGN KEY (parent_department_id)
        REFERENCES departments(department_id)
        ON DELETE RESTRICT;
      END IF;
    END $$;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS employees (
      employee_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
      employee_no TEXT,
      first_name TEXT NOT NULL,
      middle_name TEXT,
      last_name TEXT NOT NULL,
      department_id TEXT NOT NULL REFERENCES departments(department_id) ON DELETE RESTRICT,
      position TEXT,
      manager_id TEXT,
      shift TEXT NOT NULL DEFAULT 'day',
      employment_type TEXT NOT NULL DEFAULT 'regular',
      daily_rate NUMERIC(12, 2) NOT NULL DEFAULT 0,
      is_department_leader BOOLEAN NOT NULL DEFAULT false,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT employees_shift_check CHECK (shift IN ('day', 'night')),
      CONSTRAINT employees_status_check CHECK (status IN ('active', 'inactive'))
    );
  `);

  await query('ALTER TABLE employees ADD COLUMN IF NOT EXISTS first_name TEXT;');
  await query('ALTER TABLE employees ADD COLUMN IF NOT EXISTS middle_name TEXT;');
  await query('ALTER TABLE employees ADD COLUMN IF NOT EXISTS last_name TEXT;');
  await query("ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift TEXT NOT NULL DEFAULT 'day';");
  await query('ALTER TABLE employees ADD COLUMN IF NOT EXISTS daily_rate NUMERIC(12, 2);');
  await query('ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_department_leader BOOLEAN NOT NULL DEFAULT false;');
  await query(`
    UPDATE employees
    SET shift = 'day'
    WHERE shift IS NULL
       OR shift NOT IN ('day', 'night');
  `);
  await query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'employees'
          AND column_name = 'hourly_rate'
      ) THEN
        UPDATE employees
        SET daily_rate = COALESCE(daily_rate, hourly_rate * 8)
        WHERE daily_rate IS NULL;
      END IF;
    END $$;
  `);
  await query(`
    UPDATE employees
    SET daily_rate = 0
    WHERE daily_rate IS NULL;
  `);
  await query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'employees'
          AND column_name = 'full_name'
      ) THEN
        UPDATE employees
        SET first_name = COALESCE(NULLIF(first_name, ''), split_part(full_name, ' ', 1), 'Employee'),
            last_name = COALESCE(NULLIF(last_name, ''), NULLIF(regexp_replace(full_name, '^.*\\s+', ''), ''), split_part(full_name, ' ', 1), 'Employee')
        WHERE first_name IS NULL
           OR last_name IS NULL;
      END IF;
    END $$;
  `);
  await query(`
    UPDATE employees
    SET first_name = 'Employee'
    WHERE first_name IS NULL OR first_name = '';
  `);
  await query(`
    UPDATE employees
    SET last_name = first_name
    WHERE last_name IS NULL OR last_name = '';
  `);
  await query('ALTER TABLE employees ALTER COLUMN first_name SET NOT NULL;');
  await query('ALTER TABLE employees ALTER COLUMN last_name SET NOT NULL;');
  await query('ALTER TABLE employees ALTER COLUMN daily_rate SET NOT NULL;');
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'employees_shift_check'
      ) THEN
        ALTER TABLE employees
        ADD CONSTRAINT employees_shift_check CHECK (shift IN ('day', 'night'));
      END IF;
    END $$;
  `);
  await query('ALTER TABLE employees DROP COLUMN IF EXISTS full_name;');
  await query('ALTER TABLE employees DROP COLUMN IF EXISTS hourly_rate;');

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
  await query('CREATE INDEX IF NOT EXISTS departments_parent_department_id_idx ON departments (parent_department_id);');
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS employees_employee_no_unique_idx
    ON employees (employee_no)
    WHERE employee_no IS NOT NULL;
  `);
  await query('CREATE INDEX IF NOT EXISTS overtime_requests_employee_id_idx ON overtime_requests (employee_id);');
  await query('CREATE INDEX IF NOT EXISTS overtime_requests_submitted_by_idx ON overtime_requests (submitted_by);');
  await query('CREATE INDEX IF NOT EXISTS approval_logs_overtime_id_idx ON approval_logs (overtime_id);');

  for (const department of companyDepartments) {
    await query(
      `
        INSERT INTO departments (department_id, department_name, parent_department_id, head_employee_id, status)
        VALUES ($1, $2, $3, NULL, 'active')
        ON CONFLICT (department_id) DO UPDATE
        SET department_name = EXCLUDED.department_name,
            parent_department_id = EXCLUDED.parent_department_id,
            status = 'active',
            updated_at = NOW();
      `,
      [department.id, department.name, department.parentId || null]
    );
  }

  await query(`
    UPDATE employees
    SET department_id = 'DEP-ADMIN-IT',
        updated_at = NOW()
    WHERE department_id = 'DEP-IT';
  `);
  await query(`
    UPDATE departments AS new_department
    SET head_employee_id = COALESCE(new_department.head_employee_id, old_department.head_employee_id),
        updated_at = NOW()
    FROM departments AS old_department
    WHERE new_department.department_id = 'DEP-ADMIN-IT'
      AND old_department.department_id = 'DEP-IT';
  `);
  await query("DELETE FROM departments WHERE department_id = 'DEP-IT';");

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
