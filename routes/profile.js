const router = require('express').Router();
const verifyToken = require('./verifyToken');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {v4: uuidv4} = require('uuid');
const { profile } = require('console');
const { passwordChangeValidation } = require('../config/validation');
const SystemSettings = require('../models/SystemSettings');

const profileImagesDir = path.join(__dirname, '../uploads/profile-images');

if (!fs.existsSync(profileImagesDir)) {
    fs.mkdirSync(profileImagesDir, {recursive: true});
}

const storage = multer.diskStorage({
    destination: function (req, file,cb) {
        cb(null, profileImagesDir);
    }, 
    filename: function(req, file, cb)
    {
        const fileExt = path.extname(file.originalname);
        cb(null, `${uuidv4()}${fileExt}`);
    }
});

const upload = multer({
    storage: storage, 
    limits: {
        fileSize: 5 * 1024 * 1024
    },
    fileFilter: function(req, file, cb)
    {
        const filetypes = /jpeg|jpg|png|gif/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        if (mimetype && extname)
        {
            return cb(null, true);
        }
        cb('Error: Images only!');
    }
});

router.get('/', verifyToken, async (req, res) => {
    try {
        const user = await User.findByPk(req.user.id, {
            attributes: ['id', 'username', 'email', 'profileImage', 'mfaEnabled', 'role']
        });
        
        // Check if 2FA is enforced
        const systemSettings = await SystemSettings.findOne({ where: { id: 1 } });
        const isMfaEnforced = systemSettings?.enforceTwo2FA && 
                              user.role !== 'super_admin';
        
        // Include enforcement status in response
        const userData = user.toJSON();
        userData.isMfaEnforced = isMfaEnforced;
        
        res.json(userData);
    } catch (error) {
        console.error('Error fetching profile:', error);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

router.put('/', verifyToken, async (req, res) => {
    try {
        const {username, email} = req.body;

        if (email) {
            const existingUser = await User.findOne({where: {email}});

            if (existingUser && existingUser.id !== req.user.id)
            {
                return res.status(400).json({error: 'Email already in use'});
            }
        }

        await User.update(
            {
                username: username || undefined,
                email: email || undefined
            },
            {where: {id: req.user.id}}
        );

        res.json({message: 'Profile updated'});
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({error: 'Failed to update profile'});
    }
});

router.put('/password', verifyToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        // Validate new password strength
        const { error } = passwordChangeValidation(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });
        
        const user = await User.findByPk(req.user.id); 
        if (!user) {
            return res.status(404).json({error: 'User not found'});
        }

        const validPass = await bcrypt.compare(currentPassword, user.password);
        if (!validPass) {
            return res.status(400).json({error: 'Current Password is incorrect'});
        }

        // Check that new password is not the same as current password
        const sameAsCurrent = await bcrypt.compare(newPassword, user.password);
        if (sameAsCurrent) {
            return res.status(400).json({error: 'New password cannot be the same as current password'});
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        await User.update(
            {password: hashedPassword},
            {where: {id: req.user.id}}
        );
        res.json({message: 'Password updated'});
    } catch (error) {
        console.error('Password update error:', error);
        res.status(500).json({error: 'Failed to update password'});
    }
});

router.put('/image', verifyToken, upload.single('profileImage'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({error: 'No image uploaded'});
        }

        const user = await User.findByPk(req.user.id);

        if (user.profileImage) {
            const oldImagePath = path.join(profileImagesDir, path.basename(user.profileImage));
            if (fs.existsSync(oldImagePath)) {
                fs.unlinkSync(oldImagePath);
            }
        }
        const imagePath = `/profile-images/${req.file.filename}`;
        await User.update(
            {profileImage: imagePath},
            {where: {id: req.user.id}}
        );

        res.json({
            message: 'Profile image updated', 
            profileImage: imagePath
        });

    } catch (error) {
        console.error('Profile image update error:', error);
        res.status(500).json({error: 'Failed to update profile image'});
    }
});

module.exports = router;