const express = require('express');
const dotenv = require('dotenv');
const verifyToken = require('./routes/verifyToken'); 
const cors = require('cors');
const sequelize = require('./config/database'); // Make sure this is imported
const path = require('path'); // Import path module
const fs = require('fs'); // <<<<------ ADD THIS LINE

dotenv.config();

// Add this near the top of the file with other constants
const PORT = process.env.PORT || 3000;

const app = express();

// --- Add Global Header Logging Middleware (VERY EARLY) ---
app.use((req, res, next) => {
  // Log only for the specific path we are debugging
  if (req.originalUrl.startsWith('/api/vault/access/')) {
    // Log headers for BOTH OPTIONS and GET requests hitting this path
    console.log(`[EARLY LOGGER] Headers for ${req.method} ${req.originalUrl}:`, JSON.stringify(req.headers, null, 2));
  }
  next(); // Pass control to the next middleware (cors, etc.)
});
// --- End Global Header Logging Middleware ---

// Update CORS configuration
app.use(cors({
  // Allow requests from both ports
  origin: ['http://localhost:3001', 'http://localhost:3000', process.env.FRONTEND_URL],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'auth-token', 
    'mfa-setup-token',
    'mfasetuptoken',
    'x-mfa-setup-token',
    'x-vault-pin', // Lowercase
    'X-Vault-PIN'  // Uppercase
  ],
  exposedHeaders: ['Content-Disposition', 'X-File-Integrity', 'Content-Type']
}));  

// Route Imports later
const authRoute = require('./routes/auth'); // Import auth route
const postRoute = require('./routes/verPost'); // Import post route
const filesRoute = require('./routes/files'); // Import files route
const profileRoute = require('./routes/profile'); // Import profile route
const mfaRoute = require('./routes/mfa'); // Import mfa route
const activitiesRoute = require('./routes/activities'); // Import activities route
const sharesRoute = require('./routes/shares'); // Import shares route
const teamsRoutes = require('./routes/teams'); // Add this with your other routes
const notificationsRoutes = require('./routes/notifications'); // Add these with your other routes
const adminRoutes = require('./routes/admin'); // Add this with other imports
const vaultRoute = require('./routes/vault'); // Import vault route

// Add this code after you import all your models
const Team = require('./models/Team');
const User = require('./models/User');
const TeamMember = require('./models/TeamMember');

// Add this after importing your models but before syncing the database
const setupAssociations = require('./models/associations');
setupAssociations();

// Middleware to parse JSON bodies
app.use(express.json());

// Route Middlewares
app.use('/api/user', authRoute);
app.use('/api/auth', authRoute);
app.use('/api/posts', verifyToken, postRoute); // Apply verifyToken middleware to /api/posts
app.use('/api/files', filesRoute);
app.use('/api/profile', profileRoute); // Add the profile route middleware
app.use('/api/mfa', mfaRoute); // Add the mfa route middleware
app.use('/api/activities', activitiesRoute); // Notice no verifyToken here - it's already in the routes
app.use('/api/shares', sharesRoute); // Add the shares route middleware
app.use('/api/teams', teamsRoutes); // Then register it
app.use('/api/notifications', notificationsRoutes); // Register the route
app.use('/api/admin', adminRoutes); // Register the admin routes
app.use('/api/vault', vaultRoute); // Register the vault routes

// Add a route for accessing shared files with a token
app.use('/api/share', require('./routes/publicShare'));

// Serve static files
app.use('/profile-images', express.static(path.join(__dirname, 'uploads/profile-images')));

