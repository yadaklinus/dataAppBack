"use strict";
/**
 * Monnify Payment Integration Service
 * Handles Bearer Token generation, Transaction Initialization, and Verification.
 */
const axios = require('@/lib/providerClient');
const MONNIFY_API_KEY = process.env.MONNIFY_API_KEY;
const MONNIFY_SECRET_KEY = process.env.MONNIFY_SECRET_KEY;
const MONNIFY_CONTRACT_CODE = process.env.MONNIFY_CONTRACT_CODE;
const MONNIFY_BASE_URL = process.env.MONNIFY_BASE_URL || 'https://sandbox.monnify.com';
if (process.env.NODE_ENV === 'production' && MONNIFY_BASE_URL.includes('sandbox')) {
    throw new Error('FATAL: Using sandbox Monnify URL in production!');
}
let cachedToken = null;
let tokenExpiry = null;
/**
 * Helper: Get Access Token (Bearer)
 */
const getAccessToken = async () => {
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
        throw new Error(`Monnify Auth Failed: ${json.responseMessage}`);
    }
    cachedToken = json.responseBody.accessToken;
    tokenExpiry = Date.now() + (json.responseBody.expiresIn * 1000);
    return cachedToken;
};
/**
 * Helper: Fetch with Exponential Backoff
 */
const fetchWithRetry = async (url, options, retries = 3, backoff = 1000) => {
    try {
        const response = await fetch(url, options);
        if (!response.ok && response.status >= 500 && retries > 0) {
            await new Promise(r => setTimeout(r, backoff));
            return fetchWithRetry(url, options, retries - 1, backoff * 2);
        }
        return response;
    }
    catch (e) {
        if (retries > 0) {
            await new Promise(r => setTimeout(r, backoff));
            return fetchWithRetry(url, options, retries - 1, backoff * 2);
        }
        throw e;
    }
};
/**
 * Initialize Transaction
 */
const initializePayment = async (userId, amount, email, fullName) => {
    const token = await getAccessToken();
    const paymentReference = `FUND-MNFY-${Date.now()}-${userId}`;
    const baseUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
    const response = await axios.post(`${MONNIFY_BASE_URL}/api/v1/merchant/transactions/init-transaction`, {
        amount: Number(amount),
        customerEmail: email,
        customerName: fullName,
        paymentReference: paymentReference,
        paymentDescription: "Wallet Top-up",
        currencyCode: "NGN",
        contractCode: MONNIFY_CONTRACT_CODE,
        redirectUrl: `${baseUrl}/dashboard`,
        paymentMethods: ["CARD", "ACCOUNT_TRANSFER"]
    }, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const json = response.data;
    if (!json.requestSuccessful) {
        throw new Error(json.responseMessage || "Monnify initialization failed");
    }
    return {
        link: json.responseBody.checkoutUrl,
        tx_ref: json.responseBody.paymentReference,
        transactionReference: json.responseBody.transactionReference
    };
};
/**
 * Verify Transaction by Payment Reference
 */
const verifyTransaction = async (paymentReference) => {
    if (!paymentReference)
        throw new Error("Payment reference is required");
    const token = await getAccessToken();
    const response = await axios.get(`${MONNIFY_BASE_URL}/api/v2/merchant/transactions/query`, {
        params: { paymentReference },
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const json = response.data;
    if (!json.requestSuccessful) {
        const error = new Error(json.responseMessage || "Verification failed");
        error.status = 404;
        throw error;
    }
    // ...
    const body = json.responseBody;
    // Normalize response to match our internal standard
    return {
        status: body.paymentStatus === 'PAID' ? 'successful' : body.paymentStatus.toLowerCase(),
        amount: body.amountPaid,
        currency: body.currency,
        id: body.transactionReference,
        customer: body.customer,
        paymentMethod: body.paymentMethod
    };
};
/**
 * Create Dedicated Virtual Account (Reserved Account)
 * @param {object} params - { email, bvn, phoneNumber, fullName, userId }
 */
const createVirtualAccount = async (params) => {
    const { email, bvn, fullName, userId } = params;
    const token = await getAccessToken();
    const accountReference = `VA-REF-${Date.now()}-${userId}`;
    // BUILDER TIP: When a BVN is provided, Monnify ignores custom prefixes 
    // like "Data Padi -". It's better to send the raw fullName to ensure 
    // the KYC matching algorithm passes.
    const response = await axios.post(`${MONNIFY_BASE_URL}/api/v2/bank-transfer/reserved-accounts`, {
        accountReference: accountReference,
        accountName: fullName, // Send the person's name directly
        currencyCode: "NGN",
        contractCode: MONNIFY_CONTRACT_CODE,
        customerEmail: email,
        customerName: fullName,
        bvn: bvn,
        getAllAvailableBanks: true
    }, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const json = response.data;
    if (!json.requestSuccessful) {
        // Log the exact reason (e.g., "Names on BVN do not match account name")
        console.error(`[Monnify Error] ${json.responseMessage}`);
        throw new Error(json.responseMessage || "Monnify Reserved Account creation failed");
    }
    const body = json.responseBody;
    const primaryAccount = body.accounts[0];
    return {
        // We return the legal name assigned by the bank/BVN, not what we sent.
        // This is the "Truth" that will appear on the user's banking app.
        account_number: primaryAccount.accountNumber,
        bank_name: primaryAccount.bankName,
        bank_code: primaryAccount.bankCode,
        account_name: body.accountName,
        order_ref: body.accountReference,
        note: body.customerName
    };
};
module.exports = {
    initializePayment,
    verifyTransaction,
    createVirtualAccount
};
