const { Sequelize } = require('sequelize');
const dotenv = require('dotenv');
dotenv.config();

let sequelize;
let deployedSslConfig; // Variable to store sslConfig for logging if deployed

// Check if DATABASE_URL is provided (like on DigitalOcean)
if (process.env.DATABASE_URL) {
  const dbSslCaCert = process.env.DB_SSL_CA_CERT;
  let sslConfig = {}; // This is local to this block

  console.log('--- DATABASE SSL CONFIGURATION ---');
  console.log(`DATABASE_URL detected: ${process.env.DATABASE_URL ? 'Yes' : 'No'}`);
  console.log(`DB_SSL_CA_CERT raw value: [${dbSslCaCert}]`);
  console.log(`Is DB_SSL_CA_CERT a string? ${typeof dbSslCaCert === 'string'}`);
  if (typeof dbSslCaCert === 'string') {
    console.log(`DB_SSL_CA_CERT trimmed length: ${dbSslCaCert.trim().length}`);
    console.log(`DB_SSL_CA_CERT starts with: [${dbSslCaCert.substring(0, 30)}]`);
  }

  if (dbSslCaCert && dbSslCaCert.trim() !== '') {
    console.log('Condition (dbSslCaCert && dbSslCaCert.trim() !== \'\') is TRUE. Attempting to use provided CA.');
    let certToUse = dbSslCaCert;
    // Attempt to detect if it's Base64 and decode
    if (!dbSslCaCert.includes('-----BEGIN CERTIFICATE-----')) { // A simple check if it's not raw
        try {
            console.log('DB_SSL_CA_CERT does not look like a raw cert, attempting Base64 decode.');
            certToUse = Buffer.from(dbSslCaCert, 'base64').toString('ascii');
            console.log('Base64 decoding successful.');
        } catch (e) {
            console.error('Base64 decoding failed, using raw value (which might be incorrect):', e);
        }
    }
    const processedCaCert = certToUse.replace(/\\n/g, '\n'); // Ensure newlines if raw cert had escaped ones
    sslConfig = {
      rejectUnauthorized: true,
      ca: processedCaCert
    };
    console.log('Using processed DB_SSL_CA_CERT for SSL connection with verification. rejectUnauthorized is TRUE.');
  } else {
    console.log('Condition (dbSslCaCert && dbSslCaCert.trim() !== \'\') is FALSE. Falling back.');
    sslConfig = {
      rejectUnauthorized: false
    };
    console.warn('DB_SSL_CA_CERT not provided or empty. Attempting SSL connection with rejectUnauthorized: false.');
  }
  console.log('--- END DATABASE SSL CONFIGURATION ---');
  deployedSslConfig = sslConfig; // Store it for logging

  sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    dialectOptions: {
      ssl: sslConfig // Use the locally scoped sslConfig
    },
    logging: false
  });
} else {
  // Fallback to individual variables for local development
  sequelize = new Sequelize(process.env.DB_DATABASE, process.env.DB_USER, process.env.DB_PASSWORD, {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: console.log
  });
}

sequelize.authenticate()
    .then(() => {
        console.log('Connected to the PostgreSQL database');
    })
    .catch(err => {
        console.error('Unable to connect to the database:', err);
        if (process.env.DATABASE_URL && err.parent && err.parent.code === 'SELF_SIGNED_CERT_IN_CHAIN') {
            // Log the sslConfig that was used for the deployed setup
            console.error("SELF_SIGNED_CERT_IN_CHAIN error. Current sslConfig used for deployed setup:", JSON.stringify(deployedSslConfig));
            console.error("Ensure DB_SSL_CA_CERT environment variable is correctly set in DigitalOcean with the NEW CA certificate content from the NEW cluster and that it's not empty or malformed.");
        }
    });

module.exports = sequelize;