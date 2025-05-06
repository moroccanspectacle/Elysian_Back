const router = require('express').Router();
const verifyToken = require('./verifyToken');
const require2FA = require('../middleware/require2FA');
const Team = require('../models/Team');
const TeamMember = require('../models/TeamMember');
const User = require('../models/User');
const File = require('../models/File');
const TeamSettings = require('../models/TeamSettings');
const {logActivity} = require('../services/logger');
const { Op } = require('sequelize' ); // Ensure Op is imported
const nodemailer = require('nodemailer');

// GET /api/teams - List teams for current user
router.get('/', verifyToken, async (req, res) => {
    try {
        console.log('Getting teams for user ID:', req.user.id);
        
        // First check if TeamMember is properly defined
        if (!TeamMember) {
            console.error('TeamMember model is undefined');
            return res.status(500).json({error: 'Internal server configuration error'});
        }
        
        // Fetch user's email first
        const User = require('../models/User');
        const user = await User.findByPk(req.user.id, {
            attributes: ['email']
        });
        
        if (!user) {
            return res.status(404).json({error: 'User not found'});
        }
        
        // Find both active memberships and pending invitations
        const teamMemberships = await TeamMember.findAll({
            where: {
                [Op.or]: [
                    // Active memberships
                    {
                        userId: req.user.id,
                        status: 'active'
                    },
                    // Invitations by email (for users who may not have registered yet)
                    {
                        email: user.email,
                        status: 'invited'
                    },
                    // Invitations by userId (for existing users)
                    {
                        userId: req.user.id,
                        status: 'invited'
                    }
                ]
            },
            include: [{ 
                model: Team,
                required: true
            }]
        });
        
        console.log(`Found ${teamMemberships.length} team memberships/invitations`);
        
        // Return empty array if no teams found
        if (!teamMemberships || teamMemberships.length === 0) {
            return res.json([]);
        }
        
        const teams = teamMemberships.map(membership => {
            if (!membership.Team) {
                console.error('Team data missing in membership:', membership.id);
                return null;
            }
            return {
                ...membership.Team.toJSON(),
                role: membership.role,
                status: membership.status // Include status to show if invited or active
            };
        }).filter(Boolean); // Remove null entries
        
        res.json(teams);
    } catch (error) {
        console.error('Team list error:', error);
        res.status(500).json({error: 'Failed to list teams'});
    }
});

// POST /api/teams - Create a new team
router.post('/', verifyToken, async (req, res) => {
    try {
        const {name, description, storageQuota} = req.body;
        
        console.log("Creating team with owner ID:", req.user.id);

        const team = await Team.create({
            name,
            description, 
            ownerId: req.user.id,
            storageQuota: storageQuota || 10 * 1024 * 1024 * 1024 // 10 GB default
        });
        
        console.log("Team created:", team.id, team.name);
        console.log("Creating team member with teamId:", team.id, "and userId:", req.user.id);

        try {
            const teamMember = await TeamMember.create({
                teamId: team.id,
                userId: req.user.id,
                role: 'owner',
                status: 'active'
            });
            console.log("Team member created successfully:", teamMember.id);
        } catch (memberError) {
            console.error("Failed to create team member:", memberError);
            throw memberError;
        }
        
        await logActivity('create_team', req.user.id, null, {teamId: team.id});
        
        // Return ALL fields needed by the frontend
        res.status(201).json({
            id: team.id,
            name: team.name,
            description: team.description || "",
            ownerId: team.ownerId,
            currentUsage: team.currentUsage || 0,
            storageQuota: team.storageQuota,
            role: 'owner' // Add role field explicitly
        });
    } catch (error) {
        console.error('Team creation error:', error);
        res.status(500).json({error: 'Failed to create team'});
    }
});

// GET /api/teams/:id - Get single team details
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const teamId = req.params.id;
        
        const membership = await TeamMember.findOne({
            where: {
                teamId: teamId,
                userId: req.user.id,
                status: 'active'
            }
        });
        
        if (!membership) {
            return res.status(403).json({error: 'You do not have access to this team'});
        }
        
        const team = await Team.findByPk(teamId);
        if (!team) {
            return res.status(404).json({error: 'Team not found'});
        }
        
        res.json({
            ...team.toJSON(),
            role: membership.role
        });
    } catch (error) {
        console.error('Get team error:', error);
        res.status(500).json({error: 'Failed to get team details'});
    }
});

