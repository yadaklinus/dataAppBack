"use strict";
const express = require('express');
const router = express.Router();
const adminController = require('@/api/v1/admin/adminController');
const { authorizeAdmin } = require('@/middleware/authMiddleware');
// Administrative Stats - Restricted to ADMIN tier
router.get('/stats', adminController.getGeneralStats);
module.exports = router;
