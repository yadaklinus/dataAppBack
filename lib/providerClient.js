const axios = require('axios');

const axiosConfig = {
    timeout: 25000, // Fail fast to prevent worker saturation
    headers: {
        'User-Agent': 'MuftiPay-Backend/1.0.0 (Financial Integrity Layer)'
    }
};

const providerClient = axios.create(axiosConfig);

module.exports = providerClient;

