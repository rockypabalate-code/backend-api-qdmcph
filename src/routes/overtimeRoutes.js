const express = require('express');
const overtimeController = require('../controllers/overtimeController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(authenticate);

router.get('/departments', authorize('admin', 'hr', 'manager'), overtimeController.listDepartments);
router.post('/departments', authorize('admin', 'hr'), overtimeController.createDepartment);

router.get('/employees', authorize('admin', 'hr', 'manager'), overtimeController.listEmployees);
router.post('/employees', authorize('admin', 'hr'), overtimeController.createEmployee);
router.patch('/employees/:employeeId', authorize('admin', 'hr'), overtimeController.updateEmployee);

router.get('/policies', authorize('admin', 'hr', 'manager'), overtimeController.listPolicies);


router.get('/plans', overtimeController.listOvertimePlans);
router.post('/plans', authorize('admin', 'hr', 'manager', 'user'), overtimeController.createOvertimePlan);
router.patch('/plans/:planId/submit', authorize('admin', 'hr', 'manager', 'user'), overtimeController.submitOvertimePlan);
router.patch('/plans/:planId/approve', authorize('admin', 'hr'), overtimeController.approveOvertimePlan);
router.patch('/plans/:planId/reject', authorize('admin', 'hr'), overtimeController.rejectOvertimePlan);
router.patch('/plans/:planId/close', authorize('admin', 'hr', 'manager'), overtimeController.closeOvertimePlan);
router.post('/plans/:planId/items', authorize('admin', 'hr', 'manager', 'user'), overtimeController.addOvertimePlanItem);
router.post('/plans/:planId/items/bulk', authorize('admin', 'hr', 'manager', 'user'), overtimeController.addOvertimePlanItems);
router.patch('/plans/:planId/items/:itemId', authorize('admin', 'hr', 'manager', 'user'), overtimeController.updateOvertimePlanItem);
router.delete('/plans/:planId/items/:itemId', authorize('admin', 'hr', 'manager', 'user'), overtimeController.deleteOvertimePlanItem);
router.get('/plans/:planId', overtimeController.getOvertimePlan);
router.patch('/plans/:planId', authorize('admin', 'hr', 'manager', 'user'), overtimeController.updateOvertimePlan);
router.delete('/plans/:planId', authorize('admin', 'hr', 'manager', 'user'), overtimeController.deleteOvertimePlan);

router.get('/requests', overtimeController.listOvertimeRequests);
router.post('/requests', overtimeController.createOvertimeRequest);
router.get('/requests/summary', overtimeController.getUserOvertimeDashboardSummary);
router.get('/requests/admin-summary', authorize('admin', 'hr', 'manager'), overtimeController.getAdminHrOvertimeDashboardSummary);
router.get('/requests/pending', authorize('admin', 'hr', 'manager'), overtimeController.listPendingOvertimeRequests);
router.get('/requests/unpaid', authorize('admin', 'hr'), overtimeController.listUnpaidApprovedOvertimeRequests);
router.get('/requests/:overtimeId', overtimeController.getOvertimeRequest);
router.patch('/requests/:overtimeId', overtimeController.updateOwnPendingOvertimeRequest);
router.delete('/requests/:overtimeId', overtimeController.deleteOvertimeRequest);
router.get('/requests/:overtimeId/logs', overtimeController.listOvertimeRequestLogs);
router.patch('/requests/:overtimeId/approve', authorize('admin', 'hr', 'manager'), overtimeController.approveOvertimeRequest);
router.patch('/requests/:overtimeId/reject', authorize('admin', 'hr', 'manager'), overtimeController.rejectOvertimeRequest);
router.patch('/requests/:overtimeId/paid', authorize('admin', 'hr'), overtimeController.markOvertimeAsPaid);

module.exports = router;
