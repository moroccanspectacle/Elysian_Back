const File = require('../models/File');
const { Op } = require('sequelize');
const fs = require('fs');
const path = require('path');

// Function to check and remove expired files
const cleanupExpiredFiles = async () => {
  try {
    console.log('Running expired file cleanup...');
    
    // Find all expired files
    const expiredFiles = await File.findAll({
      where: {
        expiryDate: {
          [Op.lt]: new Date()
        },
        isDeleted: false
      }
    });
    
    console.log(`Found ${expiredFiles.length} expired files to clean up`);
    
    // Mark each file as deleted and remove from storage
    for (const file of expiredFiles) {
      try {
        // Mark as deleted in database
        await file.update({ isDeleted: true });
        
        // Optional: Actually delete the file from storage
        const filePath = path.join(__dirname, '../uploads', file.storedFilename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        
        console.log(`Expired file removed: ${file.originalName}`);
      } catch (fileError) {
        console.error(`Error processing expired file ${file.id}:`, fileError);
      }
    }
  } catch (error) {
    console.error('File expiration cleanup error:', error);
  }
};

// Schedule the cleanup to run daily
const scheduleFileCleanup = () => {
  // Run once at startup
  cleanupExpiredFiles();
  
  // Then schedule daily
  setInterval(cleanupExpiredFiles, 24 * 60 * 60 * 1000); // 24 hours
};

module.exports = { scheduleFileCleanup };