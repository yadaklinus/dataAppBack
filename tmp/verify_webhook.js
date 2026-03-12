const axios = require('axios');

const BASE_URL = 'http://localhost:3009/api/v1';
const WEBHOOK_URL = 'http://localhost:3009/api/v1/vtpass/webhook';

// Replace with a valid test user and a real transaction ID after running an initiation
// Or we can mock the entire flow if we have access to the DB directly (which we don't easily here without a full script)

async function simulateWebhookFlow() {
    console.log("--- Starting Webhook Flow Verification ---");

    try {
        // Since we can't easily initiate a real transaction without valid credentials/pin,
        // we'll assume a transaction with reference 'TEST-REF-123' exists in PENDING state in the DB.

        // Example VTPass Webhook Payload for success (delivered)
        const successPayload = {
            type: 'transaction-update',
            data: {
                code: '000',
                requestId: 'TEST-REF-123', // This should match a pending transaction's reference
                response_description: 'TRANSACTION SUCCESSFUL',
                purchased_code: 'PIN-12345-67890',
                content: {
                    transactions: {
                        status: 'delivered',
                        transactionId: 'VTP-TRANS-999'
                    }
                }
            }
        };

        console.log("1. Sending simulated SUCCESS webhook...");
        const res1 = await axios.post(WEBHOOK_URL, successPayload);
        console.log("   Response:", res1.data);

        // Example VTPass Webhook Payload for reversal (failed)
        const failurePayload = {
            type: 'transaction-update',
            data: {
                code: '040', // Typical failure code
                requestId: 'TEST-REF-456',
                response_description: 'TRANSACTION REVERSED',
                content: {
                    transactions: {
                        status: 'reversed',
                        transactionId: 'VTP-TRANS-000'
                    }
                }
            }
        };

        console.log("\n2. Sending simulated FAILURE webhook...");
        const res2 = await axios.post(WEBHOOK_URL, failurePayload);
        console.log("   Response:", res2.data);

        console.log("\n--- Simulation Complete. Check server logs for DB update details. ---");

    } catch (error) {
        console.error("Simulation failed:", error.message);
    }
}

simulateWebhookFlow();
