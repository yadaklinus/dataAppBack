require('dotenv').config();
const axios = require('axios');

const BASE_URL = `http://localhost:${process.env.PORT || 3009}/api/v1`;
const ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI5MzMwMjg0ZC0wZDU0LTRmZjItYmY1OC02ZWRmYWM2OTczYzAiLCJlbWFpbCI6Im11ZnRpbWFya2V0QGdtYWlsLmNvbSIsInRpZXIiOiJTTUFSVF9VU0VSIiwiaWF0IjoxNzczMjY0MDYyLCJleHAiOjE3NzMyNjQ5NjJ9.G88D9wDfg3VqhzltjE5N5Yp2tzDKwpY-oHgnx30aSTk'; // 👈 ADD YOUR ACCESS TOKEN HERE

async function testRedisCaching() {
    console.log("--- Starting Redis Caching Verification ---");

    // Choose endpoints to test
    const ENDPOINTS = [
        { name: 'Data Plans', url: `${BASE_URL}/vtu/data/plans` },
        { name: 'Cable Packages', url: `${BASE_URL}/cable/packages` }
    ];

    const config = {
        headers: {
            'Authorization': `Bearer ${ACCESS_TOKEN}`
        }
    };

    try {
        for (const endpoint of ENDPOINTS) {
            console.log(`\n--- Testing ${endpoint.name} ---`);

            // 1. First Request (Cache Miss)
            console.log(`1. Requesting data (Expected: Cache Miss)...`);
            const start1 = Date.now();
            const res1 = await axios.get(endpoint.url, config);
            const duration1 = Date.now() - start1;
            console.log(`   Status: ${res1.status}`);
            console.log(`   Time taken: ${duration1}ms`);

            // 2. Second Request (Cache Hit)
            console.log(`2. Requesting data again (Expected: Cache Hit)...`);
            const start2 = Date.now();
            const res2 = await axios.get(endpoint.url, config);
            const duration2 = Date.now() - start2;
            console.log(`   Status: ${res2.status}`);
            console.log(`   Time taken: ${duration2}ms`);

            // 3. Verification
            console.log(`3. Verifying consistency...`);
            const data1 = JSON.stringify(res1.data);
            const data2 = JSON.stringify(res2.data);

            if (data1 === data2) {
                console.log("   ✅ Data is identical across requests.");
            } else {
                console.warn("   ❌ Data mismatch found!");
            }

            if (duration2 < duration1) {
                console.log(`   ✅ Speed improvement: ${duration1 - duration2}ms faster.`);
            } else {
                console.warn("   ⚠️ No significant speed improvement (might be local network/provider variance).");
            }
        }

    } catch (error) {
        console.error("\n❌ Test failed:", error.message);
        if (error.response) {
            console.error("   Response data:", error.response.data);
        } else {
            console.log("   (Make sure the server is running on the specified port)");
        }
    }

    console.log("\n--- Verification Complete ---");
    process.exit(0);
}

testRedisCaching();
