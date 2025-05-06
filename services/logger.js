const Activity_Log = require('../models/Activity_Log');

const logActivity = async (action, userId, fileId = null, details = null, req = null) => {
    try {
        const ipAddress = req ? req.ip : null;

        const log = await Activity_Log.create({
            action,
            userId,
            fileId, // Changed from FileId to fileId
            details,
            ipAddress
        });
        return log;
    } catch (error) {
        console.error('Activity Log Error:', error);
        // Log the detailed error for debugging
        console.error('Error details:', error.message);
        if (error.errors) {
            error.errors.forEach(e => console.error(e.message));
        }
        return null;
    }
};

module.exports = { logActivity };
