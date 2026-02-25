/**
 * Paystack Payment Integration Service
 * Handles Transaction Initialization, Verification, and Dedicated Virtual Accounts.
 */

const axios = require('@/lib/providerClient');

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE_URL = process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co';

/**
 * Initialize Transaction
 */
const initializePayment = async (userId, amount, email) => {
    const paymentReference = `FUND-PSTK-${Date.now()}-${userId}`;

    const response = await axios.post(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
        email: email,
        amount: Math.round(Number(amount) * 100), // Paystack expects amount in subunits (kobo)
        reference: paymentReference,
        callback_url: `${process.env.FRONTEND_URL || ''}/dashboard`,
        metadata: {
            userId: userId,
            custom_fields: [
                {
                    display_name: "User ID",
                    variable_name: "user_id",
                    value: userId
                }
            ]
        }
    }, {
        headers: {
            'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
            'Content-Type': 'application/json'
        }
    });

    const json = response.data;

    if (!json.status) {
        throw new Error(json.message || "Paystack initialization failed");
    }

    return {
        link: json.data.authorization_url,
        tx_ref: paymentReference, // We use our own reference
        access_code: json.data.access_code
    };
};

/**
 * Verify Transaction by Reference
 */
const verifyTransaction = async (reference) => {
    if (!reference) throw new Error("Reference is required");

    const response = await axios.get(`${PAYSTACK_BASE_URL}/transaction/verify/${reference}`, {
        headers: { 'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}` }
    });

    const json = response.data;

    if (!json.status) {
        const error = new Error(json.message || "Verification failed");
        error.status = 404;
        throw error;
    }

    const data = json.data;

    return {
        status: data.status, // e.g., 'success', 'failed'
        amount: data.amount / 100, // Convert back from kobo
        currency: data.currency,
        reference: data.reference,
        customer: data.customer,
        paymentMethod: data.channel
    };
};

/**
 * Assign Dedicated Virtual Account (DVA)
 * @param {object} params - { email, first_name, last_name, phone, bvn, preferred_bank }
 */
const createVirtualAccount = async (params) => {
    const { email, first_name, last_name, phone, bvn, preferred_bank } = params;

    const response = await axios.post(`${PAYSTACK_BASE_URL}/dedicated_account/assign`, {
        email,
        first_name,
        last_name,
        phone,
        preferred_bank: preferred_bank || 'wema-bank',
        bvn,
        country: "NG"
    }, {
        headers: {
            'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
            'Content-Type': 'application/json'
        }
    });

    const json = response.data;

    if (!json.status) {
        throw new Error(json.message || "Paystack DVA assignment failed");
    }

    // Note: /dedicated_account/assign response for Paystack can be asynchronous or success
    // If it's "Assign dedicated account in progress", we might need to handle it via webhook
    // but usually, it returns true if it initiated.
    return {
        status: json.status,
        message: json.message
    };
};

module.exports = {
    initializePayment,
    verifyTransaction,
    createVirtualAccount
};