// GET /api/teams/:id/members - Get team members
router.get('/:id/members', verifyToken, async (req, res) => {
    try {
        const teamId = req.params.id;
        
        // Verify user is a member of this team
        const membership = await TeamMember.findOne({
            where: {
                teamId: teamId,
                userId: req.user.id,
                status: 'active'
            }
        });
        
        if (!membership) {
            return res.status(403).json({error: 'You do not have access to this team'});
        }
        
        // Get all members with their user info
        const members = await TeamMember.findAll({
            where: { teamId: teamId },
            include: [{
                model: User,
                attributes: ['id', 'username', 'email', 'profileImage']
            }]
        });
        
        // Format the response
        const formattedMembers = members.map(member => ({
            id: member.id,
            userId: member.userId,
            role: member.role,
            status: member.status,
            joinedAt: member.createdAt,
            username: member.User.username,
            email: member.User.email,
            profileImage: member.User.profileImage
        }));
        
        res.json(formattedMembers);
    } catch (error) {
        console.error('Get team members error:', error);
        res.status(500).json({error: 'Failed to get team members'});
    }
});

// GET /api/teams/:id/files - Get team files
router.get('/:id/files', verifyToken, async (req, res) => {
    try {
        const teamId = req.params.id;
        
        // Verify user is a member of this team
        const membership = await TeamMember.findOne({
            where: {
                teamId: teamId,
                userId: req.user.id,
                // Include all statuses, not just 'active'
                status: {[Op.in]: ['active', 'invited']}
            }
        });
        
        if (!membership) {
            return res.status(403).json({error: 'You do not have access to this team'});
        }
        
        // If the user is invited but not yet active, return an empty array
        if (membership.status === 'invited') {
            return res.json([]);
        }
        
        // Get all files for this team
        const files = await File.findAll({
            where: { 
                teamId: teamId,
                isDeleted: false
            },
            include: [{
                model: User,
                attributes: ['username']
            }]
        });
        
        // Format the response
        const formattedFiles = files.map(file => ({
            id: file.id,
            originalName: file.originalName,
            fileSize: file.fileSize,
            fileType: file.fileType,
            uploadDate: file.uploadDate,
            uploadedBy: file.User ? file.User.username : 'Unknown'
        }));
        
        res.json(formattedFiles);
    } catch (error) {
        console.error('Get team files error:', error);
        res.status(500).json({error: 'Failed to get team files'});
    }
});

// --- Add New Route: GET /api/teams/:id/search-invitees ---
// Returns users who are NOT already members or invited to this specific team
router.get('/:id/search-invitees', verifyToken, async (req, res) => {
    try {
        const teamId = req.params.id;
        const searchTerm = req.query.search || ''; // Optional search term

        // 1. Verify the current user is an active member of the team
        const currentUserMembership = await TeamMember.findOne({
            where: { teamId: teamId, userId: req.user.id, status: 'active' }
        });
        if (!currentUserMembership) {
            return res.status(403).json({ error: 'You are not an active member of this team.' });
        }

        // 2. Get IDs of users already in or invited to the team
        const existingMemberIds = (await TeamMember.findAll({
            where: { teamId: teamId },
            attributes: ['userId'] // Only fetch userId
        })).map(member => member.userId).filter(id => id !== null); // Filter out null userId for pending email invites

        // 3. Find users matching the search term (if any) who are NOT in the existingMemberIds list
        const whereClause = {
            id: { [Op.notIn]: existingMemberIds }, // Exclude existing/invited members
            // status: 'active' // Optional: Only allow inviting active users? Adjust as needed.
        };

        if (searchTerm) {
            whereClause[Op.or] = [
                { username: { [Op.iLike]: `%${searchTerm}%` } },
                { email: { [Op.iLike]: `%${searchTerm}%` } }
            ];
        }

        const potentialInvitees = await User.findAll({
            where: whereClause,
            attributes: ['id', 'username', 'email', 'profileImage'], // Return necessary fields for display
            limit: 20 // Limit results for performance
        });

        res.json(potentialInvitees);

    } catch (error) {
        console.error('Error searching for potential invitees:', error);
        res.status(500).json({ error: 'Failed to search for users to invite.' });
    }
});
// --- End New Route ---


