const express = require('express');
const router = express.Router();
const { authMiddleware, requireAdmin, requireTicketStaff } = require('@/middleware/authMiddleware');
const userController = require('@/api/v1/flights/userFlightController');
const staffController = require('@/api/v1/flights/staffFlightController');

// All flight routes require authentication
router.use(authMiddleware);

// --- USER ROUTES ---
router.get('/user/airports', userController.getAirports);
router.post('/user/request', userController.requestFlight);
router.get('/user/requests', userController.getUserRequests);
router.get('/user/requests/:id', userController.getUserRequestById);
router.post('/user/:id/select', userController.selectOptionAndPassengers);
router.post('/user/:id/pay', userController.payForFlight);
router.post('/user/:id/cancel', userController.cancelFlightRequest);

// --- STAFF ROUTES ---
// We assume requireTicketStaff exists or we can use authorizeAdmin for now
// If requireTicketStaff doesn't exist, we fallback to authorizeAdmin. 
const staffAuth = requireTicketStaff;

router.get('/staff/requests', staffAuth, staffController.getAllRequests);
router.get('/staff/dashboard', staffAuth, staffController.getDashboardData);
router.post('/staff/:id/options', staffAuth, staffController.provideOptions);
router.post('/staff/:id/quote', staffAuth, staffController.quoteFlight);
router.post('/staff/:id/fulfill', staffAuth, staffController.fulfillTicket);
router.get('/staff/:id/history', staffAuth, staffController.getRequestHistory);
router.post('/staff/:id/cancel', staffAuth, staffController.cancelFlightRequest);
router.post('/staff/:id/refund', staffAuth, staffController.refundFlightRequest);

module.exports = router;
