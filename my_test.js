require('dotenv').config();
const { buyAirtime } = require('./services/vtpassProvider');

(async () => {
    try {
        console.log("Testing buyAirtime...");
        const result = await buyAirtime('MTN', 100, '08011111111', 'TEST_REQ_123');
        console.log("Result:", result);
    } catch (e) {
        console.error("Error thrown:", e.message);
    }
})();
