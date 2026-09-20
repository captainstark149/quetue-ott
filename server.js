const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const session = require('express-session');
const db = require('./db/database');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Store io instance on app for route access
app.set('io', io);

// View Engine setup (EJS)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Security Enhancements: Hide server info & add security headers
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Secure Session configuration
app.use(session({
  name: 'quetue_admin_sid',
  secret: process.env.SESSION_SECRET || 'quetue_ott_admin_secure_secret_key_2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000 // 12 hours session duration
  }
}));

// Global view variables (for Navbar/Sidebar admin checks & dynamic categories)
app.use((req, res, next) => {
  res.locals.isAdmin = req.session ? !!req.session.isAdmin : false;
  res.locals.adminUser = req.session ? req.session.adminUser : null;
  res.locals.currentPath = req.path || '';

  db.all('SELECT * FROM categories ORDER BY display_order ASC, name ASC', [], (err, categories) => {
    res.locals.categoriesList = categories || [];
    res.locals.sidebarCategoriesList = (categories || []).filter(c => c.in_sidebar !== 0);
    
    db.all('SELECT * FROM browse_catalog ORDER BY slot_index ASC', [], (err2, catalogItems) => {
      res.locals.browseCatalogItems = catalogItems || [];
      
      db.all('SELECT * FROM custom_sections ORDER BY display_order ASC, created_at ASC', [], (err3, customSecs) => {
        res.locals.customSectionsList = customSecs || [];

        db.all('SELECT * FROM videos ORDER BY created_at DESC LIMIT 12', [], (err4, dbVideos) => {
          res.locals.dbVideosList = dbVideos || [];
          next();
        });
      });
    });
  });
});

// Import Routes
const mainRoutes = require('./routes/mainRoutes');
const videoRoutes = require('./routes/videoRoutes');
const { router: adminRoutes } = require('./routes/adminRoutes');

app.use('/admin249', adminRoutes);
app.use('/', videoRoutes);
app.use('/', mainRoutes);

// 404 Handler
app.use((req, res) => {
  res.status(404).render('404', { title: '404 - Page Not Found' });
});

// Socket.io Real-Time Video Rooms
io.on('connection', (socket) => {
  // Join Video Room
  socket.on('join_video_room', (videoId) => {
    socket.join(`video_${videoId}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`🚀 QueTube OTT Platform running on http://localhost:${PORT}`);
  console.log(`===================================================`);
});
