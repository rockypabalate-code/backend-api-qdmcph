const departmentController = require('./departmentController');
const employeeController = require('./employeeController');
const overtimeRequestController = require('./overtimeRequestController');
const policyController = require('./policyController');

module.exports = {
  ...departmentController,
  ...employeeController,
  ...overtimeRequestController,
  ...policyController,
};
