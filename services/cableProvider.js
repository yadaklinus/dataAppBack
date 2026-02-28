
const axios = require('axios');

const USER_ID = process.env.NELLOBYTE_USER_ID;
const API_KEY = process.env.NELLOBYTE_API_KEY;
const BASE_URL = 'https://www.nellobytesystems.com';

/**
 * Verify SmartCard / IUC Number
 */
const verifySmartCard = async (cableTV, smartCardNo) => {
    try {
        const response = await axios.get(`${BASE_URL}/APIVerifyCableTVV1.0.asp`, {
            params: {
                UserID: USER_ID,
                APIKey: API_KEY,
                CableTV: cableTV.toLowerCase(),
                SmartCardNo: smartCardNo
            }
        });

        if (response.data.customer_name === "INVALID_SMARTCARDNO") {
            throw new Error("Invalid smartcard number or mismatching provider.");
        }

        return response.data; // { customer_name: "..." }
    } catch (error) {
        throw new Error(error.message || "SmartCard verification failed");
    }
};

/**
 * Fetch all available packages to validate prices
 */
const fetchPackages = async () => {
    try {
        const response = await axios.get(`${BASE_URL}/APICableTVPackagesV2.asp`, {
            params: { UserID: USER_ID }
        });
        return response.data;
    } catch (error) {
        console.error("Failed to fetch cable packages:", error.message);
        return null;
    }
};

/**
 * Purchase Subscription
 */
const subscribe = async (params) => {
    const { cableTV, packageCode, smartCardNo, phoneNo, requestId } = params;

    try {
        const response = await axios.get(`${BASE_URL}/APICableTVV1.asp`, {
            params: {
                UserID: USER_ID,
                APIKey: API_KEY,
                CableTV: cableTV.toLowerCase(),
                Package: packageCode,
                SmartCardNo: smartCardNo,
                PhoneNo: phoneNo,
                RequestID: requestId,
                CallBackURL: process.env.CALLBACK_URL
            }
        });

        if (response.data.statuscode === "100" || response.data.status === "ORDER_RECEIVED" || response.data.transactionstatus === "ORDER_RECEIVED") {
            return {
                success: true,
                orderId: response.data.orderid,
                status: response.data.status || response.data.transactionstatus
            };
        }

        throw new Error(response.data.status || "Cable TV subscription failed");
    } catch (error) {
        console.error("Nellobyte Cable Error:", error.message);
        throw error;
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
        throw new Error("Transaction query failed");
    }
};

module.exports = { verifySmartCard, subscribe, fetchPackages, queryTransaction };