const router = require('express').Router();
const verifyToken = require('./verifyToken');
const User = require('../models/User');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const jwt = require('jsonwebtoken');
const SystemSettings = require('../models/SystemSettings'); // Ensure SystemSettings is imported
const Department = require('../models/Department'); // Ensure Department is imported

// Enhanced middleware
const verifyMfaSetupToken = (req, res, next) => {
    console.log('Full headers:', JSON.stringify(req.headers));
    console.log('Full body:', JSON.stringify(req.body));
    console.log('Available tokens:', {
        authToken: !!req.header('auth-token'),
        setupToken: !!req.header('mfa-setup-token'),
        body: req.body
    });
    
    // Check auth token first
    const token = req.header('auth-token');
    if (token) {
        try {
            const verified = jwt.verify(token, process.env.TOKEN_SECRET);
            req.user = verified;
            console.log('Using normal auth token for MFA setup');
            return next();
        } catch (err) {
            console.log('Auth token invalid, checking other sources');
        }
    }
    
    // Check even more header variations
    const setupToken = req.header('mfa-setup-token') || 
                       req.header('mfasetuptoken') || 
                       req.header('x-mfa-setup-token') ||
                       (req.header('authorization') && req.header('authorization').startsWith('Bearer ') 
                        ? req.header('authorization').slice(7) : null);
    
    // Check body and query
    const bodyToken = req.body?.setupToken;
    const queryToken = req.query?.setupToken;
    
    const finalToken = setupToken || bodyToken || queryToken;
    
    console.log('Token source:', 
        setupToken ? 'header' : 
        (bodyToken ? 'body' : 
         (queryToken ? 'query' : 'none')));
    
    if (!finalToken) {
        return res.status(401).send('Access Denied - Missing MFA setup token');
    }
    
    try {
        const verified = jwt.verify(finalToken, process.env.TOKEN_SECRET);
        console.log('Token verification successful:', verified.id);
        req.user = verified;
        next();
    } catch (err) {
        console.error('Token verification error:', err);
        res.status(400).send('Invalid Setup Token');
    }
};

// Use this middleware instead of verifyToken for MFA setup routes
router.post('/setup', verifyMfaSetupToken, async(req, res) => {
    console.log('Setup request received with user:', req.user); 
    try {
        const secret = speakeasy.generateSecret({
            name:`Elysian Vault:${req.user.email || req.user.id}`  
          });
      
          await User.update({
              mfaSecret: secret.base32,
              mfaEnabled: false
          }, {
              where: {id: req.user.id}
          });
      
          QRCode.toDataURL(secret.otpauth_url, (err, dataUrl) => {
              if (err) {
                  console.error('QR code generation error:', err);
                  res.status(500).json({error: 'Failed to generate QR code'});
              }
              res.json({
                  secret: secret.base32,
                  qr: dataUrl
              });
          });
    } catch (error) {
        console.error('MFA setup error: ', error);
        res.status(500).json({error: 'Failed to setup MFA'});
    }
});

router.post('/verify-setup', verifyMfaSetupToken, async(req, res) => {
   try {
    const {token} = req.body;

    const user = await User.findByPk(req.user.id);
    if (!user || !user.mfaSecret) {
        return res.status(400).json({error: 'MFA not setup'});
    }
    const verified = speakeasy.totp.verify({
        secret: user.mfaSecret,
        encoding: 'base32',
        token: token
    });

    if (!verified) {
        return res.status(400).json({error: 'Invalid token'});
    }
    await User.update({
        mfaEnabled: true
    }, {
        where: {id: req.user.id}
    });
    res.json({message: 'MFA setup enabled and verified'});
   } catch (error) {
    console.error('MFA verification error: ', error);
    res.status(500).json({error: 'Failed to verify MFA setup'});
   }
});

router.post('/verify', verifyToken, async(req, res) => {
    try {
        const {userId, token} = req.body;
        const user = await User.findByPk(userId);

        if(!user || !user.mfaSecret || !user.mfaEnabled)
        {
            return res.status(400).json({error: 'MFA not setup'});
        }

        const verified = speakeasy.totp.verify({
            secret: user.mfaSecret,
            encoding: 'base32',
            token: token, 
            window: 1
        });

        if (!verified) {
            return res.status(400).json({error: 'Invalid token'});
        }
        res.json({verified: true});
    } catch (error) {
        console.error('MFA verification error: ', error);
        res.status(500).json({error: 'Failed to verify MFA'});
    }
});

