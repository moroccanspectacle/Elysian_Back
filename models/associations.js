const Department = require('./Department');
const Team = require('./Team');
const User = require('./User');
const TeamMember = require('./TeamMember');
const File = require('./File');

// Set up associations
module.exports = function setupAssociations() {
  // User <-> Team many-to-many relationship through TeamMember
  User.belongsToMany(Team, { through: TeamMember, foreignKey: 'userId' });
  Team.belongsToMany(User, { through: TeamMember, foreignKey: 'teamId' });
  
  // Direct associations for easier querying
  User.hasMany(TeamMember, { foreignKey: 'userId' });
  TeamMember.belongsTo(User, { foreignKey: 'userId' });
  
  Team.hasMany(TeamMember, { foreignKey: 'teamId' });
  TeamMember.belongsTo(Team, { foreignKey: 'teamId' });
  
  // Team owner relationship
  User.hasMany(Team, { foreignKey: 'ownerId' });
  Team.belongsTo(User, { as: 'owner', foreignKey: 'ownerId' });
  
  // File associations
  User.hasMany(File, { foreignKey: 'userId' });
  File.belongsTo(User, { foreignKey: 'userId' });
  
  Team.hasMany(File, { foreignKey: 'teamId' });
  File.belongsTo(Team, { foreignKey: 'teamId' });

  Department.hasMany(User, { foreignKey: 'departmentId' });
  User.belongsTo(Department, { foreignKey: 'departmentId' });
  
  console.log("Model associations set up successfully");
};