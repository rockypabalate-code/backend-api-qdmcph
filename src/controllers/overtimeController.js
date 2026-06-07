const overtimeService = require('../services/overtimeDbService');

function canViewAll(user) {
  return ['admin', 'hr', 'manager'].includes(user.role);
}

async function listDepartments(req, res, next) {
  try {
    const departments = await overtimeService.getDepartments();
    return res.json({ departments });
  } catch (error) {
    return next(error);
  }
}

async function createDepartment(req, res, next) {
  const { departmentName } = req.body;

  if (!departmentName) {
    return res.status(400).json({ message: 'Department name is required.' });
  }

  try {
    const department = await overtimeService.createDepartment(req.body);
    return res.status(201).json({ department });
  } catch (error) {
    return next(error);
  }
}

async function listEmployees(req, res, next) {
  try {
    const employees = await overtimeService.getEmployees();
    return res.json({ employees });
  } catch (error) {
    return next(error);
  }
}

async function createEmployee(req, res, next) {
  const { fullName, departmentId, userId, hourlyRate } = req.body;

  if (!fullName || !departmentId || !userId || !hourlyRate) {
    return res.status(400).json({ message: 'Full name, department ID, user ID, and hourly rate are required.' });
  }

  let employee;

  try {
    employee = await overtimeService.createEmployee(req.body);
  } catch (error) {
    return next(error);
  }

  if (employee.error === 'user_not_found') {
    return res.status(404).json({ message: employee.message });
  }

  if (employee.alreadyExists) {
    return res.json({
      message: employee.message,
      employee: employee.employee,
    });
  }

  return res.status(201).json({ employee });
}

async function listOvertimeRequests(req, res, next) {
  let requests;

  try {
    requests = await overtimeService.getOvertimeRequests();
  } catch (error) {
    return next(error);
  }

  if (canViewAll(req.user)) {
    return res.json({ overtimeRequests: requests });
  }

  return res.json({
    overtimeRequests: requests.filter((request) => request.submittedBy === req.user.id),
  });
}

async function createOvertimeRequest(req, res, next) {
  const { employeeId, date, startTime, endTime, reason } = req.body;
  const requestData = { ...req.body };

  if (req.user.role === 'user') {
    let employee;

    try {
      employee = await overtimeService.getEmployeeByUserId(req.user.id);
    } catch (error) {
      return next(error);
    }

    if (!employee) {
      return res.status(403).json({ message: 'Your account is not linked to an employee profile.' });
    }

    requestData.employeeId = employee.employeeId;
  }

  if (!requestData.employeeId || !date || !startTime || !endTime || !reason) {
    return res.status(400).json({
      message: 'Employee ID, date, start time, end time, and reason are required.',
    });
  }

  let employee;

  try {
    employee = await overtimeService.getEmployeeById(requestData.employeeId);
  } catch (error) {
    return next(error);
  }

  if (!employee) {
    return res.status(404).json({ message: 'Employee ID does not exist.' });
  }

  try {
    const overtimeRequest = await overtimeService.createOvertimeRequest(requestData, req.user.id);
    return res.status(201).json({ overtimeRequest });
  } catch (error) {
    return next(error);
  }
}

async function getOvertimeRequest(req, res, next) {
  let overtimeRequest;

  try {
    overtimeRequest = await overtimeService.getOvertimeRequest(req.params.overtimeId);
  } catch (error) {
    return next(error);
  }

  if (!overtimeRequest) {
    return res.status(404).json({ message: 'Overtime request not found.' });
  }

  if (!canViewAll(req.user) && overtimeRequest.submittedBy !== req.user.id) {
    return res.status(403).json({ message: 'You do not have permission to access this request.' });
  }

  try {
    const approvalLogs = await overtimeService.getApprovalLogs(req.params.overtimeId);
    return res.json({ overtimeRequest, approvalLogs });
  } catch (error) {
    return next(error);
  }
}

async function approveOvertimeRequest(req, res, next) {
  let overtimeRequest;

  try {
    overtimeRequest = await overtimeService.updateOvertimeStatus(
      req.params.overtimeId,
      'approved',
      req.user.id,
      req.body.remarks
    );
  } catch (error) {
    return next(error);
  }

  if (!overtimeRequest) {
    return res.status(404).json({ message: 'Overtime request not found.' });
  }

  if (overtimeRequest.error === 'invalid_status_transition') {
    return res.status(400).json({ message: overtimeRequest.message });
  }

  return res.json({ overtimeRequest });
}

async function rejectOvertimeRequest(req, res, next) {
  let overtimeRequest;

  try {
    overtimeRequest = await overtimeService.updateOvertimeStatus(
      req.params.overtimeId,
      'rejected',
      req.user.id,
      req.body.remarks
    );
  } catch (error) {
    return next(error);
  }

  if (!overtimeRequest) {
    return res.status(404).json({ message: 'Overtime request not found.' });
  }

  if (overtimeRequest.error) {
    return res.status(400).json({ message: overtimeRequest.message });
  }

  return res.json({ overtimeRequest });
}

async function markOvertimeAsPaid(req, res, next) {
  let overtimeRequest;

  try {
    overtimeRequest = await overtimeService.updateOvertimeStatus(
      req.params.overtimeId,
      'paid',
      req.user.id,
      req.body.remarks
    );
  } catch (error) {
    return next(error);
  }

  if (!overtimeRequest) {
    return res.status(404).json({ message: 'Overtime request not found.' });
  }

  if (overtimeRequest.error) {
    return res.status(400).json({ message: overtimeRequest.message });
  }

  return res.json({ overtimeRequest });
}

async function listPolicies(req, res, next) {
  try {
    const policies = await overtimeService.getPolicies();
    return res.json({ policies });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  approveOvertimeRequest,
  createDepartment,
  createEmployee,
  createOvertimeRequest,
  getOvertimeRequest,
  listDepartments,
  listEmployees,
  listOvertimeRequests,
  listPolicies,
  markOvertimeAsPaid,
  rejectOvertimeRequest,
};
