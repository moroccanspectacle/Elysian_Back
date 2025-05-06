const {DataTypes} = require('sequelize');
const sequelize = require('../config/database');

const User = sequelize.define('User',
    {
        id: {
            type: DataTypes.INTEGER,  
            primaryKey: true,
            autoIncrement: true
        },
        username: {
            type: DataTypes.STRING,
            allowNull: false
        },
        email: {
            type: DataTypes.STRING,
            allowNull: false
        },
        password: {
            type: DataTypes.STRING,
            allowNull: false
        },
        profileImage: {
            type: DataTypes.STRING,
            allowNull: true
        }, 
        mfaEnabled: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        }, 
        mfaSecret: {
            type: DataTypes.STRING,
            allowNull: true
        },
        resetToken: {
            type: DataTypes.STRING,
            allowNull: true
        },
        resetTokenExpiry: {
            type: DataTypes.DATE,
            allowNull: true
        },
        passwordSetupToken: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        passwordSetupTokenExpiry: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        role: {
            type: DataTypes.ENUM('user', 'admin', 'super_admin'),
            defaultValue: 'user',
            allowNull: false
        },
        status: {
            type: DataTypes.ENUM('active', 'suspended', 'pending_setup'),
            defaultValue: 'active'
        },
        departmentId: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: {
                model: 'Departments',
                key: 'id'
            },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL'
        },
        vaultAccess: {
            type: DataTypes.BOOLEAN,
            defaultValue: true, 
        },
        vaultQuota: {
            type: DataTypes.BIGINT, 
            defaultValue: 5 * 1024 * 1024 * 1024, 
        },
        vaultUsage: {
            type: DataTypes.BIGINT,
            defaultValue: 0,
        },
    });

module.exports = User;