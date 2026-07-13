const express = require('express');
const adminRoutes = require('./routes/adminRoutes');
const authRoutes = require('./routes/authRoutes');
const overtimeRoutes = require('./routes/overtimeRoutes');

const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    message: 'Backend API is running.',
    routes: {
      login: 'POST /api/auth/login',
      accounts: 'GET/POST/PATCH/DELETE /api/admin/users',
      forceDeleteAccount: 'DELETE /api/admin/users/:userId/force',
      createAccount: 'POST /api/admin/users',
      legacyCreateAccount: 'POST /api/auth/register (admin token required)',
      me: 'GET /api/auth/me',
      adminDashboard: 'GET /api/admin/dashboard',
      overtimePlans: 'GET/POST /api/overtime/plans',
      overtimePlanItems: 'POST/PATCH/DELETE /api/overtime/plans/:planId/items',
      overtimePlanWorkflow: 'PATCH /api/overtime/plans/:planId/submit|approve|reject|close',
      overtimeRequests: 'GET/POST /api/overtime/requests',
      pendingOvertimeRequests: 'GET /api/overtime/requests/pending',
      unpaidApprovedOvertimeRequests: 'GET /api/overtime/requests/unpaid',
      overtimeRequestDetail: 'GET /api/overtime/requests/:overtimeId',
      approveOvertime: 'PATCH /api/overtime/requests/:overtimeId/approve',
      rejectOvertime: 'PATCH /api/overtime/requests/:overtimeId/reject',
      paidOvertime: 'PATCH /api/overtime/requests/:overtimeId/paid',
      employees: 'GET/POST/PATCH /api/overtime/employees',
      departments: 'GET/POST /api/overtime/departments',
      policies: 'GET /api/overtime/policies',
    },
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/overtime', overtimeRoutes);

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found.' });
});

app.use((error, req, res, next) => {
  const statusCode = error.statusCode || 500;
  const response = {
    message: statusCode >= 500 ? 'Internal server error.' : error.message,
  };

  if (error.code && statusCode < 500) {
    response.code = error.code;
  }

  if (statusCode >= 500) {
    console.error(error);
  } else {
    console.warn(error.message);
  }

  res.status(statusCode).json(response);
});

module.exports = app;
