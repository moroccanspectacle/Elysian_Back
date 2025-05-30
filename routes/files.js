const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const verifyToken = require('./verifyToken');
const { encryptFile, decryptFile } = require('../config/encryption');
const File = require('../models/File');
const VaultFile = require('../models/vaultFile'); 
const TeamMember = require('../models/TeamMember');
const Team = require('../models/Team');
const TeamSettings = require('../models/TeamSettings');
const SystemSettings = require('../models/SystemSettings');
const { generateFileHash, verifyFileIntegrity } = require('../config/fileIntegrity');
const { logActivity } = require('../services/logger');
const { Op, literal } = require('sequelize'); 
const {uploadToSpaces, downloadFromSpaces, deleteFromSpaces, fileExistsInSpaces} = require('../services/spaces');

// --- MODIFIED PATHS ---
const projectRoot = process.cwd(); // Should resolve to /workspace on App Platform
const uploadDir = path.resolve(projectRoot, 'uploads/temp');
const encryptedDir = path.resolve(projectRoot, 'uploads/encrypted');
const viewDirGlobal = path.resolve(projectRoot, 'uploads/view'); // For /view route
const decryptedDirGlobal = path.resolve(projectRoot, 'uploads/decrypted'); // For /download route

console.log("[File Service] __dirname:", __dirname);
console.log("[File Service] projectRoot (cwd):", projectRoot);
console.log("[File Service] Resolved uploadDir:", uploadDir);
console.log("[File Service] Resolved encryptedDir:", encryptedDir);
console.log("[File Service] Resolved viewDirGlobal:", viewDirGlobal);
console.log("[File Service] Resolved decryptedDirGlobal:", decryptedDirGlobal);

