const User = require("../models/users");
const sendOtpToEmail = require("../services/emailService");
const otpGenerate = require("../utils/otpGenerater");
const response = require("../utils/responseHandler");
const twilioService = require("../services/twilioService");
const generateToken = require("../utils/generateToken");
const { uploadFileToCloudinary } = require("../config/cloudinaryConfig");
const Conversation = require('../models/Conversation');
const redisService = require('../services/redisService');
const bcrypt = require('bcryptjs');
const { redis, isRedisAvailable } = require("../config/redis");


//step-1 Send Otp
const sendOtp = async (req, res) => {
    const { phoneNumber, phoneSuffix, email, mode } = req.body;
    let user;
    try {
        if (email) {
            user = await User.findOne({ email });

            if (mode === 'login' && !user) {
                return response(res, 404, 'Account not found. Please sign up first.');
            }
            if (mode === 'signup' && user) {
                return response(res, 400, 'Account already exists. Please log in instead.');
            }

            // Create new User
            if (!user) {
                user = new User({ email });
                await user.save();
            }

            const otp = otpGenerate();
            // Store OTP in Redis instead of MongoDB (Feature 2)
            await redisService.saveOtp(email, otp);

            await sendOtpToEmail(email, otp);
            return response(res, 200, 'Otp send to your email', { email });
        }

        if (!phoneNumber || !phoneSuffix) {
            return response(res, 400, 'Phone number and phone suffix are required');
        }

        user = await User.findOne({ phoneNumber, phoneSuffix });

        if (mode === 'login' && !user) {
            return response(res, 404, 'Account not found. Please sign up first.');
        }
        if (mode === 'signup' && user) {
            return response(res, 400, 'Account already exists. Please log in instead.');
        }

        const fullPhoneNumber = `${phoneSuffix}${phoneNumber}`;
        if (!user) {
            user = new User({ phoneNumber, phoneSuffix })
        }

        const hasTwilio = process.env.TWILIO_ACCOUNT_SID && 
                          process.env.TWILIO_ACCOUNT_SID !== 'paste_your_twilio_account_sid_here';

        if (hasTwilio) {
            await twilioService.sendOtpToPhoneNumber(fullPhoneNumber);
        } else {
            const otp = otpGenerate();
            await redisService.saveOtp(fullPhoneNumber, otp);
            console.log(`[LOCAL DEV SMS] OTP code for ${fullPhoneNumber} is: ${otp}`);
        }

        await user.save();

        return response(res, 200, 'Otp send successfully', user);
    } catch (error) {
        console.error("sendOtp error:", error);
        return response(res, 500, error.message || 'Internal server error');
    }
}


// Step-2 Verify Otp
const verifyOtp = async (req, res) => {
    const { phoneNumber, phoneSuffix, email, otp } = req.body;

    try {
        let user;
        if (email) {
            user = await User.findOne({ email });
            if (!user) {
                return response(res, 404, 'User not found');
            }

            // Verify using Redis instead of MongoDB (Feature 2)
            const isVerified = await redisService.verifyAndDestroyOtp(email, otp);
            if (!isVerified) {
                return response(res, 400, 'Invalid or expired otp');
            }

            user.isVerified = true;
            await user.save();
        } else {
            if (!phoneNumber || !phoneSuffix) {
                return response(res, 400, 'Phone number and phone suffix are required');
            }

            const fullPhoneNumber = `${phoneSuffix}${phoneNumber}`;
            user = await User.findOne({ phoneNumber, phoneSuffix });
            if (!user) {
                return response(res, 404, "User not found");
            }

            const hasTwilio = process.env.TWILIO_ACCOUNT_SID && 
                              process.env.TWILIO_ACCOUNT_SID !== 'paste_your_twilio_account_sid_here';

            if (hasTwilio) {
                const result = await twilioService.verifyOtp(fullPhoneNumber, otp);
                if (result.status !== "approved") {
                    return response(res, 400, "Invalid Otp");
                }
            } else {
                const isVerified = await redisService.verifyAndDestroyOtp(fullPhoneNumber, otp);
                if (!isVerified) {
                    return response(res, 400, "Invalid or expired Otp");
                }
            }

            user.isVerified = true;
            await user.save();
        }

        const token = generateToken(user?._id); // this is authentaction

        res.cookie("auth_token", token, {
            httpOnly: true,
            secure: true,        // HTTPS only
            sameSite: "None",    // Required for Vercel <-> Render
            path: "/",
            maxAge: 1000 * 60 * 60 * 24 * 365,
        });

        return response(res, 200, 'Otp verified successfully', { token, user })
    } catch (error) {
        console.log(error);
        return response(res, 500, "Internal server error");
    }
}

