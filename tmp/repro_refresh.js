const axios = require('axios');

const BASE_URL = 'http://localhost:3009/api/v1';
const EMAIL = 'linusyadak@gmail.com'; // You might need to change this
const PASSWORD = 'Yadak@125'; // You might need to change this

async function runReproduction() {
    console.log("--- Starting Refresh Token Reproduction ---");

    try {
        // 1. Initial Login
        console.log("1. Logging in...");
        const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
            email: EMAIL,
            password: PASSWORD
        });

        const { accessToken, refreshToken } = loginRes.data;
        console.log("   Login successful.");

        // 2. Test Rate Limiting
        console.log("2. Testing Rate Limiting (11 rapid calls)...");
        for (let i = 1; i <= 11; i++) {
            try {
                process.stdout.write(`   Call ${i}: `);
                await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
                console.log("OK");
            } catch (err) {
                console.log(`FAILED (${err.response?.status} - ${err.response?.data?.message})`);
                if (err.response?.status === 429) {
                    console.log("   Rate limit hit as expected.");
                    break;
                }
            }
        }

        // 3. Test Token Rotation Race Condition
        console.log("\n3. Testing Token Rotation Race Condition (3 concurrent calls)...");
        // Get a fresh refresh token first
        const refreshRes = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
        const newRefreshToken = refreshRes.data.refreshToken;

        const requests = [
            axios.post(`${BASE_URL}/auth/refresh`, { refreshToken: newRefreshToken }),
            axios.post(`${BASE_URL}/auth/refresh`, { refreshToken: newRefreshToken }),
            axios.post(`${BASE_URL}/auth/refresh`, { refreshToken: newRefreshToken })
        ];

        const results = await Promise.allSettled(requests);
        results.forEach((res, i) => {
            if (res.status === 'fulfilled') {
                console.log(`   Call ${i + 1}: OK`);
            } else {
                console.log(`   Call ${i + 1}: FAILED (${res.reason.response?.status} - ${res.reason.response?.data?.message})`);
            }
        });

    } catch (error) {
        console.error("Reproduction failed:", error.message);
        if (error.response) {
            console.error("Response data:", error.response.data);
        }
    }
}

runReproduction();
