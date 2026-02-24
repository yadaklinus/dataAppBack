const express = require('express');
// const rateLimit = require('express-rate-limit');
const router = express.Router();

const authMiddleware = require('@/middleware/authMiddleware');
const flutterwaveController = require('@/api/v1/flw/flutterwaveController');
const webhookController = require('@/webhook/paymentWebhook');

// 1. Define the specific KYC rate limiter
// const kycLimiter = rateLimit({
//     windowMs: 60 * 60 * 1000, // 1 hour window
//     max: 3, // Limit each user to 3 KYC attempts per window
//     keyGenerator: (req) => {
//         // Tie the limit to the authenticated user ID. 
//         // Fallback to IP if req.user is somehow undefined (defense in depth).
//         return req.user?.id || req.ip; 
//         return req.user?.id || req.ip; 
//     },
//     message: { 
//         status: 'ERROR', 
//         message: 'Too many KYC attempts. Please try again in 1 hour.' 
//     },
//     standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
//     legacyHeaders: false,  // Disable the deprecated `X-RateLimit-*` headers
// });

// PUBLIC: Flutterwave hits this. No authMiddleware here!
router.post('/webhook/flutterwave', webhookController.handleFlutterwaveWebhook);

// PRIVATE: User actions
router.use(authMiddleware);
router.post('/fund/init', flutterwaveController.initGatewayFunding);

// 2. Apply the limiter strictly to the KYC endpoint
router.post('/kyc/create', flutterwaveController.createAccount);

module.exports = router;