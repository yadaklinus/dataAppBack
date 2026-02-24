"use strict";
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('@/middleware/authMiddleware');
const educationController = require('@/api/v1/transactions/educationController');
// All education routes are protected by the authMiddleware
router.use(authMiddleware);
/**
 * @route   GET /api/v1/edu/packages
 * @desc    Get available JAMB/WAEC packages
 */
router.get('/packages', educationController.getPackages);
/**
 * @route   GET /api/v1/edu/verify-jamb
 * @desc    Verify JAMB Profile ID
 */
router.get('/verify-jamb', educationController.verifyJamb);
/**
 * @route   POST /api/v1/edu/purchase
 * @desc    Purchase JAMB/WAEC PIN
 */
router.post('/purchase', educationController.purchasePin);
module.exports = router;