// POST /api/teams/:id/invite - Invite a member to the team
// --- Modify this route ---
router.post('/:id/invite', verifyToken, async (req, res) => {
    try {
        const teamId = req.params.id;
        // Expect userId and role now, instead of email
        const { userId, role } = req.body;
        const inviterId = req.user.id;

        // Validate input: Check for userId and role
        if (!userId || !role) {
            return res.status(400).json({ error: 'User ID and role are required' });
        }

        // Verify that the current user has permission to invite members (existing logic)
        const membership = await TeamMember.findOne({
            where: {
                teamId: teamId,
                userId: req.user.id,
                status: 'active'
            }
        });
        
        if (!membership) {
            return res.status(403).json({ error: 'You are not a member of this team' });
        }
        
        // Admin and owner can always invite
        if (membership.role !== 'owner' && membership.role !== 'admin') {
            // Regular members need permission from settings
            const teamSettings = await TeamSettings.findOne({
                where: { teamId: teamId }
            });
            
            if (teamSettings && !teamSettings.memberPermissions.canInviteMembers) {
                return res.status(403).json({ error: 'You do not have permission to invite members to this team' });
            }
        }

        // Find the user being invited by ID
        const userToInvite = await User.findOne({
            where: { id: userId }
        });

        // Check if the target user exists
        if (!userToInvite) {
            return res.status(404).json({ error: 'User to invite not found.' });
        }
        const invitedUserEmail = userToInvite.email; // Get email for notification

        // Check if user is already a member of the team (using userId)
        const existingMember = await TeamMember.findOne({
            where: {
                teamId: teamId,
                userId: userId // Check by userId now
            }
        });

        if (existingMember) {
            if (existingMember.status === 'active') {
                return res.status(400).json({ error: 'User is already an active member of this team' });
            } else if (existingMember.status === 'invited') {
                // Optional: Resend invite? Or just return error?
                return res.status(400).json({ error: 'User has already been invited to this team' });
            }
            // Handle other statuses if necessary (e.g., suspended)
        }

        // Create the invitation record using userId
        const newMember = await TeamMember.create({
            teamId: teamId,
            userId: userId, // Use the provided userId
            role: role,
            status: 'invited',
            email: invitedUserEmail // Store email still, useful for reference/notifications
        });

        // --- Send Invitation Email (using invitedUserEmail) ---
        try {
            const inviter = await User.findByPk(inviterId, { attributes: ['username'] });
            const team = await Team.findByPk(teamId, { attributes: ['name'] });

            if (inviter && team) {
                const transporter = nodemailer.createTransport({
                    service: process.env.EMAIL_SERVICE || 'gmail',
                    auth: {
                        user: process.env.EMAIL_USER,
                        pass: process.env.EMAIL_PASSWORD
                    }
                });
                const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
                const loginUrl = `${frontendUrl}/login`;

                const mailOptions = {
                    from: process.env.EMAIL_FROM || '"Elysian Vault" <noreply@elysianvault.com>',
                    to: invitedUserEmail, // Use the fetched email
                    subject: `Invitation to join ${team.name} on Elysian Vault`,
                    html: `
                        <h1>Team Invitation</h1>
                        <p>Hi ${userToInvite.username || 'there'},</p>
                        <p>You've been invited by <strong>${inviter.username}</strong> to join the team "<strong>${team.name}</strong>" on Elysian Vault as a ${role}.</p>
                        <p>Please log in to your Elysian Vault account and check your notifications to accept or decline the invitation.</p>
                        <p><a href="${loginUrl}" style="padding: 10px 20px; background-color: #1E3A8A; color: white; text-decoration: none; border-radius: 5px;">Go to Elysian Vault</a></p>
                        <p>If you weren't expecting this invitation, you can safely ignore this email.</p>
                    `
                };
                await transporter.sendMail(mailOptions);
                console.log(`Invitation email sent successfully to ${invitedUserEmail} for team ${team.name}`);
            } else {
                 console.error(`Could not find inviter (ID: ${inviterId}) or team (ID: ${teamId}) for email notification.`);
            }
        } catch (emailError) {
            console.error(`Failed to send invitation email to ${invitedUserEmail}:`, emailError);
        }
        // --- End Send Invitation Email ---

        // Log the invite activity
        await logActivity('invite_team_member', inviterId, null, {
            teamId: teamId,
            invitedUserId: userId, // Log userId instead of email
            role: role
        });

        // Return member data - use userToInvite directly
        res.status(201).json({
            id: newMember.id,
            userId: userToInvite.id,
            role: newMember.role,
            status: newMember.status,
            joinedAt: newMember.createdAt,
            username: userToInvite.username,
            email: userToInvite.email, // Return email from the invited user object
            profileImage: userToInvite.profileImage
        });

    } catch (error) {
        console.error('Team member invitation error:', error);
        if (!res.headersSent) {
             res.status(500).json({ error: 'Failed to process invitation' });
        }
    }
});
// --- End Modify Route ---

