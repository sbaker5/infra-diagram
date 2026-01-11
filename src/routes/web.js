const express = require('express');
const router = express.Router();
const path = require('path');
const db = require('../services/database');
const mermaid = require('../services/mermaid');
const wave = require('../services/wave');
const { isAuthenticated, login, logout } = require('../middleware/auth');

// Public routes
router.get('/login', (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.redirect('/');
  }
  res.render('login', { error: null });
});

router.post('/login', login);
router.get('/logout', logout);

// Protected routes - apply auth middleware
router.use(isAuthenticated);

// Dashboard
router.get('/', (req, res) => {
  const query = req.query.q;
  let customers;

  if (query) {
    customers = db.searchCustomers(query);
    // Enrich with version info and action items
    customers = customers.map(c => {
      const diagram = db.getDiagramByCustomer(c.id);
      const openActionItems = db.getOpenActionItemCount(c.id);
      const sessionNotes = db.getSessionNotesByCustomer(c.id);
      if (diagram) {
        const version = db.getLatestVersion(diagram.id);
        return {
          ...c,
          latest_version: version?.version,
          png_path: version?.png_path,
          version_created_at: version?.created_at,
          hasDiagram: true,
          hasNotes: sessionNotes.length > 0,
          openActionItems
        };
      }
      return {
        ...c,
        hasDiagram: false,
        hasNotes: sessionNotes.length > 0,
        openActionItems
      };
    });
  } else {
    customers = db.getAllDiagramsWithLatestVersion();
    // Reshape to customer-centric view
    const customerMap = new Map();
    customers.forEach(d => {
      if (!customerMap.has(d.customer_id)) {
        customerMap.set(d.customer_id, {
          id: d.customer_id,
          name: d.customer_name,
          is_unknown: d.customer_is_unknown,
          latest_version: d.latest_version,
          png_path: d.png_path,
          version_created_at: d.version_created_at,
          hasDiagram: true
        });
      }
    });
    customers = Array.from(customerMap.values());

    // Also get customers without diagrams
    const allCustomers = db.getAllCustomers();
    allCustomers.forEach(c => {
      if (!customerMap.has(c.id)) {
        customers.push({
          id: c.id,
          name: c.name,
          is_unknown: c.is_unknown,
          latest_version: null,
          png_path: null,
          version_created_at: null,
          hasDiagram: false
        });
      }
    });

    // Enrich all customers with session notes and action item counts
    customers = customers.map(c => {
      const sessionNotes = db.getSessionNotesByCustomer(c.id);
      const openActionItems = db.getOpenActionItemCount(c.id);
      return {
        ...c,
        hasNotes: sessionNotes.length > 0,
        openActionItems
      };
    });
  }

  res.render('dashboard', { customers, query });
});

// Wave Sessions
router.get('/wave', (req, res) => {
  const isAuthenticated = wave.isAuthenticated();
  const sessions = wave.getCachedSessions();

  // Mark which sessions are already processed or skipped
  const sessionsWithStatus = sessions.map(s => ({
    ...s,
    processed: db.isSessionProcessed(s.url),
    skipped: db.isSessionSkipped(s.url)
  }));

  res.render('wave', {
    page: 'wave',
    sessions: sessionsWithStatus,
    authenticated: isAuthenticated
  });
});

// Unknown customers
router.get('/unknown', (req, res) => {
  const customers = db.getUnknownCustomers();
  const enriched = customers.map(c => {
    const diagram = db.getDiagramByCustomer(c.id);
    const version = diagram ? db.getLatestVersion(diagram.id) : null;
    return {
      ...c,
      latest_version: version?.version,
      png_path: version?.png_path
    };
  });
  res.render('unknown', { customers: enriched });
});

// New customer form
router.get('/customer/new', (req, res) => {
  res.render('customer-new');
});

// Create customer
router.post('/customer/new', async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.render('customer-new', { error: 'Customer name is required' });
  }

  const customerId = db.createCustomer(name.trim(), false);
  res.redirect(`/customer/${customerId}/edit`);
});

// Customer detail
router.get('/customer/:id', async (req, res) => {
  const customer = db.getCustomer(req.params.id);
  if (!customer) {
    return res.status(404).render('error', { message: 'Customer not found' });
  }

  const diagram = db.getDiagramByCustomer(customer.id);
  let versions = [];
  let currentVersion = null;
  let sessions = [];

  if (diagram) {
    versions = db.getAllVersions(diagram.id);
    const requestedVersion = req.query.v ? parseInt(req.query.v) : null;

    if (requestedVersion) {
      currentVersion = db.getVersion(diagram.id, requestedVersion);
    } else {
      currentVersion = db.getLatestVersion(diagram.id);
    }

    sessions = db.getSessions(diagram.id);
  }

  // Get session notes for this customer
  const sessionNotes = db.getSessionNotesByCustomer(customer.id);

  // Get action items from the dedicated table
  const actionItems = db.getActionItemsByCustomer(customer.id, true); // Include completed
  const openActionItemCount = db.getOpenActionItemCount(customer.id);

  res.render('customer', {
    customer,
    diagram,
    versions,
    currentVersion,
    sessions,
    sessionNotes,
    actionItems,
    openActionItemCount
  });
});

// Customer edit
router.get('/customer/:id/edit', async (req, res) => {
  const customer = db.getCustomer(req.params.id);
  if (!customer) {
    return res.status(404).render('error', { message: 'Customer not found' });
  }

  const diagram = db.getDiagramByCustomer(customer.id);
  let currentVersion = null;

  if (diagram) {
    currentVersion = db.getLatestVersion(diagram.id);
  }

  // Generate sample if no existing code
  const mermaidCode = currentVersion?.mermaid_code ||
    mermaid.generateSampleDiagram(customer.name);

  res.render('editor', {
    customer,
    mermaidCode,
    currentVersion
  });
});

