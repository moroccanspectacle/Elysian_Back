const {DataTypes} = require('sequelize');
const sequelize = require('../config/database');

const TeamMember = sequelize.define('TeamMember', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    teamId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'Teams',
            key: 'id'
        }
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    email: {
        type: DataTypes.STRING,
        allowNull: true // For storing email of users who aren't registered yet
    },
    role: {
        type: DataTypes.ENUM('owner', 'admin', 'member'),
        defaultValue: 'member'
    },
    status: {
        type: DataTypes.ENUM('invited', 'active', 'suspended'),
        defaultValue: 'invited'
    }
});

module.exports = TeamMember;