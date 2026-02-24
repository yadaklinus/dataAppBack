"use strict";
const axios = require('axios');
/**
 * Optimized Axios instance for Provider APIs
 * - 45-second timeout for slow VTU providers
 * - Specialized user-agent
 */
const providerClient = axios.create({
    timeout: 45000,
    headers: {
        'User-Agent': 'DataPadi-Backend/1.0.0 (Financial Integrity Layer)'
    }
});
module.exports = providerClient;
