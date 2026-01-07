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

// Create or update puppeteer config
const puppeteerConfig = {
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
};

// Use system Chromium if available (Docker environment)
if (process.env.PUPPETEER_EXECUTABLE_PATH) {
  puppeteerConfig.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
}

fs.writeFileSync(PUPPETEER_CONFIG, JSON.stringify(puppeteerConfig, null, 2));

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
      `${MMDC_PATH} -i "${tempInput}" -o "${outputPath}" -p "${PUPPETEER_CONFIG}" -b white -w 1600 -H 4000 -s 3`,
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
 * This creates a template showing gaps - vertical layout
 */
function generateSampleDiagram(customerName, knownComponents = {}) {
  const template = require('../config/infra-template');

  // Use block-beta for true vertical stacking
  let diagram = `block-beta
  columns 1

  block:header
    title["${customerName} Infrastructure"]
  end

`;

  template.categories.forEach((category, idx) => {
    const catId = category.name.replace(/\s+/g, '');
    diagram += `  block:${catId}\n`;
    diagram += `    columns 3\n`;
    diagram += `    ${catId}_header<["${category.name}"]>(down)\n`;
    diagram += `    space space\n`;

    category.components.forEach((component, compIdx) => {
      const compId = `${catId}_${compIdx}`;
      const known = knownComponents[category.name]?.[component];
      const label = known ? `${component}: ${known}` : `${component}: ???`;
      diagram += `    ${compId}["${label}"]\n`;
    });

    // Pad to fill row
    const remainder = category.components.length % 3;
    if (remainder > 0) {
      for (let i = 0; i < (3 - remainder); i++) {
        diagram += `    space\n`;
      }
    }

    diagram += `  end\n\n`;
  });

  // Add styles
  diagram += `  style header fill:none,stroke:none\n`;
  diagram += `  style title fill:#1a1a2e,color:white\n`;

  template.categories.forEach((category) => {
    const catId = category.name.replace(/\s+/g, '');
    diagram += `  style ${catId}_header fill:${category.color},color:white\n`;
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
