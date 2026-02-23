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
 * Utility: Calculate your 10% marked-up price
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
                        // Correctly map and inject SELLING_PRICE into the original object structure
                        networkGroup.PRODUCT = networkGroup.PRODUCT.map(plan => ({
                            ...plan,
                            // We add our 10% markup here
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

        // 1. Execute Axios Request
        // Axios natively handles URL parameter serialization and URL encoding via the 'params' object
        const response = await axios.get(`${BASE_URL}/APIDatabundleV1.asp`, {
            params: {
                UserID: USER_ID,
                APIKey: API_KEY,
                MobileNetwork: networkCode,
                DataPlan: String(dataPlanId).trim(),
                MobileNumber: phoneNumber,
                RequestID: requestId,
                CallBackURL: process.env.CALLBACK_URL || ''
            },
            headers: {
                // Nellobyte requires a User-Agent to bypass bot-detection blocks
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            timeout: 15000 
        });

        const data = response.data;

        // 2. Handle Provider Response (Business Logic level)
        // Nigerian VTU APIs often return HTTP 200 OK even when a transaction fails, 
        // so we must check the internal statuscode payload.
        if (data.statuscode === "100" || data.status === "ORDER_RECEIVED") {
            return {
                success: true,
                orderId: data.orderid,
                status: data.status
            };
        }

        // Logic Check: Provider returned 200 OK but business logic failed (e.g., Insufficient balance on provider side)
        const errorMessage = data.response_description || data.status || "Invalid data plan or request failed";
        throw new Error(`Provider Error: ${errorMessage}`);

    } catch (error) {
        // 3. Robust Error Handling
        // Handle Axios HTTP errors (4xx, 5xx) vs standard JS errors (e.g., Network timeout)
        const isAxiosHttpError = error.response && error.response.data;
        const errorDetail = isAxiosHttpError 
            ? (error.response.data.response_description || error.response.data.status || `HTTP ${error.response.status}`)
            : error.message;

        console.error(`[Nellobyte] buyData Error for Ref ${requestId}:`, errorDetail);
        throw new Error(`Data purchase failed: ${errorDetail}`);
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
        // Improve debugging by logging the actual Axios message
        console.error(`[Nellobyte] queryTransaction Error for Order ${orderId}:`, error.message);
        throw new Error("Transaction query failed");
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
        console.error(`[Nellobyte] cancelTransaction Error for Order ${orderId}:`, error.message);
        throw new Error("Transaction cancellation failed");
    }
};

module.exports = { 
    fetchAvailablePlans,
    buyData, 
    queryTransaction, 
    cancelTransaction,
    calculateMyPrice
};