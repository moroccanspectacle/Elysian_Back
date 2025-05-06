const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Department = sequelize.define('Department', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  description: {
    type: DataTypes.STRING,
    allowNull: true
  },
  // Vault-specific permissions
  vaultAccess: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  vaultQuotaBonus: {
    type: DataTypes.BIGINT,
    defaultValue: 0 // Additional storage on top of role-based quota
  },
  // Department-specific settings
  requireMfa: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  securityClearanceLevel: {
    type: DataTypes.INTEGER,
    defaultValue: 1, // 1-5 scale where higher means more security requirements
    validate: {
      min: 1,
      max: 5
    }
  }
});

module.exports = Department;