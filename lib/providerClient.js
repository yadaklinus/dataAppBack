const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

/**
 * Optimized Axios instance for Provider APIs
 * - 45-second timeout for slow VTU providers
 * - Specialized user-agent
 * - Supports Webshare Static IP Proxy via PROXY_URL env var
 */

const axiosConfig = {
    timeout: 45000,
    headers: {
        'User-Agent': 'MuftiPay-Backend/1.0.0 (Financial Integrity Layer)'
    }
};

// Integrate Webshare Proxy if PROXY_URL is defined
if (process.env.PROXY_URL) {
    const proxyAgent = new HttpsProxyAgent(process.env.PROXY_URL);
    axiosConfig.httpsAgent = proxyAgent;
    axiosConfig.proxy = false; // Disable axios default proxy logic to use the agent
}

const providerClient = axios.create(axiosConfig);

module.exports = providerClient;

