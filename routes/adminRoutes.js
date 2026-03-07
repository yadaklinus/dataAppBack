const express = require('express');
const router = express.Router();
const adminController = require('@/api/v1/admin/adminController');
const { authorizeAdmin } = require('@/middleware/authMiddleware');



module.exports = router;
