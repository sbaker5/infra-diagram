const express = require('express');
const router = express.Router();
const db = require('../services/database');
const mermaid = require('../services/mermaid');
const { isAuthenticated } = require('../middleware/auth');

// All API routes require authentication
router.use(isAuthenticated);

/**
 * GET /api/customers
 * List all customers
 */
router.get('/customers', (req, res) => {
  try {
    const customers = db.getAllCustomers();
    res.json(customers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/customers
 * Create a new customer
 * Body: { name: string, is_unknown?: boolean }
 */
router.post('/customers', (req, res) => {
  try {
    const { name, is_unknown = false } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const customerId = db.createCustomer(name.trim(), is_unknown);
    const customer = db.getCustomer(customerId);

    res.status(201).json(customer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/customers/:id
 * Get a specific customer
 */
router.get('/customers/:id', (req, res) => {
  try {
    const customer = db.getCustomer(req.params.id);
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.json(customer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/diagrams
 * List all diagrams with latest version info
 */
router.get('/diagrams', (req, res) => {
  try {
    const diagrams = db.getAllDiagramsWithLatestVersion();
    res.json(diagrams);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/diagrams
 * Create or update a diagram for a customer
 * Body: {
 *   customer_name: string,
 *   mermaid_code: string,
 *   session_url?: string,
 *   notes?: string,
 *   is_unknown?: boolean
 * }
 *
 * This is the main endpoint for N8N to push processed diagrams
 */
router.post('/diagrams', async (req, res) => {
  try {
    const {
      customer_name,
      mermaid_code,
      session_url,
      notes,
      is_unknown = false
    } = req.body;

    if (!customer_name || !customer_name.trim()) {
      return res.status(400).json({ error: 'customer_name is required' });
    }

    if (!mermaid_code || !mermaid_code.trim()) {
      return res.status(400).json({ error: 'mermaid_code is required' });
    }

    // Check if session was already processed
    if (session_url && db.sessionExists(session_url)) {
      return res.status(409).json({
        error: 'Session already processed',
        session_url
      });
    }

    // Validate mermaid syntax
    const validation = await mermaid.validate(mermaid_code);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Invalid Mermaid syntax',
        details: validation.error
      });
    }

    // Create/update diagram
    const result = db.addDiagramVersion(
      customer_name.trim(),
      mermaid_code,
      session_url,
      notes,
      is_unknown
    );

    // Render PNG
    try {
      const pngFilename = await mermaid.renderToPng(
        mermaid_code,
        result.diagramId,
        result.version
      );
      db.updateVersionPngPath(result.versionId, pngFilename);
      result.png_path = pngFilename;
    } catch (renderError) {
      console.error('PNG render failed:', renderError);
      // Continue without PNG - still save the diagram
    }

    res.status(201).json({
      success: true,
      ...result,
      customer_name: customer_name.trim()
    });
  } catch (error) {
    console.error('API /diagrams error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/diagrams/:id
 * Get a specific diagram with all versions
 */
router.get('/diagrams/:id', (req, res) => {
  try {
    const diagram = db.getDiagram(req.params.id);
    if (!diagram) {
      return res.status(404).json({ error: 'Diagram not found' });
    }

    const versions = db.getAllVersions(diagram.id);
    const sessions = db.getSessions(diagram.id);

    res.json({
      ...diagram,
      versions,
      sessions
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/diagrams/:id/latest
 * Get the latest version of a diagram
 */
router.get('/diagrams/:id/latest', (req, res) => {
  try {
    const diagram = db.getDiagram(req.params.id);
    if (!diagram) {
      return res.status(404).json({ error: 'Diagram not found' });
    }

    const version = db.getLatestVersion(diagram.id);
    if (!version) {
      return res.status(404).json({ error: 'No versions found' });
    }

    res.json({
      ...diagram,
      ...version
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/diagrams/:id/png
 * Get the PNG image for the latest version
 */
router.get('/diagrams/:id/png', (req, res) => {
  try {
    const diagram = db.getDiagram(req.params.id);
    if (!diagram) {
      return res.status(404).json({ error: 'Diagram not found' });
    }

    const version = db.getLatestVersion(diagram.id);
    if (!version || !version.png_path) {
      return res.status(404).json({ error: 'No PNG available' });
    }

    const filePath = mermaid.getPngPath(version.png_path);
    if (!mermaid.pngExists(version.png_path)) {
      return res.status(404).json({ error: 'PNG file not found' });
    }

    res.sendFile(filePath);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/sessions/check
 * Check if a session URL has been processed
 * Query: url=<session_url>
 */
router.get('/sessions/check', (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: 'url query parameter required' });
    }

    const exists = db.sessionExists(url);
    res.json({ processed: exists, session_url: url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/template
 * Get the infrastructure template configuration
 */
router.get('/template', (req, res) => {
  try {
    const template = require('../config/infra-template');
    res.json(template);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/render
 * Render Mermaid code to PNG without saving
 * Body: { mermaid_code: string }
 * Returns: PNG image
 */
router.post('/render', async (req, res) => {
  try {
    const { mermaid_code } = req.body;

    if (!mermaid_code || !mermaid_code.trim()) {
      return res.status(400).json({ error: 'mermaid_code is required' });
    }

    // Validate first
    const validation = await mermaid.validate(mermaid_code);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Invalid Mermaid syntax',
        details: validation.error
      });
    }

    // Render to temp file
    const filename = await mermaid.renderToPng(mermaid_code, 'api', Date.now());
    const filePath = mermaid.getPngPath(filename);

    // Send file then delete it
    res.sendFile(filePath, (err) => {
      // Clean up temp file after sending
      try {
        mermaid.deletePng(filename);
      } catch (e) {
        // Ignore cleanup errors
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
