const express = require('express');
const router = express.Router();
const analyticsController = require('@/api/v1/admin/analyticsController');
const { requireSuperAdmin } = require('@/middleware/authMiddleware');

// All analytics routes require Super Admin privileges
router.use(requireSuperAdmin);

router.get('/overview', analyticsController.getOverview);
router.get('/revenue', analyticsController.getRevenueChart);
router.get('/by-service', analyticsController.getByService);
router.get('/transactions', analyticsController.getTransactions);
router.get('/users', analyticsController.getUsers);
router.get('/data', analyticsController.getDataAnalytics);
router.get('/airtime', analyticsController.getAirtimeAnalytics);
router.get('/provider-wallets', analyticsController.getProviderWallets);
router.get('/funding', analyticsController.getFundingAnalytics);

module.exports = router;
