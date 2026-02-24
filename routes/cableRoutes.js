const express = require('express');
const router = express.Router();
const { authMiddleware } = require('@/middleware/authMiddleware');
const cableController = require('@/api/v1/transactions/cableController');

// --- CABLE / TV ROUTES ---

/**
 * @route   GET /api/vtu/cable/packages
 * @desc    Get available cable packages (Public - Frontend needs this before login)
 */
router.get('/packages', cableController.getPackages);

// ==========================================
// PROTECTED ROUTES BELOW THIS LINE
// ==========================================
router.use(authMiddleware);

/**
 * @route   GET /api/vtu/cable/verify
 * @desc    Verify IUC/Smartcard Number and get Customer Name
 */
router.get('/verify', cableController.verifyIUC);

/**
 * @route   POST /api/vtu/cable/pay
 * @desc    Purchase cable subscription
 */
router.post('/pay', cableController.purchaseSubscription);

module.exports = router;