const overtimeService = require('../services/overtimeExcelService');

function canViewAll(user) {
  return ['admin', 'hr', 'manager'].includes(user.role);
}

function listDepartments(req, res) {
  return res.json({ departments: overtimeService.getDepartments() });
}

function createDepartment(req, res) {
  const { departmentName } = req.body;

  if (!departmentName) {
    return res.status(400).json({ message: 'Department name is required.' });
  }

  const department = overtimeService.createDepartment(req.body);
  return res.status(201).json({ department });
}

function listEmployees(req, res) {
  return res.json({ employees: overtimeService.getEmployees() });
}

function createEmployee(req, res) {
  const { fullName, departmentId, userId, hourlyRate } = req.body;

  if (!fullName || !departmentId || !userId || !hourlyRate) {
    return res.status(400).json({ message: 'Full name, department ID, user ID, and hourly rate are required.' });
  }

  const employee = overtimeService.createEmployee(req.body);

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

function listOvertimeRequests(req, res) {
  const requests = overtimeService.getOvertimeRequests();

  if (canViewAll(req.user)) {
    return res.json({ overtimeRequests: requests });
  }

  return res.json({
    overtimeRequests: requests.filter((request) => request.submittedBy === req.user.id),
  });
}

function createOvertimeRequest(req, res) {
  const { employeeId, date, startTime, endTime, reason } = req.body;
  const requestData = { ...req.body };

  if (req.user.role === 'user') {
    const employee = overtimeService.getEmployeeByUserId(req.user.id);

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

  if (!overtimeService.getEmployeeById(requestData.employeeId)) {
    return res.status(404).json({ message: 'Employee ID does not exist.' });
  }

  const overtimeRequest = overtimeService.createOvertimeRequest(requestData, req.user.id);
  return res.status(201).json({ overtimeRequest });
}

function getOvertimeRequest(req, res) {
  const overtimeRequest = overtimeService.getOvertimeRequest(req.params.overtimeId);

  if (!overtimeRequest) {
    return res.status(404).json({ message: 'Overtime request not found.' });
  }

  if (!canViewAll(req.user) && overtimeRequest.submittedBy !== req.user.id) {
    return res.status(403).json({ message: 'You do not have permission to access this request.' });
  }

  return res.json({
    overtimeRequest,
    approvalLogs: overtimeService.getApprovalLogs(req.params.overtimeId),
  });
}

function approveOvertimeRequest(req, res) {
  const overtimeRequest = overtimeService.updateOvertimeStatus(
    req.params.overtimeId,
    'approved',
    req.user.id,
    req.body.remarks
  );

  if (!overtimeRequest) {
    return res.status(404).json({ message: 'Overtime request not found.' });
  }

  if (overtimeRequest.error === 'invalid_status_transition') {
    return res.status(400).json({ message: overtimeRequest.message });
  }

  return res.json({ overtimeRequest });
}

function rejectOvertimeRequest(req, res) {
  const overtimeRequest = overtimeService.updateOvertimeStatus(
    req.params.overtimeId,
    'rejected',
    req.user.id,
    req.body.remarks
  );

  if (!overtimeRequest) {
    return res.status(404).json({ message: 'Overtime request not found.' });
  }

  if (overtimeRequest.error) {
    return res.status(400).json({ message: overtimeRequest.message });
  }

  return res.json({ overtimeRequest });
}

function markOvertimeAsPaid(req, res) {
  const overtimeRequest = overtimeService.updateOvertimeStatus(
    req.params.overtimeId,
    'paid',
    req.user.id,
    req.body.remarks
  );

  if (!overtimeRequest) {
    return res.status(404).json({ message: 'Overtime request not found.' });
  }

  if (overtimeRequest.error) {
    return res.status(400).json({ message: overtimeRequest.message });
  }

  return res.json({ overtimeRequest });
}

function listPolicies(req, res) {
  return res.json({ policies: overtimeService.getPolicies() });
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
