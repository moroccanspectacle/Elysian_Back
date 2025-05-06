const {DataTypes} = require('sequelize');
const sequelize = require('../config/database');

const SystemSettings = sequelize.define('SystemSettings', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    defaultValue: 1
  },
  enforceTwo2FA: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  fileExpiration: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  maxFileSize: {
    type: DataTypes.INTEGER,
    defaultValue: 100 // MB
  },
  storageQuota: {
    type: DataTypes.INTEGER,
    defaultValue: 5000 // GB
  },
  // Add these fields to your SystemSettings model
  vaultPermissions: {
    type: DataTypes.JSONB,
    defaultValue: {
      // Role-based quotas in bytes
      quotas: {
        super_admin: -1, // Unlimited
        admin: 10737418240, // 10GB
        manager: 5368709120, // 5GB
        power_user: 3221225472, // 3GB
        user: 1073741824, // 1GB
      },
      // Department-specific settings
      departments: {
        legal: {
          additionalQuota: 5368709120, // +5GB
        },
        finance: {
          additionalQuota: 3221225472, // +3GB
        },
        hr: {
          additionalQuota: 3221225472, // +3GB
        }
      }
    }
  }
}, {
  // Only one record should exist
  indexes: [
    {
      unique: true,
      fields: ['id']
    }
  ]
});

module.exports = SystemSettings;