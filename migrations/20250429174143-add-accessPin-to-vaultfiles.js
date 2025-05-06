'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('VaultFiles', 'accessPin', {
      type: Sequelize.STRING,
      allowNull: true, // Or false if you enforce it immediately
    });
    // Optionally remove the old column if it exists and you're sure
    // await queryInterface.removeColumn('VaultFiles', 'requireMfa');
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('VaultFiles', 'accessPin');
    // Optionally add the old column back if needed
    // await queryInterface.addColumn('VaultFiles', 'requireMfa', {
    //   type: Sequelize.BOOLEAN,
    //   defaultValue: false,
    // });
  }
};
