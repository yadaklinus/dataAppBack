const express = require('express');
const router = express.Router();
const { authMiddleware } = require('@/middleware/authMiddleware');
const airtimeController = require('@/api/v1/transactions/airtimeController');
const dataController = require('@/api/v1/transactions/dataController');
const printingController = require('@/api/v1/transactions/pinController');

// All VTU routes are protected by the authMiddleware (Server Session)
router.use(authMiddleware);

// --- AIRTIME ROUTES ---
router.post('/airtime', airtimeController.purchaseAirtime);
router.get('/airtime/:reference', airtimeController.getAirtimeStatus);

// --- DATA ROUTES ---
router.get('/data/plans', dataController.getAvailablePlans);
router.post('/data', dataController.purchaseData);
router.get('/data/:reference', dataController.getDataStatus);

// --- RECHARGE CARD PRINTING (E-PIN) ROUTES ---

/**
 * @route   POST /api/vtu/print
 * @desc    Generate recharge card pins (100, 200, 500)
 */
router.post('/print', printingController.printPins);

router.get('/pins', printingController.getPrintingOrders);
/**
 * 
 * @route   GET /api/vtu/print/:reference
 * @desc    Fetch pins for a specific printing transaction (for printing/display)
 */
router.get('/print/:reference', printingController.getTransactionPins);

module.exports = router;