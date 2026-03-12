const axios = require('axios');

const axiosConfig = {
    timeout: 45000,
    headers: {
        'User-Agent': 'MuftiPay-Backend/1.0.0 (Financial Integrity Layer)'
    }
};

const providerClient = axios.create(axiosConfig);

module.exports = providerClient;

