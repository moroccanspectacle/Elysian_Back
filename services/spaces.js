const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');


const spacesEndpoint = new AWS.Endpoint(process.env.SPACES_ENDPOINT ||'nyc3.digitaloceanspaces.com');
const s3 = new AWS.S3({
    endpoint: spacesEndpoint,
    accessKeyId: process.env.SPACES_KEY, 
    secretAccessKey: process.env.SPACES_SECRET,
    s3ForcePathStyle: true,
});

const BUCKET_NAME = process.env.SPACES_BUCKET;

const uploadToSpaces = async (filePath, fileName) => {
    const fileContent = fs.readFileSync(filePath);

    const params = {
        Bucket: BUCKET_NAME,
        Key: fileName,
        Body: fileContent,
        ACL: 'private', // Set the ACL to public-read if you want the file to be publicly accessible
    };
    return s3.upload(params).promise();
};

const downloadFromSpaces = async (sourceKey, destinationPath) => {
    console.log(`[downloadFromSpaces] Attempting to download S3 object: ${BUCKET_NAME}/${sourceKey} to local path: ${destinationPath}`);
    const params = {
        Bucket: BUCKET_NAME,
        Key: sourceKey
    };

    try {
        const s3Object = await s3.getObject(params).promise();
        const Body = s3Object.Body;

        if (!Body) {
            console.error(`[downloadFromSpaces] S3 getObject returned NO BODY for key: ${sourceKey}. Object size: ${s3Object.ContentLength}`);
            throw new Error(`S3 Body was empty for key ${sourceKey}`);
        }
        console.log(`[downloadFromSpaces] S3 getObject Body received. Type: ${typeof Body}, Length: ${Body.length || 'N/A (stream?)'}. ContentLength from S3: ${s3Object.ContentLength}`);

        // Ensure destination directory exists
        const dirName = path.dirname(destinationPath);
        if (!fs.existsSync(dirName)) {
            console.log(`[downloadFromSpaces] Creating directory: ${dirName}`);
            fs.mkdirSync(dirName, { recursive: true });
        }

        console.log(`[downloadFromSpaces] Attempting to write file to: ${destinationPath}`);
        fs.writeFileSync(destinationPath, Body);
        console.log(`[downloadFromSpaces] fs.writeFileSync completed for: ${destinationPath}`);

        // VERIFY FILE EXISTENCE IMMEDIATELY
        if (fs.existsSync(destinationPath)) {
            const stats = fs.statSync(destinationPath);
            console.log(`[downloadFromSpaces] SUCCESS: File ${destinationPath} exists after write. Size: ${stats.size} bytes.`);
        } else {
            console.error(`[downloadFromSpaces] CRITICAL FAILURE: File ${destinationPath} DOES NOT exist immediately after fs.writeFileSync.`);
            // Throw an error here to ensure the calling function knows the download effectively failed.
            throw new Error(`Failed to confirm file existence at ${destinationPath} after S3 download and write attempt.`);
        }
    } catch (error) {
        console.error(`[downloadFromSpaces] Error during S3 download or file write for key ${sourceKey}:`, error);
        throw error; // Re-throw the error to be caught by the caller
    }
};

const deleteFromSpaces = async (sourceKey) => {
    const params = {
      Bucket: BUCKET_NAME,
      Key: sourceKey,
    };
    
    return s3.deleteObject(params).promise();
  };

  const fileExistsInSpaces = async (sourceKey) => {
    try {
      const params = {
        Bucket: BUCKET_NAME,
        Key: sourceKey,
      };
      
      await s3.headObject(params).promise();
      return true;
    } catch (error) {
      if (error.code === 'NotFound') {
        return false;
      }
      throw error;
    }
  };

  module.exports = {
    uploadToSpaces,
    downloadFromSpaces,
    deleteFromSpaces,
    fileExistsInSpaces,
  };