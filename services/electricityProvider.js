const axios = require('@/lib/providerClient');

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

        const data = response.data;

        // BUILDER FIX: Nellobyte returns status "100" and "N/A" for failed lookups
        if (data.customer_name === "N/A" || data.customer_name === "INVALID_METERNO" || data.status !== "00") {
            throw new Error("Invalid meter number. Please check the number and try again.");
        }

        return data;
    } catch (error) {
        // Bubble up the specific validation error
        throw new Error(error.message || "Meter verification failed");
    }
};

/**
 * Pay Electricity Bill
 */
const payBill = async (params) => {
    const { discoCode, meterType, meterNo, amount, phoneNo, requestId } = params;

    console.log(discoCode, meterType, meterNo, amount, phoneNo, requestId)

    try {
        const response = await axios.get(`${BASE_URL}/APIElectricityV1.asp`, {
            params: {
                UserID: USER_ID,
                APIKey: API_KEY,
                ElectricCompany: discoCode,
                MeterType: meterType,
                MeterNo: meterNo,
                Amount: amount,
                PhoneNo: phoneNo,
                RequestID: requestId,
                //CallBackURL: process.env.CALLBACK_URL
            }
        });


        // 100 = ORDER_RECEIVED
        if (response.data.statuscode === "100" || response.data.status === "ORDER_RECEIVED" || response.data.transactionstatus === "ORDER_RECEIVED") {
            return {
                success: true,
                orderId: response.data.orderid || response.data.transactionid,
                token: response.data.metertoken || null, // Token for prepaid meters
                status: response.data.status || response.data.transactionstatus
            };
        }

        throw new Error(response.data.status || "Electricity payment failed");
    } catch (error) {
        //console.log(error)
        console.error("Nellobyte Electricity Error:", error.message);
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

module.exports = { verifyMeter, payBill, fetchDiscos, queryTransaction };