const express = require('express');
const router = express.Router();
const db = require('../services/database');
const mermaid = require('../services/mermaid');
const wave = require('../services/wave');
const perplexity = require('../services/perplexity');
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

/**
 * GET /api/wave/status
 * Check Wave authentication status
 */
router.get('/wave/status', (req, res) => {
  res.json({
    authenticated: wave.isAuthenticated()
  });
});

/**
 * GET /api/wave/sessions
 * Get Wave sessions with processed status
 * Query: refresh=true to force refresh from Wave
 */
router.get('/wave/sessions', async (req, res) => {
  try {
    if (!wave.isAuthenticated()) {
      return res.status(401).json({ error: 'Wave not authenticated' });
    }

    let sessions;
    if (req.query.refresh === 'true') {
      sessions = await wave.fetchSessions();
    } else {
      sessions = wave.getCachedSessions();
      // If no cache, fetch fresh
      if (sessions.length === 0) {
        sessions = await wave.fetchSessions();
      }
    }

    // Mark which sessions are already processed
    const sessionsWithStatus = sessions.map(s => ({
      ...s,
      processed: db.sessionExists(s.url)
    }));

    res.json(sessionsWithStatus);
  } catch (error) {
    console.error('Wave sessions error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/wave/refresh
 * Force refresh sessions from Wave
 */
router.post('/wave/refresh', async (req, res) => {
  try {
    if (!wave.isAuthenticated()) {
      return res.status(401).json({ error: 'Wave not authenticated' });
    }

    const sessions = await wave.fetchSessions();
    const sessionsWithStatus = sessions.map(s => ({
      ...s,
      processed: db.sessionExists(s.url)
    }));

    res.json(sessionsWithStatus);
  } catch (error) {
    console.error('Wave refresh error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/wave/transcript
 * Fetch transcript for a session
 * Body: { session_url: string }
 */
router.post('/wave/transcript', async (req, res) => {
  try {
    if (!wave.isAuthenticated()) {
      return res.status(401).json({ error: 'Wave not authenticated' });
    }

    const { session_url } = req.body;
    if (!session_url) {
      return res.status(400).json({ error: 'session_url required' });
    }

    const transcript = await wave.fetchTranscript(session_url);
    res.json({ transcript, session_url });
  } catch (error) {
    console.error('Wave transcript error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/wave/auth
 * Update Wave auth token
 * Body: { auth_token: string }
 */
router.post('/wave/auth', (req, res) => {
  try {
    const { auth_token } = req.body;
    if (!auth_token) {
      return res.status(400).json({ error: 'auth_token required' });
    }

    wave.updateAuth(auth_token);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/perplexity/status
 * Check Perplexity API configuration
 */
router.get('/perplexity/status', async (req, res) => {
  const configured = perplexity.isConfigured();
  if (!configured) {
    return res.json({ configured: false });
  }

  const test = await perplexity.testConnection();
  res.json({ configured: true, ...test });
});

/**
 * POST /api/process
 * Full processing pipeline: fetch transcript -> analyze -> create diagram (if technical)
 * Body: { session_url: string, title?: string }
 */
router.post('/process', async (req, res) => {
  try {
    const { session_url, title } = req.body;

    if (!session_url) {
      return res.status(400).json({ error: 'session_url required' });
    }

    // Check if already processed or skipped
    if (db.isSessionProcessed(session_url)) {
      return res.status(409).json({ error: 'Session already processed', session_url });
    }
    if (db.isSessionSkipped(session_url)) {
      return res.status(409).json({ error: 'Session was skipped', session_url });
    }

    // Check services are configured
    if (!wave.isAuthenticated()) {
      return res.status(400).json({ error: 'Wave not authenticated' });
    }
    if (!perplexity.isConfigured()) {
      return res.status(400).json({ error: 'Perplexity API not configured' });
    }

    // Step 1: Fetch transcript
    console.log('Processing: Fetching transcript from', session_url);
    const transcript = await wave.fetchTranscript(session_url);

    if (!transcript || transcript.length < 100) {
      return res.status(400).json({ error: 'Failed to fetch transcript or transcript too short' });
    }

    // Step 2: Analyze with LLM (classifies call, extracts summary, action items, infrastructure)
    console.log('Processing: Analyzing with Perplexity...');
    const analysis = await perplexity.analyzeTranscript(transcript, title);

    const customerName = analysis.customerName || 'Unknown Customer';
    const isUnknown = !analysis.customerName;
    let result = { customerId: null, diagramId: null };

    // Step 3: For technical calls, create diagram
    if (analysis.callType === 'technical' && analysis.mermaidCode) {
      // Validate Mermaid code
      const validation = await mermaid.validate(analysis.mermaidCode);
      if (!validation.valid) {
        console.warn('Generated Mermaid invalid, saving without diagram:', validation.error);
        analysis.mermaidCode = null;
      } else {
        // Create/update diagram
        const notes = `Extracted from Wave session: ${session_url}\n\nSummary: ${analysis.summary}`;

        result = db.addDiagramVersion(
          customerName,
          analysis.mermaidCode,
          session_url,
          notes,
          isUnknown
        );

        // Render PNG
        try {
          const pngFilename = await mermaid.renderToPng(
            analysis.mermaidCode,
            result.diagramId,
            result.version
          );
          db.updateVersionPngPath(result.versionId, pngFilename);
          result.png_path = pngFilename;
        } catch (renderError) {
          console.error('PNG render failed:', renderError);
        }
      }
    }

    // Step 4: Get or create customer for non-technical calls
    if (!result.customerId && customerName !== 'Unknown Customer') {
      const existing = db.searchCustomers(customerName);
      if (existing.length > 0) {
        result.customerId = existing[0].id;
      } else {
        result.customerId = db.createCustomer(customerName, false);
      }
    }

    // Step 5: Save session notes (summary, action items, etc.)
    const sessionNoteId = db.saveSessionNotes(
      session_url,
      result.customerId,
      analysis.callType,
      title,
      analysis.summary,
      analysis.actionItems,
      analysis.components,
      analysis.gaps
    );

    // Step 6: Save action items to dedicated table
    if (result.customerId && analysis.actionItems && analysis.actionItems.length > 0) {
      // Try to get session date from cached sessions
      const cachedSessions = wave.getCachedSessions();
      const session = cachedSessions.find(s => s.url === session_url);
      const sessionDate = session?.date || new Date().toISOString().split('T')[0];

      db.saveActionItemsFromSession(
        sessionNoteId,
        result.customerId,
        analysis.actionItems,
        sessionDate,
        title
      );
    }

    res.json({
      success: true,
      callType: analysis.callType,
      customerName,
      customerId: result.customerId,
      diagramId: result.diagramId,
      summary: analysis.summary,
      actionItems: analysis.actionItems,
      components: analysis.components,
      gaps: analysis.gaps,
      hasDiagram: !!result.diagramId
    });

  } catch (error) {
    console.error('Processing error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/skip
 * Skip a session (mark as not relevant)
 * Body: { session_url: string, title?: string }
 */
router.post('/skip', (req, res) => {
  try {
    const { session_url, title } = req.body;

    if (!session_url) {
      return res.status(400).json({ error: 'session_url required' });
    }

    if (db.isSessionProcessed(session_url)) {
      return res.status(409).json({ error: 'Session already processed', session_url });
    }

    db.skipSession(session_url, title);
    res.json({ success: true, skipped: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/unskip
 * Unskip a session
 * Body: { session_url: string }
 */
router.post('/unskip', (req, res) => {
  try {
    const { session_url } = req.body;

    if (!session_url) {
      return res.status(400).json({ error: 'session_url required' });
    }

    db.unskipSession(session_url);
    res.json({ success: true, skipped: false });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/session/update-customer
 * Update the customer for a processed session
 * Body: { session_url: string, customer_name: string }
 */
router.post('/session/update-customer', (req, res) => {
  try {
    const { session_url, customer_name } = req.body;

    if (!session_url || !customer_name) {
      return res.status(400).json({ error: 'session_url and customer_name required' });
    }

    // Get or create customer
    let customer = db.searchCustomers(customer_name);
    let customerId;

    if (customer.length > 0) {
      customerId = customer[0].id;
    } else {
      customerId = db.createCustomer(customer_name.trim(), false);
    }

    // Update session notes
    db.updateSessionCustomer(session_url, customerId);

    // Also update diagram_sessions if exists
    const sessionNote = db.getSessionNotes(session_url);
    if (sessionNote && sessionNote.call_type === 'technical') {
      // Find the diagram and update customer
      const sessions = db.db.prepare('SELECT diagram_id FROM diagram_sessions WHERE session_url = ?').get(session_url);
      if (sessions) {
        db.db.prepare('UPDATE diagrams SET customer_id = ? WHERE id = ?').run(customerId, sessions.diagram_id);
      }
    }

    res.json({ success: true, customerId, customerName: customer_name });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/session/:url
 * Get session notes by URL
 */
router.get('/session/:url(*)', (req, res) => {
  try {
    const session_url = decodeURIComponent(req.params.url);
    const note = db.getSessionNotes(session_url);

    if (!note) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json(note);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/action-items/:id/toggle
 * Toggle completion status of an action item
 */
router.post('/action-items/:id/toggle', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const item = db.getActionItem(id);

    if (!item) {
      return res.status(404).json({ error: 'Action item not found' });
    }

    const updated = db.toggleActionItemComplete(id);
    res.json({
      success: true,
      id: updated.id,
      completed: !!updated.completed,
      completed_at: updated.completed_at
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/customers/:id/action-items
 * Get action items for a customer
 * Query: include_completed=true to include completed items
 */
router.get('/customers/:id/action-items', (req, res) => {
  try {
    const customerId = parseInt(req.params.id);
    const customer = db.getCustomer(customerId);

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const includeCompleted = req.query.include_completed === 'true';
    const items = db.getActionItemsByCustomer(customerId, includeCompleted);

    res.json({
      customerId,
      customerName: customer.name,
      items,
      openCount: db.getOpenActionItemCount(customerId)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/extract
 * Extract infrastructure from transcript without saving
 * Body: { transcript: string, customerName?: string }
 */
router.post('/extract', async (req, res) => {
  try {
    const { transcript, customerName } = req.body;

    if (!transcript) {
      return res.status(400).json({ error: 'transcript required' });
    }

    if (!perplexity.isConfigured()) {
      return res.status(400).json({ error: 'Perplexity API not configured' });
    }

    const extraction = await perplexity.extractInfrastructure(transcript, customerName);

    // Validate the generated Mermaid
    const validation = await mermaid.validate(extraction.mermaidCode);

    res.json({
      ...extraction,
      mermaidValid: validation.valid,
      mermaidError: validation.error
    });
  } catch (error) {
    console.error('Extract error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
