"use strict";
const axios = require('axios');
/**
 * Nellobyte Systems EPIN (Recharge Card Printing) Integration Service
 * Documentation: https://www.nellobytesystems.com/
 */
const USER_ID = process.env.NELLOBYTE_USER_ID;
const API_KEY = process.env.NELLOBYTE_API_KEY;
const BASE_URL = 'https://www.nellobytesystems.com';
/**
 * Network codes for Nellobyte EPIN
 */
const NETWORK_CODES = {
    'MTN': '01',
    'GLO': '02',
    '9MOBILE': '03',
    'AIRTEL': '04'
};
/**
 * Utility: Calculate your 12% marked-up price for the cards
 * @param {number} faceValue - The value on the card (100, 200, 500)
 * @param {number} quantity - Number of cards
 */
/**
 * Purchase/Generate EPINs
 * @param {string} network - MTN, GLO, etc.
 * @param {number} value - Face value (100, 200, 500)
 * @param {number} quantity - Number of pins (1 to 100)
 * @param {string} requestId - Unique internal ID for reconciliation
 */
const buyEpin = async (network, value, quantity, requestId) => {
    try {
        const networkCode = NETWORK_CODES[network.toUpperCase()];
        if (!networkCode)
            throw new Error("Invalid network selection");
        if (![100, 200, 500].includes(Number(value))) {
            throw new Error("Invalid card value. Allowed: 100, 200, 500");
        }
        const response = await axios.get(`${BASE_URL}/APIEPINV1.asp`, {
            params: {
                UserID: USER_ID,
                APIKey: API_KEY,
                MobileNetwork: networkCode,
                Value: value,
                Quantity: quantity,
                RequestID: requestId,
                CallBackURL: process.env.CALLBACK_URL
            }
        });
        // Nellobyte returns an array TXN_EPIN on success
        if (response.data && response.data.TXN_EPIN) {
            return {
                success: true,
                pins: response.data.TXN_EPIN, // Array of { pin, serial, batch, etc }
                count: response.data.TXN_EPIN.length
            };
        }
        // Handle error strings returned by the API
        const errorMsg = typeof response.data === 'string' ? response.data : (response.data.status || "EPIN generation failed");
        throw new Error(errorMsg);
    }
    catch (error) {
        console.error("Nellobyte EPIN Error:", error.response?.data || error.message);
        throw error;
    }
};
/**
 * Query EPIN status by OrderID or RequestID
 */
const queryTransaction = async (requestId) => {
    try {
        const response = await axios.get(`${BASE_URL}/APIQueryV1.asp`, {
            params: {
                UserID: USER_ID,
                APIKey: API_KEY,
                RequestID: requestId
            }
        });
        return response.data;
    }
    catch (error) {
        throw new Error("Query failed");
    }
};
module.exports = {
    buyEpin,
    queryTransaction
};
