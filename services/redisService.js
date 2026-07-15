const { redis, isRedisAvailable } = require('../config/redis');

// In-memory fallback structures
const fallbackOnlineUsers = new Map();

// ==========================================
// FEATURE 1 — ONLINE USERS HELPERS
// ==========================================

const setUserOnline = async (userId, socketId) => {
    if (!userId || !socketId) return;
    const key = `online:${userId}`;
    if (isRedisAvailable()) {
        try {
            await redis.set(key, socketId);
            return;
        } catch (err) {
            console.error('Redis error in setUserOnline:', err.message);
        }
    }
    fallbackOnlineUsers.set(userId.toString(), socketId);
};

const removeUserOnline = async (userId) => {
    if (!userId) return;
    const key = `online:${userId}`;
    if (isRedisAvailable()) {
        try {
            await redis.del(key);
            return;
        } catch (err) {
            console.error('Redis error in removeUserOnline:', err.message);
        }
    }
    fallbackOnlineUsers.delete(userId.toString());
};

const isUserOnline = async (userId) => {
    if (!userId) return false;
    const key = `online:${userId}`;
    if (isRedisAvailable()) {
        try {
            const exists = await redis.exists(key);
            return exists === 1;
        } catch (err) {
            console.error('Redis error in isUserOnline:', err.message);
        }
    }
    return fallbackOnlineUsers.has(userId.toString());
};

const getSocketId = async (userId) => {
    if (!userId) return null;
    const key = `online:${userId}`;
    if (isRedisAvailable()) {
        try {
            return await redis.get(key);
        } catch (err) {
            console.error('Redis error in getSocketId:', err.message);
        }
    }
    return fallbackOnlineUsers.get(userId.toString());
};

const getAllOnlineUsers = async () => {
    if (isRedisAvailable()) {
        try {
            const keys = await redis.keys('online:*');
            const entries = [];
            for (const key of keys) {
                const userId = key.split(':')[1];
                const socketId = await redis.get(key);
                if (userId && socketId) {
                    entries.push([userId, socketId]);
                }
            }
            return entries;
        } catch (err) {
            console.error('Redis error in getAllOnlineUsers, falling back:', err.message);
        }
    }
    return Array.from(fallbackOnlineUsers.entries());
};

// Map interface compatibility wrappers for index/socket controllers
const get = async (key) => await getSocketId(key);
const set = async (key, val) => await setUserOnline(key, val);
const has = async (key) => await isUserOnline(key);
const del = async (key) => await removeUserOnline(key);

// ==========================================
// FEATURE 2 — OTP STORAGE HELPERS
// ==========================================

const saveOtp = async (phoneOrEmail, otp) => {
    if (!phoneOrEmail || !otp) return;
    const key = `otp:${phoneOrEmail}`;
    if (isRedisAvailable()) {
        try {
            await redis.set(key, otp, 'EX', 300); // 5 minutes expiration
            return;
        } catch (err) {
            console.error('Redis error in saveOtp:', err.message);
        }
    }
    // Fallback: set in-memory OTP map if Redis is not running
    if (!global.fallbackOtps) global.fallbackOtps = new Map();
    global.fallbackOtps.set(phoneOrEmail, { otp, expiry: Date.now() + 5 * 60 * 1000 });
};

const verifyAndDestroyOtp = async (phoneOrEmail, otp) => {
    if (!phoneOrEmail || !otp) return false;
    const key = `otp:${phoneOrEmail}`;
    if (isRedisAvailable()) {
        try {
            const stored = await redis.get(key);
            if (stored && String(stored) === String(otp)) {
                await redis.del(key);
                return true;
            }
            return false;
        } catch (err) {
            console.error('Redis error in verifyAndDestroyOtp:', err.message);
        }
    }
    
    // In-memory fallback
    if (!global.fallbackOtps) return false;
    const record = global.fallbackOtps.get(phoneOrEmail);
    if (record && record.expiry > Date.now() && String(record.otp) === String(otp)) {
        global.fallbackOtps.delete(phoneOrEmail);
        return true;
    }
    return false;
};

// ==========================================
// FEATURE 3 — CHAT CACHE HELPERS
// ==========================================

const getCachedMessages = async (conversationId) => {
    if (!conversationId) return null;
    const key = `chat:${conversationId}`;
    if (isRedisAvailable()) {
        try {
            const cached = await redis.get(key);
            if (cached) {
                return JSON.parse(cached);
            }
        } catch (err) {
            console.error('Redis error in getCachedMessages:', err.message);
        }
    }
    return null;
};

const setCachedMessages = async (conversationId, messages) => {
    if (!conversationId || !messages) return;
    const key = `chat:${conversationId}`;
    if (isRedisAvailable()) {
        try {
            // Cache latest 50 messages
            const sliced = messages.slice(-50);
            await redis.set(key, JSON.stringify(sliced), 'EX', 600); // 10 minutes expiration
        } catch (err) {
            console.error('Redis error in setCachedMessages:', err.message);
        }
    }
};

const invalidateChatCache = async (conversationId) => {
    if (!conversationId) return;
    const key = `chat:${conversationId}`;
    if (isRedisAvailable()) {
        try {
            await redis.del(key);
        } catch (err) {
            console.error('Redis error in invalidateChatCache:', err.message);
        }
    }
};

module.exports = {
    setUserOnline,
    removeUserOnline,
    isUserOnline,
    getSocketId,
    getAllOnlineUsers,
    get,
    set,
    has,
    delete: del,
    saveOtp,
    verifyAndDestroyOtp,
    getCachedMessages,
    setCachedMessages,
    invalidateChatCache,
    isRedisAvailable
};
