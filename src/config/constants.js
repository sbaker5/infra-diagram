/**
 * Application constants
 * Centralized configuration values used across the application
 */

// Queue Worker
const QUEUE_POLL_INTERVAL_MS = 3000; // Check for jobs every 3 seconds

// Wave Scraping
const MAX_SCROLL_ATTEMPTS = 50; // Safety limit for infinite scroll

// Perplexity API
const TRANSCRIPT_MAX_LENGTH = 15000; // Characters to send to LLM
const LLM_MAX_TOKENS = 4000; // Max response tokens from LLM

// Layout polling
const LAYOUT_POLL_INTERVAL_MS = 5000; // Queue status polling in layout.ejs

module.exports = {
  QUEUE_POLL_INTERVAL_MS,
  MAX_SCROLL_ATTEMPTS,
  TRANSCRIPT_MAX_LENGTH,
  LLM_MAX_TOKENS,
  LAYOUT_POLL_INTERVAL_MS
};
