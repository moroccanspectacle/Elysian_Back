const router = require('express').Router();
const User = require('../models/User');
const Activity_Log = require('../models/Activity_Log'); // <-- Add this line
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const { registerValidation, loginValidation, passwordResetValidation } = require('../config/validation');
const verifyToken = require('./verifyToken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { Op } = require('sequelize');
const SystemSettings = require('../models/SystemSettings');
const { logActivity } = require('../services/logger'); // <-- Add this line

router.post('/register', async (req, res) => {

    //Validate the data before creating a user
   const {error} = registerValidation(req.body);
   if(error) return res.status(400).send(error.details[0].message);

   //Checking if the user is already in the database
    const emailExist = await User.findOne({where: {email: req.body.email}});
    if(emailExist) return res.status(400).send('Email already exists');

    //Hash password
    const salt = await bcrypt.genSalt(10); //genSalt(10) increases the complexity of the hash generated
    const hashedPassword = await bcrypt.hash(req.body.password, salt);

    try {
        // Get system settings for default storage quota
        const systemSettings = await SystemSettings.findOne({ where: { id: 1 } });
        const defaultQuota = (systemSettings?.storageQuota || 5000) * 1024 * 1024 * 1024; // Convert GB to bytes

        //Creating a new user
        const user = await User.create({
            username: req.body.username,
            email: req.body.email,
            password: hashedPassword,
            storageQuota: defaultQuota,
            currentUsage: 0
        });

        res.send( {user: user.id});
        console.log('User created successfully');
    } catch (error) {
        res.status(400).send(error);
        console.error(error);
    }
});

//Login
router.post('/login', async (req, res) => {
    const {error} = loginValidation(req.body);
    if(error) return res.status(400).send(error.details[0].message);

    // Checking if the email exists
    const user = await User.findOne({where: {email: req.body.email}});
    if(!user) return res.status(400).send('User does not exist');

    // Checking whether the password is correct
    const validPass = await bcrypt.compare(req.body.password, user.password);
    if(!validPass) return res.status(400).send('Invalid password');

    console.log('User logged in successfully');

    // After validating password, check if MFA is enabled
    if (user.mfaEnabled) {
        // Return a partial auth status indicating MFA is required
        return res.json({
            mfaRequired: true,
            userId: user.id,
        });
    } else {
        // Check if 2FA is enforced by system settings
        const systemSettings = await SystemSettings.findOne({ where: { id: 1 } });

        // --- CORRECTED ENFORCEMENT BLOCK ---
        if (systemSettings && systemSettings.enforceTwo2FA && user.role !== 'super_admin') {
            // Force MFA setup for users if they don't have it enabled yet

            // Generate the special token just for MFA setup
            const setupToken = jwt.sign(
                { id: user.id, purpose: 'mfa-setup' },
                process.env.TOKEN_SECRET,
                { expiresIn: '15m' }
            );
            console.log(`[Login Enforcement] Generated setupToken: ${setupToken ? 'OK' : 'MISSING'}. Sending response...`);

            // Return the response WITH the setupToken
            return res.json({
                mfaRequired: true,
                userId: user.id,
                setupRequired: true, // Special flag to indicate they need to set up 2FA
                setupToken: setupToken // Include the token
            });
        }
        // --- END CORRECTED ENFORCEMENT BLOCK ---
    }

    // If no MFA required (neither enabled nor enforced), proceed with normal login
    const rememberMe = req.body.rememberMe === true;
    const expiresIn = rememberMe ? '30d' : '1d';

    const token = jwt.sign(
      {id: user.id},
      process.env.TOKEN_SECRET,
      { expiresIn }
    );
    res.header('auth-token', token).send(token);
});

// Update the MFA verification route
router.post('/login/verify-mfa', async (req, res) => {
    try {
        const { userId, token, rememberMe } = req.body;
        
        // Get user
        const user = await User.findByPk(userId);
        if (!user || !user.mfaSecret || !user.mfaEnabled) {
            return res.status(400).send('Invalid request');
        }
        
        // Verify MFA token
        const verified = speakeasy.totp.verify({
            secret: user.mfaSecret,
            encoding: 'base32',
            token: token,
            window: 1
        });
        
        if (!verified) {
            return res.status(400).send('Invalid verification code');
        }
        
        // Set token expiration based on remember me option
        const expiresIn = rememberMe ? '30d' : '1d';
        
        // If MFA is verified, issue the JWT token with appropriate expiration
        const jwtToken = jwt.sign(
          {id: user.id},
          process.env.TOKEN_SECRET,
          { expiresIn }
        );
        res.header('auth-token', jwtToken).send(jwtToken);
    } catch (error) {
        console.error('MFA login verification error:', error);
        res.status(500).send('Authentication failed');
    }
});


router.post('/verify-2fa', verifyToken, async (req, res) => {
    try {
        const { code } = req.body;
        
        if (!code) {
            return res.status(400).json({ error: 'Verification code is required' });
        }
        
        const user = await User.findByPk(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // If user doesn't have 2FA enabled
        if (!user.twoFactorEnabled) {
            return res.status(400).json({ error: '2FA is not enabled for this account' });
        }
        
        // Verify the code using a proper 2FA library
        const isValid = speakeasy.totp.verify({
            secret: user.twoFactorSecret,
            encoding: 'base32',
            token: code,
            window: 1
        });
        
        if (!isValid) {
            return res.status(400).json({ error: 'Invalid verification code' });
        }
        
        // Generate a temporary token for sensitive operations
        const sensitiveOpToken = jwt.sign(
            { userId: user.id, verified2FA: true },
            process.env.JWT_SECRET,
            { expiresIn: '15m' } // Short expiry for security
        );
        
        res.json({ 
            message: '2FA verification successful',
            sensitiveOpToken
        });
    } catch (error) {
        console.error('2FA verification error:', error);
        res.status(500).json({ error: 'Failed to verify 2FA code' });
    }
});

router.post('/logout', async (req, res) =>
{
    res.header('auth-token', '').send('Logged out');
    console.log('User logged out successfully');
});

// Modify the verify endpoint to include MFA setup status
router.get('/verify', verifyToken, async (req, res) => {
    try {
        // Find user by ID from the verified token
        const user = await User.findByPk(req.user.id, {
            attributes: ['id', 'username', 'email', 'profileImage', 'mfaEnabled', 'role', 'mfaSecret']
        });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Check if the user needs to set up MFA due to enforcement
        let needsMfaSetup = false;
        const systemSettings = await SystemSettings.findOne({ where: { id: 1 } });
        
        if (systemSettings?.enforceTwo2FA && 
            !user.mfaEnabled && 
            user.role !== 'super_admin') {
            needsMfaSetup = true;
        }
        
        // Add the needsMfaSetup flag to the response
        const userData = user.toJSON();
        userData.needsMfaSetup = needsMfaSetup;
        
        // Return user data without sensitive information
        delete userData.mfaSecret;
        res.json(userData);
    } catch (error) {
        console.error('Token verification error:', error);
        res.status(500).json({ error: 'Failed to verify authentication' });
    }
});

// Request password reset
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }
        
        // Find user with this email
        const user = await User.findOne({ where: { email } });
        if (!user) {
            // For security reasons, don't reveal if the email exists or not
            return res.status(200).json({ message: 'If your email exists in our system, you will receive a password reset link' });
        }
        
        // Generate a reset token
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetTokenExpiry = Date.now() + 3600000; // 1 hour from now
        
        // Save the token to the user
        await User.update({
            resetToken,
            resetTokenExpiry
        }, {
            where: { id: user.id }
        });
        
        // Configure nodemailer with your email service
        const transporter = nodemailer.createTransport({
            service: process.env.EMAIL_SERVICE || 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASSWORD
            }
        });
        
        // Create reset URL
        const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/reset-password/${resetToken}`;
        
        // Email content
        const mailOptions = {
            from: process.env.EMAIL_FROM || '"Elysian Vault" <noreply@elysianvault.com>',
            to: user.email,
            subject: 'Password Reset Request',
            html: `
                <h1>Password Reset</h1>
                <p>You requested a password reset for your Elysian Vault account.</p>
                <p>Please click the link below to reset your password. This link is valid for 1 hour.</p>
                <a href="${resetUrl}" style="display: inline-block; padding: 10px 20px; background-color: #217eaa; color: white; text-decoration: none; border-radius: 5px;">Reset Password</a>
                <p>If you didn't request this, please ignore this email.</p>
            `
        };
        
        // Send the email
        await transporter.sendMail(mailOptions);
        
        res.status(200).json({ message: 'If your email exists in our system, you will receive a password reset link' });
    } catch (error) {
        console.error('Password reset request error:', error);
        res.status(500).json({ error: 'Failed to process password reset request' });
    }
});

// Verify reset token
router.get('/reset-password/:token', async (req, res) => {
    try {
        const { token } = req.params;
        
        // Find user with this token and valid expiry
        const user = await User.findOne({
            where: {
                resetToken: token,
                resetTokenExpiry: { [Op.gt]: Date.now() }
            }
        });
        
        if (!user) {
            return res.status(400).json({ error: 'Invalid or expired reset token' });
        }
        
        res.status(200).json({ message: 'Token is valid', userId: user.id });
    } catch (error) {
        console.error('Reset token verification error:', error);
        res.status(500).json({ error: 'Failed to verify reset token' });
    }
});

// Reset password with token
router.post('/reset-password/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const { password } = req.body;
        
        // Validate password strength
        const { error } = passwordResetValidation(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });
        
        // Find user with this token and valid expiry
        const user = await User.findOne({
            where: {
                resetToken: token,
                resetTokenExpiry: { [Op.gt]: Date.now() }
            }
        });
        
        if (!user) {
            return res.status(400).json({ error: 'Invalid or expired reset token' });
        }
        
        // Hash the new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        // Update user's password and clear reset token
        await User.update({
            password: hashedPassword,
            resetToken: null,
            resetTokenExpiry: null
        }, {
            where: { id: user.id }
        });
        
        res.status(200).json({ message: 'Password has been reset successfully' });
    } catch (error) {
        console.error('Password reset error:', error);
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

// Verify setup token
router.get('/verify-setup-token/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    // Find user with this token
    const user = await User.findOne({ 
      where: { 
        passwordSetupToken: token,
        passwordSetupTokenExpiry: { [Op.gt]: Date.now() }
      },
      attributes: ['id', 'username', 'email']
    });
    
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired setup token' });
    }
    
    res.json({ 
      message: 'Token valid',
      user: {
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(500).json({ error: 'Failed to verify token' });
  }
});

// Setup password for new account
router.post('/setup-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    
    if (!token || !password) {
      return res.status(400).json({ error: 'Token and password are required' });
    }
    
    // Find user with this token
    const user = await User.findOne({ 
      where: { 
        passwordSetupToken: token,
        passwordSetupTokenExpiry: { [Op.gt]: Date.now() }
      }
    });
    
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired setup token' });
    }
    
    // Hash the new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Update user with new password and clear token
    await User.update({
      password: hashedPassword,
      passwordSetupToken: null,
      passwordSetupTokenExpiry: null
    }, {
      where: { id: user.id }
    });
    
    // Log activity
    await logActivity('password_setup_completed', user.id, null, 'User completed initial password setup', req); // <-- Add this line
    
    res.json({ message: 'Password set successfully' });
    
  } catch (error) {
    console.error('Password setup error:', error);
    res.status(500).json({ error: 'Failed to set password' });
  }
});

module.exports = router;