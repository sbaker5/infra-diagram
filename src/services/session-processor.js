/**
 * Session Processor Service
 * Shared processing logic for Wave sessions - used by both API and queue worker
 */
const db = require('./database');
const wave = require('./wave');
const perplexity = require('./perplexity');
const mermaid = require('./mermaid');

/**
 * Validate that a session can be processed
 * @param {string} sessionUrl - The Wave session URL
 * @returns {{ valid: boolean, error?: string }}
 */
function validateSession(sessionUrl) {
  if (db.isSessionProcessed(sessionUrl)) {
    return { valid: false, error: 'Session already processed' };
  }
  if (db.isSessionSkipped(sessionUrl)) {
    return { valid: false, error: 'Session was skipped' };
  }
  return { valid: true };
}

/**
 * Validate that required services are configured
 * @returns {{ valid: boolean, error?: string }}
 */
function validateServices() {
  if (!wave.isAuthenticated()) {
    return { valid: false, error: 'Wave not authenticated' };
  }
  if (!perplexity.isConfigured()) {
    return { valid: false, error: 'Perplexity API not configured' };
  }
  return { valid: true };
}

/**
 * Fetch and validate transcript from Wave
 * @param {string} sessionUrl - The Wave session URL
 * @param {string} logPrefix - Prefix for log messages
 * @returns {Promise<string>}
 */
async function fetchTranscript(sessionUrl, logPrefix = '') {
  console.log(`${logPrefix}Fetching transcript from ${sessionUrl}`);
  const transcript = await wave.fetchTranscript(sessionUrl);

  if (!transcript || transcript.length < 100) {
    throw new Error('Failed to fetch transcript or transcript too short');
  }

  return transcript;
}

/**
 * Analyze transcript with LLM
 * @param {string} transcript - The transcript text
 * @param {string} title - Session title
 * @param {string} logPrefix - Prefix for log messages
 * @returns {Promise<Object>}
 */
async function analyzeTranscript(transcript, title, logPrefix = '') {
  console.log(`${logPrefix}Analyzing with Perplexity...`);
  return await perplexity.analyzeTranscript(transcript, title);
}

/**
 * Create or update diagram for technical calls
 * @param {Object} analysis - LLM analysis result
 * @param {string} customerName - Customer name
 * @param {boolean} isUnknown - Whether customer is unknown
 * @param {string} sessionUrl - Wave session URL
 * @param {string} logPrefix - Prefix for log messages
 * @returns {Promise<Object>}
 */
async function createDiagramIfTechnical(analysis, customerName, isUnknown, sessionUrl, logPrefix = '') {
  let result = { customerId: null, diagramId: null };

  if (analysis.callType !== 'technical' || !analysis.mermaidCode) {
    return result;
  }

  const validation = await mermaid.validate(analysis.mermaidCode);
  if (!validation.valid) {
    console.warn(`${logPrefix}Generated Mermaid invalid:`, validation.error);
    analysis.mermaidCode = null;
    return result;
  }

  const notes = `Extracted from Wave session: ${sessionUrl}\n\nSummary: ${analysis.summary}`;

  result = db.addDiagramVersion(
    customerName,
    analysis.mermaidCode,
    sessionUrl,
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
    console.error(`${logPrefix}PNG render failed:`, renderError);
  }

  return result;
}

/**
 * Get or create customer for non-technical calls
 * @param {Object} result - Current result object
 * @param {string} customerName - Customer name
 * @returns {Object}
 */
function ensureCustomer(result, customerName) {
  // If we already have a customerId, nothing to do
  if (result.customerId) {
    return result;
  }

  // For Unknown Customer, still create/get the customer record so action items can be saved
  const name = customerName || 'Unknown Customer';
  const isUnknown = name === 'Unknown Customer';

  const existing = db.searchCustomers(name);
  if (existing.length > 0) {
    result.customerId = existing[0].id;
  } else {
    result.customerId = db.createCustomer(name, isUnknown);
  }

  return result;
}

/**
 * Save session notes and action items
 * @param {string} sessionUrl - Wave session URL
 * @param {Object} result - Processing result with customerId
 * @param {Object} analysis - LLM analysis result
 * @param {string} title - Session title
 * @returns {number} Session note ID
 */
function saveSessionData(sessionUrl, result, analysis, title) {
  // Get session date from Wave cache
  const cachedSessions = wave.getCachedSessions();
  const session = cachedSessions.find(s => s.url === sessionUrl);
  const sessionDate = session?.date || new Date().toISOString().split('T')[0];

  const sessionNoteId = db.saveSessionNotes(
    sessionUrl,
    result.customerId,
    analysis.callType,
    title,
    analysis.summary,
    analysis.actionItems,
    analysis.components,
    analysis.gaps,
    sessionDate
  );

  // Save action items to dedicated table
  if (result.customerId && analysis.actionItems && analysis.actionItems.length > 0) {
    db.saveActionItemsFromSession(
      sessionNoteId,
      result.customerId,
      analysis.actionItems,
      sessionDate,
      title
    );
  }

  return sessionNoteId;
}

/**
 * Process a Wave session through the full pipeline
 * @param {Object} options - Processing options
 * @param {string} options.sessionUrl - Wave session URL
 * @param {string} options.title - Session title
 * @param {string} options.logPrefix - Prefix for log messages
 * @returns {Promise<Object>} Processing result
 */
async function processSession({ sessionUrl, title, logPrefix = '' }) {
  // Validate session can be processed
  const sessionValidation = validateSession(sessionUrl);
  if (!sessionValidation.valid) {
    throw new Error(sessionValidation.error);
  }

  // Validate services are configured
  const serviceValidation = validateServices();
  if (!serviceValidation.valid) {
    throw new Error(serviceValidation.error);
  }

  // Step 1: Fetch transcript
  const transcript = await fetchTranscript(sessionUrl, logPrefix);

  // Step 2: Analyze with LLM
  const analysis = await analyzeTranscript(transcript, title, logPrefix);

  const customerName = analysis.customerName || 'Unknown Customer';
  const isUnknown = !analysis.customerName;

  // Step 3: Create diagram for technical calls
  let result = await createDiagramIfTechnical(
    analysis,
    customerName,
    isUnknown,
    sessionUrl,
    logPrefix
  );

  // Step 4: Ensure customer exists for non-technical calls
  result = ensureCustomer(result, customerName);

  // Step 5: Save session notes and action items
  saveSessionData(sessionUrl, result, analysis, title);

  return {
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
  };
}

module.exports = {
  processSession,
  validateSession,
  validateServices
};
