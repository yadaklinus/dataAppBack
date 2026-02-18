const express = require('express');
const router = express.Router();
const authMiddleware = require('@/middleware/authMiddleware');
const fundingController = require('@/api/v1/flw/paymentController');
const webhookController = require('@/webhook/paymentWebhook');

// PUBLIC: Flutterwave hits this. No authMiddleware here!
router.post('/webhook/flutterwave', webhookController.handleFlutterwaveWebhook);

// PRIVATE: User actions
router.use(authMiddleware);
router.post('/fund/init', fundingController.initGatewayFunding);
router.post('/kyc/verify-bvn', fundingController.verifyBvnAndCreateAccount);

module.exports = router;