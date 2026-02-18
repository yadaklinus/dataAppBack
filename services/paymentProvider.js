const axios = require('axios');

const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY;
const FLW_BASE_URL = 'https://api.flutterwave.com/v3';

const flwHeader = {
    headers: { 
        'Authorization': `Bearer ${FLW_SECRET_KEY}`,
        'Content-Type': 'application/json'
    },
    timeout: 15000 // 15 seconds timeout
};

/**
 * Helper: Exponential Backoff Wrapper
 * Retries up to 5 times: 1s, 2s, 4s, 8s, 16s
 */
const requestWithRetry = async (config, retries = 5, backoff = 1000) => {
    try {
        return await axios(config);
    } catch (error) {
        // Only retry on network errors or 5xx server errors (like 502)
        const isRetryable = !error.response || (error.response.status >= 500 && error.response.status <= 599);
        
        if (retries > 0 && isRetryable) {
            await new Promise(resolve => setTimeout(resolve, backoff));
            return requestWithRetry(config, retries - 1, backoff * 2);
        }
        throw error;
    }
};

/**
 * Initialize a Flutterwave Standard Payment (Gateway)
 * Updated to explicitly include bank transfer and other payment options
 */
const initializePayment = async (userId, amount, email, fullName) => {
    const tx_ref = `FUND-${Date.now()}-${userId}`;
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const redirect_url = `${baseUrl}/dashboard`.replace(/([^:]\/)\/+/g, "$1");

    const config = {
        method: 'post',
        url: `${FLW_BASE_URL}/payments`,
        data: {
            tx_ref,
            amount,
            currency: "NGN",
            redirect_url,
            // Added payment_options to enable specific channels
            payment_options: "card, banktransfer, ussd, account",
            customer: { email, name: fullName },
            customizations: {
                title: "Data Padi Wallet Funding",
                description: "Wallet Top-up",
                logo: "https://your-logo-url.com/logo.png" // Optional: Add your logo here
            }
        },
        ...flwHeader
    };

    try {
        const response = await requestWithRetry(config);
        return { link: response.data.data.link, tx_ref };
    } catch (error) {
        // Handle HTML error pages (like 502) gracefully
        const isHtml = typeof error.response?.data === 'string' && error.response.data.includes('<!DOCTYPE html>');
        const errorMessage = isHtml ? "Payment provider is temporarily unavailable (502)" : (error.response?.data?.message || error.message);
        
        console.error("FLW Initialization Failed:", errorMessage);
        throw new Error(errorMessage);
    }
};

/**
 * Generate Static NGN Virtual Account
 */
const createVirtualAccount = async (params) => {
    const { email, bvn, phoneNumber, fullName, userId } = params;
    const tx_ref = `VA-REG-${Date.now()}-${userId}`;
    
    const config = {
        method: 'post',
        url: `${FLW_BASE_URL}/virtual-account-numbers`,
        data: {
            email: email,
            is_permanent: true,
            bvn: bvn,
            phonenumber: phoneNumber,
            firstname: "Data Padi",
            lastname: fullName.toUpperCase(),
            narration: `Data Padi - ${fullName}`,
            tx_ref: tx_ref
        },
        ...flwHeader
    };

    try {
        const response = await requestWithRetry(config);
        return response.data.data; 
    } catch (error) {
        const isHtml = typeof error.response?.data === 'string' && error.response.data.includes('<!DOCTYPE html>');
        const errorMessage = isHtml ? "Provider identity service is down" : (error.response?.data?.message || error.message);
        
        throw new Error(errorMessage);
    }
};

/**
 * Verify Transaction Status
 */
const verifyTransaction = async (transactionId) => {
    const config = {
        method: 'get',
        url: `${FLW_BASE_URL}/transactions/${transactionId}/verify`,
        ...flwHeader
    };
    const response = await requestWithRetry(config);
    return response.data.data;
};

module.exports = { initializePayment, createVirtualAccount, verifyTransaction };