const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const SESSION_URL = process.argv[2] || 'https://app.wave.co/sessions/4c83cde0-6b81-4228-a022-c8b9146b3390';

async function fetchWaveSession() {
  // Load auth token
  const auth = JSON.parse(fs.readFileSync('./data/wave-auth.json', 'utf8'));

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
  });

  try {
    const page = await browser.newPage();

    // Set the auth cookie
    await page.setCookie({
      name: 'AuthToken',
      value: auth.AuthToken,
      domain: 'app.wave.co',
      path: '/',
      httpOnly: false,
      secure: true
    });

    console.log('Navigating to:', SESSION_URL);
    await page.goto(SESSION_URL, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for content to load
    console.log('Waiting for content...');
    await page.waitForFunction(() => {
      return !document.body.innerText.includes('Loading') ||
             document.body.innerText.length > 1000;
    }, { timeout: 30000 }).catch(() => {});

    // Extra wait for dynamic content
    await new Promise(r => setTimeout(r, 5000));

    // Get the page text
    const pageText = await page.evaluate(() => document.body.innerText);

    // Save it
    fs.writeFileSync('./data/wave-transcript.txt', pageText);
    console.log('\n=== TRANSCRIPT ===\n');
    console.log(pageText);

    // Also save screenshot
    await page.screenshot({ path: './data/wave-session.png', fullPage: true });
    console.log('\nScreenshot saved to ./data/wave-session.png');

  } finally {
    await browser.close();
  }
}

fetchWaveSession().catch(console.error);
