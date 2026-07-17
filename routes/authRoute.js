const express = require('express')
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');
const { multerMiddleware } = require('../config/cloudinaryConfig');
const rateLimiter = require('../middleware/rateLimiter');
const User = require('../models/users');

const router = express.Router();

// Define rate limiting configurations
const loginLimiter = rateLimiter({
    window: 60, // 1 minute
    max: 5,
    prefix: 'login',
    keyGenerator: (req) => req.body.email || req.ip,
    message: 'Too many login attempts. Try again in one minute.'
});

const sendOtpLimiter = rateLimiter({
    window: 600, // 10 minutes
    max: 3,
    prefix: 'otp',
    keyGenerator: (req) => req.body.email || (req.body.phoneNumber ? `${req.body.phoneSuffix || ''}${req.body.phoneNumber}` : null) || req.ip,
    message: 'Too many OTP requests. Please wait 10 minutes.'
});

const verifyOtpLimiter = rateLimiter({
    window: 600, // 10 minutes
    max: 5,
    prefix: 'verify',
    keyGenerator: (req) => req.body.email || (req.body.phoneNumber ? `${req.body.phoneSuffix || ''}${req.body.phoneNumber}` : null) || req.ip,
    message: 'Too many OTP verification attempts.'
});

const registerLimiter = rateLimiter({
    window: 3600, // 1 hour
    max: 5,
    prefix: 'register',
    keyGenerator: async (req) => {
        // If it is a login request (user email exists in DB), skip the registration rate limit
        if (req.body && req.body.email) {
            const user = await User.findOne({ email: req.body.email });
            if (user) {
                return null; // Bypass register rate limit
            }
        }
        return req.ip;
    },
    message: 'Too many registration attempts.'
});

router.post('/send-otp', sendOtpLimiter, authController.sendOtp);
router.post('/verify-otp', verifyOtpLimiter, authController.verifyOtp);
router.post('/register-manual', multerMiddleware, loginLimiter, registerLimiter, authController.registerManual);
router.get('/logout', authController.logout);

//protected route
router.put('/update-profile',authMiddleware,multerMiddleware,authController.updateProfile);
router.get('/check-auth',authMiddleware,authController.checkAuthenticated);
router.get('/users',authMiddleware,authController.getAllUser);
router.delete('/delete-account', authMiddleware, authController.deleteUserAccount);


module.exports = router;