const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const SESSION_PATH = './data/wave-session.json';
const WAVE_SESSION_URL = 'https://app.wave.co/sessions/4c83cde0-6b81-4228-a022-c8b9146b3390';

const GOOGLE_EMAIL = 'stephenbaker0@gmail.com';
const GOOGLE_PASSWORD = '1ntel@md11';

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== Wave Login Script ===\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1920,1080',
      '--disable-popup-blocking',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
    ],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
  });

  const context = browser.defaultBrowserContext();
  await context.overridePermissions('https://app.wave.co', ['notifications']);

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  try {
    // Step 1: Go to Wave login
    console.log('[1/6] Navigating to Wave...');
    await page.goto('https://app.wave.co/login', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000);

    // Intercept window.open to capture OAuth URL
    console.log('[2/6] Setting up OAuth intercept...');

    let oauthUrl = null;

    // Override window.open to capture the URL
    await page.evaluateOnNewDocument(() => {
      const originalOpen = window.open;
      window.open = function(url, ...args) {
        window.__oauthUrl = url;
        console.log('OAuth URL intercepted:', url);
        return originalOpen.call(this, url, ...args);
      };
    });

    // Also listen for new targets
    browser.on('targetcreated', async target => {
      const url = target.url();
      console.log('   New target:', url);
      if (url.includes('accounts.google.com')) {
        oauthUrl = url;
      }
    });

    // Click the Google button
    console.log('[3/6] Clicking Google sign-in...');

    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent.toLowerCase().includes('google')) {
          btn.click();
          return true;
        }
      }
      return false;
    });

    await delay(3000);

    // Check if we captured the OAuth URL
    const capturedUrl = await page.evaluate(() => window.__oauthUrl);
    console.log('   Captured OAuth URL:', capturedUrl ? 'Yes' : 'No');

    // Get all pages
    const allPages = await browser.pages();
    console.log('   Total browser pages:', allPages.length);

    let authPage = null;

    for (let i = 0; i < allPages.length; i++) {
      const url = allPages[i].url();
      console.log(`   Page ${i}: ${url}`);

      // Look for Firebase auth handler or Google accounts page
      if (url.includes('firebaseapp.com/__/auth/handler') || url.includes('accounts.google.com')) {
        authPage = allPages[i];
        console.log('   Found auth page!');
      }
    }

    if (authPage) {
      // Wait for the Firebase handler to redirect to Google
      console.log('[4/6] Waiting for Google login page...');

      // The Firebase handler will redirect to Google
      await delay(3000);

      let currentAuthUrl = authPage.url();
      console.log('   Auth page URL:', currentAuthUrl);

      // Wait for redirect to Google
      let attempts = 0;
      while (!currentAuthUrl.includes('accounts.google.com') && attempts < 10) {
        await delay(1000);
        currentAuthUrl = authPage.url();
        console.log('   Waiting for Google redirect...', currentAuthUrl.substring(0, 50));
        attempts++;
      }

      if (currentAuthUrl.includes('accounts.google.com')) {
        console.log('   Google login page loaded!');
      }
    } else {
      // Fallback - check if popup is there but not detected
      await delay(2000);
      const retryPages = await browser.pages();
      console.log('   Retry: Total pages:', retryPages.length);

      for (const p of retryPages) {
        const url = p.url();
        if (url.includes('firebaseapp.com') || url.includes('accounts.google.com')) {
          authPage = p;
          break;
        }
      }

      if (!authPage) {
        await page.screenshot({ path: './data/wave-debug.png', fullPage: true });
        throw new Error('Could not find OAuth page');
      }
    }

    // Now handle Google login
    if (authPage) {
      console.log('[5/6] Handling Google login...');
      await handleGoogleLogin(authPage);

      // Wait for redirect back to Wave
      console.log('   Waiting for redirect to Wave...');
      await delay(5000);
    }

    // Check all pages for Wave authenticated state
    const finalPages = await browser.pages();
    let wavePage = null;

    for (const p of finalPages) {
      const url = p.url();
      if (url.includes('app.wave.co') && !url.includes('/login')) {
        wavePage = p;
        break;
      }
    }

    if (!wavePage) {
      // Try navigating back to Wave
      await page.goto('https://app.wave.co/', { waitUntil: 'networkidle2' });
      await delay(2000);

      if (!page.url().includes('/login')) {
        wavePage = page;
      }
    }

    if (wavePage) {
      console.log('\n✅ SUCCESS! Logged into Wave.\n');

      // Save session
      const cookies = await wavePage.cookies();
      const localStorage = await wavePage.evaluate(() => JSON.stringify(window.localStorage));

      fs.writeFileSync(SESSION_PATH, JSON.stringify({
        cookies,
        localStorage: JSON.parse(localStorage),
        savedAt: new Date().toISOString()
      }, null, 2));
      console.log('Session saved to:', SESSION_PATH);

      // Fetch transcript
      console.log('\nNavigating to Wave session...');
      await wavePage.goto(WAVE_SESSION_URL, { waitUntil: 'networkidle2' });
      await delay(3000);

      await wavePage.screenshot({ path: './data/wave-session.png', fullPage: true });
      console.log('Screenshot saved to: ./data/wave-session.png');

      const pageText = await wavePage.evaluate(() => document.body.innerText);
      fs.writeFileSync('./data/wave-transcript.txt', pageText);

      console.log('\n=== TRANSCRIPT PREVIEW ===');
      console.log(pageText.substring(0, 3000));
    } else {
      console.log('\n❌ Login failed');
      await page.screenshot({ path: './data/wave-failed.png', fullPage: true });
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    await page.screenshot({ path: './data/wave-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
}

async function handleGoogleLogin(page) {
  try {
    console.log('   Waiting for email input...');
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await delay(1000);

    // Type email character by character
    await page.click('input[type="email"]');
    await page.type('input[type="email"]', GOOGLE_EMAIL, { delay: 50 });
    await delay(1000);

    // Screenshot before clicking Next
    await page.screenshot({ path: './data/google-email.png' });
    console.log('   Entered email, clicking Next...');

    // Click Next - try multiple selectors
    const nextBtn = await page.$('#identifierNext');
    if (nextBtn) {
      await nextBtn.click();
    } else {
      // Try other selectors
      const altNext = await page.$('button[type="button"]');
      if (altNext) {
        await altNext.click();
      } else {
        await page.keyboard.press('Enter');
      }
    }

    // Wait longer for password page
    await delay(5000);

    // Screenshot to see what happened
    await page.screenshot({ path: './data/google-after-email.png' });
    console.log('   Screenshot saved to google-after-email.png');
    console.log('   Current URL:', page.url());

    console.log('   Looking for password field...');

    // Check if there's an error or different page
    const pageContent = await page.evaluate(() => document.body.innerText.substring(0, 500));
    console.log('   Page content preview:', pageContent.substring(0, 200));

    await page.waitForSelector('input[type="password"]', { visible: true, timeout: 20000 });
    await delay(1000);

    await page.type('input[type="password"]', GOOGLE_PASSWORD, { delay: 30 });
    await delay(500);

    const passBtn = await page.$('#passwordNext');
    if (passBtn) {
      await passBtn.click();
    } else {
      await page.keyboard.press('Enter');
    }
    await delay(5000);

    // Check for MFA
    const currentUrl = page.url();
    console.log('   Post-password URL:', currentUrl);

    if (currentUrl.includes('challenge')) {
      console.log('\n⚠️  MFA REQUIRED - Check your phone!');
      console.log('   Waiting 90 seconds...\n');

      for (let i = 90; i > 0; i -= 5) {
        await delay(5000);
        if (!page.url().includes('accounts.google.com')) {
          console.log('   MFA approved!');
          break;
        }
        console.log(`   Waiting... ${i-5}s`);
      }
    }

  } catch (error) {
    console.error('   Google login error:', error.message);
    await page.screenshot({ path: './data/google-error.png' });
    throw error;
  }
}

main();
