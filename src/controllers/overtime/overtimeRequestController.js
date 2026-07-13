const overtimeService = require('../../services/overtimeDbService');

function isAdminOrHr(user) {
  return ['admin', 'hr'].includes(user.role);
}

function isManager(user) {
  return user.role === 'manager';
}

function hasOvertimeHours(value) {
  return value !== undefined && value !== null && value !== '';
}

function isOwnOvertimeRequest(user, overtimeRequest) {
  return overtimeRequest.employeeUserId === user.id || overtimeRequest.submittedBy === user.id;
}

function buildOvertimeUpdateData(body) {
  const updateData = {};

  if (Object.prototype.hasOwnProperty.call(body, 'date')) {
    updateData.date = body.date;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'totalHours')) {
    updateData.totalHours = body.totalHours;
  } else if (Object.prototype.hasOwnProperty.call(body, 'overtimeHours')) {
    updateData.overtimeHours = body.overtimeHours;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'reason')) {
    updateData.reason = body.reason;
  }

  return updateData;
}

async function getManagerEmployee(user) {
  if (!isManager(user)) {
    return null;
  }

  return overtimeService.getEmployeeByUserId(user.id);
}

async function buildScopedFilters(user, filters = {}) {
  if (isAdminOrHr(user)) {
    return { filters, employee: null, forbidden: false };
  }

  if (isManager(user)) {
    const employee = await getManagerEmployee(user);

    if (!employee || !employee.departmentId) {
      return { filters: {}, employee, forbidden: true };
    }

    return {
      filters: {
        ...filters,
        departmentId: employee.departmentId,
      },
      employee,
      forbidden: false,
    };
  }

  return { filters, employee: null, forbidden: false };
}

async function canAccessOvertimeRequest(user, overtimeRequest) {
  if (isAdminOrHr(user)) {
    return true;
  }

  if (isManager(user)) {
    const managerEmployee = await getManagerEmployee(user);
    return Boolean(
      managerEmployee
        && managerEmployee.departmentId
        && overtimeRequest.departmentId === managerEmployee.departmentId
    );
  }

  return isOwnOvertimeRequest(user, overtimeRequest);
}

async function canCreateForEmployee(user, targetEmployee) {
  if (isAdminOrHr(user)) {
    return true;
  }

  if (isManager(user)) {
    const managerEmployee = await getManagerEmployee(user);
    return Boolean(
      managerEmployee
        && managerEmployee.departmentId
        && targetEmployee.departmentId === managerEmployee.departmentId
    );
  }

  return targetEmployee.userId === user.id;
}

async function canEditOvertimeRequest(user, overtimeRequest) {
  if (isAdminOrHr(user)) {
    return true;
  }

  if (isManager(user)) {
    const managerEmployee = await getManagerEmployee(user);
    return Boolean(
      managerEmployee
        && managerEmployee.departmentId
        && overtimeRequest.departmentId === managerEmployee.departmentId
    );
  }

  return isOwnOvertimeRequest(user, overtimeRequest);
}

async function listOvertimeRequests(req, res, next) {
  try {
    if (isAdminOrHr(req.user) || isManager(req.user)) {
      const scope = await buildScopedFilters(req.user, req.query);

      if (scope.forbidden) {
        return res.status(403).json({ message: 'Your manager account is not linked to a department employee profile.' });
      }

      const requests = await overtimeService.getOvertimeRequests(scope.filters);
      return res.json({ overtimeRequests: requests });
    }

    const requests = await overtimeService.getUserOvertimeRequests(req.user.id, req.query);
    return res.json({ overtimeRequests: requests });
  } catch (error) {
    return next(error);
  }
}

async function listPendingOvertimeRequests(req, res, next) {
  try {
    const scope = await buildScopedFilters(req.user, req.query);

    if (scope.forbidden) {
      return res.status(403).json({ message: 'Your manager account is not linked to a department employee profile.' });
    }

    const requests = await overtimeService.getPendingApprovalOvertimeRequests(scope.filters);
    return res.json({ overtimeRequests: requests });
  } catch (error) {
    return next(error);
  }
}

async function listUnpaidApprovedOvertimeRequests(req, res, next) {
  try {
    const requests = await overtimeService.getUnpaidApprovedOvertimeRequests(req.query);
    return res.json({ overtimeRequests: requests });
  } catch (error) {
    return next(error);
  }
}

async function getUserOvertimeDashboardSummary(req, res, next) {
  try {
    const summary = await overtimeService.getUserOvertimeDashboardSummary(req.user.id, req.query);

    if (!summary.employee) {
      return res.status(403).json({ message: 'Your account is not linked to an employee profile.' });
    }

    return res.json({ summary });
  } catch (error) {
    return next(error);
  }
}

async function getAdminHrOvertimeDashboardSummary(req, res, next) {
  try {
    const scope = await buildScopedFilters(req.user, req.query);

    if (scope.forbidden) {
      return res.status(403).json({ message: 'Your manager account is not linked to a department employee profile.' });
    }

    const summary = await overtimeService.getOvertimeDashboardSummary(scope.filters);
    return res.json({ summary });
  } catch (error) {
    return next(error);
  }
}

