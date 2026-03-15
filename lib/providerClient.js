const axios = require('axios');
const http = require('http');
const https = require('https');

const axiosConfig = {
    timeout: 45000, // Balanced timeout for slow providers under heavy load
    headers: {
        'User-Agent': 'MuftiPay-Backend/1.0.0 (Financial Integrity Layer)'
    },
    // PERFORMANCE: Massive socket pool to prevent local queuing of concurrent requests
    httpAgent: new http.Agent({ keepAlive: true, maxSockets: 500 }),
    httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 500 })
};

const providerClient = axios.create(axiosConfig);

module.exports = providerClient;

