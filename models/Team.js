const {DataTypes} = require('sequelize');
const sequelize = require('../config/database');
const User = require('./User');

const Team = sequelize.define('Team', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    }, 
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    description : {
        type: DataTypes.TEXT,
        allowNull: true
    },
    ownerId:{
        type: DataTypes.INTEGER,  // Changed from UUID to INTEGER to match User.id
        references: {
            model: User,
            key: 'id'
        }
    },
    storageQuota: {
        type: DataTypes.BIGINT,
        defaultValue: 10 * 1024 * 1024 * 1024 // 10 GB
    }, 
    currentUsage: {
        type: DataTypes.BIGINT,
        defaultValue: 0
    },
    avatar: {
        type: DataTypes.STRING,
        allowNull: true
    }
});

module.exports = Team;