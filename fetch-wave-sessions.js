const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

async function fetchWaveSessions() {
  const auth = JSON.parse(fs.readFileSync('./data/wave-auth.json', 'utf8'));

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
  });

  try {
    const page = await browser.newPage();

    await page.setCookie({
      name: 'AuthToken',
      value: auth.AuthToken,
      domain: 'app.wave.co',
      path: '/',
      httpOnly: false,
      secure: true
    });

    console.log('Fetching sessions list...');
    await page.goto('https://app.wave.co/sessions', { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for sessions to load
    await page.waitForFunction(() => {
      const text = document.body.innerText;
      return text.includes('Jan') || text.includes('Feb') || text.includes('Dec') || text.length > 2000;
    }, { timeout: 30000 }).catch(() => {});

    await new Promise(r => setTimeout(r, 3000));

    // Extract session data from the page - look for table rows
    const sessions = await page.evaluate(() => {
      const results = [];

      // Wave uses a table-like structure - look for rows with session links
      const rows = document.querySelectorAll('tr, [role="row"], div[class*="row"]');

      rows.forEach(row => {
        const link = row.querySelector('a[href*="/sessions/"]');
        if (!link) return;

        const href = link.getAttribute('href');
        const match = href.match(/\/sessions\/([a-f0-9-]{36})/);
        if (!match) return;

        const sessionId = match[1];

        // Get all text cells in this row
        const cells = row.querySelectorAll('td, [role="cell"], span, div');
        const cellTexts = [];
        cells.forEach(cell => {
          const text = cell.innerText?.trim();
          if (text && text.length < 200 && !text.includes('{')) {
            cellTexts.push(text);
          }
        });

        // Try to find title, date, duration
        const rowText = row.innerText || '';
        const dateMatch = rowText.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
        const durationMatch = rowText.match(/(\d{1,2}:\d{2}(?::\d{2})?)/g);

        // The link text is usually the title
        const title = link.innerText?.trim() || 'Untitled';

        results.push({
          id: sessionId,
          url: 'https://app.wave.co' + href,
          title: title,
          date: dateMatch ? dateMatch[1] : null,
          duration: durationMatch ? durationMatch[durationMatch.length - 1] : null
        });
      });

      // Fallback: if no rows found, look for links directly
      if (results.length === 0) {
        const links = document.querySelectorAll('a[href*="/sessions/"]');
        links.forEach(link => {
          const href = link.getAttribute('href');
          const match = href.match(/\/sessions\/([a-f0-9-]{36})/);
          if (match) {
            results.push({
              id: match[1],
              url: 'https://app.wave.co' + href,
              title: link.innerText?.trim() || 'Untitled',
              date: null,
              duration: null
            });
          }
        });
      }

      return results;
    });

    // Dedupe by ID
    const seen = new Set();
    const unique = sessions.filter(s => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });

    console.log('\nFound ' + unique.length + ' sessions:\n');
    unique.slice(0, 15).forEach((s, i) => {
      console.log((i+1) + '. ' + s.title);
      console.log('   Date: ' + (s.date || 'Unknown') + ' | Duration: ' + (s.duration || 'Unknown'));
      console.log('   ' + s.url + '\n');
    });

    // Save to file
    fs.writeFileSync('./data/wave-sessions.json', JSON.stringify(unique, null, 2));
    console.log('Saved to ./data/wave-sessions.json');

    // Also screenshot
    await page.screenshot({ path: './data/wave-sessions-list.png', fullPage: true });

  } finally {
    await browser.close();
  }
}

fetchWaveSessions().catch(console.error);
