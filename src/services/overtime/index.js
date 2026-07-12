const departmentService = require('./departmentService');
const employeeService = require('./employeeService');
const overtimeRequestService = require('./overtimeRequestService');
const approvalLogService = require('./approvalLogService');
const policyService = require('./policyService');

module.exports = {
  ...departmentService,
  ...employeeService,
  ...overtimeRequestService,
  ...approvalLogService,
  ...policyService,
};
