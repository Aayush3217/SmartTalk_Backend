const jwt = require("jsonwebtoken");
const response = require("../utils/responseHandler");

const authMiddleware = (req, res, next) => {
    let authToken = req.cookies?.auth_token;

    // Fallback: check Authorization header
    if (!authToken && req.headers.authorization) {
        const parts = req.headers.authorization.split(' ');
        if (parts.length === 2 && parts[0] === 'Bearer') {
            authToken = parts[1];
        } else {
            authToken = req.headers.authorization;
        }
    }

    if (!authToken) {
        return response(
            res,
            401,
            "Authorization token missing. Please provide token."
        );
    }

    try {
        const decode = jwt.verify(authToken, process.env.JWT_SECRET);
        req.user = decode;
        next();
    } catch (error) {
        console.error(error);
        return response(
            res,
            401,
            "Invalid or expired token"
        );
    }
};

module.exports = authMiddleware;