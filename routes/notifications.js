const router = require('express').Router();
const verifyToken = require('./verifyToken');
const TeamMember = require('../models/TeamMember');
const Team = require('../models/Team');
const {Op} = require('sequelize');

// GET /api/notifications/invitations - Get team invitations for current user
router.get('/invitations', verifyToken, async (req, res) => {
    try {
        
        const User = require('../models/User');
        const user = await User.findByPk(req.user.id, {
            attributes: ['email']
        });
        
        if (!user) {
            return res.status(404).json({error: 'User not found'});
        }
        
        const pendingInvitations = await TeamMember.findAll({
            where: {
                [Op.or]: [
                    {
                        userId: req.user.id,
                        status: 'invited'
                    },
                    {
                        email: user.email,
                        status: 'invited'
                    }
                ]
            },
            include: [{
                model: Team,
                attributes: ['id', 'name', 'description', 'avatar']
            }]
        });
        
        const formattedInvitations = pendingInvitations.map(invitation => ({
            id: invitation.id,
            teamId: invitation.teamId,
            teamName: invitation.Team.name,
            teamDescription: invitation.Team.description,
            teamAvatar: invitation.Team.avatar,
            role: invitation.role,
            invitedAt: invitation.createdAt
        }));
        
        res.json(formattedInvitations);
    } catch (error) {
        console.error('Failed to get invitations:', error);
        res.status(500).json({error: 'Failed to load invitations'});
    }
});

// POST /api/notifications/invitations/:id/accept - Accept a team invitation
router.post('/invitations/:id/accept', verifyToken, async (req, res) => {
    try {
        const invitationId = req.params.id;
        
        // Fetch user's email first
        const User = require('../models/User');
        const user = await User.findByPk(req.user.id, {
            attributes: ['email']
        });
        
        if (!user) {
            return res.status(404).json({error: 'User not found'});
        }
        
        // Find the invitation
        const invitation = await TeamMember.findOne({
            where: {
                id: invitationId,
                [Op.or]: [
                    { userId: req.user.id },
                    { email: user.email }
                ],
                status: 'invited'
            }
        });
        
        if (!invitation) {
            return res.status(404).json({error: 'Invitation not found'});
        }
        
        // Update the invitation status to active
        await invitation.update({
            status: 'active',
            userId: req.user.id // Ensure user ID is set (for email invites)
        });
        
        res.json({message: 'Invitation accepted successfully'});
    } catch (error) {
        console.error('Failed to accept invitation:', error);
        res.status(500).json({error: 'Failed to accept invitation'});
    }
});

// POST /api/notifications/invitations/:id/decline - Decline a team invitation
router.post('/invitations/:id/decline', verifyToken, async (req, res) => {
    try {
        const invitationId = req.params.id;
        
        // Fetch user's email first
        const User = require('../models/User');
        const user = await User.findByPk(req.user.id, {
            attributes: ['email']
        });
        
        if (!user) {
            return res.status(404).json({error: 'User not found'});
        }
        
        // Find the invitation
        const invitation = await TeamMember.findOne({
            where: {
                id: invitationId,
                [Op.or]: [
                    { userId: req.user.id },
                    { email: user.email }
                ],
                status: 'invited'
            }
        });
        
        if (!invitation) {
            return res.status(404).json({error: 'Invitation not found'});
        }
        
        // Delete the invitation
        await invitation.destroy();
        
        res.json({message: 'Invitation declined successfully'});
    } catch (error) {
        console.error('Failed to decline invitation:', error);
        res.status(500).json({error: 'Failed to decline invitation'});
    }
});

module.exports = router;