// Save diagram
router.post('/customer/:id/save', async (req, res) => {
  const customer = db.getCustomer(req.params.id);
  if (!customer) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  const { mermaid_code, notes } = req.body;

  if (!mermaid_code || !mermaid_code.trim()) {
    return res.status(400).json({ error: 'Mermaid code is required' });
  }

  // Validate mermaid syntax
  const validation = await mermaid.validate(mermaid_code);
  if (!validation.valid) {
    return res.status(400).json({ error: 'Invalid Mermaid syntax', details: validation.error });
  }

  // Create or get diagram
  let diagram = db.getDiagramByCustomer(customer.id);
  if (!diagram) {
    const diagramId = db.createDiagram(customer.id);
    diagram = { id: diagramId };
  }

  // Create new version
  const { id: versionId, version } = db.createVersion(diagram.id, mermaid_code, notes);

  // Render PNG
  try {
    const pngFilename = await mermaid.renderToPng(mermaid_code, diagram.id, version);
    db.updateVersionPngPath(versionId, pngFilename);

    res.json({
      success: true,
      version,
      png_path: pngFilename
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to render diagram', details: error.message });
  }
});

// Assign unknown customer
router.post('/customer/:id/assign', (req, res) => {
  const customer = db.getCustomer(req.params.id);
  if (!customer) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  const { name, existing_customer_id } = req.body;

  if (existing_customer_id) {
    // Merge into existing customer
    const existingCustomer = db.getCustomer(existing_customer_id);
    if (!existingCustomer) {
      return res.status(404).json({ error: 'Target customer not found' });
    }

    // Move diagram to existing customer
    const diagram = db.getDiagramByCustomer(customer.id);
    if (diagram) {
      // Update diagram's customer_id
      db.db.prepare('UPDATE diagrams SET customer_id = ? WHERE id = ?')
        .run(existingCustomer.id, diagram.id);
    }

    // Delete the unknown customer
    db.db.prepare('DELETE FROM customers WHERE id = ?').run(customer.id);

    res.json({ success: true, redirect: `/customer/${existingCustomer.id}` });
  } else if (name) {
    // Just rename and mark as known
    db.updateCustomer(customer.id, name, false);
    res.json({ success: true, redirect: `/customer/${customer.id}` });
  } else {
    res.status(400).json({ error: 'Name or existing_customer_id required' });
  }
});

// Preview mermaid (for live editor)
router.post('/preview', async (req, res) => {
  const { mermaid_code } = req.body;

  if (!mermaid_code) {
    return res.status(400).json({ error: 'Mermaid code is required' });
  }

  const validation = await mermaid.validate(mermaid_code);

  if (!validation.valid) {
    return res.json({ valid: false, error: validation.error });
  }

  // Generate a temporary preview
  try {
    const tempFilename = `preview-${Date.now()}.png`;
    const filename = await mermaid.renderToPng(mermaid_code, 'preview', Date.now());
    res.json({ valid: true, preview_url: `/exports/${filename}` });
  } catch (error) {
    res.json({ valid: false, error: error.message });
  }
});

// Serve PNG exports
router.get('/exports/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = mermaid.getPngPath(filename);

  if (!mermaid.pngExists(filename)) {
    return res.status(404).send('Image not found');
  }

  res.sendFile(filePath);
});

// Delete customer
router.post('/customer/:id/delete', (req, res) => {
  const customer = db.getCustomer(req.params.id);
  if (!customer) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  // Delete associated diagram and versions first
  const diagram = db.getDiagramByCustomer(customer.id);
  if (diagram) {
    // Delete PNG files
    const versions = db.getAllVersions(diagram.id);
    versions.forEach(v => {
      if (v.png_path) {
        mermaid.deletePng(v.png_path);
      }
    });
    // Delete diagram (cascades to versions and sessions)
    db.db.prepare('DELETE FROM diagrams WHERE id = ?').run(diagram.id);
  }

  // Delete customer
  db.db.prepare('DELETE FROM customers WHERE id = ?').run(customer.id);

  res.json({ success: true, redirect: '/' });
});

// Delete specific diagram version
router.post('/customer/:id/version/:version/delete', (req, res) => {
  const customer = db.getCustomer(req.params.id);
  if (!customer) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  const diagram = db.getDiagramByCustomer(customer.id);
  if (!diagram) {
    return res.status(404).json({ error: 'No diagram found' });
  }

  const version = db.getVersion(diagram.id, parseInt(req.params.version));
  if (!version) {
    return res.status(404).json({ error: 'Version not found' });
  }

  // Delete PNG file
  if (version.png_path) {
    mermaid.deletePng(version.png_path);
  }

  // Delete version
  db.db.prepare('DELETE FROM diagram_versions WHERE id = ?').run(version.id);

  res.json({ success: true });
});

// Download PNG
router.get('/customer/:id/download', (req, res) => {
  const customer = db.getCustomer(req.params.id);
  if (!customer) {
    return res.status(404).send('Customer not found');
  }

  const diagram = db.getDiagramByCustomer(customer.id);
  if (!diagram) {
    return res.status(404).send('No diagram found');
  }

  const version = req.query.v
    ? db.getVersion(diagram.id, parseInt(req.query.v))
    : db.getLatestVersion(diagram.id);

  if (!version || !version.png_path) {
    return res.status(404).send('No PNG available');
  }

  const filePath = mermaid.getPngPath(version.png_path);
  const downloadName = `${customer.name.replace(/[^a-z0-9]/gi, '-')}-v${version.version}.png`;

  res.download(filePath, downloadName);
});

module.exports = router;
