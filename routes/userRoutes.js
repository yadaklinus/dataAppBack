const express = require('express');
const router = express.Router();
const { authMiddleware } = require('@/middleware/authMiddleware');
const userController = require('@/api/v1/user/userController');

// Secure all user routes
router.use(authMiddleware);

/**
 * @route   GET /api/user/profile
 * @desc    Get user info and wallet balance
 */
router.get('/profile', userController.getProfile);

/**
 * @route   GET /api/user/dashboard
 * @desc    Get aggregate data for home screen (Balance + Recent Txns)
 */
router.get('/dashboard', userController.getDashboard);


/**
 * @route   GET /api/user/transactions
 * @desc    Get full transaction history with pagination
 */
router.get('/transactions', userController.getTransactions);

module.exports = router;