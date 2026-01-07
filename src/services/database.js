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

  CREATE INDEX IF NOT EXISTS idx_diagrams_customer ON diagrams(customer_id);
  CREATE INDEX IF NOT EXISTS idx_versions_diagram ON diagram_versions(diagram_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_diagram ON diagram_sessions(diagram_id);
`);

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
           v.version as latest_version, v.png_path, v.created_at as version_created_at
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
  `)
};

// Session operations
const sessionOps = {
  create: db.prepare(`
    INSERT INTO diagram_sessions (diagram_id, session_url) VALUES (?, ?)
  `),

  getByDiagramId: db.prepare(`
    SELECT * FROM diagram_sessions WHERE diagram_id = ? ORDER BY processed_at DESC
  `),

  exists: db.prepare(`
    SELECT 1 FROM diagram_sessions WHERE session_url = ?
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

function addSession(diagramId, sessionUrl) {
  sessionOps.create.run(diagramId, sessionUrl);
}

function getSessions(diagramId) {
  return sessionOps.getByDiagramId.all(diagramId);
}

function sessionExists(sessionUrl) {
  return !!sessionOps.exists.get(sessionUrl);
}

// Create or get customer's diagram, add a new version
function addDiagramVersion(customerName, mermaidCode, sessionUrl = null, notes = null, isUnknown = false) {
  // Check if customer exists
  let customer = customerOps.search.get(customerName);

  if (!customer) {
    const customerId = createCustomer(customerName, isUnknown);
    customer = { id: customerId };
  }

  // Get or create diagram for customer
  let diagram = getDiagramByCustomer(customer.id);

  if (!diagram) {
    const diagramId = createDiagram(customer.id);
    diagram = { id: diagramId };
  }

  // Create new version
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
  addSession,
  getSessions,
  sessionExists,
  addDiagramVersion
};
