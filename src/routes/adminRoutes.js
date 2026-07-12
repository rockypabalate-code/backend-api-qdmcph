const express = require('express');
const adminController = require('../controllers/adminController');
const authController = require('../controllers/authController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(authenticate, authorize('admin'));

router.get('/dashboard', adminController.dashboard);
router.post('/users', authController.createAccount);

module.exports = router;
