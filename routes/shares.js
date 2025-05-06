const router = require('express').Router();
const {v4: uuidv4} = require('uuid');
const crypto = require('crypto');
const File = require('../models/File');
const FileShare = require('../models/FileShare');
const verifyToken = require('./verifyToken');
const {logActivity} = require('../services/logger');
const path = require('path');
const fs = require('fs');
const {decryptFile} = require('../config/encryption');
const { permission } = require('process');
const { create } = require('domain');

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
      createdAt: share.createdAt
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
    const { fileId, permissions, expirationDays, recipientEmail } = req.body;

    // Validate fileId exists and belongs to user
    const file = await File.findOne({
      where: {
        id: fileId,
        userId: req.user.id,
        isDeleted: false
      }
    });

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Generate a secure random token
    const shareToken = crypto.randomBytes(32).toString('hex');

    // Calculate expiration date if provided
    const expiresAt = expirationDays
      ? new Date(Date.now() + expirationDays * 24 * 60 * 60 * 1000)
      : null;

    // Create share record with explicit fileId
    const shareRecord = await FileShare.create({
      shareToken,
      fileId: fileId,  // EXPLICITLY set the fileId
      expiresAt: expiresAt,
      permissions: permissions || { canView: true, canDownload: false },
      recipientEmail: recipientEmail || null,
      isActive: true,
      createdById: req.user.id  // Make sure to set the creator
    });

    // Log activity
    await logActivity('create_share', req.user.id, fileId, 'Created share link', req);

    res.status(201).json({
      id: shareRecord.id,
      shareToken: shareRecord.shareToken,
      shareUrl: `${req.protocol}://${req.get('host')}/share/${shareToken}`,
      expiresAt: shareRecord.expiresAt
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

module.exports = router;