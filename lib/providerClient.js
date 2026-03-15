const axios = require('axios');
const http = require('http');
const https = require('https');

const axiosConfig = {
    timeout: 25000, // Fail fast to prevent worker saturation
    headers: {
        'User-Agent': 'MuftiPay-Backend/1.0.0 (Financial Integrity Layer)'
    },
    // PERFORMANCE: Reuse existing connections to eliminate TCP handshake overhead
    httpAgent: new http.Agent({ keepAlive: true, maxSockets: 100 }),
    httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 100 })
};

const providerClient = axios.create(axiosConfig);

module.exports = providerClient;

