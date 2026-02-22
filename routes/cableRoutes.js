const express = require('express');
const router = express.Router();
const authMiddleware = require('@/middleware/authMiddleware');
const cableController = require('@/api/v1/transactions/cableController');

// --- ELECTRICITY ROUTES ---

/**
 * @route   GET /api/vtu/electricity/verify
 * @desc    Verify Meter Number and get Customer Name
 */
router.use(authMiddleware)
router.get('/verify', cableController.verifyIUC);


router.get('/packages', cableController.getPackages);

/**
 * @route   POST /api/vtu/electricity/pay
 * @desc    Purchase electricity units / pay postpaid bill
 */
router.post('/pay', cableController.purchaseSubscription);

// ... rest of file ...

module.exports = router