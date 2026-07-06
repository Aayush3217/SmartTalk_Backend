const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    phoneNumber: { type: String, unique: true, sparse: true },
    phoneSuffix: { type: String, unique: false },
    username: { type: String },
    email: {
        type: String,
        validate: {
            validator: function (v) {
                return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
            },
            message: props => `${props.value} is not a valid email address!`
        },
    },
    emailOtp: { type: String },
    emailOtpExpiry: { type: Date },
    profilePicture: { type: String },
    lastSeen: { type: String },
    isOnline: { type: Boolean, default: false },
    isVerified: { type: Boolean, default: false },
    about: {type: String},
    preferredLanguage: { type: String, default: 'English' },
    agreed: { type: Boolean, default: false }
}, {timestamps: true})

const User = mongoose.model('User', userSchema);
module.exports = User;