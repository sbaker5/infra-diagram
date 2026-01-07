/**
 * Simple password-based authentication middleware
 */

const APP_PASSWORD = process.env.APP_PASSWORD || 'changeme';

/**
 * Check if user is authenticated
 */
function isAuthenticated(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }

  // Allow API requests with password header
  const apiPassword = req.headers['x-api-password'];
  if (apiPassword === APP_PASSWORD) {
    return next();
  }

  // Redirect to login for web requests
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.redirect('/login');
}

/**
 * Login handler
 */
function login(req, res) {
  const { password } = req.body;

  if (password === APP_PASSWORD) {
    req.session.authenticated = true;
    res.redirect('/');
  } else {
    res.render('login', { error: 'Invalid password' });
  }
}

/**
 * Logout handler
 */
function logout(req, res) {
  req.session.destroy(() => {
    res.redirect('/login');
  });
}

module.exports = {
  isAuthenticated,
  login,
  logout
};
