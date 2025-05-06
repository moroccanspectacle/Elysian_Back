const jwt = require('jsonwebtoken');

module.exports = function(req, res, next) {
    // Check for token in header first, then in query parameters
    const token = req.header('auth-token') || req.query.token;
    
    // --- Add Logging ---
    console.log(`[verifyToken] Middleware triggered for path: ${req.originalUrl}`);
    console.log(`[verifyToken] Received token: ${token ? token.substring(0, 15) + '...' : 'NONE'}`);
    const secret = process.env.TOKEN_SECRET;
    console.log(`[verifyToken] Using TOKEN_SECRET: ${secret ? secret.substring(0, 5) + '...' : 'MISSING/UNDEFINED'}`);
    // --- End Logging ---

    if(!token) {
        console.log('[verifyToken] Access Denied - No token found.'); // Log reason
        return res.status(401).send('Access Denied');
    }

    try {
        const verified = jwt.verify(token, secret); // Use the 'secret' variable
        req.user = verified;
        console.log(`[verifyToken] Token verified successfully for user ID: ${req.user.id}`); // Log success
        next();
    } catch (error) {
        // --- Add Logging for Error ---
        console.error(`[verifyToken] Invalid Token Error: ${error.message}`); // Log the specific JWT error
        console.error(`[verifyToken] Token being verified: ${token}`); // Log the full token that failed
        // --- End Logging for Error ---
        res.status(400).send('Invalid Token: ' + error.message); // Send specific error message
    }
}