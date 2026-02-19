const axios = require('axios');

const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY;
const FLW_BASE_URL = 'https://api.flutterwave.com/v3';

const flwHeader = {
    headers: { 
        'Authorization': `Bearer ${FLW_SECRET_KEY}`,
        'Content-Type': 'application/json'
    },
    timeout: 15000 
};

/**
 * Helper: Exponential Backoff Wrapper
 */
const requestWithRetry = async (config, retries = 5, backoff = 1000) => {
    try {
        return await axios(config);
    } catch (error) {
        const isRetryable = !error.response || (error.response.status >= 500 && error.response.status <= 599);
        if (retries > 0 && isRetryable) {
            await new Promise(resolve => setTimeout(resolve, backoff));
            return requestWithRetry(config, retries - 1, backoff * 2);
        }
        throw error;
    }
};

/**
 * Smart Verify Transaction
 * Automatically switches between ID verification and Reference verification.
 * @param {string|number} identifier - The FLW ID (number) or tx_ref (string)
 */
const verifyTransaction = async (identifier) => {
    if (!identifier) throw new Error("Transaction identifier is required");

    // Check if the identifier is a reference (contains non-numeric characters)
    // IDs are strictly numeric, tx_refs contain letters/dashes like "FUND-"
    const isReference = isNaN(identifier) || typeof identifier === 'string'; 
    
    let config;

    if (isReference) {
        // Use the verify_by_reference endpoint
        config = {
            method: 'get',
            url: `${FLW_BASE_URL}/transactions/verify_by_reference`,
            params: { tx_ref: identifier }, // Axios handles encoding automatically
            ...flwHeader
        };
    } else {
        // Use the ID-based verification endpoint
        config = {
            method: 'get',
            url: `${FLW_BASE_URL}/transactions/${identifier}/verify`,
            ...flwHeader
        };
    }

    try {
        const response = await requestWithRetry(config);
        
        // Flutterwave verify_by_reference sometimes returns data in an array 
        // or directly as an object depending on the account configuration
        let txData = response.data.data;
        if (Array.isArray(txData)) {
            txData = txData[0];
        }

        return txData;
    } catch (error) {
        // If it's a 400/404, we bubble it up so the sync job can log it as "Not Found"
        throw error;
    }
};

/**
 * Initialize Payment (Gateway)
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
            payment_options: "card, banktransfer, ussd",
            customer: { email, name: fullName },
            customizations: {
                title: "Data Padi Wallet Funding",
                description: "Wallet Top-up"
            }
        },
        ...flwHeader
    };

    const response = await requestWithRetry(config);
    return { link: response.data.data.link, tx_ref };
};

/**
 * Generate Static Virtual Account
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
            tx_ref: tx_ref
        },
        ...flwHeader
    };

    const response = await requestWithRetry(config);
    return response.data.data; 
};

module.exports = { 
    initializePayment, 
    createVirtualAccount, 
    verifyTransaction 
};