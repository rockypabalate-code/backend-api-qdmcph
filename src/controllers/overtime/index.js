const departmentController = require('./departmentController');
const employeeController = require('./employeeController');
const overtimeRequestController = require('./overtimeRequestController');
const overtimePlanController = require('./overtimePlanController');
const policyController = require('./policyController');

module.exports = {
  ...departmentController,
  ...employeeController,
  ...overtimeRequestController,
  ...overtimePlanController,
  ...policyController,
};