// Step-3 Manual Register & Login (No OTP)
const registerManual = async (req, res) => {
    const { username, email, password, preferredLanguage, about } = req.body;
    const file = req.file;

    if (!email || !password) {
        return response(res, 400, "Email and password are required");
    }

    try {
        let user = await User.findOne({ email });

        if (user) {
            const wrongPasswordKey = `rate:wrong-password:${email}`;

            if (isRedisAvailable()) {
                const wrongCount = await redis.get(wrongPasswordKey);
                if (wrongCount && parseInt(wrongCount, 10) >= 5) {
                    // Check if it has a TTL. If not, set it to prevent key from living forever
                    const ttl = await redis.ttl(wrongPasswordKey);
                    if (ttl < 0) {
                        await redis.expire(wrongPasswordKey, 60);
                    }
                    return response(res, 429, "Too many registration attempts.");
                }
            }

            // User exists, verify password if stored
            if (user.password) {
                const isMatch = await bcrypt.compare(password, user.password);
                if (!isMatch) {
                    if (isRedisAvailable()) {
                        const currentCount = await redis.incr(wrongPasswordKey);
                        
                        // Set TTL on first fail OR on lockout threshold (fresh 60s lockout)
                        if (currentCount === 1 || currentCount === 5) {
                            await redis.expire(wrongPasswordKey, 60);
                        } else {
                            // Ensure TTL is always set in case of any edge cases
                            const ttl = await redis.ttl(wrongPasswordKey);
                            if (ttl < 0) {
                                await redis.expire(wrongPasswordKey, 60);
                            }
                        }
                        
                        if (currentCount >= 5) {
                            return response(res, 429, "Too many registration attempts.");
                        }
                    }
                    return response(res, 400, "Incorrect password for this email");
                }
            } else {
                // If user didn't have a password set (e.g. from phone signup), set it now
                const salt = await bcrypt.genSalt(10);
                user.password = await bcrypt.hash(password, salt);
            }

            // Password matches, delete wrong password lock if any
            if (isRedisAvailable()) {
                await redis.del(wrongPasswordKey);
            }

            // Update details and log in
            if (username) user.username = username;
            if (preferredLanguage) user.preferredLanguage = preferredLanguage;
            if (about) user.about = about;
            
            if (file) {
                const uploadResult = await uploadFileToCloudinary(file);
                user.profilePicture = uploadResult?.secure_url;
            }
            
            user.isOnline = true;
            user.isVerified = true;
            await user.save();
        } else {
            // Create new user
            if (!username) {
                return response(res, 400, "Username is required for new registration");
            }

            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);

            user = new User({
                username,
                email,
                password: hashedPassword,
                preferredLanguage: preferredLanguage || 'English',
                about: about || 'Hey there! I am using WhatsApp.',
                isOnline: true,
                isVerified: true
            });

            if (file) {
                const uploadResult = await uploadFileToCloudinary(file);
                user.profilePicture = uploadResult?.secure_url;
            }
            await user.save();
        }

        const token = generateToken(user._id);

        res.cookie("auth_token", token, {
            httpOnly: true,
            secure: true,
            sameSite: "None",
            path: "/",
            maxAge: 1000 * 60 * 60 * 24 * 365,
        });

        return response(res, 200, 'User logged in successfully', { token, user });
    } catch (error) {
        console.error("registerManual error:", error);
        return response(res, 500, error.message || "Internal server error");
    }
}

const updateProfile = async (req, res) => {
    const { username, agreed, about, preferredLanguage } = req.body;
    const userId = req.user.userId;

    try {
        const user = await User.findById(userId);
        const file = req.file;  // Gets uploaded image from Multer middleware.
        if (file) {
            const uploadResult = await uploadFileToCloudinary(file);  // Uploads image to Cloudinary.
            console.log(uploadResult);
            user.profilePicture = uploadResult?.secure_url;
        } else if (req.body.profilePicture) {
            user.profilePicture = req.body.profilePicture;
        }

        if (username) user.username = username;
        if (agreed) user.agreed = agreed;
        if (about) user.about = about;
        if (preferredLanguage) user.preferredLanguage = preferredLanguage;
        await user.save();
        return response(res, 200, 'user profile update sucessfully', user);
    } catch (error) {
        console.log("updateProfile error:", error);
        return response(res, 500, error.message || "Internal server error");
    }
}

const checkAuthenticated = async (req, res) => {
    try {
        const userId = req.user.userId;
        if (!userId) {
            return response(res, 404, 'unauthorization ! please login before access our app');
        }
        const user = await User.findById(userId);
        if (!user) {
            return response(res, 404, 'User not found');
        }
        return response(res, 200, 'user retrived and allow to use whatapp', user);
    } catch (error) {
        console.log(error);
        return response(res, 500, "Intrenal server error");
    }
}

const logout = (req, res) => {
    try {
        res.cookie("auth_token", "", {
            httpOnly: true,
            secure: true,
            sameSite: "None",
            path: "/",
            expires: new Date(0)
        });
        return response(res, 200, 'user logout successfully')
    } catch (error) {
        console.error(error);
        return response(res, 500, "Internal server error");
    }
}

const getAllUser = async (req, res) => {
    const loggedInUser = req.user.userId;
    try {
        const users = await User.find({ _id: { $ne: loggedInUser } }).select(
            "username email profilePicture lastSeen isOnline about phoneNumber phoneSuffix"
        ).lean();

        const usersWithConversation = await Promise.all(
            users.map(async (user) => {
                const conversation = await Conversation.findOne({
                    participants: { $all: [loggedInUser, user?._id] }
                }).populate({
                    path: "lastMessage",
                    select: 'content createdAt sender receiver'
                }).lean();

                return {
                    ...user,
                    conversation: conversation || null,
                }
            })
        )
        console.log(usersWithConversation);
        return response(res, 200, 'user retrived successfully', usersWithConversation);
    } catch (error) {
        console.error(error);
        return response(res, 500, "Internal server error");
    }
}

module.exports = {
    sendOtp,
    verifyOtp,
    registerManual,
    updateProfile,
    logout,
    checkAuthenticated,
    getAllUser
}