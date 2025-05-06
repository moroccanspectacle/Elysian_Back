const router = require('express').Router();
const verifyToken = require('./verifyToken');
const isAdmin = require('../middleware/isAdmin');
const User = require('../models/User');
const File = require('../models/File');
const Activity_Log = require('../models/Activity_Log');
const Team = require('../models/Team');
const SystemSettings = require('../models/SystemSettings'); // Added SystemSettings model
const Department = require('../models/Department'); // Added Department model
const { Op } = require('sequelize');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const sequelize = require('sequelize');
const nodemailer = require('nodemailer'); // Added nodemailer
const { logActivity } = require('../services/logger');

// Apply middleware to all admin routes
router.use(verifyToken, isAdmin);

// GET /api/admin/users - List all users with pagination
router.get('/users', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    
    const where = {};
    if (search) {
      where[Op.or] = [
        { username: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } }
      ];
    }
    
    const users = await User.findAndCountAll({
      where,
      attributes: ['id', 'username', 'email', 'createdAt', 'role', 'mfaEnabled', 'profileImage', 'departmentId'], // Added departmentId
      include: [{
        model: Department,
        attributes: ['name']
      }],
      limit,
      offset,
      order: [['createdAt', 'DESC']]
    });
    
    res.json({
      users: users.rows,
      total: users.count,
      pages: Math.ceil(users.count / limit),
      currentPage: page
    });
  } catch (error) {
    console.error('Admin users list error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Create a new user (admin only)
router.post('/users', async (req, res) => {
  try {
    const { username, email } = req.body;
    
    // Basic validation
    if (!username || !email) {
      return res.status(400).json({ error: 'Username and email are required' });
    }
    
    // Check if user already exists
    const existingUser = await User.findOne({ 
      where: {
        [Op.or]: [
          { email },
          { username }
        ]
      }
    });
    
    if (existingUser) {
      return res.status(409).json({ 
        error: 'User with this email or username already exists' 
      });
    }
    
    // Generate a secure password reset token
    const passwordSetupToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = Date.now() + 86400000; // 24 hours
    
    // Create a temporary random password (will be changed by user)
    const tempPassword = crypto.randomBytes(16).toString('hex');
    const salt = await bcrypt.genSalt(10);
    const hashedTempPassword = await bcrypt.hash(tempPassword, salt);
    
    // Create user with temp password and setup token
    const user = await User.create({
      username,
      email,
      password: hashedTempPassword, // Add this line
      passwordSetupToken,
      passwordSetupTokenExpiry: tokenExpiry,
      role: 'user',
      status: 'active',
      storageQuota: 5 * 1024 * 1024 * 1024, // 5GB default or get from system settings
      currentUsage: 0
    });
    
    // Configure nodemailer with your email service
    const transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });
    
    // Create password setup URL
    const setupUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/setup-password/${passwordSetupToken}`;
    
    // Email content
    const mailOptions = {
      from: process.env.EMAIL_FROM || '"Elysian Vault" <noreply@elysianvault.com>',
      to: email,
      subject: 'Welcome to Elysian Vault - Set Up Your Account',
      html: `
        <h1>Welcome to Elysian Vault</h1>
        <p>An administrator has created an account for you. Please click the link below to set up your password and access your account:</p>
        <p><a href="${setupUrl}" style="padding: 10px 20px; background-color: #1E3A8A; color: white; text-decoration: none; border-radius: 5px;">Set Up Your Password</a></p>
        <p>This link will expire in 24 hours.</p>
        <p>If you did not request this account, please ignore this email.</p>
      `
    };
    
    // Send email
    await transporter.sendMail(mailOptions);
    
    // Log the action
    await Activity_Log.create({
      userId: req.user.id,
      action: 'user_management', // Changed from 'create_user'
      details: `Admin created user ${username} (${email})`
    });
    
    res.status(201).json({ 
      message: 'User created successfully. Setup email sent to user.'
    });
    
  } catch (error) {
    console.error('User creation error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// PUT /api/admin/users/:id - Update user details
router.put('/users/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const { username, email, role, status, departmentId } = req.body;
    
    // Get the user to update
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Prevent super_admin changes by anyone except another super_admin
    if (user.role === 'super_admin' && !req.isSuperAdmin) {
      return res.status(403).json({ error: 'Only super admins can modify other super admins' });
    }
    
    const updateData = {};
    if (username) updateData.username = username;
    if (email) updateData.email = email;
    if (role && user.role !== 'super_admin') updateData.role = role;
    if (status && user.role !== 'super_admin') updateData.status = status;

    // --- Add this check for departmentId ---
    // Check if departmentId is explicitly provided in the request body.
    // Allows setting it to a value OR explicitly to null.
    if (departmentId !== undefined) {
      // Ensure null is passed correctly if intended, otherwise parse the ID.
      updateData.departmentId = departmentId === null ? null : parseInt(departmentId, 10);
      // Basic validation if ID is not null
      if (updateData.departmentId !== null && isNaN(updateData.departmentId)) {
         return res.status(400).json({ error: 'Invalid Department ID format' });
      }
    }
    // --- End Add ---

    // Only update if there's actually data to change
    if (Object.keys(updateData).length > 0) {
      await user.update(updateData);
      // Log activity
      await logActivity('admin_update_user', req.user.id, userId, { changes: Object.keys(updateData) });
    }

    // Fetch updated user data including department
    const updatedUser = await User.findByPk(userId, { include: [Department] });
    res.json(updatedUser);
  } catch (error) {
    console.error('Admin user update error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// --- Add New Route: GET /api/admin/files/:id ---
router.get('/files/:id', async (req, res) => {
  try {
    const fileId = req.params.id;

    const file = await File.findOne({
      where: { id: fileId }, // Find by ID, regardless of isDeleted for admin view
      include: [
        {
          model: User,
          attributes: ['id', 'username', 'email'] // Include owner details
        },
        {
          model: Team, // Include team details if it's a team file
          attributes: ['id', 'name'],
          required: false // Use left join
        }
        // Optional: Include FileShare or VaultFile if needed
      ]
    });

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    // You might want to omit sensitive data like 'iv' before sending
    const fileDetails = file.toJSON();
    // delete fileDetails.iv; // Example: remove iv if not needed

    res.json(fileDetails);

  } catch (error) {
    console.error('Admin file details error:', error);
    res.status(500).json({ error: 'Failed to fetch file details' });
  }
});
// --- End New Route ---

// --- Add New Route: DELETE /api/admin/files/:id ---
router.delete('/files/:id', async (req, res) => {
  try {
    const fileId = req.params.id;
    const adminUserId = req.user.id; // ID of the admin performing the action

    const file = await File.findOne({
      where: { id: fileId } // Find by ID, even if already marked as deleted
    });

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    // If the file is already marked as deleted, maybe just return success
    if (file.isDeleted) {
      return res.json({ message: 'File was already deleted' });
    }

    // Mark the file as deleted
    await file.update({ isDeleted: true });

    // Update team usage if it's a team file
    if (file.teamId) {
      try {
        const team = await Team.findByPk(file.teamId);
        if (team) {
          const fileSize = Number(file.fileSize);
          if (!isNaN(fileSize)) {
            await team.decrement('currentUsage', { by: fileSize });
            console.log(`[Admin File Delete] Decremented team ${file.teamId} usage by ${fileSize}.`);
          }
        }
      } catch (teamUpdateError) {
        console.error(`[Admin File Delete] Error updating team usage for team ${file.teamId}:`, teamUpdateError);
        // Log error but continue, as file is marked deleted
      }
    }

    // Log the admin action
    await logActivity('admin_delete_file', adminUserId, fileId, {
      fileName: file.originalName,
      deletedByAdmin: adminUserId
    });

    res.json({ message: 'File deleted successfully by admin' });

  } catch (error) {
    console.error('Admin file delete error:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});
// --- End New Route ---

// GET /api/admin/files - List all files
router.get('/files', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    
    const where = { isDeleted: false };
    if (search) {
      where[Op.or] = [
        { originalName: { [Op.iLike]: `%${search}%` } }
      ];
    }
    
    const files = await File.findAndCountAll({
      where,
      include: [{
        model: User,
        attributes: ['username', 'email']
      }],
      limit,
      offset,
      order: [['uploadDate', 'DESC']]
    });
    
    res.json({
      files: files.rows,
      total: files.count,
      pages: Math.ceil(files.count / limit),
      currentPage: page
    });
  } catch (error) {
    console.error('Admin files list error:', error);
    res.status(500).json({ error: 'Failed to fetch files' });
  }
});

// GET /api/admin/activities - Get activity logs
router.get('/activities', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const userId = req.query.userId;
    const action = req.query.action;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    
    const where = {};
    if (userId) where.userId = userId;
    if (action) where.action = action;
    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp[Op.gte] = new Date(startDate);
      if (endDate) where.timestamp[Op.lte] = new Date(endDate);
    }
    
    const logs = await Activity_Log.findAndCountAll({
      where,
      include: [{
        model: User,
        attributes: ['username', 'email']
      }],
      limit,
      offset,
      order: [['timestamp', 'DESC']]
    });
    
    res.json({
      logs: logs.rows,
      total: logs.count,
      pages: Math.ceil(logs.count / limit),
      currentPage: page
    });
  } catch (error) {
    console.error('Admin activities list error:', error);
    res.status(500).json({ error: 'Failed to fetch activity logs' });
  }
});

// GET /api/admin/stats/overview - Get system overview
router.get('/stats/overview', async (req, res) => {
  try {
    // Get total users
    const totalUsers = await User.count();
    
    // Get users registered in last 30 days
    const last30DaysUsers = await User.count({
      where: {
        createdAt: {
          [Op.gte]: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        }
      }
    });
    
    // Get total files and storage used
    const filesStats = await File.findAll({
      attributes: [
        [sequelize.fn('COUNT', sequelize.col('id')), 'total'],
        [sequelize.fn('SUM', sequelize.col('fileSize')), 'totalSize']
      ],
      where: { isDeleted: false }
    });
    
    // Get total teams
    const totalTeams = await Team.count();
    
    res.json({
      users: {
        total: totalUsers,
        last30Days: last30DaysUsers
      },
      files: {
        total: filesStats[0].getDataValue('total') || 0,
        totalSize: filesStats[0].getDataValue('totalSize') || 0
      },
      teams: {
        total: totalTeams
      }
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Failed to fetch system stats' });
  }
});

// GET /api/admin/settings - Get system settings
router.get('/settings', async (req, res) => {
  try {
    // Create SystemSettings model if you don't have one yet
    const settings = await SystemSettings.findOne({ where: { id: 1 } });
    
    // If no settings exist yet, return defaults
    if (!settings) {
      return res.json({
        enforceTwo2FA: false,
        fileExpiration: true,
        maxFileSize: 100, // MB
        storageQuota: 5000 // GB
      });
    }
    
    res.json(settings);
  } catch (error) {
    console.error('Admin settings fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch system settings' });
  }
});

// PUT /api/admin/settings - Update system settings
router.put('/settings', async (req, res) => {
  try {
    const { enforceTwo2FA, fileExpiration, maxFileSize, storageQuota } = req.body;
    
    // Validate settings
    if (maxFileSize <= 0 || storageQuota <= 0) {
      return res.status(400).json({ error: 'Invalid size values' });
    }
    
    // Find or create settings record
    const [settings, created] = await SystemSettings.findOrCreate({
      where: { id: 1 },
      defaults: {
        enforceTwo2FA: !!enforceTwo2FA,
        fileExpiration: !!fileExpiration,
        maxFileSize: maxFileSize || 100,
        storageQuota: storageQuota || 5000
      }
    });
    
    // If settings already exist, update them
    if (!created) {
      await settings.update({
        enforceTwo2FA: !!enforceTwo2FA,
        fileExpiration: !!fileExpiration,
        maxFileSize: maxFileSize || settings.maxFileSize,
        storageQuota: storageQuota || settings.storageQuota
      });
    }
    
    // Log the activity
    await Activity_Log.create({
      userId: req.user.id,
      action: 'update_system_settings',
      details: 'Updated system settings',
      timestamp: new Date()
    });
    
    res.json(settings);
  } catch (error) {
    console.error('Admin settings update error:', error);
    res.status(500).json({ error: 'Failed to update system settings' });
  }
});

// Create initial super admin user if none exists
router.get('/setup', async (req, res) => {
  try {
    // Check if super admin already exists
    const adminExists = await User.findOne({
      where: { role: 'super_admin' }
    });
    
    if (adminExists) {
      return res.status(400).json({ message: 'Super admin already exists' });
    }
    
    // Create a super admin user with a random password
    const password = crypto.randomBytes(8).toString('hex');
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    const admin = await User.create({
      username: 'superadmin',
      email: 'admin@elysianvault.com',
      password: hashedPassword,
      role: 'super_admin'
    });
    
    res.json({ 
      message: 'Super admin created successfully',
      credentials: {
        email: admin.email,
        password: password
      }
    });
  } catch (error) {
    console.error('Admin setup error:', error);
    res.status(500).json({ error: 'Failed to create super admin' });
  }
});

router.get('/vault/usage', verifyToken, isAdmin, async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: ['id', 'username', 'email', 'role', 'department', 'vaultAccess', 'vaultQuota', 'vaultUsage'],
      order: [['vaultUsage', 'DESC']]
    });
    res.json(users);
  } catch (error) {
    console.error('Error fetching vault usage:', error);
    res.status(500).json({ message: 'Failed to fetch vault usage' });
  }
});

router.put('/vault/user/:userId', verifyToken, isAdmin, async (req, res) => {
  try {
    const {userId} = req.params;
    const {vaultAccess, vaultQuota} = req.body;

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({message: 'User not found'});
    }

    await user.update({
      vaultAccess: vaultAccess !== undefined ? vaultAccess : user.vaultAccess,
      vaultQuota: vaultQuota !== undefined ? vaultQuota : user.vaultQuota
    });

    await logActivity('admin_update_vault_permissions', req.user.id, null, `Updated vault permissions for user ${user.username}`, req);
    res.json({
      message: 'User vault permissions updated successfully',
      user: {
        id: user.id,
        username: user.username, 
        vaultAccess: user.vaultAccess,
        vaultQuota: user.vaultQuota,
        vaultUsage: user.vaultUsage
      }
    });

  } catch (error) {
    console.error('Error updating vault permissions:', error);
    res.status(500).json({message: 'Failed to update vault permissions'});
  }
});

router.put('/vault/settings', verifyToken, isAdmin, async (req, res) => {
  try {
    const {vaultPermissions} = req.body;
    const systemSettings = await SystemSettings.findOne({ where: { id: 1 } });
    if (!systemSettings) {
      return res.status(404).json({message: 'System settings not found'});
    }
    await systemSettings.update({
      vaultPermissions: vaultPermissions || systemSettings.vaultPermissions
    });
    await logActivity('admin_update_vault_settings', req.user.id, null, 'Updated vault settings', req);

    res.json({
      message: 'Vault settings updated successfully',
      vaultPermissions: systemSettings.vaultPermissions
    });
  } catch (error) {
    console.error('Error updating vault settings:', error);
    res.status(500).json({message: 'Failed to update vault settings'});
  }
});

// GET /api/admin/departments - List all departments
router.get('/departments', async (req, res) => {
  try {
    // First get all departments
    const departments = await Department.findAll({
      order: [['name', 'ASC']]
    });
    
    // Then get the user counts for each department
    const results = await Promise.all(departments.map(async (dept) => {
      const count = await User.count({
        where: { departmentId: dept.id }
      });
      
      return {
        ...dept.toJSON(),
        userCount: count
      };
    }));
    
    res.json(results);
  } catch (error) {
    console.error('Error fetching departments:', error);
    res.status(500).json({ message: 'Failed to fetch departments' });
  }
});

// POST /api/admin/departments - Create new department
router.post('/departments', async (req, res) => {
  try {
    const { name, description, vaultAccess, vaultQuotaBonus, requireMfa, securityClearanceLevel } = req.body;
    
    const department = await Department.create({
      name,
      description,
      vaultAccess: vaultAccess !== undefined ? vaultAccess : true,
      vaultQuotaBonus: vaultQuotaBonus || 0,
      requireMfa: requireMfa !== undefined ? requireMfa : false,
      securityClearanceLevel: securityClearanceLevel || 1
    });
    
    await logActivity('admin_action', req.user.id, null, `Created department: ${name}`, req);
    
    res.status(201).json(department);
  } catch (error) {
    console.error('Error creating department:', error);
    res.status(500).json({ message: 'Failed to create department' });
  }
});

// PUT /api/admin/departments/:id - Update department
router.put('/departments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, vaultAccess, vaultQuotaBonus, requireMfa, securityClearanceLevel } = req.body;
    
    const department = await Department.findByPk(id);
    if (!department) {
      return res.status(404).json({ message: 'Department not found' });
    }
    
    await department.update({
      name: name || department.name,
      description: description !== undefined ? description : department.description,
      vaultAccess: vaultAccess !== undefined ? vaultAccess : department.vaultAccess,
      vaultQuotaBonus: vaultQuotaBonus !== undefined ? vaultQuotaBonus : department.vaultQuotaBonus,
      requireMfa: requireMfa !== undefined ? requireMfa : department.requireMfa,
      securityClearanceLevel: securityClearanceLevel || department.securityClearanceLevel
    });
    
    await logActivity('admin_action', req.user.id, null, `Updated department: ${department.name}`, req);
    
    res.json(department);
  } catch (error) {
    console.error('Error updating department:', error);
    res.status(500).json({ message: 'Failed to update department' });
  }
});

// DELETE /api/admin/departments/:id - Delete department
router.delete('/departments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const department = await Department.findByPk(id, {
      include: [{ model: User }]
    });
    
    if (!department) {
      return res.status(404).json({ message: 'Department not found' });
    }
    
    // Check if department has users
    if (department.Users && department.Users.length > 0) {
      return res.status(400).json({ 
        message: 'Cannot delete department with assigned users',
        userCount: department.Users.length
      });
    }
    
    await department.destroy();
    await logActivity('admin_action', req.user.id, null, `Deleted department: ${department.name}`, req);
    
    res.json({ message: 'Department deleted successfully' });
  } catch (error) {
    console.error('Error deleting department:', error);
    res.status(500).json({ message: 'Failed to delete department' });
  }
});

module.exports = router;