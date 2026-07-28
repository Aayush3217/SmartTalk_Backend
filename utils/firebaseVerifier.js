const jwt = require('jsonwebtoken');
const axios = require('axios');

let publicKeysCache = null;
let cacheExpiry = 0;

/**
 * Fetches Google's public certificates for Firebase ID tokens.
 * Caches the results according to the Cache-Control header max-age.
 */
async function getFirebasePublicKeys() {
    const now = Date.now();
    if (publicKeysCache && now < cacheExpiry) {
        return publicKeysCache;
    }

    try {
        const response = await axios.get(
            'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com',
            { timeout: 5000 }
        );
        
        const cacheControl = response.headers['cache-control'] || '';
        const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
        const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) * 1000 : 3600000;

        publicKeysCache = response.data;
        cacheExpiry = now + maxAge;
        return publicKeysCache;
    } catch (error) {
        console.error('Error fetching Firebase public keys:', error.message);
        throw new Error('Failed to retrieve Firebase public keys for verification.');
    }
}

/**
 * Decodes and verifies a Firebase ID Token (JWT).
 * @param {string} idToken 
 * @returns {Promise<object>} The decoded token payload.
 */
async function verifyFirebaseToken(idToken) {
    if (!idToken) {
        throw new Error('No ID token provided');
    }

    const decodedHeader = jwt.decode(idToken, { complete: true });
    if (!decodedHeader || !decodedHeader.header || !decodedHeader.header.kid) {
        throw new Error('Invalid Firebase ID token format');
    }

    const kid = decodedHeader.header.kid;
    const publicKeys = await getFirebasePublicKeys();
    const certificate = publicKeys[kid];

    if (!certificate) {
        throw new Error('Corresponding public key not found for token kid');
    }

    // Default fallback project ID is the one from the client
    const projectId = process.env.FIREBASE_PROJECT_ID || 'smarttalk-75a97';

    try {
        const decoded = jwt.verify(idToken, certificate, {
            algorithms: ['RS256'],
            audience: projectId,
            issuer: `https://securetoken.google.com/${projectId}`
        });
        return decoded;
    } catch (error) {
        console.error('JWT verification failed:', error.message);
        throw new Error(`Firebase token verification failed: ${error.message}`);
    }
}

module.exports = {
    verifyFirebaseToken
};