async function createOvertimeRequest(req, res, next) {
  const { date, reason } = req.body;
  const overtimeHours = req.body.totalHours ?? req.body.overtimeHours;
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

  if (req.user.role === 'user' && (!date || !hasOvertimeHours(overtimeHours) || !reason)) {
    return res.status(400).json({
      message: 'Date, overtime hours, and reason are required.',
    });
  }

  if (req.user.role !== 'user' && (!requestData.employeeId || !date || !hasOvertimeHours(overtimeHours) || !reason)) {
    return res.status(400).json({
      message: 'Employee ID, date, overtime hours, and reason are required.',
    });
  }

  requestData.totalHours = overtimeHours;

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
    const allowed = await canCreateForEmployee(req.user, employee);

    if (!allowed) {
      return res.status(403).json({ message: 'You do not have permission to create an overtime request for this employee.' });
    }

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

  try {
    const allowed = await canAccessOvertimeRequest(req.user, overtimeRequest);

    if (!allowed) {
      return res.status(403).json({ message: 'You do not have permission to access this request.' });
    }

    const approvalLogs = await overtimeService.getApprovalLogs(req.params.overtimeId);
    return res.json({ overtimeRequest, approvalLogs });
  } catch (error) {
    return next(error);
  }
}

async function updateOwnPendingOvertimeRequest(req, res, next) {
  const updateData = buildOvertimeUpdateData(req.body);

  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({
      message: 'At least one field is required: date, totalHours, or reason.',
    });
  }

  let overtimeRequest;

  try {
    overtimeRequest = await overtimeService.getOvertimeRequest(req.params.overtimeId);
  } catch (error) {
    return next(error);
  }

  if (!overtimeRequest) {
    return res.status(404).json({ message: 'Overtime request not found.' });
  }

  try {
    const allowed = await canEditOvertimeRequest(req.user, overtimeRequest);

    if (!allowed) {
      return res.status(403).json({ message: 'You do not have permission to edit this overtime request.' });
    }
  } catch (error) {
    return next(error);
  }

  try {
    const updatedOvertimeRequest = await overtimeService.updatePendingOvertimeRequest(
      req.params.overtimeId,
      updateData,
      req.user.id
    );

    return res.json({ overtimeRequest: updatedOvertimeRequest });
  } catch (error) {
    return next(error);
  }
}

async function deleteOvertimeRequest(req, res, next) {
  let overtimeRequest;

  try {
    overtimeRequest = await overtimeService.getOvertimeRequest(req.params.overtimeId);
  } catch (error) {
    return next(error);
  }

  if (!overtimeRequest) {
    return res.status(404).json({ message: 'Overtime request not found.' });
  }

  const isAdminHr = isAdminOrHr(req.user);
  const isOwner = isOwnOvertimeRequest(req.user, overtimeRequest);

  if (!isAdminHr && !isOwner) {
    return res.status(403).json({ message: 'You do not have permission to delete this overtime request.' });
  }

  if (!isAdminHr && overtimeRequest.status !== 'pending') {
    return res.status(400).json({ message: 'Only pending overtime requests can be deleted by the user.' });
  }

  if (isAdminHr && overtimeRequest.status === 'paid') {
    return res.status(400).json({ message: 'Paid overtime requests cannot be deleted.' });
  }

  try {
    const deletedOvertimeRequest = await overtimeService.deleteOvertimeRequest(req.params.overtimeId, {
      pendingOnly: !isAdminHr,
      allowPaid: false,
    });

    if (!deletedOvertimeRequest) {
      return res.status(404).json({ message: 'Overtime request not found.' });
    }

    return res.json({
      message: 'Overtime request deleted successfully.',
      overtimeRequest: deletedOvertimeRequest,
    });
  } catch (error) {
    return next(error);
  }
}

async function listOvertimeRequestLogs(req, res, next) {
  let overtimeRequest;

  try {
    overtimeRequest = await overtimeService.getOvertimeRequest(req.params.overtimeId);
  } catch (error) {
    return next(error);
  }

  if (!overtimeRequest) {
    return res.status(404).json({ message: 'Overtime request not found.' });
  }

  try {
    const allowed = await canAccessOvertimeRequest(req.user, overtimeRequest);

    if (!allowed) {
      return res.status(403).json({ message: 'You do not have permission to access these logs.' });
    }

    const approvalLogs = await overtimeService.getApprovalLogs(req.params.overtimeId);
    return res.json({ approvalLogs });
  } catch (error) {
    return next(error);
  }
}

async function changeOvertimeStatus(req, res, next, nextStatus) {
  let overtimeRequest;

  try {
    overtimeRequest = await overtimeService.getOvertimeRequest(req.params.overtimeId);
  } catch (error) {
    return next(error);
  }

  if (!overtimeRequest) {
    return res.status(404).json({ message: 'Overtime request not found.' });
  }

  try {
    const allowed = await canAccessOvertimeRequest(req.user, overtimeRequest);

    if (!allowed) {
      return res.status(403).json({ message: 'You do not have permission to update this overtime request.' });
    }

    const updatedOvertimeRequest = await overtimeService.updateOvertimeStatus(
      req.params.overtimeId,
      nextStatus,
      req.user.id,
      req.body.remarks
    );

    if (!updatedOvertimeRequest) {
      return res.status(404).json({ message: 'Overtime request not found.' });
    }

    return res.json({ overtimeRequest: updatedOvertimeRequest });
  } catch (error) {
    return next(error);
  }
}

function approveOvertimeRequest(req, res, next) {
  return changeOvertimeStatus(req, res, next, 'approved');
}

function rejectOvertimeRequest(req, res, next) {
  return changeOvertimeStatus(req, res, next, 'rejected');
}

function markOvertimeAsPaid(req, res, next) {
  return changeOvertimeStatus(req, res, next, 'paid');
}

module.exports = {
  approveOvertimeRequest,
  deleteOvertimeRequest,
  createOvertimeRequest,
  getAdminHrOvertimeDashboardSummary,
  getOvertimeRequest,
  getUserOvertimeDashboardSummary,
  listOvertimeRequestLogs,
  listOvertimeRequests,
  listPendingOvertimeRequests,
  listUnpaidApprovedOvertimeRequests,
  markOvertimeAsPaid,
  rejectOvertimeRequest,
  updateOwnPendingOvertimeRequest,
};
