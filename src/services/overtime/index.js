const departmentService = require('./departmentService');
const employeeService = require('./employeeService');
const overtimeRequestService = require('./overtimeRequestService');
const overtimePlanService = require('./overtimePlanService');
const approvalLogService = require('./approvalLogService');
const policyService = require('./policyService');

module.exports = {
  ...departmentService,
  ...employeeService,
  ...overtimeRequestService,
  ...overtimePlanService,
  ...approvalLogService,
  ...policyService,
};
