/**
 * Background queue worker for processing Wave sessions
 * Polls for pending jobs and processes them sequentially
 */
const db = require('./database');
const { processSession } = require('./session-processor');
const { QUEUE_POLL_INTERVAL_MS } = require('../config/constants');

// Event listeners for notifications
const listeners = new Set();

// Worker state
let isRunning = false;
let pollInterval = null;

/**
 * Add a listener for job completion/failure events
 * @param {Function} callback - Called with { type: 'completed'|'failed', job, result? }
 */
function addListener(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * Notify all listeners of an event
 */
function notifyListeners(event) {
  listeners.forEach(cb => {
    try {
      cb(event);
    } catch (e) {
      console.error('Queue listener error:', e);
    }
  });
}

/**
 * Process the next pending job in the queue
 */
async function processNextJob() {
  const job = db.getNextPendingJob();
  if (!job) {
    return null;
  }

  console.log(`[Queue] Processing job ${job.id}: ${job.title || job.session_url}`);
  db.markJobProcessing(job.id);

  try {
    const result = await processSession({
      sessionUrl: job.session_url,
      title: job.title,
      logPrefix: '[Queue] '
    });

    const summary = `${result.callType === 'technical' ? 'Technical' : 'Non-technical'}: ${result.customerName}`;
    db.markJobCompleted(job.id, summary, result.customerId);

    console.log(`[Queue] Job ${job.id} completed: ${summary}`);

    notifyListeners({
      type: 'completed',
      job,
      result
    });

    return { job, result, success: true };
  } catch (error) {
    const errorMessage = error.message || 'Unknown error';
    db.markJobFailed(job.id, errorMessage);

    console.error(`[Queue] Job ${job.id} failed:`, errorMessage);

    notifyListeners({
      type: 'failed',
      job,
      error: errorMessage
    });

    return { job, error: errorMessage, success: false };
  }
}

/**
 * Poll for and process pending jobs
 */
async function poll() {
  // Only process if not already processing
  const status = db.getQueueStatus();
  if (status.processing) {
    return; // Already processing a job
  }

  await processNextJob();
}

/**
 * Start the background worker
 */
function start() {
  if (isRunning) {
    console.log('[Queue] Worker already running');
    return;
  }

  // Reset stale jobs from previous runs
  const staleCount = db.resetStaleQueueJobs();
  if (staleCount > 0) {
    console.log(`[Queue] Reset ${staleCount} stale jobs`);
  }

  // Clear old completed jobs (older than 24 hours)
  db.clearOldQueueJobs();

  isRunning = true;
  pollInterval = setInterval(poll, QUEUE_POLL_INTERVAL_MS);
  console.log('[Queue] Worker started');
}

/**
 * Stop the background worker
 */
function stop() {
  if (!isRunning) {
    return;
  }

  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  isRunning = false;
  console.log('[Queue] Worker stopped');
}

/**
 * Check if worker is running
 */
function isWorkerRunning() {
  return isRunning;
}

/**
 * Get current queue status
 */
function getStatus() {
  return {
    running: isRunning,
    ...db.getQueueStatus()
  };
}

module.exports = {
  start,
  stop,
  isWorkerRunning,
  getStatus,
  addListener,
  processNextJob
};
