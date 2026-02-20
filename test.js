require('dotenv').config();

const MONNIFY_API_KEY = process.env.MONNIFY_API_KEY;
const MONNIFY_SECRET_KEY = process.env.MONNIFY_SECRET_KEY;
const MONNIFY_CONTRACT_CODE = process.env.MONNIFY_CONTRACT_CODE;
const MONNIFY_BASE_URL = process.env.MONNIFY_BASE_URL || 'https://sandbox.monnify.com';

// In-memory cache for the token. 
// NOTE: In a multi-instance deployment (PM2, Kubernetes) or serverless environment, 
// use Redis to store this token instead so instances don't fetch redundant tokens.
let cachedToken = null;
let tokenExpiry = null;

/**
 * Helper: Get Access Token (Bearer)
 * Monnify requires Basic Auth to get a JWT that lasts 1 hour.
 */
const getAccessToken = async () => {
    // Check if we have a valid cached token (with 1-minute buffer)
    if (cachedToken && tokenExpiry && Date.now() < (tokenExpiry - 60000)) {
        return cachedToken;
    }

    const auth = Buffer.from(`${MONNIFY_API_KEY}:${MONNIFY_SECRET_KEY}`).toString('base64');

    const response = await fetch(`${MONNIFY_BASE_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${auth}` }
    });

    const json = await response.json();

    if (!response.ok || !json.requestSuccessful) {
        throw new Error(`Monnify Auth Failed: ${json.responseMessage || 'Unknown error'}`);
    }

    cachedToken = json.responseBody.accessToken;
    tokenExpiry = Date.now() + (json.responseBody.expiresIn * 1000);

    return cachedToken;
};

/**
 * Resilient Fetch wrapper to handle intermittent 5xx network/API drops
 */
const fetchWithRetry = async (url, options, retries = 3, backoff = 1000) => {
    try {
        const response = await fetch(url, options);
        // Only retry on server errors (5xx), not client errors (4xx)
        if (!response.ok && response.status >= 500 && retries > 0) {
            console.warn(`Monnify API 5xx Error. Retrying in ${backoff}ms...`);
            await new Promise(r => setTimeout(r, backoff));
            return fetchWithRetry(url, options, retries - 1, backoff * 2);
        }
        return response;
    } catch (e) {
        if (retries > 0) {
            console.warn(`Network Error. Retrying in ${backoff}ms...`);
            await new Promise(r => setTimeout(r, backoff));
            return fetchWithRetry(url, options, retries - 1, backoff * 2);
        }
        throw e;
    }
};

/**
 * Initialize Transaction
 * @param {string} userId - Internal user ID
 * @param {number} amount - Amount to charge
 * @param {string} email - Customer email
 * @param {string} fullName - Customer name
 */
const initializePayment = async (userId, amount, email, fullName) => {
    // 1. Basic Validation to prevent useless API calls
    if (!userId || !amount || !email || !fullName) {
        throw new Error("Missing required parameters for payment initialization");
    }

    const token = await getAccessToken();
    
    // Use a robust idempotency/reference key. 
    // In production, save this ref to your database BEFORE calling the API.
    const paymentReference = `FUND-MNFY-${Date.now()}-${userId}`;
    
    // Fix: Monnify strictly validates this. Rejecting 'localhost' is common.
    // Default to a valid HTTPS URL to pass validation if FRONTEND_URL is missing.
    let baseUrl = 'https://example.com';
    baseUrl = baseUrl.replace(/\/$/, ''); // Strip trailing slash to prevent '//' in the URL

    const payload = {
        amount: Number(amount),
        customerEmail: email,
        customerName: fullName,
        paymentReference: paymentReference,
        paymentDescription: "Wallet Top-up",
        currencyCode: "NGN",
        contractCode: MONNIFY_CONTRACT_CODE,
        redirectUrl: `${baseUrl}/dashboard`,
        paymentMethods: ["CARD", "ACCOUNT_TRANSFER"]
    };

    const options = {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    };

    const response = await fetchWithRetry(`${MONNIFY_BASE_URL}/api/v1/merchant/transactions/init-transaction`, options);
    const json = await response.json();

    if (!json.requestSuccessful) {
        throw new Error(`Monnify init failed: ${json.responseMessage}`);
    }

    return {
        link: json.responseBody.checkoutUrl,
        tx_ref: json.responseBody.paymentReference, 
        transactionReference: json.responseBody.transactionReference
    };
};

// --- Execution / Testing Block ---
(async () => {
    try {
        // We must pass the actual arguments and await the promise.
        console.log("Initializing payment...");
        const result = await initializePayment(
            "usr_12345", 
            5000, 
            "customer@example.com", 
            "John Doe"
        );
        console.log("Success! Payment Details:", result);
    } catch (error) {
        console.error("Payment initialization failed:", error.message);
    }
})();

module.exports = { initializePayment };