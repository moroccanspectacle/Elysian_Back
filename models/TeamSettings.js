const {DataTypes} = require('sequelize');
const sequelize = require('../config/database');

const TeamSettings = sequelize.define('TeamSettings', {
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
    memberPermissions: {
        type: DataTypes.JSON,
        defaultValue: {
            canInviteMembers: false,
            canUploadFiles: true,
            canDeleteFiles: false
        }
    },
    securitySettings: {
        type: DataTypes.JSON,
        defaultValue: {
            enforceFileEncryption: true,
            require2FAForSensitiveOperations: false
        }
    }
});

module.exports = TeamSettings;