const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const pipeline = promisify(require('stream').pipeline);

const getEncryptionKey = () => 
    {
        return crypto.scryptSync(process.env.TOKEN_SECRET, 'salt', 32);
    };

const encryptFile = async (sourceFilePath, destinationFilePath, fileName) => 
    {
        const iv = crypto.randomBytes(16);
        const key = getEncryptionKey();

        const cipher = crypto.createCipheriv('aes-256-ctr', key, iv);

        const readStream = fs.createReadStream(sourceFilePath);
        const writeStream = fs.createWriteStream(destinationFilePath);

        writeStream.write(iv);

        await pipeline(
            readStream,
            cipher,
            writeStream
        );

        return iv.toString('hex');
    };

    const decryptFile = async (sourceFilePath, destinationFilePath) =>  
        {
            const readIvStream = fs.createReadStream(sourceFilePath, { end: 15 });
            const chunks = [];

            for await (const chunk of readIvStream)
            {
                chunks.push(chunk);
            }
            const iv = Buffer.concat(chunks);
            const key = getEncryptionKey();

            const decipher = crypto.createDecipheriv('aes-256-ctr', key, iv);

            const readStream = fs.createReadStream(sourceFilePath, { start: 16 });
            const writeStream = fs.createWriteStream(destinationFilePath);

            await pipeline(
                readStream,
                decipher,
                writeStream
            );

            return true;
        };

        module.exports = { encryptFile, decryptFile };