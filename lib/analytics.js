const EventEmitter = require('events');
const umami = require('@umami/node');

/**
 * High-performance Umami Tracking Utility
 * Uses the official @umami/node SDK and an EventEmitter to decouple
 * analytics from the main request lifecycle.
 */

// Initialize Umami client
// We strip '/api/send' from the URL because the SDK adds it automatically
umami.init({
    websiteId: process.env.UMAMI_WEBSITE_ID,
    hostUrl: process.env.UMAMI_URL?.replace('/api/send', '') || 'https://analytics.muftipay.com',
});

class AnalyticsBus extends EventEmitter {}
const analytics = new AnalyticsBus();

// Background listener - handles the actual network request outside the HTTP flow
analytics.on('trackEvent', async ({ eventName, url, hostname, ip, userAgent, data }) => {
    if (!process.env.UMAMI_WEBSITE_ID) return;

    try {
        await umami.track((payload) => ({
            ...payload,
            website: process.env.UMAMI_WEBSITE_ID,
            url,
            hostname,
            ip,
            userAgent,
            name: eventName,
            data
        }));
    } catch (error) {
        // Fail silently in production, log in development
        if (process.env.NODE_ENV === 'development') {
            console.error(`[Umami SDK Error] ${error.message}`);
        }
    }
});

/**
 * Main tracking function
 * Compatible with existing controller implementations
 */
const trackEvent = (req, eventName, eventData = {}) => {
    if (!process.env.UMAMI_WEBSITE_ID) return;

    // Emit event to the background bus
    analytics.emit('trackEvent', {
        eventName,
        url: req.originalUrl,
        hostname: 'api.muftipay.com', // Fixed hostname per user dashboard settings
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'] || 'MuftiPay-Server',
        data: {
            userId: req.user?.id,
            isStaff: req.user?.isStaff,
            ...eventData
        }
    });
};

module.exports = { trackEvent, analytics };
