"use strict";
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { authMiddleware } = require('@/middleware/authMiddleware');
const monnifyMiddleware = require('@/middleware/monnifyMiddleware');
const monnifyController = require('@/api/v1/monnify/monnifyController');
// 1. Define the strict KYC rate limiter
// const kycLimiter = rateLimit({
//     windowMs: 60 * 60 * 1000, // 1 hour window
//     max: 3, // Limit each user to 3 attempts per hour
//     keyGenerator: (req) => {
//         // Tie the limit to the authenticated user ID. 
//         // Fallback to IP if req.user is undefined (defense in depth).
//         return req.user?.id || req.ip; 
//     },
//     message: { 
//         status: 'ERROR', 
//         message: 'Too many KYC attempts. Try again in 1 hour.' 
//     },
//     standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
//     legacyHeaders: false,  // Disable the deprecated `X-RateLimit-*` headers
// });
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
// 2. Apply the limiter strictly to the KYC endpoint
router.post('/kyc/create', monnifyController.createAccount);
module.exports = router;
