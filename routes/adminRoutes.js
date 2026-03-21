const express = require('express');
const router = express.Router();
const adminController = require('@/api/v1/admin/adminController');
const dataPlanController = require('@/api/v1/admin/dataPlanController');
const { authMiddleware, requireSuperAdmin } = require('@/middleware/authMiddleware');

// --- DATA PLAN MANAGEMENT (SUPER ADMIN ONLY) ---
router.post('/data-plans/sync', authMiddleware, requireSuperAdmin, dataPlanController.syncDataPlans);
router.get('/data-plans', authMiddleware, requireSuperAdmin, dataPlanController.getAllDataPlans);
router.patch('/data-plans/reorder', authMiddleware, requireSuperAdmin, dataPlanController.reorderDataPlans);
router.patch('/data-plans/:id', authMiddleware, requireSuperAdmin, dataPlanController.updateDataPlan);
router.delete('/data-plans/:id', authMiddleware, requireSuperAdmin, dataPlanController.deleteDataPlan);

module.exports = router;
