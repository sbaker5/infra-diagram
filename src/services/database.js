const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'diagrams.db');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    is_unknown BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS diagrams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS diagram_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    diagram_id INTEGER NOT NULL,
    version INTEGER NOT NULL,
    mermaid_code TEXT NOT NULL,
    png_path TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (diagram_id) REFERENCES diagrams(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS diagram_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    diagram_id INTEGER NOT NULL,
    session_url TEXT NOT NULL,
    processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (diagram_id) REFERENCES diagrams(id) ON DELETE CASCADE
  );

  -- Session notes: summaries, action items, call classification
  CREATE TABLE IF NOT EXISTS session_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_url TEXT NOT NULL UNIQUE,
    customer_id INTEGER,
    call_type TEXT NOT NULL DEFAULT 'technical',
    title TEXT,
    summary TEXT,
    action_items TEXT,
    components TEXT,
    gaps TEXT,
    skipped BOOLEAN DEFAULT FALSE,
    session_date TEXT,
    processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
  );

  -- Action items table (normalized from session_notes JSON)
  CREATE TABLE IF NOT EXISTS action_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_note_id INTEGER,
    customer_id INTEGER NOT NULL,
    owner TEXT NOT NULL,
    item TEXT NOT NULL,
    completed BOOLEAN DEFAULT FALSE,
    completed_at DATETIME,
    session_date DATETIME,
    session_title TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_note_id) REFERENCES session_notes(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
  );

  -- Processing queue for background job processing
  CREATE TABLE IF NOT EXISTS processing_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_url TEXT NOT NULL UNIQUE,
    title TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    result_summary TEXT,
    customer_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    completed_at DATETIME,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_diagrams_customer ON diagrams(customer_id);
  CREATE INDEX IF NOT EXISTS idx_queue_status ON processing_queue(status);
  CREATE INDEX IF NOT EXISTS idx_versions_diagram ON diagram_versions(diagram_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_diagram ON diagram_sessions(diagram_id);
  CREATE INDEX IF NOT EXISTS idx_session_notes_url ON session_notes(session_url);
  CREATE INDEX IF NOT EXISTS idx_session_notes_customer ON session_notes(customer_id);
  CREATE INDEX IF NOT EXISTS idx_action_items_customer ON action_items(customer_id);
  CREATE INDEX IF NOT EXISTS idx_action_items_completed ON action_items(completed);
`);

// Migration: Add session_date column to session_notes if it doesn't exist
try {
  db.prepare('SELECT session_date FROM session_notes LIMIT 1').get();
} catch (e) {
  if (e.code === 'SQLITE_ERROR' && e.message.includes('no such column')) {
    console.log('Adding session_date column to session_notes...');
    db.exec('ALTER TABLE session_notes ADD COLUMN session_date TEXT');
    console.log('session_date column added successfully');
  }
}

// Customer operations
const customerOps = {
  create: db.prepare(`
    INSERT INTO customers (name, is_unknown) VALUES (?, ?)
  `),

  getById: db.prepare(`
    SELECT * FROM customers WHERE id = ?
  `),

  getAll: db.prepare(`
    SELECT c.*,
           (SELECT COUNT(*) FROM diagrams WHERE customer_id = c.id) as diagram_count
    FROM customers c
    ORDER BY c.updated_at DESC
  `),

  getUnknown: db.prepare(`
    SELECT c.*,
           (SELECT COUNT(*) FROM diagrams WHERE customer_id = c.id) as diagram_count
    FROM customers c
    WHERE c.is_unknown = TRUE
    ORDER BY c.created_at DESC
  `),

  update: db.prepare(`
    UPDATE customers SET name = ?, is_unknown = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `),

  delete: db.prepare(`
    DELETE FROM customers WHERE id = ?
  `),

  search: db.prepare(`
    SELECT * FROM customers WHERE name LIKE ? ORDER BY name
  `),

  mergeIntoDiagram: db.prepare(`
    UPDATE diagrams SET customer_id = ? WHERE id = ?
  `)
};

// Diagram operations
const diagramOps = {
  create: db.prepare(`
    INSERT INTO diagrams (customer_id) VALUES (?)
  `),

  getById: db.prepare(`
    SELECT d.*, c.name as customer_name, c.is_unknown as customer_is_unknown
    FROM diagrams d
    JOIN customers c ON d.customer_id = c.id
    WHERE d.id = ?
  `),

  getByCustomerId: db.prepare(`
    SELECT * FROM diagrams WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1
  `),

  getAllWithLatestVersion: db.prepare(`
    SELECT d.*, c.name as customer_name, c.is_unknown as customer_is_unknown,
           v.version as latest_version, v.png_path, v.created_at as version_created_at,
           (SELECT sn.session_date FROM session_notes sn WHERE sn.customer_id = c.id ORDER BY sn.session_date DESC LIMIT 1) as latest_session_date
    FROM diagrams d
    JOIN customers c ON d.customer_id = c.id
    LEFT JOIN diagram_versions v ON d.id = v.diagram_id
      AND v.version = (SELECT MAX(version) FROM diagram_versions WHERE diagram_id = d.id)
    ORDER BY COALESCE(v.created_at, d.created_at) DESC
  `),

  delete: db.prepare(`
    DELETE FROM diagrams WHERE id = ?
  `)
};

// Version operations
const versionOps = {
  create: db.prepare(`
    INSERT INTO diagram_versions (diagram_id, version, mermaid_code, png_path, notes)
    VALUES (?, ?, ?, ?, ?)
  `),

  getLatest: db.prepare(`
    SELECT * FROM diagram_versions
    WHERE diagram_id = ?
    ORDER BY version DESC
    LIMIT 1
  `),

  getByVersion: db.prepare(`
    SELECT * FROM diagram_versions
    WHERE diagram_id = ? AND version = ?
  `),

  getAllForDiagram: db.prepare(`
    SELECT * FROM diagram_versions
    WHERE diagram_id = ?
    ORDER BY version DESC
  `),

  getNextVersion: db.prepare(`
    SELECT COALESCE(MAX(version), 0) + 1 as next_version
    FROM diagram_versions
    WHERE diagram_id = ?
  `),

  updatePngPath: db.prepare(`
    UPDATE diagram_versions SET png_path = ? WHERE id = ?
  `),

  delete: db.prepare(`
    DELETE FROM diagram_versions WHERE id = ?
  `)
};

// Session operations
const sessionOps = {
  create: db.prepare(`
    INSERT INTO diagram_sessions (diagram_id, session_url) VALUES (?, ?)
  `),

  getByDiagramId: db.prepare(`
    SELECT ds.*, sn.session_date
    FROM diagram_sessions ds
    LEFT JOIN session_notes sn ON ds.session_url = sn.session_url
    WHERE ds.diagram_id = ?
    ORDER BY sn.session_date DESC, ds.processed_at DESC
  `),

  exists: db.prepare(`
    SELECT 1 FROM diagram_sessions WHERE session_url = ?
  `),

  getByUrl: db.prepare(`
    SELECT * FROM diagram_sessions WHERE session_url = ?
  `)
};

// Session notes operations
const notesOps = {
  create: db.prepare(`
    INSERT INTO session_notes (session_url, customer_id, call_type, title, summary, action_items, components, gaps, session_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  update: db.prepare(`
    UPDATE session_notes
    SET customer_id = ?, call_type = ?, title = ?, summary = ?, action_items = ?, components = ?, gaps = ?, session_date = ?
    WHERE session_url = ?
  `),

  getByUrl: db.prepare(`
    SELECT sn.*, c.name as customer_name
    FROM session_notes sn
    LEFT JOIN customers c ON sn.customer_id = c.id
    WHERE sn.session_url = ?
  `),

  getByCustomerId: db.prepare(`
    SELECT * FROM session_notes WHERE customer_id = ? ORDER BY processed_at DESC
  `),

  getAll: db.prepare(`
    SELECT sn.*, c.name as customer_name
    FROM session_notes sn
    LEFT JOIN customers c ON sn.customer_id = c.id
    ORDER BY sn.processed_at DESC
  `),

  getRecent: db.prepare(`
    SELECT sn.*, c.name as customer_name
    FROM session_notes sn
    LEFT JOIN customers c ON sn.customer_id = c.id
    WHERE sn.skipped = FALSE
    ORDER BY sn.processed_at DESC
    LIMIT ?
  `),

  skip: db.prepare(`
    INSERT OR REPLACE INTO session_notes (session_url, skipped, title)
    VALUES (?, TRUE, ?)
  `),

  unskip: db.prepare(`
    DELETE FROM session_notes WHERE session_url = ? AND skipped = TRUE
  `),

  isSkipped: db.prepare(`
    SELECT 1 FROM session_notes WHERE session_url = ? AND skipped = TRUE
  `),

  exists: db.prepare(`
    SELECT 1 FROM session_notes WHERE session_url = ? AND skipped = FALSE
  `),

  updateCustomer: db.prepare(`
    UPDATE session_notes SET customer_id = ? WHERE session_url = ?
  `)
};

// Action items operations
const actionItemOps = {
  create: db.prepare(`
    INSERT INTO action_items (session_note_id, customer_id, owner, item, session_date, session_title)
    VALUES (?, ?, ?, ?, ?, ?)
  `),

  getByCustomerId: db.prepare(`
    SELECT * FROM action_items
    WHERE customer_id = ?
    ORDER BY completed ASC, session_date DESC, created_at DESC
  `),

  getOpenByCustomerId: db.prepare(`
    SELECT * FROM action_items
    WHERE customer_id = ? AND completed = FALSE
    ORDER BY session_date DESC, created_at DESC
  `),

  getById: db.prepare(`
    SELECT * FROM action_items WHERE id = ?
  `),

  toggleComplete: db.prepare(`
    UPDATE action_items
    SET completed = NOT completed,
        completed_at = CASE WHEN completed = FALSE THEN CURRENT_TIMESTAMP ELSE NULL END
    WHERE id = ?
  `),

  deleteBySessionNoteId: db.prepare(`
    DELETE FROM action_items WHERE session_note_id = ?
  `),

  countOpenByCustomerId: db.prepare(`
    SELECT COUNT(*) as count FROM action_items
    WHERE customer_id = ? AND completed = FALSE
  `),

  updateCustomerId: db.prepare(`
    UPDATE action_items SET customer_id = ? WHERE id = ?
  `),

  updateItem: db.prepare(`
    UPDATE action_items SET owner = ?, item = ?, session_date = ? WHERE id = ?
  `)
};

// Queue operations
const queueOps = {
  add: db.prepare(`
    INSERT INTO processing_queue (session_url, title, status)
    VALUES (?, ?, 'pending')
    ON CONFLICT(session_url) DO UPDATE SET
      status = 'pending',
      title = excluded.title,
      error = NULL,
      started_at = NULL,
      completed_at = NULL
    WHERE status = 'failed'
  `),

  getNextPending: db.prepare(`
    SELECT * FROM processing_queue
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT 1
  `),

  markProcessing: db.prepare(`
    UPDATE processing_queue
    SET status = 'processing', started_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `),

  markCompleted: db.prepare(`
    UPDATE processing_queue
    SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
        result_summary = ?, customer_id = ?
    WHERE id = ?
  `),

  markFailed: db.prepare(`
    UPDATE processing_queue
    SET status = 'failed', completed_at = CURRENT_TIMESTAMP, error = ?
    WHERE id = ?
  `),

  getById: db.prepare(`
    SELECT * FROM processing_queue WHERE id = ?
  `),

  getBySessionUrl: db.prepare(`
    SELECT * FROM processing_queue WHERE session_url = ?
  `),

  isQueued: db.prepare(`
    SELECT 1 FROM processing_queue WHERE session_url = ? AND status IN ('pending', 'processing')
  `),

  getPendingCount: db.prepare(`
    SELECT COUNT(*) as count FROM processing_queue WHERE status = 'pending'
  `),

  getProcessingJob: db.prepare(`
    SELECT * FROM processing_queue WHERE status = 'processing' LIMIT 1
  `),

  getRecentCompleted: db.prepare(`
    SELECT * FROM processing_queue
    WHERE status IN ('completed', 'failed')
    ORDER BY completed_at DESC
    LIMIT 20
  `),

  deletePending: db.prepare(`
    DELETE FROM processing_queue WHERE id = ? AND status = 'pending'
  `),

  resetStale: db.prepare(`
    UPDATE processing_queue
    SET status = 'failed', error = 'Processing interrupted - app restarted', completed_at = CURRENT_TIMESTAMP
    WHERE status = 'processing'
  `),

  retryFailed: db.prepare(`
    UPDATE processing_queue
    SET status = 'pending', error = NULL, started_at = NULL, completed_at = NULL
    WHERE id = ? AND status = 'failed'
  `),

  clearOldCompleted: db.prepare(`
    DELETE FROM processing_queue
    WHERE status IN ('completed', 'failed') AND completed_at < datetime('now', '-7 days')
  `)
};

// High-level functions
function createCustomer(name, isUnknown = false) {
  const result = customerOps.create.run(name, isUnknown ? 1 : 0);
  return result.lastInsertRowid;
}

function getCustomer(id) {
  return customerOps.getById.get(id);
}

function getAllCustomers() {
  return customerOps.getAll.all();
}

function getUnknownCustomers() {
  return customerOps.getUnknown.all();
}

function updateCustomer(id, name, isUnknown) {
  customerOps.update.run(name, isUnknown ? 1 : 0, id);
}

function searchCustomers(query) {
  return customerOps.search.all(`%${query}%`);
}

function createDiagram(customerId) {
  const result = diagramOps.create.run(customerId);
  return result.lastInsertRowid;
}

function getDiagram(id) {
  return diagramOps.getById.get(id);
}

function getDiagramByCustomer(customerId) {
  return diagramOps.getByCustomerId.get(customerId);
}

function getAllDiagramsWithLatestVersion() {
  return diagramOps.getAllWithLatestVersion.all();
}

function createVersion(diagramId, mermaidCode, notes = null) {
  const { next_version } = versionOps.getNextVersion.get(diagramId);
  const result = versionOps.create.run(diagramId, next_version, mermaidCode, null, notes);
  return { id: result.lastInsertRowid, version: next_version };
}

function getLatestVersion(diagramId) {
  return versionOps.getLatest.get(diagramId);
}

function getVersion(diagramId, version) {
  return versionOps.getByVersion.get(diagramId, version);
}

function getAllVersions(diagramId) {
  return versionOps.getAllForDiagram.all(diagramId);
}

function updateVersionPngPath(versionId, pngPath) {
  versionOps.updatePngPath.run(pngPath, versionId);
}

function deleteVersion(versionId) {
  const result = versionOps.delete.run(versionId);
  return result.changes > 0;
}

function addSession(diagramId, sessionUrl) {
  sessionOps.create.run(diagramId, sessionUrl);
}

function getDiagramSessionByUrl(sessionUrl) {
  return sessionOps.getByUrl.get(sessionUrl);
}

// Customer deletion - deletes customer record
function deleteCustomer(customerId) {
  const result = customerOps.delete.run(customerId);
  return result.changes > 0;
}

// Update diagram's customer (for merging customers)
function updateDiagramCustomer(diagramId, customerId) {
  customerOps.mergeIntoDiagram.run(customerId, diagramId);
}

// Delete diagram (cascades to versions and sessions)
function deleteDiagram(diagramId) {
  const result = diagramOps.delete.run(diagramId);
  return result.changes > 0;
}

function getSessions(diagramId) {
  return sessionOps.getByDiagramId.all(diagramId);
}

function sessionExists(sessionUrl) {
  return !!sessionOps.exists.get(sessionUrl);
}

// Session notes functions
function saveSessionNotes(sessionUrl, customerId, callType, title, summary, actionItems, components, gaps, sessionDate = null) {
  const existing = notesOps.getByUrl.get(sessionUrl);
  const actionItemsJson = JSON.stringify(actionItems || []);
  const componentsJson = JSON.stringify(components || []);
  const gapsJson = JSON.stringify(gaps || []);

  if (existing && !existing.skipped) {
    notesOps.update.run(customerId, callType, title, summary, actionItemsJson, componentsJson, gapsJson, sessionDate, sessionUrl);
    return existing.id;
  } else {
    const result = notesOps.create.run(sessionUrl, customerId, callType, title, summary, actionItemsJson, componentsJson, gapsJson, sessionDate);
    return result.lastInsertRowid;
  }
}

function getSessionNotes(sessionUrl) {
  const note = notesOps.getByUrl.get(sessionUrl);
  if (note) {
    note.action_items = JSON.parse(note.action_items || '[]');
    note.components = JSON.parse(note.components || '[]');
    note.gaps = JSON.parse(note.gaps || '[]');
  }
  return note;
}

function getSessionNotesByCustomer(customerId) {
  const notes = notesOps.getByCustomerId.all(customerId);
  return notes.map(n => ({
    ...n,
    action_items: JSON.parse(n.action_items || '[]'),
    components: JSON.parse(n.components || '[]'),
    gaps: JSON.parse(n.gaps || '[]')
  }));
}

function getRecentSessionNotes(limit = 20) {
  const notes = notesOps.getRecent.all(limit);
  return notes.map(n => ({
    ...n,
    action_items: JSON.parse(n.action_items || '[]'),
    components: JSON.parse(n.components || '[]'),
    gaps: JSON.parse(n.gaps || '[]')
  }));
}

function skipSession(sessionUrl, title) {
  notesOps.skip.run(sessionUrl, title);
}

function unskipSession(sessionUrl) {
  notesOps.unskip.run(sessionUrl);
}

function isSessionSkipped(sessionUrl) {
  return !!notesOps.isSkipped.get(sessionUrl);
}

function isSessionProcessed(sessionUrl) {
  return !!notesOps.exists.get(sessionUrl);
}

function updateSessionCustomer(sessionUrl, customerId) {
  notesOps.updateCustomer.run(customerId, sessionUrl);
}

// Action item functions
function createActionItem(sessionNoteId, customerId, owner, item, sessionDate, sessionTitle) {
  const result = actionItemOps.create.run(sessionNoteId, customerId, owner, item, sessionDate, sessionTitle);
  return result.lastInsertRowid;
}

function getActionItemsByCustomer(customerId, includeCompleted = true) {
  if (includeCompleted) {
    return actionItemOps.getByCustomerId.all(customerId);
  }
  return actionItemOps.getOpenByCustomerId.all(customerId);
}

function getActionItem(id) {
  return actionItemOps.getById.get(id);
}

function toggleActionItemComplete(id) {
  actionItemOps.toggleComplete.run(id);
  return actionItemOps.getById.get(id);
}

function deleteActionItemsBySessionNote(sessionNoteId) {
  actionItemOps.deleteBySessionNoteId.run(sessionNoteId);
}

function getOpenActionItemCount(customerId) {
  const result = actionItemOps.countOpenByCustomerId.get(customerId);
  return result ? result.count : 0;
}

// Save action items from a processed session
function saveActionItemsFromSession(sessionNoteId, customerId, actionItems, sessionDate, sessionTitle) {
  // Delete existing action items for this session (in case of reprocessing)
  deleteActionItemsBySessionNote(sessionNoteId);

  // Insert new action items
  const ids = [];
  for (const item of actionItems) {
    const id = createActionItem(
      sessionNoteId,
      customerId,
      item.owner || 'Unknown',
      item.item,
      sessionDate,
      sessionTitle
    );
    ids.push(id);
  }
  return ids;
}

// Move an action item to a different customer
function moveActionItemToCustomer(actionItemId, newCustomerId) {
  actionItemOps.updateCustomerId.run(newCustomerId, actionItemId);
  return actionItemOps.getById.get(actionItemId);
}

// Update action item details (owner, text, date)
function updateActionItem(id, owner, item, sessionDate) {
  actionItemOps.updateItem.run(owner, item, sessionDate, id);
  return actionItemOps.getById.get(id);
}

// Delete a diagram but keep associated action items
// Action items have their own customer_id so they survive
function deleteDiagramKeepActionItems(diagramId) {
  const diagram = diagramOps.getById.get(diagramId);
  if (!diagram) return false;

  // Get the session URLs associated with this diagram
  const sessions = db.prepare('SELECT session_url FROM diagram_sessions WHERE diagram_id = ?').all(diagramId);

  // For each session, disconnect session_notes from the diagram by setting call_type to non-technical
  // This preserves the notes and action items but removes the diagram association
  for (const session of sessions) {
    db.prepare(`
      UPDATE session_notes
      SET call_type = 'non-technical'
      WHERE session_url = ?
    `).run(session.session_url);
  }

  // Delete the diagram versions (PNGs will be orphaned but that's ok)
  db.prepare('DELETE FROM diagram_versions WHERE diagram_id = ?').run(diagramId);

  // Delete the diagram sessions
  db.prepare('DELETE FROM diagram_sessions WHERE diagram_id = ?').run(diagramId);

  // Delete the diagram itself
  db.prepare('DELETE FROM diagrams WHERE id = ?').run(diagramId);

  return true;
}

// Queue functions
function addToQueue(sessionUrl, title = null) {
  const result = queueOps.add.run(sessionUrl, title);
  return result.lastInsertRowid;
}

function getNextPendingJob() {
  return queueOps.getNextPending.get();
}

function markJobProcessing(id) {
  queueOps.markProcessing.run(id);
}

function markJobCompleted(id, resultSummary, customerId) {
  queueOps.markCompleted.run(resultSummary, customerId, id);
}

function markJobFailed(id, error) {
  queueOps.markFailed.run(error, id);
}

function getQueueJob(id) {
  return queueOps.getById.get(id);
}

function getQueueJobByUrl(sessionUrl) {
  return queueOps.getBySessionUrl.get(sessionUrl);
}

function isSessionQueued(sessionUrl) {
  return !!queueOps.isQueued.get(sessionUrl);
}

function getQueueStatus() {
  const pendingCount = queueOps.getPendingCount.get().count;
  const processingJob = queueOps.getProcessingJob.get();
  const recentCompleted = queueOps.getRecentCompleted.all();

  return {
    pending_count: pendingCount,
    processing_count: processingJob ? 1 : 0,
    current_job: processingJob,
    recent_completed: recentCompleted
  };
}

function deleteFromQueue(id) {
  const result = queueOps.deletePending.run(id);
  return result.changes > 0;
}

function resetStaleQueueJobs() {
  const result = queueOps.resetStale.run();
  if (result.changes > 0) {
    console.log(`Reset ${result.changes} stale processing jobs`);
  }
}

function retryQueueJob(id) {
  const result = queueOps.retryFailed.run(id);
  return result.changes > 0;
}

function clearOldQueueJobs() {
  queueOps.clearOldCompleted.run();
}

// Create or get customer's diagram, add a new version
function addDiagramVersion(customerName, mermaidCode, sessionUrl = null, notes = null, isUnknown = false) {
  let customer;

  if (isUnknown) {
    // For unknown customers, ALWAYS create a new customer entry - no versioning/iteration
    const customerId = createCustomer(customerName, true);
    customer = { id: customerId };
  } else {
    // For known customers, find existing or create new
    customer = customerOps.search.get(customerName);
    if (!customer) {
      const customerId = createCustomer(customerName, false);
      customer = { id: customerId };
    }
  }

  // Get or create diagram for customer
  let diagram = getDiagramByCustomer(customer.id);

  if (!diagram) {
    const diagramId = createDiagram(customer.id);
    diagram = { id: diagramId };
  }

  // Create new version (for unknown customers this will always be version 1)
  const version = createVersion(diagram.id, mermaidCode, notes);

  // Add session if provided
  if (sessionUrl) {
    addSession(diagram.id, sessionUrl);
  }

  // Update customer timestamp
  const existingCustomer = getCustomer(customer.id);
  updateCustomer(customer.id, existingCustomer.name, existingCustomer.is_unknown);

  return {
    customerId: customer.id,
    diagramId: diagram.id,
    versionId: version.id,
    version: version.version
  };
}

// Migration: Populate action_items table from existing session_notes JSON
function migrateActionItems() {
  // Check if migration is needed (if action_items table is empty but session_notes has data)
  const actionItemCount = db.prepare('SELECT COUNT(*) as count FROM action_items').get().count;
  const sessionNotesCount = db.prepare("SELECT COUNT(*) as count FROM session_notes WHERE action_items IS NOT NULL AND action_items != '[]' AND skipped = FALSE").get().count;

  if (actionItemCount === 0 && sessionNotesCount > 0) {
    console.log('Migrating action items from session_notes to action_items table...');

    const notes = db.prepare(`
      SELECT id, session_url, customer_id, title, action_items, processed_at
      FROM session_notes
      WHERE action_items IS NOT NULL AND action_items != '[]' AND skipped = FALSE AND customer_id IS NOT NULL
    `).all();

    let migratedCount = 0;
    for (const note of notes) {
      try {
        const items = JSON.parse(note.action_items || '[]');
        const sessionDate = note.processed_at ? new Date(note.processed_at).toISOString().split('T')[0] : null;

        for (const item of items) {
          actionItemOps.create.run(
            note.id,
            note.customer_id,
            item.owner || 'Unknown',
            item.item,
            sessionDate,
            note.title
          );
          migratedCount++;
        }
      } catch (e) {
        console.error('Failed to migrate action items for session', note.session_url, e.message);
      }
    }

    console.log(`Migrated ${migratedCount} action items from ${notes.length} sessions`);
  }
}

// Run migration on startup
migrateActionItems();

module.exports = {
  db,
  createCustomer,
  getCustomer,
  getAllCustomers,
  getUnknownCustomers,
  updateCustomer,
  searchCustomers,
  createDiagram,
  getDiagram,
  getDiagramByCustomer,
  getAllDiagramsWithLatestVersion,
  createVersion,
  getLatestVersion,
  getVersion,
  getAllVersions,
  updateVersionPngPath,
  deleteVersion,
  addSession,
  getSessions,
  sessionExists,
  getDiagramSessionByUrl,
  deleteCustomer,
  updateDiagramCustomer,
  deleteDiagram,
  addDiagramVersion,
  // Session notes
  saveSessionNotes,
  getSessionNotes,
  getSessionNotesByCustomer,
  getRecentSessionNotes,
  skipSession,
  unskipSession,
  isSessionSkipped,
  isSessionProcessed,
  updateSessionCustomer,
  // Action items
  createActionItem,
  getActionItemsByCustomer,
  getActionItem,
  toggleActionItemComplete,
  deleteActionItemsBySessionNote,
  getOpenActionItemCount,
  saveActionItemsFromSession,
  moveActionItemToCustomer,
  updateActionItem,
  // Diagram management
  deleteDiagramKeepActionItems,
  // Queue
  addToQueue,
  getNextPendingJob,
  markJobProcessing,
  markJobCompleted,
  markJobFailed,
  getQueueJob,
  getQueueJobByUrl,
  isSessionQueued,
  getQueueStatus,
  deleteFromQueue,
  resetStaleQueueJobs,
  retryQueueJob,
  clearOldQueueJobs
};
