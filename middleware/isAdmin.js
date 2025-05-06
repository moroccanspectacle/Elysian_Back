const User = require('../models/User');

const isAdmin = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.user.id);
    
    if (!user || user.role !== 'admin' && user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    }
    
    // Add admin info to request
    req.isAdmin = true;
    req.isSuperAdmin = user.role === 'super_admin';
    
    next();
  } catch (error) {
    console.error('Admin verification error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
};

module.exports = isAdmin;