// Add this at the end of your backend/index.js file, after all other routes
// Serve static files from React's build folder in production
if (process.env.NODE_ENV === 'production') {
  const frontendDistPath = path.join(__dirname, '../frontend/dist');
  const frontendIndexPath = path.join(frontendDistPath, 'index.html');

  console.log(`[SERVER_LOG] Running in production mode.`);
  console.log(`[SERVER_LOG] __dirname: ${__dirname}`);
  console.log(`[SERVER_LOG] Calculated frontendDistPath: ${frontendDistPath}`);
  console.log(`[SERVER_LOG] Calculated frontendIndexPath: ${frontendIndexPath}`);

  if (fs.existsSync(frontendDistPath)) {
    console.log(`[SERVER_LOG] SUCCESS: Directory ${frontendDistPath} EXISTS.`);
    if (fs.existsSync(frontendIndexPath)) {
      console.log(`[SERVER_LOG] SUCCESS: File ${frontendIndexPath} EXISTS.`);
    } else {
      console.error(`[SERVER_LOG] ERROR: File ${frontendIndexPath} DOES NOT EXIST.`);
      try {
        const filesInDist = fs.readdirSync(frontendDistPath);
        console.log(`[SERVER_LOG] Contents of ${frontendDistPath}: [${filesInDist.join(', ')}]`);
      } catch (e) {
        console.error(`[SERVER_LOG] Error reading contents of ${frontendDistPath}:`, e);
      }
    }
  } else {
    console.error(`[SERVER_LOG] ERROR: Directory ${frontendDistPath} DOES NOT EXIST.`);
    // Check if frontend directory itself exists
    const frontendPath = path.join(__dirname, '../frontend');
    if(fs.existsSync(frontendPath)) {
        console.log(`[SERVER_LOG] Parent frontend directory ${frontendPath} EXISTS. Contents: [${fs.readdirSync(frontendPath).join(', ')}]`);
    } else {
        console.error(`[SERVER_LOG] ERROR: Parent frontend directory ${frontendPath} DOES NOT EXIST.`);
    }
  }
  app.use(express.static(frontendDistPath));
}

// The "catch all" handler for any request that doesn't match one above
app.get('*', (req, res) => {
  // Skip API routes - they should have been handled already
  if (req.url.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  
  if (process.env.NODE_ENV === 'production') {
    const indexPath = path.join(__dirname, '../frontend/dist/index.html');
    
    // Ensure the file exists before trying to send it
    if (fs.existsSync(indexPath)) {
      console.log(`[SERVER_LOG] Serving React app for: ${req.path}`);
      return res.sendFile(indexPath);
    } else {
      console.error(`[SERVER_LOG] React app index.html not found at ${indexPath}`);
      // Check parent directories to help with debugging
      const frontendDir = path.join(__dirname, '../frontend');
      const distDir = path.join(frontendDir, 'dist');
      
      console.error(`Frontend directory exists: ${fs.existsSync(frontendDir)}`);
      console.error(`Dist directory exists: ${fs.existsSync(distDir)}`);
      
      return res.status(404).send('Application not available. Please contact support.');
    }
  } else {
    // In development, redirect to the separate frontend dev server
    console.log(`[SERVER_LOG] Development mode: Redirecting ${req.originalUrl} to frontend`);
    res.redirect(`http://localhost:3001${req.originalUrl}`);
  }
});

// Add this after you've set up all your routes

// Replace the HTTP request approach with direct function call
const initializeSuperAdmin = async () => {
  try {
    console.log('Checking for super admin account...');
    
    // Import User model and other required dependencies
    const User = require('./models/User');
    const bcrypt = require('bcryptjs');
    const SystemSettings = require('./models/SystemSettings');
    
    // Check if super admin already exists
    const adminExists = await User.findOne({
      where: { role: 'super_admin' }
    });
    
    if (adminExists) {
      console.log('ℹ️ Super admin already exists, no action needed');
      return;
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
    
    console.log('✅ Super admin created successfully:', admin.email);
  } catch (error) {
    console.error('❌ Failed to initialize super admin:', error.message);
  }
};

// Sync all models with database
sequelize.sync({ alter: true })
  .then(() => {
    console.log('[SERVER_LOG] Database synced');
    app.listen(PORT, () => {
      console.log(`[SERVER_LOG] Server is running on port ${PORT}`);
      scheduleFileCleanup(); // Start scheduled tasks
      // Initialize super admin after server has started
      setTimeout(initializeSuperAdmin, 1000);
    });
  })
  .catch(err => {
    console.error('[SERVER_LOG] Error syncing database:', err);
  });

// Add near the bottom of the file
const { scheduleFileCleanup } = require('./services/fileExpirationService');


