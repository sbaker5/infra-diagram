const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const util = require('util');

const execPromise = util.promisify(exec);

const EXPORTS_DIR = path.join(__dirname, '../../data/exports');

// Ensure exports directory exists
if (!fs.existsSync(EXPORTS_DIR)) {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}

// Path to mmdc (mermaid CLI)
const MMDC_PATH = path.join(__dirname, '../../node_modules/.bin/mmdc');

// Puppeteer config for mermaid-cli
const PUPPETEER_CONFIG = path.join(__dirname, '../../puppeteer-config.json');

// Create puppeteer config if it doesn't exist
if (!fs.existsSync(PUPPETEER_CONFIG)) {
  fs.writeFileSync(PUPPETEER_CONFIG, JSON.stringify({
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }));
}

/**
 * Validate Mermaid syntax
 * Returns { valid: boolean, error?: string }
 */
async function validate(mermaidCode) {
  const tempInput = path.join(EXPORTS_DIR, `temp-${Date.now()}.mmd`);
  const tempOutput = path.join(EXPORTS_DIR, `temp-${Date.now()}.png`);

  try {
    fs.writeFileSync(tempInput, mermaidCode);

    await execPromise(
      `${MMDC_PATH} -i "${tempInput}" -o "${tempOutput}" -p "${PUPPETEER_CONFIG}"`,
      { timeout: 30000 }
    );

    return { valid: true };
  } catch (error) {
    const errorMessage = error.stderr || error.message || 'Unknown error';
    return { valid: false, error: errorMessage };
  } finally {
    // Cleanup temp files
    try {
      if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
      if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

/**
 * Render Mermaid code to PNG
 * Returns the path to the generated PNG file
 */
async function renderToPng(mermaidCode, diagramId, version) {
  const filename = `diagram-${diagramId}-v${version}.png`;
  const outputPath = path.join(EXPORTS_DIR, filename);
  const tempInput = path.join(EXPORTS_DIR, `input-${Date.now()}.mmd`);

  try {
    fs.writeFileSync(tempInput, mermaidCode);

    await execPromise(
      `${MMDC_PATH} -i "${tempInput}" -o "${outputPath}" -p "${PUPPETEER_CONFIG}" -b white -w 1200`,
      { timeout: 60000 }
    );

    return filename;
  } catch (error) {
    console.error('Mermaid render error:', error);
    throw new Error(`Failed to render diagram: ${error.message}`);
  } finally {
    // Cleanup temp input file
    try {
      if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

/**
 * Get the full path to a PNG export
 */
function getPngPath(filename) {
  return path.join(EXPORTS_DIR, filename);
}

/**
 * Check if a PNG exists
 */
function pngExists(filename) {
  return fs.existsSync(path.join(EXPORTS_DIR, filename));
}

/**
 * Delete a PNG file
 */
function deletePng(filename) {
  const fullPath = path.join(EXPORTS_DIR, filename);
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
}

/**
 * Generate a sample infrastructure diagram
 * This creates a template showing gaps
 */
function generateSampleDiagram(customerName, knownComponents = {}) {
  const template = require('../config/infra-template');

  let diagram = `flowchart TB
    subgraph title[" "]
        direction LR
        T["${customerName} Infrastructure"]
    end
    style title fill:none,stroke:none

`;

  template.categories.forEach((category, idx) => {
    diagram += `    subgraph ${category.name.replace(/\s+/g, '')}["${category.name}"]\n`;
    diagram += `        direction TB\n`;

    category.components.forEach((component, compIdx) => {
      const compId = `${category.name.replace(/\s+/g, '')}_${compIdx}`;
      const known = knownComponents[category.name]?.[component];

      if (known) {
        diagram += `        ${compId}["${component}: ${known}"]\n`;
        diagram += `        style ${compId} fill:${category.color},color:white\n`;
      } else {
        diagram += `        ${compId}["${component}: ???"]\n`;
        diagram += `        style ${compId} fill:#f0f0f0,stroke:#ccc,stroke-dasharray: 5 5\n`;
      }
    });

    diagram += `    end\n\n`;
  });

  return diagram;
}

module.exports = {
  validate,
  renderToPng,
  getPngPath,
  pngExists,
  deletePng,
  generateSampleDiagram,
  EXPORTS_DIR
};
