const express = require('express');
const router = express.Router();
const authMiddleware = require('@/middleware/authMiddleware');
const monnifyMiddleware = require('@/middleware/monnifyMiddleware');
const monnifyController = require('@/api/v1/monify/monnifyController');

/**
 * PUBLIC ROUTE
 * This is the endpoint you will paste into your Monnify Dashboard 
 * under "Webhook URL". It must NOT have authMiddleware.
 */
router.post('/webhook', monnifyMiddleware.handleMonnifyWebhook);

/**
 * PROTECTED ROUTES
 * These require a valid Bearer Token (JWT)
 */
router.use(authMiddleware);

// Endpoint to start the standard checkout/gateway process
router.post('/fund/init', monnifyController.initGatewayFunding);

// Endpoint to verify BVN and link a dedicated reserved account
router.post('/kyc/create', monnifyController.createAccount);

module.exports = router;