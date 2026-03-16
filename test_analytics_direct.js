require('dotenv').config();
const { trackEvent, analytics } = require('./lib/analytics');

async function testUmamiSDK() {
    console.log('--- Umami SDK Diagnostic Tool ---');
    console.log(`URL: ${process.env.UMAMI_URL || 'https://analytics.muftipay.com/api/send'}`);
    console.log(`Website ID: ${process.env.UMAMI_WEBSITE_ID || 'MISSING'}`);
    console.log('-----------------------------\n');

    if (!process.env.UMAMI_WEBSITE_ID) {
        console.error('❌ ERROR: UMAMI_WEBSITE_ID is not set in your .env file.');
        return;
    }

    // Mock request object for the utility
    const mockReq = {
        originalUrl: '/test-sdk-diagnostic',
        hostname: 'api.muftipay.com',
        headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'x-forwarded-for': '1.2.3.4'
        },
        socket: { remoteAddress: '1.2.3.4' },
        user: { id: 'test-user-sdk' }
    };

    console.log('Firing test event via SDK (background)...');
    
    // We listen for success/failure via the event emitter if possible, 
    // but the trackEvent utility is fire-and-forget.
    // For this test, we'll just wait a few seconds.
    trackEvent(mockReq, 'SDK Diagnostic Test', {
        testType: 'Official SDK + EventEmitter',
        timestamp: new Date().toISOString()
    });

    console.log('Event emitted. Waiting 5 seconds for background processing...');
    
    setTimeout(() => {
        console.log('\nDone.');
        console.log('1. Visit https://analytics.muftipay.com');
        console.log('2. Check "Real-time" tab.');
        console.log('3. Look for "SDK Diagnostic Test" event.');
        console.log('\nIf it appears, your backend is 100% production-ready!');
        process.exit(0);
    }, 5000);
}

testUmamiSDK();
