const express = require('express');
const router = express.Router();
const { authMiddleware } = require('@/middleware/authMiddleware');
const electricityController = require('@/api/v1/transactions/electricityController');

// --- ELECTRICITY ROUTES ---

/**
 * @route   GET /api/vtu/electricity/verify
 * @desc    Verify Meter Number and get Customer Name
 */

router.get('/disco', electricityController.getDiscos);


router.use(authMiddleware)
router.get('/verify', electricityController.verifyMeterNumber);

/**
 * @route   POST /api/vtu/electricity/pay
 * @desc    Purchase electricity units / pay postpaid bill
 */
router.post('/pay', electricityController.purchaseElectricity);

// ... rest of file ...

module.exports = router