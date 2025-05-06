const {DataTypes} = require('sequelize');
const sequelize = require('../config/database');
const User = require('./User');
const File = require('./File');

const Activity_Log = sequelize.define('Activity_Log',{
    id:{
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4
    },
    action: {
        type: DataTypes.ENUM(
            'upload', 
            'download', 
            'share', 
            'delete', 
            'login', 
            'update_system_settings',
            'user_management',
            'admin_action'
        ),
        allowNull: false
    },
    timestamp: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    details: {
        type: DataTypes.STRING, 
        allowNull: true  
    },
    ipAddress: {
        type: DataTypes.STRING,
        allowNull: true  
    },
    userId: {
        type: DataTypes.INTEGER,  
        references: {
            model: User,
            key: 'id'
        }
    },
    fileId: {
        type: DataTypes.UUID, 
        allowNull: true,  
        references: {
            model: File,
            key: 'id'
        }
    }
});

Activity_Log.belongsTo(User, {foreignKey: 'userId'});
User.hasMany(Activity_Log);

Activity_Log.belongsTo(File, {foreignKey: 'fileId', constraints: false});
File.hasMany(Activity_Log, {foreignKey: 'fileId', constraints: false});

module.exports = Activity_Log;