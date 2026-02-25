const express = require('express');
const router = express.Router();
const webhookController = require('@/webhook/paystackWebhook');

/**
 * PUBLIC: Paystack hits this. No authMiddleware!
 * @route   POST /api/v1/paystack/webhook/paystack
 */
router.post('/webhook/paystack', webhookController.handlePaystackWebhook);

module.exports = router;
