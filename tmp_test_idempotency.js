const axios = require('axios');
require('dotenv').config();

// Create a test script to verify the idempotency implementation
// This script assumes there's a local server running and it has a valid token

const BASE_URL = 'http://localhost:5000/api/v1'; // Update to your local server port
const TOKEN = process.env.TEST_TOKEN || ''; // Add a valid token here to test

async function testIdempotency() {
    if (!TOKEN) {
        console.log("Please provide a valid TEST_TOKEN in your .env or script to run this test.");
        return;
    }

    const headers = {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
    };

    console.log("--- Testing Data Purchase Idempotency (Time-based Fallback) ---");
    const dataPayload = {
        network: "MTN",
        planId: "mtn-100mb", // use a valid plan ID for testing
        phoneNumber: "08030000000",
        transactionPin: "1234" // Use a valid PIN for the test user
    };

    try {
        console.log("Sending first request...");
        const res1 = await axios.post(`${BASE_URL}/transactions/data`, dataPayload, { headers });
        console.log("First request successful:", res1.data.status);
    } catch (error) {
        console.log("First request failed:", error.response?.data || error.message);
    }

    try {
        console.log("Sending duplicated second request immediately...");
        const res2 = await axios.post(`${BASE_URL}/transactions/data`, dataPayload, { headers });
        console.log("Second request SUCCESS (This is a failure of idempotency):", res2.data.status);
    } catch (error) {
        if (error.response?.status === 409) {
            console.log("SUCCESS! Second request was blocked with 409 Conflict:", error.response.data.message);
        } else {
            console.log("Second request failed with unexpected error:", error.response?.data || error.message);
        }
    }


    console.log("\n--- Testing Airtime Purchase Idempotency (Explicit Header) ---");
    const airtimePayload = {
        network: "GLO",
        amount: 100,
        phoneNumber: "08050000000",
        transactionPin: "1234"
    };

    const idempotencyKey = "test-key-12345";
    const headerWithKey = { ...headers, 'x-idempotency-key': idempotencyKey };

    try {
        console.log("Sending first request with idempotency key...");
        const res3 = await axios.post(`${BASE_URL}/transactions/airtime`, airtimePayload, { headers: headerWithKey });
        console.log("First request successful:", res3.data.status);
    } catch (error) {
        console.log("First request failed:", error.response?.data || error.message);
    }

    try {
        console.log("Sending duplicated second request with same key...");
        const res4 = await axios.post(`${BASE_URL}/transactions/airtime`, airtimePayload, { headers: headerWithKey });
        console.log("Second request SUCCESS (This is a failure of idempotency):", res4.data.status);
    } catch (error) {
        if (error.response?.status === 409) {
            console.log("SUCCESS! Second request was blocked with 409 Conflict:", error.response.data.message);
        } else {
            console.log("Second request failed with unexpected error:", error.response?.data || error.message);
        }
    }

}

testIdempotency();
