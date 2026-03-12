require('dotenv').config();
const { createClient } = require('redis');

async function checkRedisConnection() {
    const redisUrl = "redis://default:ZMOZsns081ToGK0ioabr23lh8JqR17KYBlCgOBrOO2DatTFgYnC7sQtXoKIl3ybo@72.61.201.50:6379";
    console.log(`--- Redis Connection Check ---`);
    console.log(`URL: ${redisUrl}`);

    const client = createClient({
        url: redisUrl,
        socket: {
            connectTimeout: 5000
        }
    });

    client.on('error', (err) => {
        console.error('\n❌ Redis Client Error:', err.message);
    });

    try {
        console.log('\n1. Connecting...');
        await client.connect();
        console.log('✅ Connected successfully!');

        console.log('\n2. Pinging server...');
        const ping = await client.ping();
        console.log(`✅ Ping response: ${ping}`);

        console.log('\n3. Testing write/read operation...');
        const testKey = 'test:connection:check';
        const testValue = `ok-${Date.now()}`;

        await client.set(testKey, testValue, { EX: 10 });
        const result = await client.get(testKey);

        if (result === testValue) {
            console.log(`✅ Write/Read successful! (Retrieved: ${result})`);
        } else {
            console.warn(`⚠️ Write/Read mismatch! Expected ${testValue}, got ${result}`);
        }

        console.log('\n--- SUCCESS: Redis is functional ---');

    } catch (error) {
        console.error('\n❌ Connection Failed!');
        console.error(`Reason: ${error.message}`);

        if (error.message.includes('ECONNREFUSED')) {
            console.log('\n💡 Tip: Is Redis actually running? Start it with "redis-server" or ensure your Docker container is up.');
        } else if (error.message.includes('ETIMEDOUT')) {
            console.log('\n💡 Tip: The connection timed out. Check your firewall settings or if the host is reachable.');
        }
    } finally {
        if (client.isOpen) {
            await client.quit();
        }
        process.exit();
    }
}

checkRedisConnection();
