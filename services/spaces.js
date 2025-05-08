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
    const params = {
        Bucket: BUCKET_NAME,
        Key: sourceKey
    };
    const { Body } = await s3.getObject(params).promise();
    const dir = path.dirname(destinationPath);
    
    if (!fs.existsSync(dir)){
        fs.mkdirSync(dir, {recursive: true});
    }
    fs.writeFileSync(destinationPath, Body);
    return destinationPath;
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