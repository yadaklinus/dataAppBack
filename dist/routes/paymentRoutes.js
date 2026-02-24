"use strict";
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('@/middleware/authMiddleware');
const paymentController = require('@/api/v1/payment/paymentController');
// All payment routes are protected
router.use(authMiddleware);
/**
 * @route   POST /api/v1/payment/fund/init
 * @desc    Initialize gateway funding (switchable between Monnify/Flutterwave)
 */
router.post('/fund/init', paymentController.initGatewayFunding);
/**
 * @route   POST /api/v1/payment/kyc/create
 * @desc    Create dedicated virtual account (switchable)
 */
router.post('/kyc/create', paymentController.createAccount);
module.exports = router;
