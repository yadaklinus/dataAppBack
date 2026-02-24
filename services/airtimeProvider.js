const axios = require('@/lib/providerClient');

/**
 * Nellobyte Systems Airtime Integration Service
 * Documentation: https://www.nellobytesystems.com/
 */

const USER_ID = process.env.NELLOBYTE_USER_ID;
const API_KEY = process.env.NELLOBYTE_API_KEY;
const BASE_URL = 'https://www.nellobytesystems.com';

/**
 * Maps human-readable networks to Nellobyte codes
 */
const NETWORK_CODES = {
    'MTN': '01',
    'GLO': '02',
    '9MOBILE': '03',
    'AIRTEL': '04'
};

/**
 * Purchase Airtime
 * @param {string} network - MTN, GLO, etc.
 * @param {number} amount - Minimum 50
 * @param {string} phoneNumber - Recipient
 * @param {string} requestId - Unique internal ID for reconciliation
 */
const buyAirtime = async (network, amount, phoneNumber, requestId) => {
    try {
        const networkCode = NETWORK_CODES[network.toUpperCase()];
        if (!networkCode) throw new Error("Invalid network selection");

        // Nellobyte uses GET for transactions. 
        // We use params object in axios to ensure proper URL encoding.
        const response = await axios.get(`${BASE_URL}/APIAirtimeV1.asp`, {
            params: {
                UserID: USER_ID,
                APIKey: API_KEY,
                MobileNetwork: networkCode,
                Amount: amount,
                MobileNumber: phoneNumber,
                RequestID: requestId,
                CallBackURL: process.env.CALLBACK_URL // Ensure this is set in .env
            }
        });

        // Nellobyte returns statuscode "100" for ORDER_RECEIVED
        if (response.data.statuscode === "100" || response.data.status === "ORDER_RECEIVED") {
            return {
                success: true,
                orderId: response.data.orderid,
                status: response.data.status
            };
        }

        throw new Error(response.data.status || "Airtime request failed");
    } catch (error) {
        console.error("Nellobyte Airtime Error:", error.response?.data || error.message);
        throw error;
    }
};

/**
 * Query the status of a specific transaction
 */
const queryTransaction = async (orderId) => {
    try {
        const response = await axios.get(`${BASE_URL}/APIQueryV1.asp`, {
            params: {
                UserID: USER_ID,
                APIKey: API_KEY,
                OrderID: orderId
            }
        });

        return response.data;
    } catch (error) {
        throw new Error("Could not verify transaction status");
    }
};

/**
 * Cancel a pending transaction
 */
const cancelTransaction = async (orderId) => {
    try {
        const response = await axios.get(`${BASE_URL}/APICancelV1.asp`, {
            params: {
                UserID: USER_ID,
                APIKey: API_KEY,
                OrderID: orderId
            }
        });

        return response.data;
    } catch (error) {
        throw new Error("Cancellation request failed");
    }
};

module.exports = {
    buyAirtime,
    queryTransaction,
    cancelTransaction
};