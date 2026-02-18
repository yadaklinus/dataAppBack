const axios = require('axios');

/**
 * Nellobyte Systems Data Bundle Integration Service
 * Documentation: https://www.nellobytesystems.com/
 */

const USER_ID = process.env.NELLOBYTE_USER_ID;
const API_KEY = process.env.NELLOBYTE_API_KEY;
const BASE_URL = 'https://www.nellobytesystems.com';

/**
 * Network codes for Nellobyte Data
 */
const NETWORK_CODES = {
    'MTN': '01',
    'GLO': '02',
    '9MOBILE': '03',
    'AIRTEL': '04'
};

/**
 * Utility: Calculate your 12% marked-up price
 */
const calculateMyPrice = (providerAmount) => {
    const amount = parseFloat(providerAmount);
    if (isNaN(amount)) return 0;
    const markup = amount * 0.10;
    return Math.ceil(amount + markup); // Round up to nearest Naira
};

/**
 * Fetch available plans and automatically inject YOUR selling price
 */
const fetchAvailablePlans = async () => {
    try {
        const response = await axios.get(`${BASE_URL}/APIDatabundlePlansV2.asp`, {
            params: { UserID: USER_ID }
        });

        const data = response.data;

        // Loop through the response to add your profit margin
        if (data.MOBILE_NETWORK) {
            Object.keys(data.MOBILE_NETWORK).forEach(networkName => {
                data.MOBILE_NETWORK[networkName].forEach(networkGroup => {
                    if (networkGroup.PRODUCT) {
                        networkGroup.PRODUCT = networkGroup.PRODUCT.map(plan => ({
                            ...plan,
                            // We add our 12% markup here
                            SELLING_PRICE: calculateMyPrice(plan.PRODUCT_AMOUNT)
                        }));
                    }
                });
            });
        }

        return data;
    } catch (error) {
        console.error("Error fetching plans from provider:", error.message);
        throw new Error("Could not retrieve data plans from provider.");
    }
};

/**
 * Purchase Data Bundle
 */
const buyData = async (network, dataPlanId, phoneNumber, requestId) => {
    try {
        const networkCode = NETWORK_CODES[network.toUpperCase()];
        if (!networkCode) throw new Error("Invalid network selection");

        const response = await axios.get(`${BASE_URL}/APIDatabundleV1.asp`, {
            params: {
                UserID: USER_ID,
                APIKey: API_KEY,
                MobileNetwork: networkCode,
                DataPlan: dataPlanId,
                MobileNumber: phoneNumber,
                RequestID: requestId,
                CallBackURL: process.env.CALLBACK_URL
            }
        });

        if (response.data.statuscode === "100" || response.data.status === "ORDER_RECEIVED") {
            return {
                success: true,
                orderId: response.data.orderid,
                status: response.data.status
            };
        }

        throw new Error(response.data.status || "Data request failed at provider");
    } catch (error) {
        console.error("Nellobyte Data Error:", error.response?.data || error.message);
        throw new Error(error.message || "External Provider Error");
    }
};

/**
 * Query Transaction status
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
        throw new Error("Query failed");
    }
};

/**
 * Cancel a transaction
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
        throw new Error("Cancellation failed");
    }
};

module.exports = { 
    fetchAvailablePlans,
    buyData, 
    queryTransaction, 
    cancelTransaction,
    calculateMyPrice
};