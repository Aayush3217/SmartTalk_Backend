const { redis, isRedisAvailable } = require('../config/redis');

/**
 * Reusable Redis Rate Limiter Middleware
 * @param {Object} options
 * @param {number} options.window - Window duration in seconds
 * @param {number} options.max - Maximum number of requests allowed in the window
 * @param {string} options.prefix - Prefix for the Redis key (e.g. 'login')
 * @param {Function} [options.keyGenerator] - Custom key generator function (req => string)
 * @param {string} [options.message] - Custom error message
 */
const rateLimiter = (options) => {
    const {
        window,
        max,
        prefix,
        keyGenerator,
        message = 'Too many requests'
    } = options;

    return async (req, res, next) => {
        // Fall open if Redis is not available to prevent blocking users
        if (!isRedisAvailable()) {
            console.warn(`[RateLimiter] Redis is not available. Bypassing rate limit check for ${prefix}.`);
            return next();
        }

        try {
            // Generate the unique identifier for rate limiting
            let identifier = '';
            if (keyGenerator) {
                identifier = await keyGenerator(req);
            } else {
                // Default fallback: IP address or email/phoneNumber if present in body
                identifier = (req.body && req.body.email) || (req.body && req.body.phoneNumber) || req.ip;
            }

            // Skip rate limiting if identifier is explicitly null or false (bypass signal)
            if (identifier === null || identifier === false) {
                return next();
            }

            const key = `rate:${prefix}:${identifier}`;

            // Increment request count
            const current = await redis.incr(key);

            // If it is a new key (counter is 1), set expiration TTL
            if (current === 1) {
                await redis.expire(key, window);
            }

            // If count exceeds max, return HTTP 429
            if (current > max) {
                return res.status(429).json({
                    success: false,
                    message
                });
            }

            next();
        } catch (error) {
            // Fall open if processing errors out to keep application running
            console.error(`[RateLimiter] Error in rate limiter for ${prefix}:`, error.message);
            next();
        }
    };
};

module.exports = rateLimiter;
