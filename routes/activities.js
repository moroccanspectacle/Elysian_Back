const router = require('express').Router();
const verifyToken = require('./verifyToken');
const Activity_Log = require('../models/Activity_Log'); // Changed from File
const File = require('../models/File');

router.get('/', verifyToken, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;
        const action = req.query.action;
        const where = {userId: req.user.id};

        if (action && action !== 'all') where.action = action;
        
        // Use Activity_Log model instead of File model
        const logs = await Activity_Log.findAndCountAll({
            where, 
            limit, 
            offset, 
            order: [['timestamp', 'DESC']],
            include: [
                {
                    model: File, 
                    attributes: ['originalName', 'fileType']
                }
            ]
        });
        
        res.json({
            logs: logs.rows,
            total: logs.count, 
            page, 
            limit,
            totalPages: Math.ceil(logs.count / limit)
        });
    } catch (error) {
        console.error('Activity log list error: ', error);
        res.status(500).json({error: 'Activity log list failed'});
    }
});

module.exports = router;