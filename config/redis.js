const Redis = require('ioredis');

const redisUrl = process.env.REDIS_URL;
let redis = null;
let isRedisConnected = false;

try {
    redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        showFriendlyErrorStack: true,
        retryStrategy(times) {
            // Reconnect after 2 seconds, stop retrying after 5 attempts
            if (times > 5) {
                console.warn('Redis connection failed permanently. Running in offline/fallback mode.');
                return null;
            }
            return 2000;
        }
    });

    redis.on('connect', () => {
        console.log('Redis connected successfully');
        isRedisConnected = true;
    });

    redis.on('error', (err) => {
        console.error('Redis error occurred:', err.message);
        isRedisConnected = false;
    });

    redis.on('close', () => {
        isRedisConnected = false;
    });
} catch (error) {
    console.error('Failed to initialize Redis client:', error.message);
}

module.exports = {
    redis,
    isRedisAvailable: () => isRedisConnected && redis && redis.status === 'ready'
};
