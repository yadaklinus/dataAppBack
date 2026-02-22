const axios = require('axios');

const USER_ID = process.env.NELLOBYTE_USER_ID;
const API_KEY = process.env.NELLOBYTE_API_KEY;
const BASE_URL = 'https://www.nellobytesystems.com';

/**
 * Verify Meter Number
 * @returns {object} { customer_name: "..." }
 */

const fetchDiscos = async () => {
    try {
        const response = await axios.get(`${BASE_URL}/APIElectricityDiscosV2.asp`, {
            params: { UserID: USER_ID }
        });
        return response.data;
    } catch (error) {
        console.error("Failed to fetch electricity discos:", error.message);
        return null;
    }
};

const verifyMeter = async (discoCode, meterNo, meterType) => {
    try {
        const response = await axios.get(`${BASE_URL}/APIVerifyElectricityV1.asp`, {
            params: {
                UserID: USER_ID,
                APIKey: API_KEY,
                ElectricCompany: discoCode,
                MeterNo: meterNo,
                MeterType: meterType
            }
        });

        if (response.data.customer_name === "INVALID_METERNO") {
            throw new Error("Invalid meter number or mismatching provider.");
        }

        return response.data;
    } catch (error) {
        throw new Error(error.message || "Meter verification failed");
    }
};

/**
 * Pay Electricity Bill
 */
const payBill = async (params) => {
    const { discoCode, meterType, meterNo, amount, phoneNo, requestId } = params;
    
    try {
        const response = await axios.get(`${BASE_URL}/APIEcurtricityV1.asp`, {
            params: {
                UserID: USER_ID,
                APIKey: API_KEY,
                ElectricCompany: discoCode,
                MeterType: meterType,
                MeterNo: meterNo,
                Amount: amount,
                PhoneNo: phoneNo,
                RequestID: requestId,
                CallBackURL: process.env.CALLBACK_URL
            }
        });

        // 100 = ORDER_RECEIVED
        if (response.data.statuscode === "100" || response.data.status === "ORDER_RECEIVED") {
            return {
                success: true,
                orderId: response.data.orderid,
                token: response.data.metertoken || null, // Token for prepaid meters
                status: response.data.status
            };
        }

        throw new Error(response.data.status || "Electricity payment failed");
    } catch (error) {
        console.error("Nellobyte Electricity Error:", error.message);
        throw new Error(error.message || "External Provider Error");
    }
};

module.exports = { verifyMeter, payBill, fetchDiscos };