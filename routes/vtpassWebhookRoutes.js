const express = require('express');
const router = express.Router();
const webhookController = require('@/webhook/vtpassWebhook');

/**
 * PUBLIC: VTPass hits this URL. No authMiddleware.
 * @route   POST /api/v1/vtpass/webhook
 */
router.post('/webhook', webhookController.handleVTPassWebhook);

module.exports = router;
