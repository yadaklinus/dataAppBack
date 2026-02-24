const axios = require('@/lib/providerClient');

const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY;
const FLW_BASE_URL = 'https://api.flutterwave.com/v3';

const flwHeader = {
    headers: {
        'Authorization': `Bearer ${FLW_SECRET_KEY}`,
        'Content-Type': 'application/json'
    }
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
const verifyTransaction = async (tx_ref) => {
    if (!tx_ref) throw new Error("Transaction reference (tx_ref) is required");

    const config = {
        method: 'GET',
        url: `${FLW_BASE_URL}/transactions/verify_by_reference`,
        // Axios handles query string serialization automatically
        params: {
            tx_ref: String(tx_ref).trim()
        },
        headers: {
            ...flwHeader.headers, // Spreading headers from your existing config
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }
    };

    try {
        // Using axios directly or via your requestWithRetry wrapper
        const response = await axios(config);

        /**
         * Axios wraps the response body in .data
         * Flutterwave's response structure is { status: "success", data: [...] }
         */
        let txData = response.data.data;

        if (Array.isArray(txData)) {
            // Take the most relevant attempt
            txData = txData[0];
        }

        return txData;
    } catch (error) {
        // Axios provides the full response in error.response if the server replied
        const status = error.response?.status || 'NETWORK_ERROR';
        const message = error.response?.data?.message || error.message;

        console.error(`[FLW Verify Error] Ref: ${tx_ref} | Status: ${status} | Msg: ${message}`);

        // Re-throw so your Webhook or Sync Job can handle the failure (e.g., retry)
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