[uploadDir, encryptedDir, viewDirGlobal, decryptedDirGlobal].forEach(dir => {
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
            
            // Upload to Digital Ocean Spaces
            console.log("Uploading encrypted file to Spaces...");
            const spacesKey = `encrypted/${encryptedFileName}`;
            const uploadResult = await uploadToSpaces(encryptedPath, spacesKey);
            console.log("File uploaded to Spaces successfully:", uploadResult.Location);
            
            // Calculate expiry date if needed
            let expiryDate = null;
            if (systemSettings?.fileExpiration) {
                // Set expiry date to 30 days from now (or adjust as needed)
                expiryDate = new Date();
                expiryDate.setDate(expiryDate.getDate() + 30);
            }
            
            // Create database record
            const fileRecord = await File.create({
                originalName: originalname,
                fileName: encryptedFileName,
                fileSize: size, 
                fileType: mimetype,
                iv: iv,
                fileHash: fileHash,
                userId: req.user.id,  // FIXED: Using req.user.id instead of userId
                teamId: isTeamUpload ? teamId : null,
                isTeamFile: isTeamUpload,
                expiryDate: expiryDate,
                storageLocation: 'spaces',
                spacesKey: spacesKey
            });
            
            // Clean up local encrypted file (optional - keep for caching)
            // fs.unlinkSync(encryptedPath);
            
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

        // Check if we need to download from Spaces
        if (fileRecord.storageLocation === 'spaces' && !fs.existsSync(encryptedFilePath)) {
            console.log(`Downloading file from Spaces: ${fileRecord.spacesKey}`);
            await downloadFromSpaces(fileRecord.spacesKey, encryptedFilePath);
        }

        const encryptedFileHash = await generateFileHash(encryptedFilePath);
        const integrityStatus = {
            verified: encryptedFileHash === fileRecord.fileHash,
            originalHash: fileRecord.fileHash,
            currentHash: encryptedFileHash
        }

        const decryptedFilePath = path.join(decryptedDirGlobal, fileRecord.originalName);
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
        const currentUserId = req.user.id;

        // Step 1: Find the file by ID first
        const fileRecord = await File.findOne({
            where: {
                id: fileId,
                isDeleted: false
            }
        });

        if (!fileRecord) {
            console.log(`[File View] File record not found for id: ${fileId}`);
            return res.status(404).json({error: 'File not found'});
        }

        // Step 2: Authorization check
        if (fileRecord.isTeamFile && fileRecord.teamId) {
            // It's a team file, check if the current user is a member of that team
            const teamMembership = await TeamMember.findOne({
                where: {
                    teamId: fileRecord.teamId,
                    userId: currentUserId,
                    status: 'active' // Ensure the member is active in the team
                }
            });

            if (!teamMembership) {
                console.log(`[File View] User ${currentUserId} is not an active member of team ${fileRecord.teamId} for file ${fileId}`);
                return res.status(403).json({error: 'Access denied. You are not an active member of the team that owns this file.'});
            }
            // User is a member of the team, allow access
            console.log(`[File View] User ${currentUserId} is an active member of team ${fileRecord.teamId}. Access granted to team file ${fileId}.`);

        } else {
            // It's a personal file, check if the current user is the owner
            if (fileRecord.userId !== currentUserId) {
                console.log(`[File View] User ${currentUserId} is not the owner of personal file ${fileId} (owner: ${fileRecord.userId})`);
                return res.status(403).json({error: 'Access denied. You are not the owner of this file.'});
            }
            // User is the owner, allow access
            console.log(`[File View] User ${currentUserId} is the owner of personal file ${fileId}. Access granted.`);
        }
        
        // If authorization passed, proceed with file processing
        console.log(`[File View] Authorized. Found fileRecord: ID=${fileRecord.id}, Name=${fileRecord.fileName}, IsTeamFile=${fileRecord.isTeamFile}, Storage=${fileRecord.storageLocation}, SpacesKey=${fileRecord.spacesKey}`);

        const encryptedFilePath = path.join(encryptedDir, fileRecord.fileName);
        console.log(`[File View] Constructed encryptedFilePath: ${encryptedFilePath}`);

        if (!fs.existsSync(encryptedDir)) {
            console.log(`[File View] Encrypted directory ${encryptedDir} does not exist. Creating.`);
            fs.mkdirSync(encryptedDir, { recursive: true });
        }

        // Check if we need to download from Spaces
        if (fileRecord.storageLocation === 'spaces' && fileRecord.spacesKey) {
            if (!fs.existsSync(encryptedFilePath)) {
                console.log(`[File View] TEAM_DEBUG: File not local. Attempting download for fileId: ${fileRecord.id}, fileName: ${fileRecord.fileName}, isTeamFile: ${fileRecord.isTeamFile}, spacesKey: ${fileRecord.spacesKey}, to: ${encryptedFilePath}`);
                try {
                    await downloadFromSpaces(fileRecord.spacesKey, encryptedFilePath);
                    // This log is CRITICAL. If it appears, downloadFromSpaces returned.
                    console.log(`[File View] TEAM_DEBUG: downloadFromSpaces call completed for fileId: ${fileRecord.id}. Now re-checking existence of ${encryptedFilePath}`);
                } catch (spacesError) {
                    // This catch is for errors thrown BY downloadFromSpaces
                    console.error(`[File View] TEAM_DEBUG: Error explicitly thrown by downloadFromSpaces for ${fileRecord.fileName}:`, spacesError);
                    return res.status(500).json({ error: 'Failed to retrieve file from storage for viewing due to download error.' });
                }
            } else {
                console.log(`[File View] File ${encryptedFilePath} already exists locally. No download needed.`);
            }
        } else if (fileRecord.storageLocation === 'spaces' && !fileRecord.spacesKey) {
            console.error(`[File View] File ${fileRecord.id} is in Spaces but has no spacesKey!`);
            return res.status(500).json({ error: 'File metadata error: missing Spaces key.' });
        }


        // Now, check if the file exists locally (either it was local, or just downloaded)
        if (!fs.existsSync(encryptedFilePath)) {
            console.error(`[File View] FINAL CHECK FAILED: Encrypted file not found locally after all checks/downloads: ${encryptedFilePath}. isTeamFile: ${fileRecord.isTeamFile}`);
            return res.status(404).json({ error: 'File content not found. Download may have failed or file is missing.' });
        }
        
        console.log(`[File View] File confirmed to exist locally at: ${encryptedFilePath}. Proceeding to hash generation. isTeamFile: ${fileRecord.isTeamFile}`);
        const encryptedFileHash = await generateFileHash(encryptedFilePath);

        const integrityVerified = encryptedFileHash === fileRecord.fileHash;

        const decryptedFilePath = path.join(viewDirGlobal, `view_${Date.now()}_${fileRecord.originalName}`);
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
// POST route to create initial super admin during deployment
router.post('/init-super-admin', async (req, res) => {
  try {
    // Check if super admin already exists
    const User = require('../models/User');
    const bcrypt = require('bcryptjs');
    
    const adminExists = await User.findOne({
      where: { role: 'super_admin' }
    });
    
    if (adminExists) {
      console.log('Super admin already exists, skipping creation');
      return res.status(200).json({ message: 'Super admin already exists' });
    }
    
    // Get credentials from environment variables or use defaults
    const adminUsername = process.env.INITIAL_ADMIN_USERNAME || 'superadmin';
    const adminEmail = process.env.INITIAL_ADMIN_EMAIL || 'admin@elysianvault.com';
    const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || 'temporaryPassword123!';
    
    // Hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(adminPassword, salt);
    
    // Get system settings for default storage quota
    const systemSettings = await SystemSettings.findOne({ where: { id: 1 } });
    const defaultQuota = (systemSettings?.storageQuota || 10000) * 1024 * 1024 * 1024; // 10TB default
    
    // Create the super admin user
    const admin = await User.create({
      username: adminUsername,
      email: adminEmail,
      password: hashedPassword,
      role: 'super_admin',
      storageQuota: defaultQuota,
      currentUsage: 0
    });
    
    console.log(`Super admin created successfully: ${adminEmail}`);
    res.status(201).json({ 
      message: 'Super admin created successfully',
      username: admin.username,
      email: admin.email
    });
  } catch (error) {
    console.error('Admin setup error:', error);
    res.status(500).json({ error: 'Failed to create super admin' });
  }
});
module.exports = router;