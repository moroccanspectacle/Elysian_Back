const router = require('express').Router();
const FileShare = require('../models/FileShare');
const File = require('../models/File');
const fs = require('fs');
const path = require('path');
const { decryptFile } = require('../config/encryption');
const { logActivity } = require('../services/logger');

// Get file info for a shared link
router.get('/:shareToken', async (req, res) => {
  try {
    const shareToken = req.params.shareToken;
    console.log('Looking up share with token:', shareToken);
    
    // First find the share without the File inclusion
    const share = await FileShare.findOne({
      where: {
        shareToken: shareToken,
        isActive: true
      }
    });
    
    if (!share) {
      console.log(`Share not found for token: ${shareToken}`);
      return res.status(404).json({ error: 'Share not found - token may be invalid' });
    }
    
    console.log(`Found share: ${share.id}, fileId: ${share.fileId}`);
    
    // Then find the file separately
    const file = await File.findOne({
      where: { 
        id: share.fileId,
        isDeleted: false 
      }
    });
    
    if (!file) {
      return res.status(404).json({ error: 'The shared file has been deleted' });
    }
    
    if (share.expiresAt && new Date() > new Date(share.expiresAt)) {
      return res.status(410).json({ error: 'Share link has expired' });
    }

    await share.update({ accessCount: share.accessCount + 1 });
    await logActivity('share', share.createdById, share.fileId, 'Share link accessed', req);

    const fileInfo = {
      fileName: file.originalName,
      fileSize: file.fileSize,
      permissions: share.permissions,
      shareId: share.id,
      expiresAt: share.expiresAt
    };

    res.json(fileInfo);
  } catch (error) {
    console.error('Share access error:', error);
    res.status(500).json({ error: 'Error accessing shared file: ' + error.message });
  }
});

// Download a shared file
router.get('/:shareToken/download', async (req, res) => {
  try {
    const share = await FileShare.findOne({
      where: {
        shareToken: req.params.shareToken,
        isActive: true
      },
      include: {
        model: File,
        where: { isDeleted: false }
      }
    });

    if (!share) {
      return res.status(404).json({ error: 'Share not found' });
    }

    if (share.expiresAt && new Date() > new Date(share.expiresAt)) {
      return res.status(410).json({ error: 'Share link has expired' });
    }

    if (!share.permissions.canDownload) {
      return res.status(403).json({ error: 'Download not allowed for this share' });
    }

    const file = share.File;
    const encryptedDir = path.join(__dirname, '../uploads/encrypted');
    const encryptedFilePath = path.join(encryptedDir, file.fileName);

    const decryptedDir = path.join(__dirname, '../uploads/shared');
    if (!fs.existsSync(decryptedDir)) {
      fs.mkdirSync(decryptedDir, { recursive: true });
    }

    const decryptedFilePath = path.join(decryptedDir, `shared_${file.originalName}`);
    await decryptFile(encryptedFilePath, decryptedFilePath);

    await logActivity('download', share.createdById, share.fileId, 'Downloaded via share link', req);
    await share.update({ accessCount: share.accessCount + 1 });

    res.download(decryptedFilePath, file.originalName, (err) => {
      if (err) {
        console.error('Download error:', err);
        return res.status(500).json({ error: 'Error downloading file' });
      }

      fs.unlink(decryptedFilePath, (unlinkErr) => {
        if (unlinkErr) console.error('Error deleting decrypted file:', unlinkErr);
      });
    });
  } catch (error) {
    console.error('Share download error:', error);
    res.status(500).json({ error: 'Error downloading shared file' });
  }
});

router.get('/:shareToken/view', async (req, res) => {
    console.log("View endpoint hit with token:", req.params.shareToken);
    try {
        const share = await FileShare.findOne({
            where: {
                shareToken: req.params.shareToken,
                isActive: true
            },
            include: {
                model: File,
                where: { isDeleted: false }
            }
        });

        if (!share) {
            return res.status(404).json({ error: 'Share not found' });
        }

        if (share.expiresAt && new Date() > new Date(share.expiresAt)) {
            return res.status(410).json({ error: 'Share link has expired' });
        }

        // View permission is implied by canView
        if (!share.permissions.canView) {
            return res.status(403).json({ error: 'View not allowed for this share' });
        }

        const file = share.File;
        // Add this line to define encryptedDir
        const encryptedDir = path.join(__dirname, '../uploads/encrypted');
        const encryptedFilePath = path.join(encryptedDir, file.fileName);

        // Create temp directory for viewing
        const viewDir = path.join(__dirname, '../uploads/view');
        if (!fs.existsSync(viewDir)) {
            fs.mkdirSync(viewDir, {recursive: true});
        }
        
        // Use a unique name to avoid conflicts
        const decryptedFilePath = path.join(viewDir, `share_view_${Date.now()}_${file.originalName}`);
        await decryptFile(encryptedFilePath, decryptedFilePath);

        await logActivity('view', share.createdById, share.fileId, 'Viewed via share link', req);
        await share.update({ accessCount: share.accessCount + 1 });
        
        // Set appropriate headers for the file type
        const fileType = path.extname(file.originalName).toLowerCase();
        if (fileType === '.pdf') {
            res.setHeader('Content-Type', 'application/pdf');
        } else if (['.jpg', '.jpeg', '.png', '.gif'].includes(fileType)) {
            res.setHeader('Content-Type', `image/${fileType.substring(1)}`);
        } else if (['.doc', '.docx'].includes(fileType)) {
            res.setHeader('Content-Type', 'application/msword');
        }
        
        res.setHeader('Content-Disposition', `inline; filename="${file.originalName}"`);
        
        // Send file and clean up afterward
        res.sendFile(decryptedFilePath, {}, (err) => {
            if (err) {
                console.error('File view error: ', err);
            }
            
            // Delete after a short delay to ensure file is fully sent
            setTimeout(() => {
                fs.unlink(decryptedFilePath, (unlinkErr) => {
                    if (unlinkErr) console.error('Error deleting viewed file: ', unlinkErr);
                });
            }, 1000);
        });
    } catch (error) {
        console.error('Share view error:', error);
        res.status(500).json({ error: 'Error viewing shared file' });
    }
});

module.exports = router;