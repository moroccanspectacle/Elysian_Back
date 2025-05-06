const {DataTypes} = require('sequelize');
const sequelize = require('../config/database');
const User = require('./User');
const File = require('./File');
const bcrypt = require('bcryptjs'); // Import bcrypt

const VaultFile = sequelize.define('VaultFile', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    }, 
    fileId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: File,
            key: 'id',
        }
    },
    userId: {
        type: DataTypes.INTEGER,  // Change from UUID to INTEGER
        allowNull: false, 
        references: {
            model: User,
            key: 'id',
        }
    },
    vaultKey: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    accessCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
    },
    lastAccessed: {
        type: DataTypes.DATE, 
        allowNull: true,
    },
    selfDestruct: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    destructAfter: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    accessPin: { // Add this field
        type: DataTypes.STRING,
        allowNull: true, // Allow null initially, will be set when added
    },
}, {
    hooks: {
        // Hash the pin before saving
        beforeCreate: async (vaultFile) => {
            if (vaultFile.accessPin) {
                const salt = await bcrypt.genSalt(10);
                vaultFile.accessPin = await bcrypt.hash(vaultFile.accessPin, salt);
            }
        },
        // Optional: Hash if updated (though PIN shouldn't change often)
        beforeUpdate: async (vaultFile) => {
            if (vaultFile.changed('accessPin') && vaultFile.accessPin) {
                const salt = await bcrypt.genSalt(10);
                vaultFile.accessPin = await bcrypt.hash(vaultFile.accessPin, salt);
            }
        }
    }
});

// Explicitly define the foreign key for the association
VaultFile.belongsTo(File, { foreignKey: 'fileId' }); // Use the lowercase 'fileId' column you defined
File.hasOne(VaultFile, { foreignKey: 'fileId' }); // Also specify it for the reverse association

module.exports = VaultFile;