"use strict";
const monnifyController = require('@/api/v1/monnify/monnifyController');
const flutterwaveController = require('@/api/v1/flw/flutterwaveController');
const paystackController = require('@/api/v1/paystack/paystackController');
/**
 * Switchable Payment Gateway Logic
 * This controller acts as a proxy for either Monnify, Flutterwave or Paystack
 * based on the ACTIVE_PAYMENT_GATEWAY environment variable.
 */
const getActiveController = () => {
    const gateway = (process.env.ACTIVE_PAYMENT_GATEWAY || 'MONNIFY').toUpperCase();
    if (gateway === 'FLUTTERWAVE') {
        return flutterwaveController;
    }
    if (gateway === 'PAYSTACK') {
        return paystackController;
    }
    // Default to Monnify
    return monnifyController;
};
const initGatewayFunding = async (req, res) => {
    const controller = getActiveController();
    return controller.initGatewayFunding(req, res);
};
const createAccount = async (req, res) => {
    const controller = getActiveController();
    return controller.createAccount(req, res);
};
module.exports = { initGatewayFunding, createAccount };
