require('dotenv').config();
const axios = require('axios');

async function testUmami() {
    const websiteId = process.env.UMAMI_WEBSITE_ID;
    const umamiUrl = process.env.UMAMI_URL || 'https://analytics.muftipay.com/api/send';

    console.log('--- Umami Diagnostic Tool ---');
    console.log(`URL: ${umamiUrl}`);
    console.log(`Website ID: ${websiteId || 'MISSING (Check your .env!)'}`);
    console.log('-----------------------------\n');

    if (!websiteId) {
        console.error('❌ ERROR: UMAMI_WEBSITE_ID is not set in your .env file.');
        console.log('Go to https://analytics.muftipay.com, add your website, and copy the ID first.');
        return;
    }

    const payload = {
        payload: {
            website: websiteId,
            url: '/test-page-diagnostic',
            name: 'Diagnostic Test Event',
            data: {
                testTime: new Date().toISOString(),
                environment: 'Backend Debug'
            }
        },
        type: "event"
    };

    console.log('Sending test event...');

    try {
        const response = await axios.post(umamiUrl, payload, {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'MuftiPay-Diagnostic-Tool'
            },
            timeout: 10000
        });

        console.log(`✅ SUCCESS! Response Status: ${response.status}`);
        console.log('Check your Umami dashboard now under the "Real-time" tab.');
        console.log('You should see an event named "Diagnostic Test Event" on page "/test-page-diagnostic".');

    } catch (error) {
        console.error('❌ FAILED to send event.');
        
        if (error.response) {
            console.error(`HTTP Status: ${error.response.status}`);
            console.error('Body:', error.response.data);
            
            if (error.response.status === 400) {
                console.log('Hint: Your Website ID might be invalid or formatted incorrectly.');
            }
        } else if (error.request) {
            console.error('Error Code:', error.code);
            console.error('No response received. Check your server\'s internet connection or firewall.');
        } else {
            console.error('Error Message:', error.message);
        }
    }
}

testUmami();
