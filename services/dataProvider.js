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
            params: { UserID: USER_ID },
            timeout: 15000,  
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

        // 1. Build Query Params
        const queryParams = new URLSearchParams({
            UserID: USER_ID,
            APIKey: API_KEY,
            MobileNetwork: networkCode,
            DataPlan: String(dataPlanId).trim(), // Force string and trim
            MobileNumber: phoneNumber,
            RequestID: requestId,
            CallBackURL: process.env.CALLBACK_URL || ''
        });

        const url = `${BASE_URL}/APIDatabundleV1.asp?${queryParams.toString()}`;
        
        // DEBUG: Copy this URL from your console and paste it into a browser to see if it works

        // 2. Execute Fetch with User-Agent
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                // Some providers return "Invalid Plan" if they detect a bot without a User-Agent
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const data = await response.json();

        // 3. Handle Provider Response
        if (data.statuscode === "100" || data.status === "ORDER_RECEIVED") {
            return {
                success: true,
                orderId: data.orderid,
                status: data.status
            };
        }

        // Logic Check: If the provider returns an error, throw the exact message
        const errorMessage = data.status || data.response_description || "Invalid data plan or request failed";
        throw new Error(errorMessage);

    } catch (error) {
        console.error("Nellobyte Data Error:", error.message);
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
            },
            timeout: 15000,  
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
            },
            timeout: 15000,  
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