// --- Add New Route: DELETE /api/teams/:id/members/:memberId ---
router.delete('/:id/members/:memberId', verifyToken, /* Optional: require2FA, */ async (req, res) => {
    try {
        const teamId = req.params.id;
        const memberIdToRemove = req.params.memberId; // This is the TeamMember record ID
        const removerUserId = req.user.id; // User performing the action

        console.log(`[Team Member Delete] Attempting removal: Team ${teamId}, Member Record ${memberIdToRemove}, By User ${removerUserId}`);

        // Verify remover's permissions (owner or admin)
        const removerMembership = await TeamMember.findOne({
            where: { teamId: teamId, userId: removerUserId, status: 'active' }
        });

        if (!removerMembership || (removerMembership.role !== 'owner' && removerMembership.role !== 'admin')) {
            console.log(`[Team Member Delete] Permission denied: User ${removerUserId} is not owner/admin.`);
            return res.status(403).json({ error: 'You do not have permission to remove members from this team' });
        }

        // Find the membership record to delete using its own ID
        const membershipToRemove = await TeamMember.findOne({
            where: { id: memberIdToRemove, teamId: teamId } // Find by TeamMember.id and teamId
        });

        if (!membershipToRemove) {
            console.log(`[Team Member Delete] Member record not found: ID ${memberIdToRemove} in Team ${teamId}.`);
            return res.status(404).json({ error: 'Team member record not found' });
        }

        // Prevent owner from being removed
        if (membershipToRemove.role === 'owner') {
            console.log(`[Team Member Delete] Cannot remove owner: Member Record ID ${memberIdToRemove}.`);
            return res.status(400).json({ error: 'Cannot remove the team owner' });
        }

        // Perform the deletion
        await membershipToRemove.destroy();

        // Log the activity
        await logActivity('remove_team_member', removerUserId, null, {
            teamId: teamId,
            removedUserId: membershipToRemove.userId, // Log the actual User ID removed
            removedMemberRecordId: memberIdToRemove // Log the TeamMember record ID
        });

        console.log(`[Team Member Delete] Success: Member Record ${memberIdToRemove} removed from Team ${teamId}.`);
        res.json({ message: 'Team member removed successfully' });

    } catch (error) {
        console.error('Remove team member error:', error);
        res.status(500).json({ error: 'Failed to remove team member' });
    }
});
// --- End New Route ---

// --- Add New Route: PUT /api/teams/:id/members/:memberId/role ---
router.put('/:id/members/:memberId/role', verifyToken, /* Optional: require2FA, */ async (req, res) => {
    try {
        const teamId = req.params.id;
        const memberIdToUpdate = req.params.memberId; // This is the TeamMember record ID
        const { role: newRole } = req.body; // Get the new role from the request body
        const updaterUserId = req.user.id; // User performing the action

        console.log(`[Team Member Role Update] Attempting update: Team ${teamId}, Member Record ${memberIdToUpdate}, New Role ${newRole}, By User ${updaterUserId}`);

        // Validate the new role
        if (!['admin', 'member'].includes(newRole)) {
            return res.status(400).json({ error: 'Invalid role specified. Must be "admin" or "member".' });
        }

        // Verify updater's permissions (Only Owner can change roles for this example)
        // You might adjust this logic based on your requirements (e.g., allow admins to change roles too)
        const team = await Team.findByPk(teamId);
        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }
        if (team.ownerId !== updaterUserId) {
             console.log(`[Team Member Role Update] Permission denied: User ${updaterUserId} is not the team owner.`);
            return res.status(403).json({ error: 'Only the team owner can change member roles.' });
        }

        // Find the membership record to update using its own ID
        const membershipToUpdate = await TeamMember.findOne({
            where: { id: memberIdToUpdate, teamId: teamId } // Find by TeamMember.id and teamId
        });

        if (!membershipToUpdate) {
            console.log(`[Team Member Role Update] Member record not found: ID ${memberIdToUpdate} in Team ${teamId}.`);
            return res.status(404).json({ error: 'Team member record not found' });
        }

        // Prevent changing the owner's role
        if (membershipToUpdate.role === 'owner') {
            console.log(`[Team Member Role Update] Cannot change owner's role: Member Record ID ${memberIdToUpdate}.`);
            return res.status(400).json({ error: "Cannot change the team owner's role." });
        }

        // Prevent changing role to 'owner'
        if (newRole === 'owner') {
             return res.status(400).json({ error: "Cannot assign 'owner' role. Ownership transfer needs a dedicated process." });
        }

        // Perform the update
        const previousRole = membershipToUpdate.role;
        await membershipToUpdate.update({ role: newRole });

        // Log the activity
        await logActivity('update_team_member_role', updaterUserId, null, {
            teamId: teamId,
            targetUserId: membershipToUpdate.userId,
            targetMemberRecordId: memberIdToUpdate,
            previousRole: previousRole,
            newRole: newRole
        });

        console.log(`[Team Member Role Update] Success: Member Record ${memberIdToUpdate} role changed to ${newRole} in Team ${teamId}.`);
        // Return the updated member info or just success
        res.json({ message: 'Member role updated successfully', updatedRole: newRole });

    } catch (error) {
        console.error('Update team member role error:', error);
        res.status(500).json({ error: 'Failed to update team member role' });
    }
});
// --- End New Route ---

