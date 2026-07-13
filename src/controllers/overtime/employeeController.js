const overtimeService = require('../../services/overtimeDbService');

async function listEmployees(req, res, next) {
  try {
    const employees = await overtimeService.getEmployees();
    return res.json({ employees });
  } catch (error) {
    return next(error);
  }
}

async function createEmployee(req, res, next) {
  const { departmentId, userId, dailyRate, shift } = req.body;

  if (!departmentId || !userId || dailyRate === undefined || !shift) {
    return res.status(400).json({
      message: 'Department ID, user ID, shift, and daily rate are required.',
    });
  }

  if (!['day', 'night'].includes(String(shift).toLowerCase().trim())) {
    return res.status(400).json({ message: 'Shift must be day or night.' });
  }

  if (!Number.isFinite(Number(dailyRate)) || Number(dailyRate) <= 0) {
    return res.status(400).json({ message: 'Daily rate must be greater than 0.' });
  }

  try {
    const result = await overtimeService.createEmployee(req.body);
    return res.status(result.created ? 201 : 200).json({
      message: result.message,
      employee: result.employee,
    });
  } catch (error) {
    return next(error);
  }
}

async function updateEmployee(req, res, next) {
  const { shift, dailyRate, status } = req.body;

  if (shift !== undefined && !['day', 'night'].includes(String(shift).toLowerCase().trim())) {
    return res.status(400).json({ message: 'Shift must be day or night.' });
  }

  if (dailyRate !== undefined && (!Number.isFinite(Number(dailyRate)) || Number(dailyRate) <= 0)) {
    return res.status(400).json({ message: 'Daily rate must be greater than 0.' });
  }

  if (status !== undefined && !['active', 'inactive'].includes(String(status).toLowerCase().trim())) {
    return res.status(400).json({ message: 'Employee status must be active or inactive.' });
  }

  try {
    const result = await overtimeService.updateEmployee(req.params.employeeId, req.body);
    return res.json(result);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listEmployees,
  createEmployee,
  updateEmployee,
};
