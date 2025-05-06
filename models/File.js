const {DataTypes} = require('sequelize');
const sequelize = require('../config/database');
const User = require('./User');
const Team = require('./Team');

const File = sequelize.define('File', 
    {
        id: 
        {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true
        },
        originalName: 
        {
            type: DataTypes.STRING,
            allowNull: false
        },
        fileName:
        {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
        },
        fileSize: 
        {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        fileType: 
        {
            type: DataTypes.STRING,
            allowNull: false
        },
        iv:
        {
            type: DataTypes.STRING,
            allowNull: false
        },
        uploadDate: 
        {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        },
        fileHash: {
            type: DataTypes.STRING(128),
            allowNull: false
        },
        userId:
        {
            type: DataTypes.INTEGER,
            references: 
            {
                model: User,
                key: 'id'
            }
        },
        isDeleted: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },
        teamId: {
            type: DataTypes.UUID,
            allowNull: true,
            references: {
                model: Team,
                key: 'id'
            }
        },
        isTeamFile: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },
        expiryDate: {
            type: DataTypes.DATE,
            allowNull: true // Allow null since not all files need expiration dates
        }
});

File.belongsTo(User);
User.hasMany(File);
File.belongsTo(Team, { foreignKey: 'teamId' });
Team.hasMany(File, { foreignKey: 'teamId' });
module.exports = File;