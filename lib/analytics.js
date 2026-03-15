const axios = require('axios');

/**
 * High-performance Umami Tracking Utility
 * Sends events to Umami Analytics without blocking the main request thread.
 */
const trackEvent = async (req, eventName, eventData = {}) => {
    const websiteId = process.env.UMAMI_WEBSITE_ID;
    const umamiUrl = process.env.UMAMI_URL || 'https://analytics.muftipay.com/api/send';

    if (!websiteId) {
        // Silently skip if analytics is not configured
        return;
    }

    try {
        const payload = {
            payload: {
                website: websiteId,
                url: req.originalUrl,
                hostname: 'api.muftipay.com',
                screen: '1920x1080',
                language: 'en-US',
                name: eventName,
                data: {
                    userId: req.user?.id,
                    isStaff: req.user?.isStaff,
                    ...eventData
                }
            },
            type: "event"
        };

        // Fire and forget - don't await to keep the API fast
        axios.post(umamiUrl, payload, {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': req.headers['user-agent'] || 'MuftiPay-Server'
            },
            timeout: 5000 // Short timeout to avoid hanging
        }).catch(err => {
            // Log analytics errors only in development
            if (process.env.NODE_ENV === 'development') {
                console.error(`[Umami Error] ${err.message}`);
            }
        });

    } catch (error) {
        // Catch synchronous payload errors
        if (process.env.NODE_ENV === 'development') {
            console.error(`[Analytics Utility Error] ${error.message}`);
        }
    }
};

module.exports = { trackEvent };
