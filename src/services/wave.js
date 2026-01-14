/**
 * Wave scraping service - fetches sessions and transcripts from Wave
 */
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const { MAX_SCROLL_ATTEMPTS } = require('../config/constants');

puppeteer.use(StealthPlugin());

const AUTH_PATH = path.join(__dirname, '../../data/wave-auth.json');
const SESSIONS_CACHE_PATH = path.join(__dirname, '../../data/wave-sessions.json');

class WaveService {
  constructor() {
    this.authToken = null;
    this.refreshing = false;
    this.refreshStartedAt = null;
    this.loadAuth();
  }

  isRefreshing() {
    return this.refreshing;
  }

  getRefreshStatus() {
    return {
      refreshing: this.refreshing,
      startedAt: this.refreshStartedAt
    };
  }

  loadAuth() {
    try {
      if (fs.existsSync(AUTH_PATH)) {
        const auth = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
        this.authToken = auth.AuthToken;
        console.log('Wave auth loaded');
      }
    } catch (err) {
      console.error('Failed to load Wave auth:', err.message);
    }
  }

  isAuthenticated() {
    return !!this.authToken;
  }

  async getBrowser() {
    return await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome'
    });
  }

  async setAuthCookie(page) {
    await page.setCookie({
      name: 'AuthToken',
      value: this.authToken,
      domain: 'app.wave.co',
      path: '/',
      httpOnly: false,
      secure: true
    });
  }

  /**
   * Fetch list of all Wave sessions (scrolls to load all)
   */
  async fetchSessions() {
    if (!this.isAuthenticated()) {
      throw new Error('Wave not authenticated');
    }

    if (this.refreshing) {
      throw new Error('Refresh already in progress');
    }

    this.refreshing = true;
    this.refreshStartedAt = new Date().toISOString();

    const browser = await this.getBrowser();

    try {
      const page = await browser.newPage();
      await this.setAuthCookie(page);

      console.log('Fetching Wave sessions list...');
      await page.goto('https://app.wave.co/sessions', { waitUntil: 'networkidle2', timeout: 60000 });

      // Wait for sessions to load
      await page.waitForFunction(() => {
        const text = document.body.innerText;
        return text.includes('Jan') || text.includes('Feb') || text.includes('Dec') || text.length > 2000;
      }, { timeout: 30000 }).catch(() => {});

      await new Promise(r => setTimeout(r, 2000));

      // Scroll to load all sessions (infinite scroll)
      console.log('Scrolling to load all sessions...');
      let previousHeight = 0;
      let scrollAttempts = 0;

      while (scrollAttempts < MAX_SCROLL_ATTEMPTS) {
        const currentHeight = await page.evaluate(() => document.body.scrollHeight);

        if (currentHeight === previousHeight) {
          // No new content loaded, try a few more times then stop
          scrollAttempts++;
          if (scrollAttempts >= 3) {
            console.log('No more content to load after', scrollAttempts, 'attempts');
            break;
          }
        } else {
          scrollAttempts = 0; // Reset counter when new content loads
        }

        previousHeight = currentHeight;

        // Scroll to bottom
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await new Promise(r => setTimeout(r, 1500)); // Wait for content to load

        // Log progress
        const sessionCount = await page.evaluate(() =>
          document.querySelectorAll('a[href*="/sessions/"]').length
        );
        console.log(`Loaded ${sessionCount} sessions so far...`);
      }

      console.log('Finished scrolling, extracting sessions...');

      // Extract session data - find all session links and their context
      const sessions = await page.evaluate(() => {
        const results = [];
        const links = document.querySelectorAll('a[href*="/sessions/"]');

        links.forEach(link => {
          const href = link.getAttribute('href');
          const match = href.match(/\/sessions\/([a-f0-9-]{36})/);
          if (!match) return;

          const sessionId = match[1];
          const rawTitle = link.innerText?.trim() || 'Untitled';

          // Skip navigation/header links (usually short or generic text)
          if (rawTitle.length < 5 || rawTitle === 'Sessions' || rawTitle === 'View') return;

          let date = null;
          let duration = null;
          let title = rawTitle;

          // PRIORITY: Extract date from title (format: "Title12/19/2025, 7:07:43 PM·46:10")
          // Wave embeds date/time/duration directly in the title text
          const titleDateMatch = rawTitle.match(/(\d{1,2}\/\d{1,2}\/\d{4}),?\s*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)/i);
          if (titleDateMatch) {
            date = titleDateMatch[1]; // e.g., "12/19/2025"
            // Clean up title by removing the date/time portion
            title = rawTitle.replace(/\d{1,2}\/\d{1,2}\/\d{4},?\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?/i, '').trim();
          }

          // Extract duration from title (format: "·46:10" or similar)
          const durationMatch = rawTitle.match(/[·•]\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*$/);
          if (durationMatch) {
            duration = durationMatch[1];
            // Remove duration from title
            title = title.replace(/[·•]\s*\d{1,2}:\d{2}(?::\d{2})?\s*$/, '').trim();
          }

          // Fallback: look for date in nearby elements if not found in title
          if (!date) {
            let container = link.parentElement;
            for (let i = 0; i < 3 && container && !date; i++) {
              const siblings = container.querySelectorAll('span, div, p, time');
              siblings.forEach(el => {
                const text = el.innerText?.trim() || '';
                if (text === rawTitle || text.length > 50) return;

                if (!date) {
                  const dateMatch = text.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
                  if (dateMatch) date = dateMatch[1];
                  const dateMatch2 = text.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4})/i);
                  if (dateMatch2) date = dateMatch2[1];
                }
              });
              container = container.parentElement;
            }
          }

          results.push({
            id: sessionId,
            url: 'https://app.wave.co' + href,
            title: title,
            date: date,
            duration: duration
          });
        });

        return results;
      });

      // Dedupe by ID
      const seen = new Set();
      const unique = sessions.filter(s => {
        if (seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
      });

      console.log(`Found ${unique.length} unique sessions`);

      // Cache the sessions
      fs.writeFileSync(SESSIONS_CACHE_PATH, JSON.stringify(unique, null, 2));

      this.refreshing = false;
      return unique;
    } finally {
      this.refreshing = false;
      await browser.close();
    }
  }

  /**
   * Fetch transcript from a specific session
   */
  async fetchTranscript(sessionUrl) {
    if (!this.isAuthenticated()) {
      throw new Error('Wave not authenticated');
    }

    const browser = await this.getBrowser();

    try {
      const page = await browser.newPage();
      await this.setAuthCookie(page);

      console.log('Fetching Wave transcript:', sessionUrl);
      await page.goto(sessionUrl, { waitUntil: 'networkidle2', timeout: 60000 });

      // Wait for content to load
      await page.waitForFunction(() => {
        return !document.body.innerText.includes('Loading') ||
               document.body.innerText.length > 1000;
      }, { timeout: 30000 }).catch(() => {});

      await new Promise(r => setTimeout(r, 5000));

      const pageText = await page.evaluate(() => document.body.innerText);

      return pageText;
    } finally {
      await browser.close();
    }
  }

  /**
   * Get cached sessions without fetching
   */
  getCachedSessions() {
    try {
      if (fs.existsSync(SESSIONS_CACHE_PATH)) {
        return JSON.parse(fs.readFileSync(SESSIONS_CACHE_PATH, 'utf8'));
      }
    } catch (err) {
      console.error('Failed to load cached sessions:', err.message);
    }
    return [];
  }

  /**
   * Update auth token
   */
  updateAuth(authToken) {
    this.authToken = authToken;
    fs.writeFileSync(AUTH_PATH, JSON.stringify({
      AuthToken: authToken,
      savedAt: new Date().toISOString()
    }, null, 2));
  }
}

module.exports = new WaveService();
