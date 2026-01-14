require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');

const webRoutes = require('./routes/web');
const apiRoutes = require('./routes/api');
const queueWorker = require('./services/queue-worker');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for HTTPS behind Traefik
app.set('trust proxy', 1);

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Prevent browser caching of HTML pages
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.match(/\.(js|css|png|jpg|ico)$/)) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});

// Static files
app.use(express.static(path.join(__dirname, '../public')));

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

// Routes
app.use('/api', apiRoutes);
app.use('/', webRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', { message: 'Page not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).render('error', { message: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Infrastructure Diagram App running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

  // Start background queue worker
  queueWorker.start();
});
