const puppeteer = require('puppeteer');
const fs = require('fs');

const SESSION_STORAGE_PATH = './data/wave-session.json';
const WAVE_URL = 'https://app.wave.co/sessions/4c83cde0-6b81-4228-a022-c8b9146b3390';

async function testWave() {
  console.log('Starting Puppeteer...');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
  });

  try {
    const page = await browser.newPage();

    // Load saved session if exists
    if (fs.existsSync(SESSION_STORAGE_PATH)) {
      console.log('Loading saved session...');
      const session = JSON.parse(fs.readFileSync(SESSION_STORAGE_PATH, 'utf8'));

      // Set cookies
      if (session.cookies) {
        await page.setCookie(...session.cookies);
      }
    }

    console.log('Navigating to Wave...');
    await page.goto(WAVE_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    const currentUrl = page.url();
    console.log('Current URL:', currentUrl);

    if (currentUrl.includes('/login')) {
      console.log('\n=== NOT LOGGED IN ===');
      console.log('Wave requires authentication.');
      console.log('\nTo get cookies, you can:');
      console.log('1. Log in to Wave in your browser');
      console.log('2. Open DevTools > Application > Cookies');
      console.log('3. Export all wave.co cookies');

      // Take screenshot of login page
      await page.screenshot({ path: './data/wave-login.png' });
      console.log('\nScreenshot saved to: ./data/wave-login.png');
    } else {
      console.log('\n=== LOGGED IN ===');

      // Wait for content to load
      await page.waitForTimeout(3000);

      // Get page title
      const title = await page.title();
      console.log('Page title:', title);

      // Take screenshot
      await page.screenshot({ path: './data/wave-session.png', fullPage: true });
      console.log('Screenshot saved to: ./data/wave-session.png');

      // Get page content
      const content = await page.content();
      fs.writeFileSync('./data/wave-content.html', content);
      console.log('HTML saved to: ./data/wave-content.html');

      // Try to find transcript text
      const text = await page.evaluate(() => {
        // Look for transcript container
        const transcript = document.querySelector('[class*="transcript"]') ||
                          document.querySelector('[data-transcript]') ||
                          document.body;
        return transcript ? transcript.innerText : '';
      });

      console.log('\n=== TRANSCRIPT PREVIEW ===');
      console.log(text.substring(0, 2000));

      // Save cookies for future use
      const cookies = await page.cookies();
      fs.writeFileSync(SESSION_STORAGE_PATH, JSON.stringify({ cookies }, null, 2));
      console.log('\nSession saved for future use');
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
}

testWave().catch(console.error);
