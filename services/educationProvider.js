const axios = require('@/lib/providerClient');

const USER_ID = process.env.NELLOBYTE_USER_ID;
const API_KEY = process.env.NELLOBYTE_API_KEY;
const BASE_URL = 'https://www.nellobytesystems.com';

/**
 * Fetch Available Packages (WAEC or JAMB)
 */
const fetchPackages = async (type = 'WAEC') => {
    try {
        const endpoint = type === 'WAEC' ? 'APIWAECPackagesV2.asp' : 'APIJAMBPackagesV2.asp';
        const response = await axios.get(`${BASE_URL}/${endpoint}`, {
            params: { UserID: USER_ID }
        });
        return response.data;
    } catch (error) {
        console.error(`Failed to fetch ${type} packages:`, error.message);
        return null;
    }
};
/**
 * Verify JAMB Profile 
 */
const verifyJambProfile = async (profileId) => {
    try {
        const response = await axios.get(`${BASE_URL}/APIVerifyJAMBV1.asp`, {
            params: {
                UserID: USER_ID,
                APIKey: API_KEY,
                ExamType: 'jamb',
                ProfileID: profileId
            }
        });

        if (response.data.customer_name === "INVALID_ACCOUNTNO") {
            throw new Error("Invalid JAMB Profile ID.");
        }

        return response.data; // { customer_name: "..." }
    } catch (error) {
        throw new Error(error.message || "JAMB verification failed");
    }
};

/**
 * Purchase Education PIN (WAEC or JAMB)
 */
const buyPin = async (provider, examType, phoneNo, requestId) => {
    try {
        // provider: 'WAEC' or 'JAMB'
        const endpoint = provider === 'WAEC' ? 'APIWAECV1.asp' : 'APIJAMBV1.asp';

        const response = await axios.get(`${BASE_URL}/${endpoint}`, {
            params: {
                UserID: USER_ID,
                APIKey: API_KEY,
                ExamType: examType,
                PhoneNo: phoneNo,
                RequestID: requestId,
                CallBackURL: process.env.CALLBACK_URL
            }
        });

        // 100/200 are success/received codes for Nellobyte Education API
        const isSuccess = ["100", "200"].includes(String(response.data.statuscode)) ||
            ["ORDER_RECEIVED", "ORDER_COMPLETED"].includes(response.data.status);

        if (isSuccess) {
            return {
                success: true,
                orderId: response.data.orderid,
                status: response.data.status,
                cardDetails: response.data.carddetails || null, // PIN and Serial
                amountCharged: response.data.amountcharged
            };
        }

        throw new Error(response.data.status || response.data.remark || "PIN purchase failed");
    } catch (error) {
        console.error(`Nellobyte ${provider} Error:`, error.message);
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

module.exports = { fetchPackages, verifyJambProfile, buyPin, queryTransaction };