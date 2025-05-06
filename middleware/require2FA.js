const jwt = require('jsonwebtoken');
const TeamSettings = require('../models/TeamSettings');

async function require2FA(req, res, next) {
    try {
        // Skip if no teamId in request
        if (!req.params.id && !req.body.teamId) {
            return next();
        }
        
        const teamId = req.params.id || req.body.teamId;
        
        // Check if this operation requires 2FA
        const teamSettings = await TeamSettings.findOne({
            where: { teamId: teamId }
        });
        
        // If 2FA for sensitive ops is not required, continue
        if (!teamSettings || !teamSettings.securitySettings.require2FAForSensitiveOperations) {
            return next();
        }
        
        // Check for the sensitiveOpToken in headers
        const sensitiveOpToken = req.headers['sensitive-op-token'];
        if (!sensitiveOpToken) {
            return res.status(403).json({
                error: '2FA verification required',
                require2FA: true
            });
        }
        
        // Verify the token
        try {
            const decoded = jwt.verify(sensitiveOpToken, process.env.JWT_SECRET);
            if (!decoded.verified2FA || decoded.userId !== req.user.id) {
                throw new Error('Invalid 2FA verification');
            }
            next();
        } catch (err) {
            return res.status(403).json({
                error: 'Invalid or expired 2FA verification',
                require2FA: true
            });
        }
    } catch (error) {
        console.error('2FA middleware error:', error);
        res.status(500).json({ error: 'Server error during 2FA check' });
    }
}

module.exports = require2FA;