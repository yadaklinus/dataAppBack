const { createClient } = require('redis');

const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    socket: {
        reconnectStrategy: (retries) => {
            if (retries > 20) {
                console.error('[Redis] Max retries reached. Stopping reconnection.');
                return new Error('Max retries reached');
            }
            const delay = Math.min(retries * 100, 3000);
            console.log(`[Redis] Reconnecting in ${delay}ms (Retry: ${retries})`);
            return delay;
        },
        keepAlive: 5000,
        connectTimeout: 10000
    }
});

redisClient.on('error', (err) => {
    // Suppress SocketClosedUnexpectedlyError logs if it's just a background noise
    if (err.name === 'SocketClosedUnexpectedlyError') {
        console.warn('[Redis] Connection dropped. Reconnecting...');
    } else {
        console.error('Redis Client Error:', err);
    }
});

redisClient.on('connect', () => console.log('Redis Client Connected'));
redisClient.on('reconnecting', () => console.log('Redis Client Reconnecting...'));
redisClient.on('ready', () => console.log('Redis Client Ready'));

// Connect to redis automatically unless in test environment
// (Removed eager connect to save memory)

/**
 * Cleanup function for tests
 */
const disconnectRedis = async () => {
    if (redisClient.isOpen) {
        await redisClient.quit();
    }
};

let _connecting = false;

const ensureConnected = async () => {
    // Skip if in test environment (leaks prevention)
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) return;
    if (redisClient.isOpen) return;
    if (_connecting) return;
    _connecting = true;
    try {
        await redisClient.connect();
    } catch (err) {
        console.error('[Redis] Connect failed:', err.message);
    } finally {
        _connecting = false;
    }
};

/**
 * Check if Redis is available
 */
const isRedisReady = () => redisClient.isOpen && redisClient.isReady;

/**
 * Get data from cache
 * @param {string} key 
 * @returns {Promise<any|null>}
 */
const getCache = async (key) => {
    try {
        await ensureConnected();
        if (!redisClient.isOpen) return null;
        const data = await redisClient.get(key);
        return data ? JSON.parse(data) : null;
    } catch (err) {
        console.error(`Redis Get Error [${key}]:`, err.message);
        return null;
    }
};

/**
 * Set data in cache with TTL
 * @param {string} key 
 * @param {any} value 
 * @param {number} ttlSeconds Default 24 hours (86400s)
 */
const setCache = async (key, value, ttlSeconds = 86400) => {
    try {
        await ensureConnected();
        if (!redisClient.isOpen) return;
        await redisClient.set(key, JSON.stringify(value), {
            EX: ttlSeconds
        });
    } catch (err) {
        console.error(`Redis Set Error [${key}]:`, err.message);
    }
};

/**
 * Delete data from cache
 * @param {string} key 
 */
const delCache = async (key) => {
    try {
        if (!redisClient.isOpen) return;
        await redisClient.del(key);
    } catch (err) {
        console.error(`Redis Del Error [${key}]:`, err.message);
    }
};

module.exports = {
    redisClient,
    disconnectRedis,
    getCache,
    setCache,
    delCache
};
