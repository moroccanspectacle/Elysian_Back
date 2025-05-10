const router = require('express').Router();
const {v4: uuidv4} = require('uuid');
const crypto = require('crypto');
const File = require('../models/File');
const FileShare = require('../models/FileShare');
const User = require('../models/User'); // <<< ADD THIS LINE
const verifyToken = require('./verifyToken');
const {logActivity} = require('../services/logger');
const path = require('path');
const fs = require('fs');
const {decryptFile} = require('../config/encryption');
// const { permission } = require('process'); // This line seems unused, consider removing if not needed
// const { create } = require('domain'); // This line seems unused, consider removing if not needed);
const { downloadFromSpaces } = require('../services/spaces');
const { Op } = require('sequelize'); // <<< ADD THIS LINE

const projectRoot = process.cwd();
const encryptedDir = path.resolve(projectRoot, 'uploads/encrypted');
const sharedTempDir = path.resolve(projectRoot, 'uploads/shared_temp');

if (!fs.existsSync(sharedTempDir)) {
    fs.mkdirSync(sharedTempDir, { recursive: true });
}
if (!fs.existsSync(encryptedDir)) { // Ensure encryptedDir also exists for downloads
    fs.mkdirSync(encryptedDir, { recursive: true });
}

// List user's shares - MOVED TO TOP
router.get('/myshares', verifyToken, async(req, res) => {
  try {
    const userId = req.user.id;
    console.log("Getting shares for user ID:", userId);
    
    const shares = await FileShare.findAll({
      where: {
        createdById: userId
      },
      include: [{
        model: File, 
        attributes: ['id', 'originalName']
      }],
      order: [['createdAt', 'DESC']]
    });
    
    console.log(`Found ${shares.length} shares`);
    
    const formattedShares = shares.map(share => ({
      id: share.id,
      shareToken: share.shareToken, 
      fileId: share.fileId,
      fileName: share.File ? share.File.originalName : 'Unknown File',
      isActive: share.isActive,
      expiresAt: share.expiresAt,
      permissions: share.permissions,
      accessCount: share.accessCount,
      createdAt: share.createdAt,
      isPrivateShare: share.isPrivateShare, // <<< ADD THIS LINE
      recipientUserIds: share.recipientUserIds // <<< ADD THIS LINE (optional, but good for frontend debugging/display)
    }));

    res.json(formattedShares);
  } catch (error) {
    console.error('Error fetching shares:', error);
    res.status(500).json({error: 'Error fetching shares'});
  }
});

