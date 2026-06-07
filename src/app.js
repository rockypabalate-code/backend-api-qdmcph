const express = require('express');
const adminRoutes = require('./routes/adminRoutes');
const authRoutes = require('./routes/authRoutes');
const overtimeRoutes = require('./routes/overtimeRoutes');

const app = express();

app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    message: 'Backend API is running.',
    routes: {
      login: 'POST /api/auth/login',
      register: 'POST /api/auth/register',
      me: 'GET /api/auth/me',
      adminDashboard: 'GET /api/admin/dashboard',
      overtimeRequests: 'GET/POST /api/overtime/requests',
      overtimeRequestDetail: 'GET /api/overtime/requests/:overtimeId',
      approveOvertime: 'PATCH /api/overtime/requests/:overtimeId/approve',
      rejectOvertime: 'PATCH /api/overtime/requests/:overtimeId/reject',
      paidOvertime: 'PATCH /api/overtime/requests/:overtimeId/paid',
      employees: 'GET/POST /api/overtime/employees',
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
  console.error(error);
  res.status(500).json({ message: 'Internal server error.' });
});

module.exports = app;