// GET /api/teams/:id/settings - Get team settings
router.get('/:id/settings', verifyToken, async (req, res) => {
    try {
        const teamId = req.params.id;
        
        // Verify user is a member of this team
        const membership = await TeamMember.findOne({
            where: {
                teamId: teamId,
                userId: req.user.id,
                status: 'active'
            }
        });
        
        if (!membership) {
            return res.status(403).json({error: 'You do not have access to this team'});
        }
        
        // Get team settings - adjust model as needed
        const teamSettings = await TeamSettings.findOne({
            where: { teamId: teamId }
        });
        
        // If no settings exist yet, return defaults
        if (!teamSettings) {
            return res.json({
                memberPermissions: {
                    canInviteMembers: false,
                    canUploadFiles: true,
                    canDeleteFiles: false
                },
                securitySettings: {
                    enforceFileEncryption: true,
                    require2FAForSensitiveOperations: false
                }
            });
        }
        
        res.json(teamSettings);
    } catch (error) {
        console.error('Get team settings error:', error);
        res.status(500).json({error: 'Failed to get team settings'});
    }
});

// PUT /api/teams/:id/settings - Update team settings
router.put('/:id/settings', verifyToken, require2FA, async (req, res) => {
    try {
        const teamId = req.params.id;
        const { memberPermissions, securitySettings } = req.body;
        
        // Verify user is owner or admin
        const membership = await TeamMember.findOne({
            where: {
                teamId: teamId,
                userId: req.user.id,
                status: 'active',
                role: {
                    [Op.in]: ['owner', 'admin']
                }
            }
        });
        
        if (!membership) {
            return res.status(403).json({error: 'You do not have permission to update team settings'});
        }
        
        // Update or create team settings
        const [teamSettings, created] = await TeamSettings.findOrCreate({
            where: { teamId: teamId },
            defaults: {
                teamId: teamId,
                memberPermissions,
                securitySettings
            }
        });
        
        if (!created) {
            await teamSettings.update({
                memberPermissions,
                securitySettings
            });
        }
        
        // Log the settings update
        await logActivity('update_team_settings', req.user.id, null, {
            teamId: teamId
        });
        
        res.json(teamSettings);
    } catch (error) {
        console.error('Update team settings error:', error);
        res.status(500).json({error: 'Failed to update team settings'});
    }
});

// DELETE /api/teams/:id - Delete a team
router.delete('/:id', verifyToken, require2FA, async (req, res) => {
    try {
        const teamId = req.params.id;
        
        // Verify user is the team owner
        const team = await Team.findByPk(teamId);
        
        if (!team) {
            return res.status(404).json({error: 'Team not found'});
        }
        
        if (team.ownerId !== req.user.id) {
            return res.status(403).json({error: 'Only the team owner can delete the team'});
        }
        
        // Delete team files
        const teamFiles = await File.findAll({
            where: { 
                teamId: teamId,
                isDeleted: false
            }
        });
        
        // Mark all files as deleted or physically delete them
        for (const file of teamFiles) {
            await file.update({ isDeleted: true });
            
            // Log file deletion
            await logActivity('delete_team_file', req.user.id, file.id, {
                teamId: teamId,
                reason: 'team_deletion'
            });
        }
        
        // Delete team members
        await TeamMember.destroy({
            where: { teamId: teamId }
        });
        
        // Delete team settings if they exist
        await TeamSettings.destroy({
            where: { teamId: teamId }
        });
        
        // Finally delete the team
        await team.destroy();
        
        // Log the team deletion
        await logActivity('delete_team', req.user.id, null, {
            teamId: teamId,
            teamName: team.name
        });
        
        res.json({ message: 'Team deleted successfully' });
    } catch (error) {
        console.error('Delete team error:', error);
        res.status(500).json({error: 'Failed to delete team'});
    }
});

module.exports = router;