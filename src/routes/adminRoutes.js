const express = require('express');
const adminController = require('../controllers/adminController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/dashboard', authenticate, authorize('admin'), adminController.dashboard);

module.exports = router;