// Debug route - should also be early
router.get('/debug/:token', verifyToken, async (req, res) => {
  try {
    const share = await FileShare.findOne({
      where: { shareToken: req.params.token }
    });
    
    res.json({ 
      exists: !!share,
      share: share ? {
        id: share.id,
        isActive: share.isActive,
        fileId: share.fileId,
        expiresAt: share.expiresAt,
      } : null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// File shares route - should be before param routes
router.get('/file/:fileId', verifyToken, async (req, res) => {
  try {
    // Check if user owns the file
    const file = await File.findOne({
      where: {
        id: req.params.fileId,
        userId: req.user.id
      }
    });

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Get all shares for this file
    const shares = await FileShare.findAll({
      where: {
        fileId: req.params.fileId
      },
      attributes: [
        'id', 
        'shareToken', 
        'expiresAt', 
        'permissions', 
        'recipientEmail', 
        'isActive', 
        'accessCount',
        'createdAt'
      ]
    });

    res.json(shares);
  } catch (error) {
    console.error('File shares error:', error);
    res.status(500).json({ error: 'Error getting file shares' });
  }
});

// Fix the route to /share instead of /create
router.post('/share', verifyToken, async (req, res) => {
  try {
    const { fileId, permissions, expirationDays, recipientEmail, recipientUserEmails, recipientUserIds: directRecipientUserIds } = req.body;

    const file = await File.findOne({
      where: {
        id: fileId,
        userId: req.user.id, // Or team access check if applicable for creating shares
        isDeleted: false
      }
    });

    if (!file) {
      return res.status(404).json({ error: 'File not found or access denied' });
    }

    const shareToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = expirationDays
      ? new Date(Date.now() + expirationDays * 24 * 60 * 60 * 1000)
      : null;

    let finalRecipientUserIds = null;
    let isPrivate = false;

    if (directRecipientUserIds && Array.isArray(directRecipientUserIds) && directRecipientUserIds.length > 0) {
        if (directRecipientUserIds.every(id => typeof id === 'number' && Number.isInteger(id))) {
            finalRecipientUserIds = [...new Set(directRecipientUserIds)];
            isPrivate = true;
        } else {
            console.warn('[Share Create] Invalid directRecipientUserIds provided, not all are integers.');
        }
    } else if (recipientUserEmails && Array.isArray(recipientUserEmails) && recipientUserEmails.length > 0) {
        const validEmails = recipientUserEmails.filter(email => typeof email === 'string');
        if (validEmails.length > 0) {
            const foundUsers = await User.findAll({
                where: {
                    email: { [Op.in]: validEmails }
                },
                attributes: ['id']
            });
            if (foundUsers.length > 0) {
                finalRecipientUserIds = [...new Set(foundUsers.map(u => u.id))];
                isPrivate = true;
            }
        }
    }

    const shareRecord = await FileShare.create({
      shareToken,
      fileId: fileId,
      expiresAt: expiresAt,
      permissions: permissions || { canView: true, canDownload: false },
      recipientEmail: recipientEmail || null,
      isActive: true,
      createdById: req.user.id,
      isPrivateShare: isPrivate,
      recipientUserIds: finalRecipientUserIds
    });

    await logActivity('create_share', req.user.id, fileId, `Created ${isPrivate ? 'private' : 'public'} share link for token ${shareToken}`, req);

    // TODO: Implement notifications for recipientUserIds if isPrivate is true

    res.status(201).json({
      id: shareRecord.id,
      shareToken: shareRecord.shareToken,
      shareUrl: `${process.env.FRONTEND_URL || req.protocol + '://' + req.get('host')}/share/${shareToken}`,
      expiresAt: shareRecord.expiresAt,
      isPrivateShare: shareRecord.isPrivateShare,
      recipientUserIds: shareRecord.recipientUserIds // For frontend confirmation
    });
  } catch (error) {
    console.error('Error creating share:', error);
    res.status(500).json({ error: 'Failed to create share link' });
  }
});

router.get('/details/:shareId', verifyToken,  async (req, res) => {
    try {
        const share = await FileShare.findOne({
            where: {
                id: req.params.shareId
            },
            include:{
                model: File, 
                where: {userId: req.user.id}, 
                attributes: ['id', 'originalName', 'fileSize', 'uploadedDate']
            }
        });
        if (!share) {
            return res.status(404).json({error: 'Share not found'});
        }
        res.json(share);
    } catch (error) {
        console.error('Share details error: ', error);
        res.status(500).json({error: 'Error getting share details'});
    }
});

router.put('/:shareId', verifyToken, async (req, res) => {
    try {
        const {permissions, expirationDays, isActive} = req.body;
        const share = await FileShare.findOne({
            where: {
                id: req.params.shareId
            },
            include: {
                model: File, 
                where: {userId: req.user.id}
          }
        });
        if (!share) {
            return res.status(404).json({error: 'Share not found'});
        }
        const updates = {};
        if (permissions) {
            updates.permissions = permissions;
        }
        if (expirationDays !== undefined) {
            updates.expiresAt = expirationDays ? new Date(Date.now() + expirationDays * 24 * 60 * 60 * 1000) : null;
        }
        if (isActive !== undefined) {
            updates.isActive = isActive;
        }
        await share.update(updates);

        res.json({
            id: share.id,
            shareToken: share.shareToken,
            expiresAt: share.expiresAt,
            permissions: share.permissions, 
            isActive: share.isActive
        });
    } catch (error) {
        console.error('Share update error: ', error);
        res.status(500).json({error: 'Error updating share'});
    }
});

router.delete('/:shareId', verifyToken, async (req, res) => {
    try {
        const share = await FileShare.findOne({
            where: {
                id: req.params.shareId
            }, 
            include: {
                model: File, 
                where: {userId: req.user.id}
            }
        });

        if (!share) {
            return res.status(404).json({error: 'Share not found'});
        }
        await share.destroy();
        res.json({message: 'Share deleted'});
    } catch (error) {
        console.error('Share delete error: ', error);
        res.status(500).json({error: 'Error deleting share'});
    }
});

router.get('/:shareToken', async (req, res)=> {
    try {
        const share = await FileShare.findOne({
            where: {
                shareToken: req.params.shareToken,
                isActive: true
            },
            include: {
                model: File, 
                where: {isDeleted: false}
            }
        });

        if (!share) {
            return res.status(404).json({error: 'Share not found'});
        }

        if (share.expiresAt && share.expiresAt < new Date(share.expiresAt)) {
            return res.status(404).json({error: 'Share expired'});
        }

        await share.update({accessCount: share.accessCount + 1});
        await logActivity('share', share.createdById, share.fileId, 'Share link accessed', req);

        const fileInfo = {
            fileName: share.File.originalName,
            fileSize: share.File.fileSize,
            permissions: share.permissions,
            shareId: share.id
        };

        res.json(fileInfo);

    } catch (error) {
        console.error('Share access error: ', error);
        res.status(500).json({error: 'Error accessing share'});
    }
});

router.get('/:shareToken/download', async (req, res) => {
    try {
        const share = await FileShare.findOne({
            where: {
                shareToken: req.params.shareToken,
                isActive: true
            },
            include: {
            model: File, 
            where: {isDeleted: false}
            }
        });
        if (!share) {
            return res.status(404).json({error: 'Share not found'});
        }
        if (share.expiresAt && new Date() > new Date(share.expiresAt)) {
            return res.status(404).json({error: 'Share expired'});
        }
        if (!share.permissions.canDownload) {
            return res.status(403).json({error: 'Download not allowed'});
        }

        const file = share.File;
        const encryptedDir = path.join(__dirname, '../uploads/encrypted');
        const encryptedFilePath = path.join(encryptedDir, file.fileName);

        const decryptedDir = path.join(__dirname, '../uploads/shared');

        if (!fs.existsSync(decryptedDir)) {
            fs.mkdirSync(decryptedDir, {recursive: true});
        }

        const decryptedFilePath = path.join(decryptedDir, `shared_${file.originalName}`);
        await decryptFile(encryptedFilePath, decryptedFilePath);

        await logActivity('download', share.createdById, share.fileId, 'Downloaded via share link', req);

        await share.update({accessCount: share.accessCount + 1});

        res.download(decryptedFilePath, file.originalName, (err) => {
            if (err) {
                console.error('Download error: ', err);
                res.status(500).json({error: 'Error downloading file'});
            }

            fs.unlink(decryptedFilePath, (unlinkErr) => {
                if (unlinkErr) {
                    console.error('Error deleting decrypted file: ', err);
                }
            });
        });
    } catch (error) {
        console.error('Download error: ', error);
        res.status(500).json({error: 'Error downloading file'});
    }
});

router.put('/:shareId/status', verifyToken, async (req, res) => {
  try {
    const {shareId} = req.params;
    const {isActive} = req.body;
    const userId = req.user.id;

    const share = await FileShare.findOne({
      where: {
        id: shareId, 
        createdById: userId
      }
    });

    if(!share)
    {
      return res.status(404).json({error: 'Share not found'});
    }

    await share.update({isActive});

    await logActivity(
      isActive ? 'enable_share' : 'disable_share',
      userId,
      share.fileId, 
      `${isActive ? 'Enabled' : 'Disabled'} share link`,
      req
    );

    res.json({success: true, isActive});
  } catch (error) {
    console.error('Error updating share status: ', error);
    res.status  (500).json({error: 'Error updating share status'});
  }
});

// Authenticated view for private shares
router.get('/private/:shareToken/view', verifyToken, async (req, res) => {
    try {
        const shareToken = req.params.shareToken;
        const currentUserId = req.user.id;

        const share = await FileShare.findOne({
            where: { shareToken: shareToken, isActive: true },
            include: { model: File, where: { isDeleted: false } }
        });

        if (!share) return res.status(404).json({ error: 'Share not found or is inactive.' });
        if (share.expiresAt && new Date() > new Date(share.expiresAt)) return res.status(410).json({ error: 'Share link has expired.' });
        
        if (!share.isPrivateShare) { // Should ideally not be hit if frontend routes correctly
             console.warn(`[Private Share View] Attempt to access non-private share ${shareToken} via private route by user ${currentUserId}`);
             return res.status(403).json({ error: 'This link is not for private user-specific sharing.' });
        }
        if (!share.recipientUserIds || !share.recipientUserIds.includes(currentUserId)) {
            return res.status(403).json({ error: 'You are not authorized to view this shared file.' });
        }
        if (!share.permissions.canView) return res.status(403).json({ error: 'View not allowed for this share.' });

        const file = share.File;
        const localEncryptedFilePath = path.join(encryptedDir, file.fileName);

        if (file.storageLocation === 'spaces' && file.spacesKey && !fs.existsSync(localEncryptedFilePath)) {
            console.log(`[Private Share View] File ${file.fileName} in Spaces. Downloading to ${localEncryptedFilePath}`);
            await downloadFromSpaces(file.spacesKey, localEncryptedFilePath);
        }

        if (!fs.existsSync(localEncryptedFilePath)) {
            console.error(`[Private Share View] Encrypted file not found: ${localEncryptedFilePath}`);
            return res.status(404).json({ error: 'Shared file content not found.' });
        }

        const decryptedFilePath = path.join(sharedTempDir, `priv_view_${Date.now()}_${file.originalName}`);
        await decryptFile(localEncryptedFilePath, decryptedFilePath);

        await share.increment('accessCount');
        await logActivity('private_share_view', currentUserId, file.id, `Viewed private share: ${share.id} (Token: ${shareToken})`, req);

        const fileMimeType = file.fileType || 'application/octet-stream';
        res.setHeader('Content-Type', fileMimeType);
        res.setHeader('Content-Disposition', `inline; filename="${file.originalName}"`);
        
        res.sendFile(decryptedFilePath, {}, (err) => {
            if (err) console.error('[Private Share View] Error sending file:', err);
            fs.unlink(decryptedFilePath, (unlinkErr) => {
                if (unlinkErr) console.error('[Private Share View] Error deleting temp viewed file:', unlinkErr);
            });
        });

    } catch (error) {
        console.error('[Private Share View] Error:', error);
        res.status(500).json({ error: 'Error viewing shared file.' });
    }
});

// Authenticated download for private shares
router.get('/private/:shareToken/download', verifyToken, async (req, res) => {
    try {
        const shareToken = req.params.shareToken;
        const currentUserId = req.user.id;

        const share = await FileShare.findOne({
            where: { shareToken: shareToken, isActive: true },
            include: { model: File, where: { isDeleted: false } }
        });

        if (!share) return res.status(404).json({ error: 'Share not found or is inactive.' });
        if (share.expiresAt && new Date() > new Date(share.expiresAt)) return res.status(410).json({ error: 'Share link has expired.' });

        if (!share.isPrivateShare) {
             console.warn(`[Private Share Download] Attempt to access non-private share ${shareToken} via private route by user ${currentUserId}`);
            return res.status(403).json({ error: 'This link is not for private user-specific sharing.' });
        }
        if (!share.recipientUserIds || !share.recipientUserIds.includes(currentUserId)) {
            return res.status(403).json({ error: 'You are not authorized to download this shared file.' });
        }
        if (!share.permissions.canDownload) return res.status(403).json({ error: 'Download not allowed for this share.' });

        const file = share.File;
        const localEncryptedFilePath = path.join(encryptedDir, file.fileName);

        if (file.storageLocation === 'spaces' && file.spacesKey && !fs.existsSync(localEncryptedFilePath)) {
            console.log(`[Private Share Download] File ${file.fileName} in Spaces. Downloading to ${localEncryptedFilePath}`);
            await downloadFromSpaces(file.spacesKey, localEncryptedFilePath);
        }

        if (!fs.existsSync(localEncryptedFilePath)) {
            console.error(`[Private Share Download] Encrypted file not found: ${localEncryptedFilePath}`);
            return res.status(404).json({ error: 'Shared file content not found.' });
        }

        const decryptedFilePath = path.join(sharedTempDir, `priv_dl_${Date.now()}_${file.originalName}`);
        await decryptFile(localEncryptedFilePath, decryptedFilePath);

        await share.increment('accessCount');
        await logActivity('private_share_download', currentUserId, file.id, `Downloaded private share: ${share.id} (Token: ${shareToken})`, req);
        
        res.download(decryptedFilePath, file.originalName, (err) => {
            if (err) console.error('[Private Share Download] Error during res.download:', err);
            fs.unlink(decryptedFilePath, (unlinkErr) => {
                if (unlinkErr) console.error('[Private Share Download] Error deleting temp downloaded file:', unlinkErr);
            });
        });

    } catch (error) {
        console.error('[Private Share Download] Error:', error);
        res.status(500).json({ error: 'Error downloading shared file.' });
    }
});

module.exports = router;