const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const verifyToken = require('./verifyToken');
const { encryptFile, decryptFile } = require('../config/encryption');
const File = require('../models/File');
const VaultFile = require('../models/vaultFile'); // Keep this import
const TeamMember = require('../models/TeamMember');
const Team = require('../models/Team');
const TeamSettings = require('../models/TeamSettings');
const SystemSettings = require('../models/SystemSettings');
const { generateFileHash, verifyFileIntegrity } = require('../config/fileIntegrity');
const { logActivity } = require('../services/logger');
const { Op, literal } = require('sequelize'); // <-- Import Op and literal

const uploadDir = path.join(__dirname, '../uploads/temp');
const encryptedDir = path.join(__dirname, '../uploads/encrypted');

console.log("Upload directory:", uploadDir);
console.log("Encrypted directory:", encryptedDir);

// Check and fix directory permissions
[uploadDir, encryptedDir].forEach(dir => {
  try {
    if (!fs.existsSync(dir)) {
      console.log(`Creating directory: ${dir}`);
      fs.mkdirSync(dir, { recursive: true });
    }
    // Test write permissions
    const testFile = path.join(dir, '.permission-test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    console.log(`Directory ${dir} is writable`);
  } catch (err) {
    console.error(`Directory permission error for ${dir}:`, err);
  }
});

if (!fs.existsSync(uploadDir))
{
    fs.mkdirSync(uploadDir, {recursive: true});
}

if (!fs.existsSync(encryptedDir))
{
    fs.mkdirSync(encryptedDir, {recursive: true});
}

const storage = multer.diskStorage({
    destination: function(req, file, cb)
    {
        cb(null, uploadDir);
    },
    filename: function(req, file, cb)
    {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const initializeMulter = async () => {
  // Get system settings for max file size
  let maxFileSize = 50 * 1024 * 1024; // Default 50MB
  
  try {
    const systemSettings = await SystemSettings.findOne({ where: { id: 1 } });
    if (systemSettings && systemSettings.maxFileSize) {
      maxFileSize = systemSettings.maxFileSize * 1024 * 1024; // Convert MB to bytes
    }
  } catch (error) {
    console.error('Failed to fetch max file size from settings:', error);
  }
  
  return multer({
    storage: storage,
    limits: {
      fileSize: maxFileSize
    }
  });
};

// Add this new route at the top of your routes
router.get('/settings', async (req, res) => {
  try {
    // Get only public-facing settings
    const systemSettings = await SystemSettings.findOne({ where: { id: 1 } });
    
    // Return only the settings regular users need to know
    res.json({
      maxFileSize: systemSettings?.maxFileSize || 100, // Default to 100MB
      fileExpiration: systemSettings?.fileExpiration || true
    });
  } catch (error) {
    console.error('Public settings fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

router.post('/upload', verifyToken, async (req, res, next) => {
  const upload = await initializeMulter();
  
  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ 
          error: 'File size exceeds the maximum allowed limit' 
        });
      }
      return res.status(400).json({ error: err.message });
    }
    
    // Rest of your upload handling code
    try {
        if (!req.file) {
            return res.status(400).send('No file uploaded');
        }
        
        const {originalname, mimetype, size, filename, path: tempPath } = req.file;
        console.log("Request body:", req.body);
        console.log(`Processing upload: ${originalname}, size: ${size}, user: ${req.user.id}`);
        
        // Check file size against system settings
        const systemSettings = await SystemSettings.findOne({ where: { id: 1 } });
        const maxFileSize = (systemSettings?.maxFileSize || 100) * 1024 * 1024; // Convert MB to bytes
        
        if (req.file.size > maxFileSize) {
            return res.status(400).json({ 
                error: `File exceeds the maximum allowed size of ${systemSettings?.maxFileSize || 100}MB` 
            });
        }
        
        // Check for team upload
        const teamId = req.body.teamId;
        let isTeamUpload = false;
        
        if (teamId) {
            console.log("This is a team upload for team:", teamId);
            
            // Verify user is a member of this team
            const membership = await TeamMember.findOne({
                where: {
                    teamId: teamId,
                    userId: req.user.id,
                    status: 'active'
                }
            });
            
            if (!membership) {
                return res.status(403).json({ error: 'Not a member of this team' });
            }
            
            // Check if user has permission to upload files
            if (membership.role !== 'owner' && membership.role !== 'admin') {
                // Check team settings for upload permissions
                const teamSettings = await TeamSettings.findOne({
                    where: { teamId: teamId }
                });
                
                if (teamSettings && !teamSettings.memberPermissions.canUploadFiles) {
                    return res.status(403).json({ error: 'You do not have permission to upload files to this team' });
                }
            }
            
            // Check team storage quota
            const team = await Team.findByPk(teamId);

            // Add detailed logging
            console.log("Team storage diagnostics:", {
                teamName: team.name,
                currentUsage: team.currentUsage,
                currentUsageType: typeof team.currentUsage,
                currentUsageMB: Math.round(Number(team.currentUsage) / (1024 * 1024) * 100) / 100,
                fileSize: size,
                fileSizeType: typeof size,
                fileSizeMB: Math.round(size / (1024 * 1024) * 100) / 100,
                storageQuota: team.storageQuota,
                storageQuotaType: typeof team.storageQuota,
                storageQuotaGB: Math.round(Number(team.storageQuota) / (1024 * 1024 * 1024) * 100) / 100,
                calculatedNewUsage: Number(team.currentUsage) + Number(size)
            });

            // Fix the comparison by explicitly converting values to Numbers
            const currentUsage = Number(team.currentUsage);
            const quotaLimit = Number(team.storageQuota);
            const fileSize = Number(size);

            if (isNaN(currentUsage) || isNaN(quotaLimit) || isNaN(fileSize)) {
                console.error("Invalid storage value detected:", {
                    currentUsage: team.currentUsage,
                    quotaLimit: team.storageQuota,
                    fileSize: size
                });
                return res.status(500).json({ error: 'Storage calculation error' });
            }

            if (currentUsage + fileSize > quotaLimit) {
                console.log(`Team quota exceeded: ${currentUsage + fileSize} > ${quotaLimit}`);
                return res.status(400).json({ error: 'Team storage quota exceeded' });
            }

            isTeamUpload = true;

            // Update team storage usage with explicit Number conversion
            await team.update({
                currentUsage: currentUsage + fileSize
            });
        }
        
        try {
            const encryptedFileName = `${uuidv4()}${path.extname(originalname)}`;
            const encryptedPath = path.join(encryptedDir, encryptedFileName);
            
            console.log("Starting file encryption...");
            const iv = await encryptFile(tempPath, encryptedPath, encryptedFileName);
            console.log("File encrypted successfully with IV:", iv.substring(0, 10) + "...");
            
            // Generate hash AFTER encryption
            console.log("Starting file hash generation of encrypted file...");
            const fileHash = await generateFileHash(encryptedPath);
            console.log("Encrypted file hash generated successfully:", fileHash.substring(0, 10) + "...");
            
            console.log("Creating database record with user ID:", req.user.id);
            console.log("User ID type:", typeof req.user.id);
            
            // Convert userId to number if it's a string
            const userId = typeof req.user.id === 'string' ? parseInt(req.user.id, 10) : req.user.id;
            
            // Set expiration date if enabled in system settings
            let expiryDate = null;
            if (systemSettings?.fileExpiration) {
                // Default expiration after 30 days
                expiryDate = new Date();
                expiryDate.setDate(expiryDate.getDate() + 30);
            }
            
            const fileRecord = await File.create({
                originalName: originalname,
                fileName: encryptedFileName,
                fileSize: size, 
                fileType: mimetype,
                iv: iv,
                fileHash: fileHash,
                userId: userId,
                teamId: isTeamUpload ? teamId : null,
                isTeamFile: isTeamUpload,
                expiryDate: expiryDate
            });
            console.log(`File record created with ID: ${fileRecord.id}`);
            
            // Log the upload activity
            await logActivity('upload', req.user.id, fileRecord.id, null, req);
            
            // Clean up temp file
            fs.unlinkSync(tempPath);
            console.log("Temporary file cleaned up");
            
            return res.status(201).json({
                id: fileRecord.id,
                originalName: fileRecord.originalName,
                fileSize: fileRecord.fileSize, 
                uploadDate: fileRecord.uploadDate,
                fileType: fileRecord.fileType,
                fileHash: fileRecord.fileHash
            });
        } catch (processingError) {
            console.error('File processing error details:', processingError);
            console.error('Error stack:', processingError.stack);
            // Clean up temp file if it exists
            if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
            }
            return res.status(500).json({error: `File processing failed: ${processingError.message}`});
        }
    } catch (error) {
        console.error("File upload error:", error);
        console.error("Error stack:", error.stack);
        return res.status(500).json({ error: 'File upload failed' });
    }
  });
});

router.get('/download/:id', verifyToken, async (req, res)=>
{
    try {
        const fileId = req.params.id;

        const fileRecord = await File.findOne({
            where: {
                id: fileId,
                userId: req.user.id
            }
        });
        if (!fileRecord) {
            return res.status(404).send('File not found');
        }

        const encryptedFilePath = path.join(encryptedDir, fileRecord.fileName);

        const encryptedFileHash = await generateFileHash(encryptedFilePath);
        const integrityStatus = {
            verified: encryptedFileHash === fileRecord.fileHash,
            originalHash: fileRecord.fileHash,
            currentHash: encryptedFileHash
        }

        const decryptedDir = path.join(__dirname, '../uploads/decrypted');
        if (!fs.existsSync(decryptedDir))
        {
            fs.mkdirSync(decryptedDir, {recursive: true});
            
        }
        const decryptedFilePath = path.join(decryptedDir, fileRecord.originalName);
        await decryptFile(encryptedFilePath, decryptedFilePath);

        // Log the download activity before sending the file
        await logActivity('download', req.user.id, fileRecord.id, null, req);

        res.set('X-File-Integrity', integrityStatus.verified ? 'verified': 'failed');

        res.download(decryptedFilePath, fileRecord.originalName, (err) =>
            {
                if (err)
                {
                    console.error('File download error: ', err);
                    res.status(500).send('File download failed');
                }

                fs.unlink(decryptedFilePath, (unlinkErr) =>
                {
                    if (unlinkErr) console.error('Error deleting decrypted file: ', unlinkErr);
                });
            });
    } catch (error) 
    {
        console.error('File download error: ', error);
        res.status(500).json({error: 'File download failed'});    
    }
});
router.get('/view/:id', verifyToken, async (req, res)=>{

    try {
        const fileId = req.params.id;
        const fileRecord = await File.findOne({
            where: {
                id: fileId,
                userId: req.user.id,
                isDeleted: false
            }
        });

        if (!fileRecord) return res.status(404).json({error: 'File not found'});
        const encryptedFilePath = path.join(encryptedDir, fileRecord.fileName);

        const encryptedFileHash = await generateFileHash(encryptedFilePath);
        const integrityVerified = encryptedFileHash === fileRecord.fileHash;

        const viewDir = path.join(__dirname, '../uploads/view');
        if (!fs.existsSync(viewDir)) fs.mkdirSync(viewDir, {recursive: true});

        const decryptedFilePath = path.join(viewDir, `view_${Date.now()}_${fileRecord.originalName}`);
        await decryptFile(encryptedFilePath, decryptedFilePath);

        await logActivity('view', req.user.id, fileRecord.id, null, req);

        const fileType = path.extname(fileRecord.originalName).toLowerCase();
        if (fileType === '.pdf') {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        } else if (['.jpg', '.jpeg', '.png', '.gif'].includes(fileType)) {
            res.setHeader('Content-Type', `image/${fileType.substring(1)}`);
        }
        else if (['.doc', '.docx'].includes(fileType)) {
            res.setHeader('Content-Type', 'application/msword');
        }

        res.setHeader('Content-Disposition', `inline; filename="${fileRecord.originalName}"`);
        res.setHeader('X-File-Integrity', integrityVerified ? 'verified' : 'failed');

        res.sendFile(decryptedFilePath, (err) => {
            if (err) console.error('File view error: ', err);
            setTimeout(() => {
                fs.unlink(decryptedFilePath, (unlinkErr) => {
                    if (unlinkErr) console.error('Error deleting decrypted file: ', unlinkErr);
                });
            }, 1000);
        });
    } catch (error) {
        console.error('File view error: ', error);
        res.status(500).json({error: 'File view failed'});
    }
});
router.get('/list', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id; // Get user ID

        const files = await File.findAll({
            where: {
                userId: userId,
                isDeleted: false,
                isTeamFile: false,
                // Use Op.notIn with a subquery to exclude files present in VaultFile for this user
                id: {
                    [Op.notIn]: literal(`(SELECT "fileId" FROM "VaultFiles" WHERE "userId" = ${userId})`)
                }
            },
            // No include needed for VaultFile with this approach
            attributes: ['id', 'originalName', 'fileSize', 'fileType', 'uploadDate'],
            order: [['uploadDate', 'DESC']]
        });
        res.json(files);

    } catch (error) {
        console.error('File list error: ', error);
        res.status(500).json({ error: 'File list failed' });
    }
});

