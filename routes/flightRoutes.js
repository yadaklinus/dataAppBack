const express = require('express');
const router = express.Router();
const { authMiddleware, requireAdmin, requireTicketStaff } = require('@/middleware/authMiddleware');
const userController = require('@/api/v1/flights/userFlightController');
const staffController = require('@/api/v1/flights/staffFlightController');
const templateController = require('@/api/v1/flights/flightTemplateController');

// Public route - no auth required
router.get('/link', (req, res) => {
  res.json({ url: 'https://www.travelstart.com.ng/?affId=223554&utm_source=affiliate&utm_medium=223554' });
});

// All flight routes require authentication
router.use(authMiddleware);

// --- USER ROUTES ---
router.get('/user/airports', userController.getAirports);
router.post('/user/request', userController.requestFlight);
router.get('/user/requests', userController.getUserRequests);
router.get('/user/requests/:id', userController.getUserRequestById);
router.post('/user/:id/book', userController.bookFlight);
router.post('/user/:id/pay', userController.payForFlight);
router.post('/user/:id/cancel', userController.cancelFlightRequest);
router.get('/user/transactions', userController.getUserFlightTransactions);

// --- STAFF ROUTES ---
const staffAuth = requireTicketStaff;

router.get('/staff/requests', staffAuth, staffController.getAllRequests);
router.get('/staff/dashboard', staffAuth, staffController.getDashboardData);
router.post('/staff/:id/options', staffAuth, staffController.provideOptions);
router.post('/staff/:id/quote', staffAuth, staffController.quoteFlight);
router.post('/staff/:id/fulfill', staffAuth, staffController.fulfillTicket);
router.get('/staff/:id/history', staffAuth, staffController.getRequestHistory);
router.post('/staff/:id/cancel', staffAuth, staffController.cancelFlightRequest);
router.post('/staff/:id/refund', staffAuth, staffController.refundFlightRequest);
router.get('/staff/transactions', staffAuth, staffController.getAllFlightTransactions);

// --- TEMPLATE ROUTES ---
router.post('/staff/templates', staffAuth, templateController.saveTemplate);
router.get('/staff/templates', staffAuth, templateController.getTemplates);
router.delete('/staff/templates/:id', staffAuth, templateController.deleteTemplate);
router.post('/staff/request/:requestId/quote-from-template', staffAuth, templateController.quoteFromTemplate);

module.exports = router;
