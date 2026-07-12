const express = require('express');
const overtimeController = require('../controllers/overtimeController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(authenticate);

router.get('/departments', authorize('admin', 'hr', 'manager'), overtimeController.listDepartments);
router.post('/departments', authorize('admin', 'hr'), overtimeController.createDepartment);

router.get('/employees', authorize('admin', 'hr', 'manager'), overtimeController.listEmployees);
router.post('/employees', authorize('admin', 'hr'), overtimeController.createEmployee);

router.get('/policies', authorize('admin', 'hr', 'manager'), overtimeController.listPolicies);

router.get('/requests', overtimeController.listOvertimeRequests);
router.post('/requests', overtimeController.createOvertimeRequest);
router.get('/requests/summary', overtimeController.getUserOvertimeDashboardSummary);
router.get('/requests/admin-summary', authorize('admin', 'hr', 'manager'), overtimeController.getAdminHrOvertimeDashboardSummary);
router.get('/requests/pending', authorize('admin', 'hr', 'manager'), overtimeController.listPendingOvertimeRequests);
router.get('/requests/unpaid', authorize('admin', 'hr'), overtimeController.listUnpaidApprovedOvertimeRequests);
router.get('/requests/:overtimeId', overtimeController.getOvertimeRequest);
router.patch('/requests/:overtimeId', overtimeController.updateOwnPendingOvertimeRequest);
router.patch('/requests/:overtimeId/cancel', overtimeController.cancelOwnPendingOvertimeRequest);
router.get('/requests/:overtimeId/logs', overtimeController.listOvertimeRequestLogs);
router.patch('/requests/:overtimeId/approve', authorize('admin', 'hr', 'manager'), overtimeController.approveOvertimeRequest);
router.patch('/requests/:overtimeId/reject', authorize('admin', 'hr', 'manager'), overtimeController.rejectOvertimeRequest);
router.patch('/requests/:overtimeId/paid', authorize('admin', 'hr'), overtimeController.markOvertimeAsPaid);

module.exports = router;
