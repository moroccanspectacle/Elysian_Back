const crypto = require('crypto');
const fs = require('fs');
const {promisify} = require('util');
const fsReadFile = promisify(fs.readFile);
const stream = require('stream');
const pipeline = promisify(stream.pipeline);

/**
 * @param {string} filePath
 * @returns {Promise<string>}
 */
const generateFileHash = async (filePath) => {
    console.log(`Starting hash generation for file: ${filePath}`);
    
    // Check if the file exists first
    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found at path: ${filePath}`);
    }
    
    try {
        const hash = crypto.createHash('sha256');
        const fileStream = fs.createReadStream(filePath);
        
        // Use a Promise to handle the hash generation
        return new Promise((resolve, reject) => {
            fileStream.on('error', (err) => {
                console.error('File stream error:', err);
                reject(err);
            });
            
            fileStream.on('data', (chunk) => {
                hash.update(chunk);
            });
            
            fileStream.on('end', () => {
                const hashValue = hash.digest('hex');
                console.log('Hash generation completed successfully');
                resolve(hashValue);
            });
        });
    } catch (err) {
        console.error('Hash generation failed:', err);
        throw err;
    }
};

/**
 * @param {string} filePath
 * @param {string} storedHash
 * @returns {Promise<boolean>}
 */
const verifyFileIntegrity = async (filePath, storedHash) => {
    try {
        const computedHash = await generateFileHash(filePath);
        return computedHash === storedHash;
    } catch (error) {
        console.error('Integrity check failed:', error);
        return false;
    }
};
module.exports = {generateFileHash, verifyFileIntegrity};