router.post('/disable', verifyToken, async(req, res) => {
    try {
        const {token} = req.body;
        console.log(`[MFA Disable] Attempt by user ID: ${req.user.id}`); // Log attempt

        const user = await User.findByPk(req.user.id, {
            include: [{ model: Department, attributes: ['requireMfa'] }] // Include department info
        });
        if (!user || !user.mfaSecret || !user.mfaEnabled) {
            console.log('[MFA Disable] Error: MFA not setup or user not found.');
            return res.status(400).json({error: 'MFA not setup'});
        }

        // Check if 2FA is enforced for this user
        const systemSettings = await SystemSettings.findOne({ where: { id: 1 } });
        const systemEnforced = systemSettings?.enforceTwo2FA && user.role !== 'super_admin';
        const departmentEnforced = user.Department?.requireMfa; // Check department enforcement

        console.log(`[MFA Disable] Enforcement Check - System: ${systemEnforced}, Department: ${departmentEnforced}`); // Log enforcement status

        if (systemEnforced || departmentEnforced) {
            console.log('[MFA Disable] Error: MFA is enforced.');
            return res.status(403).json({error: 'Two-Factor Authentication is enforced by your organization or department'});
        }

        const verified = speakeasy.totp.verify({
            secret: user.mfaSecret,
            encoding: 'base32',
            token: token,
            window: 1 // Allow some time drift
        });

        console.log(`[MFA Disable] Token Verification Result: ${verified}`); // Log verification result

        if (!verified) {
            console.log('[MFA Disable] Error: Invalid token provided.');
            return res.status(400).json({error: 'Invalid token'});
        }

        console.log('[MFA Disable] Verification successful. Attempting DB update...'); // Log before update
        const [updateCount] = await User.update({ // Capture update count
            mfaEnabled: false,
            mfaSecret: null
        }, {
            where: {id: req.user.id}
        });

        console.log(`[MFA Disable] DB Update Result - Rows affected: ${updateCount}`); // Log update result

        if (updateCount > 0) {
            res.json({message: 'MFA disabled Successfully'});
        } else {
            // This case might happen if the user ID somehow didn't match, though unlikely here
            console.log('[MFA Disable] Error: Database update affected 0 rows.');
            res.status(500).json({error: 'Failed to update MFA status in database'});
        }

    } catch (error) {
        console.error('[MFA Disable] Error:', error); // Log any caught errors
        res.status(500).json({error: 'Failed to disable MFA'});
    }
});

// Add this route for emergency use
router.post('/debug-setup', async(req, res) => {
    try {
        console.log('Debug setup route called');
        console.log('Headers:', req.headers);
        console.log('Body:', req.body);
        
        let userId = null;
        
        // Try to extract user ID from various sources
        if (req.body && req.body.userId) {
            userId = req.body.userId;
        } else if (req.body && req.body.setupToken) {
            try {
                const decoded = jwt.verify(req.body.setupToken, process.env.TOKEN_SECRET);
                userId = decoded.id;
            } catch (err) {
                console.log('Could not decode token in body');
            }
        }
        
        if (!userId) {
            return res.status(400).json({error: 'No user ID provided'});
        }
        
        // Create MFA setup directly
        const secret = speakeasy.generateSecret({
            name: `Elysian Vault:User-${userId}`  
        });
      
        await User.update({
            mfaSecret: secret.base32,
            mfaEnabled: false
        }, {
            where: {id: userId}
        });
      
        QRCode.toDataURL(secret.otpauth_url, (err, dataUrl) => {
            if (err) {
                console.error('QR code generation error:', err);
                res.status(500).json({error: 'Failed to generate QR code'});
            }
            res.json({
                secret: secret.base32,
                qr: dataUrl
            });
        });
    } catch (error) {
        console.error('Debug MFA setup error: ', error);
        res.status(500).json({error: 'Failed to setup MFA in debug mode'});
    }
});

module.exports = router;