// Modify the delete route to check team permissions

router.delete('/:id', verifyToken, async (req, res) => {
    try {
        const fileId = req.params.id;
        const file = await File.findOne({
            where: {
                id: fileId,
                isDeleted: false
            }
        });
        
        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        // Check if this is a team file
        if (file.teamId) {
            // Check if user is a member of this team
            const membership = await TeamMember.findOne({
                where: {
                    teamId: file.teamId,
                    userId: req.user.id,
                    status: 'active'
                }
            });
            
            if (!membership) {
                return res.status(403).json({ error: 'You do not have permission to delete this file' });
            }
            
            // Admin and owner can always delete
            if (membership.role !== 'owner' && membership.role !== 'admin') {
                // Regular members need permission from settings
                const teamSettings = await TeamSettings.findOne({
                    where: { teamId: file.teamId }
                });
                
                if (teamSettings && !teamSettings.memberPermissions.canDeleteFiles) {
                    return res.status(403).json({ error: 'You do not have permission to delete files in this team' });
                }
            }
        } else {
            // For personal files, only the owner can delete
            if (file.userId !== req.user.id) {
                return res.status(403).json({ error: 'You do not have permission to delete this file' });
            }
        }
        
        // Proceed with deletion
        await file.update({ isDeleted: true });

        // --- Add this block to update team usage ---
        if (file.teamId) {
            try {
                const team = await Team.findByPk(file.teamId);
                if (team) {
                    // Use Number() to ensure values are numeric before decrementing
                    const fileSize = Number(file.fileSize);
                    if (!isNaN(fileSize)) {
                        // Use decrement for safety against race conditions
                        await team.decrement('currentUsage', { by: fileSize });
                        console.log(`[File Delete] Decremented team ${file.teamId} usage by ${fileSize}.`);
                    } else {
                        console.error(`[File Delete] Invalid file size (${file.fileSize}) for file ${fileId}. Team usage not updated.`);
                    }
                } else {
                    // This case should ideally not happen if the file record is valid
                    console.error(`[File Delete] Team ${file.teamId} not found when trying to update usage for deleted file ${fileId}.`);
                }
            } catch (teamUpdateError) {
                // Log the error but don't necessarily fail the whole delete operation
                console.error(`[File Delete] Error updating team usage for team ${file.teamId}:`, teamUpdateError);
            }
        }
        // --- End block ---

        // Log the activity
        await logActivity('delete', req.user.id, fileId, file.teamId ? { teamId: file.teamId } : null);
        
        res.json({ message: 'File deleted successfully' });
    } catch (error) {
        console.error('File delete error:', error);
        res.status(500).json({ error: 'Failed to delete file' });
    }
});

router.get('/verify/:id', verifyToken, async (req, res) =>{
    try {
        const fileId = req.params.id;
        const fileRecord = await File.findOne({
            where: {
                id: fileId,
                userId: req.user.id
            }
        });

        if (!fileRecord) {
            return res.status(404).json({error: 'File not found'});
        }

        const encryptedFilePath = path.join(encryptedDir, fileRecord.fileName);
        const currentHash = await generateFileHash(encryptedFilePath);
        const integrityVerified = currentHash === fileRecord.fileHash;

        res.json({
            fileId: fileRecord.id,
            fileName: fileRecord.originalName,
            integrityVerified: integrityVerified,
            storedHash: fileRecord.fileHash,
            currentHash
        });
    } catch (error) {
        console.error('File integrity verification error: ', error);
        res.status(500).json({error: 'File integrity verification failed'});
    }
});
module.exports = router;