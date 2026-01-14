/**
 * Wave Sessions page client-side functionality
 * Handles session processing, queue management, and UI updates
 */
(function() {
  'use strict';

  // DOM Elements
  const refreshBtn = document.getElementById('refresh-btn');
  const sessionsList = document.getElementById('sessions-list');
  const modal = document.getElementById('transcript-modal');
  const modalTitle = document.getElementById('modal-title');
  const transcriptLoading = document.getElementById('transcript-loading');
  const transcriptContent = document.getElementById('transcript-content');
  const transcriptText = document.getElementById('transcript-text');
  const copyBtn = document.getElementById('copy-transcript');
  const showSkippedCheckbox = document.getElementById('show-skipped');
  const hideProcessedCheckbox = document.getElementById('hide-processed');
  const queueStatusPanel = document.getElementById('queue-status-panel');
  const queueStatusText = document.getElementById('queue-status-text');
  const queueProgressText = document.getElementById('queue-progress-text');
  const queueProgressFill = document.getElementById('queue-progress-fill');

  // State
  let currentSessionData = null;
  const queuedSessions = new Set();
  let batchTotal = 0;
  let batchCompleted = 0;

  // ============================================
  // Skip Filter
  // ============================================

  function initSkipFilter() {
    if (!showSkippedCheckbox) return;

    showSkippedCheckbox.addEventListener('change', function() {
      if (this.checked) {
        sessionsList.classList.add('show-skipped');
      } else {
        sessionsList.classList.remove('show-skipped');
      }
    });
  }

  function initHideProcessedFilter() {
    if (!hideProcessedCheckbox) return;

    // Checkbox checked = hide processed (no class), unchecked = show processed (add class)
    hideProcessedCheckbox.addEventListener('change', function() {
      if (this.checked) {
        sessionsList.classList.remove('show-processed');
      } else {
        sessionsList.classList.add('show-processed');
      }
    });
  }

  // ============================================
  // Refresh Sessions
  // ============================================

  function initRefreshButton() {
    if (!refreshBtn) return;

    refreshBtn.addEventListener('click', async function() {
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = '<span class="refresh-icon">&#8635;</span> Refreshing...';

      // Disable queue buttons during refresh
      const queueNext10Btn = document.getElementById('btn-queue-next-10');
      const queueAllBtn = document.getElementById('btn-queue-all');
      if (queueNext10Btn) queueNext10Btn.disabled = true;
      if (queueAllBtn) queueAllBtn.disabled = true;

      // Show refresh status panel
      showRefreshStatus();

      // Start polling in case user navigates away and comes back
      startRefreshPolling();

      try {
        const res = await fetch('/api/wave/refresh', { method: 'POST', keepalive: true });
        const data = await res.json();

        if (res.ok) {
          location.reload();
        } else {
          alert('Error: ' + (data.error || 'Failed to refresh'));
          hideRefreshStatus();
          resetRefreshButton();
          if (queueNext10Btn) queueNext10Btn.disabled = false;
          if (queueAllBtn) queueAllBtn.disabled = false;
        }
      } catch (err) {
        // Don't show error if user navigated away (request aborted)
        if (err.name !== 'AbortError') {
          alert('Error: ' + err.message);
          hideRefreshStatus();
          resetRefreshButton();
          if (queueNext10Btn) queueNext10Btn.disabled = false;
          if (queueAllBtn) queueAllBtn.disabled = false;
        }
      }
    });
  }

  function showRefreshStatus() {
    let panel = document.getElementById('refresh-status-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'refresh-status-panel';
      panel.className = 'refresh-status-panel';
      panel.innerHTML = '<div class="refresh-status-content"><span class="refresh-status-icon">&#8635;</span><span>Refreshing sessions from Wave... This may take 30-60 seconds.</span></div>';
      const container = document.querySelector('.sessions-container');
      if (container) {
        container.insertBefore(panel, container.firstChild);
      }
    }
    panel.style.display = 'block';
  }

  function hideRefreshStatus() {
    const panel = document.getElementById('refresh-status-panel');
    if (panel) {
      panel.style.display = 'none';
    }
  }

  function resetRefreshButton() {
    refreshBtn.disabled = false;
    refreshBtn.innerHTML = '<span class="refresh-icon">&#8635;</span> Refresh';
  }

  // ============================================
  // Skip/Unskip Functionality
  // ============================================

  function initSkipButtons() {
    document.querySelectorAll('.btn-skip').forEach(function(btn) {
      btn.addEventListener('click', handleSkip);
    });

    document.querySelectorAll('.btn-unskip').forEach(function(btn) {
      btn.addEventListener('click', handleUnskip);
    });
  }

  async function handleSkip() {
    const btn = this;
    const url = btn.dataset.url;
    const title = btn.dataset.title;
    const card = btn.closest('.session-card');

    btn.disabled = true;
    btn.textContent = 'Skipping...';

    try {
      const res = await fetch('/api/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_url: url, title: title }),
        keepalive: true
      });

      if (res.ok) {
        updateCardToSkipped(card, url);
      } else {
        const data = await res.json();
        alert('Error: ' + (data.error || 'Failed to skip'));
        btn.disabled = false;
        btn.textContent = 'Skip';
      }
    } catch (err) {
      alert('Error: ' + err.message);
      btn.disabled = false;
      btn.textContent = 'Skip';
    }
  }

  function updateCardToSkipped(card, url) {
    card.classList.add('skipped');
    const actionsDiv = card.querySelector('.session-actions');
    actionsDiv.innerHTML =
      '<span class="badge badge-muted">Skipped</span>' +
      '<button class="btn btn-sm btn-outline btn-unskip" data-url="' + url + '">Undo</button>' +
      '<a href="' + url + '" target="_blank" class="btn btn-link">View</a>';
    actionsDiv.querySelector('.btn-unskip').addEventListener('click', handleUnskip);
  }

  async function handleUnskip() {
    const btn = this;
    const url = btn.dataset.url;
    const card = btn.closest('.session-card');

    btn.disabled = true;
    btn.textContent = 'Restoring...';

    try {
      const res = await fetch('/api/unskip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_url: url }),
        keepalive: true
      });

      if (res.ok) {
        location.reload();
      } else {
        const data = await res.json();
        alert('Error: ' + (data.error || 'Failed to unskip'));
        btn.disabled = false;
        btn.textContent = 'Undo';
      }
    } catch (err) {
      alert('Error: ' + err.message);
      btn.disabled = false;
      btn.textContent = 'Undo';
    }
  }

  // ============================================
  // Process Session
  // ============================================

  function initProcessButtons() {
    document.querySelectorAll('.btn-process').forEach(function(btn) {
      btn.addEventListener('click', handleProcess);
    });
  }

  async function handleProcess() {
    const btn = this;
    const url = btn.dataset.url;
    const card = btn.closest('.session-card');
    const title = card.querySelector('.session-title').textContent;
    const originalText = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = 'Processing...';

    showProcessingModal(title);

    try {
      const res = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_url: url }),
        keepalive: true
      });

      const data = await res.json();
      currentSessionData = { ...data, sessionUrl: url };

      if (res.ok) {
        displayProcessingResult(data, card, btn);
      } else {
        displayProcessingError(data, btn, originalText);
      }
    } catch (err) {
      displayProcessingError({ error: err.message }, btn, originalText);
    }
  }

  function showProcessingModal(title) {
    modalTitle.textContent = 'Processing: ' + title;
    transcriptLoading.querySelector('p').textContent =
      'Analyzing transcript... This may take 30-60 seconds.';
    transcriptLoading.style.display = 'block';
    transcriptContent.style.display = 'none';
    copyBtn.style.display = 'none';
    modal.style.display = 'flex';
  }

  function displayProcessingResult(data, card, btn) {
    const isTechnical = data.callType === 'technical';
    const isPartner = data.callType === 'partner';
    const components = data.components || [];
    const gaps = data.gaps || [];
    const actionItems = data.actionItems || [];

    let resultHtml = '<div class="result-container">';

    // Header with call type badge
    resultHtml += '<div class="result-header">';
    resultHtml += '<span class="badge ' + getBadgeClass(isTechnical, isPartner) + '">';
    resultHtml += getCallTypeLabel(isTechnical, isPartner);
    resultHtml += '</span></div>';

    // Customer name with edit
    resultHtml += buildCustomerEditRow(data.customerName);

    // Summary
    if (data.summary) {
      resultHtml += buildSummarySection(data.summary);
    }

    // Action items
    if (actionItems.length > 0) {
      resultHtml += buildActionItemsSection(actionItems);
    }

    // Technical call details
    if (isTechnical) {
      resultHtml += buildTechnicalDetails(components, gaps, data.customerId);
    }

    // Partner call details
    if (isPartner && data.customerId) {
      resultHtml += buildPartnerDetails(data.customerId);
    }

    resultHtml += '</div>';

    transcriptText.innerHTML = resultHtml;
    transcriptLoading.style.display = 'none';
    transcriptContent.style.display = 'block';

    initCustomerNameSave();

    card.classList.add('processed');
    btn.outerHTML = '<span class="badge badge-success">Processed</span>';
  }

  function getBadgeClass(isTechnical, isPartner) {
    if (isTechnical) return 'badge-success';
    if (isPartner) return 'badge-partner';
    return 'badge-info';
  }

  function getCallTypeLabel(isTechnical, isPartner) {
    if (isTechnical) return 'Technical Call';
    if (isPartner) return 'Partner Call';
    return 'Non-Technical Call';
  }

  function buildCustomerEditRow(customerName) {
    return '<div class="customer-edit-row">' +
      '<label><strong>Customer:</strong></label>' +
      '<input type="text" id="edit-customer-name" value="' + (customerName || 'Unknown') + '" />' +
      '<button id="save-customer-name" class="btn btn-sm btn-secondary">Save</button>' +
      '</div>';
  }

  function buildSummarySection(summary) {
    return '<div class="result-section">' +
      '<h4>Summary</h4>' +
      '<p>' + summary + '</p>' +
      '</div>';
  }

  function buildActionItemsSection(actionItems) {
    let html = '<div class="result-section">';
    html += '<h4>Action Items</h4>';
    html += '<ul class="action-items-list">';

    actionItems.forEach(function(item) {
      const ownerClass = getOwnerClass(item.owner);
      html += '<li class="' + ownerClass + '">';
      html += '<span class="owner-badge">' + item.owner + '</span> ';
      html += item.item;
      html += '</li>';
    });

    html += '</ul></div>';
    return html;
  }

  function getOwnerClass(owner) {
    switch (owner) {
      case 'Stephen': return 'owner-stephen';
      case 'Customer': return 'owner-customer';
      case 'Partner': return 'owner-partner';
      default: return 'owner-vendor';
    }
  }

  function buildTechnicalDetails(components, gaps, customerId) {
    let html = '<div class="result-section tech-details">';
    html += '<p><strong>Components found:</strong> ' + components.length + '</p>';
    html += '<p><strong>Gaps identified:</strong> ' + gaps.length + '</p>';

    if (gaps.length > 0) {
      html += '<div class="gaps-box">';
      html += '<strong>Infrastructure Gaps:</strong><ul>';
      gaps.forEach(function(g) {
        html += '<li>' + g.category + ': ' + g.component + '</li>';
      });
      html += '</ul></div>';
    }

    html += '<div class="result-actions">';
    html += '<a href="/customer/' + customerId + '" class="btn btn-primary">View Diagram</a>';
    html += '</div></div>';

    return html;
  }

  function buildPartnerDetails(customerId) {
    return '<div class="result-section" style="padding: 1rem; background: #fdf2f8; border-radius: 6px; border: 1px solid #fbcfe8;">' +
      '<p><strong>Mind Map Generated</strong></p>' +
      '<div class="result-actions" style="margin-top: 0.5rem;">' +
      '<a href="/customer/' + customerId + '" class="btn btn-primary">View Mind Map</a>' +
      '</div></div>';
  }

  function displayProcessingError(data, btn, originalText) {
    let errorText = 'Error: ' + (data.error || 'Processing failed');
    if (data.details) {
      errorText += '\n\nDetails: ' + data.details;
    }
    transcriptText.textContent = errorText;
    transcriptLoading.style.display = 'none';
    transcriptContent.style.display = 'block';

    btn.disabled = false;
    btn.innerHTML = originalText;
  }

  function initCustomerNameSave() {
    const saveBtn = document.getElementById('save-customer-name');
    if (!saveBtn) return;

    saveBtn.addEventListener('click', async function() {
      const newName = document.getElementById('edit-customer-name').value.trim();
      if (!newName) {
        alert('Please enter a customer name');
        return;
      }

      this.disabled = true;
      this.textContent = 'Saving...';

      try {
        const updateRes = await fetch('/api/session/update-customer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_url: currentSessionData.sessionUrl,
            customer_name: newName
          })
        });

        if (updateRes.ok) {
          this.textContent = 'Saved!';
          const btn = this;
          setTimeout(function() {
            btn.textContent = 'Save';
            btn.disabled = false;
          }, 1500);
        } else {
          const errData = await updateRes.json();
          alert('Error: ' + (errData.error || 'Failed to save'));
          this.disabled = false;
          this.textContent = 'Save';
        }
      } catch (err) {
        alert('Error: ' + err.message);
        this.disabled = false;
        this.textContent = 'Save';
      }
    });
  }

  // ============================================
  // Modal Controls
  // ============================================

  function initModalControls() {
    if (!modal) return;

    // Copy button
    if (copyBtn) {
      copyBtn.addEventListener('click', function() {
        navigator.clipboard.writeText(transcriptText.textContent);
        copyBtn.textContent = 'Copied!';
        setTimeout(function() {
          copyBtn.textContent = 'Copy Transcript';
        }, 2000);
      });
    }

    // Close buttons
    modal.querySelectorAll('.modal-close, .modal-close-btn').forEach(function(el) {
      el.addEventListener('click', function() {
        modal.style.display = 'none';
      });
    });

    // Click outside to close
    modal.addEventListener('click', function(e) {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    });
  }

  // ============================================
  // Auth Form
  // ============================================

  function initAuthForm() {
    const authForm = document.getElementById('auth-form');
    if (!authForm) return;

    authForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      const token = document.getElementById('auth-token').value.trim();

      if (!token) {
        alert('Please enter a token');
        return;
      }

      try {
        const res = await fetch('/api/wave/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ auth_token: token })
        });

        if (res.ok) {
          location.reload();
        } else {
          const data = await res.json();
          alert('Error: ' + (data.error || 'Failed to save token'));
        }
      } catch (err) {
        alert('Error: ' + err.message);
      }
    });
  }

  // ============================================
  // Queue Status
  // ============================================

  async function updateQueueStatus() {
    try {
      const res = await fetch('/api/queue/status');
      if (!res.ok) return;

      const status = await res.json();
      const hasActive = status.pending_count > 0 || status.current_job;

      if (hasActive) {
        queueStatusPanel.style.display = 'flex';

        if (status.current_job) {
          const title = (status.current_job.title || 'Session...').substring(0, 35);
          queueStatusText.textContent = 'Processing: ' + title + '...';
        } else {
          queueStatusText.textContent = 'Queue active';
        }

        updateProgressBar(status);
      } else {
        queueStatusPanel.style.display = 'none';
        batchTotal = 0;
        batchCompleted = 0;
      }

      updateCompletedCards(status.recent_completed);
    } catch (err) {
      // Silently fail
    }
  }

  function updateProgressBar(status) {
    const total = batchTotal || (status.pending_count + (status.current_job ? 1 : 0) + batchCompleted);
    const remaining = status.pending_count + (status.current_job ? 1 : 0);
    const completed = total - remaining;

    if (total > 0) {
      queueProgressText.textContent = completed + '/' + total;
      const percent = Math.round((completed / total) * 100);
      queueProgressFill.style.width = percent + '%';
    }
  }

  function updateCompletedCards(recentCompleted) {
    if (!recentCompleted) return;

    recentCompleted.forEach(function(job) {
      if (job.status !== 'completed') return;

      const card = document.querySelector('[data-session-url="' + job.session_url + '"]');
      if (!card || card.classList.contains('processed')) return;

      card.classList.add('processed');
      card.classList.remove('queued');

      const actionsDiv = card.querySelector('.session-actions');
      if (actionsDiv) {
        actionsDiv.innerHTML =
          '<span class="badge badge-success">Processed</span>' +
          '<a href="' + job.session_url + '" target="_blank" class="btn btn-link">View</a>';
      }

      queuedSessions.delete(job.session_url);
      batchCompleted++;

      updateUnprocessedCount();
    });
  }

  function updateUnprocessedCount() {
    const unprocessedSpan = document.getElementById('unprocessed-count');
    if (!unprocessedSpan) return;

    const currentCount = parseInt(unprocessedSpan.textContent) || 0;
    if (currentCount > 0) {
      unprocessedSpan.textContent = (currentCount - 1) + ' unprocessed';
    }
  }

  // ============================================
  // Queue Buttons
  // ============================================

  function initQueueButtons() {
    document.querySelectorAll('.btn-queue').forEach(function(btn) {
      btn.addEventListener('click', handleQueueSingle);
    });
  }

  async function handleQueueSingle() {
    const btn = this;
    const url = btn.dataset.url;
    const title = btn.dataset.title;
    const card = btn.closest('.session-card');

    btn.disabled = true;
    btn.textContent = 'Queueing...';

    try {
      const res = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_url: url, title: title }),
        keepalive: true
      });

      const data = await res.json();

      if (res.ok) {
        updateCardToQueued(card, url, data.job.id);
        updateQueueStatus();
      } else {
        alert('Error: ' + (data.error || 'Failed to queue'));
        btn.disabled = false;
        btn.textContent = 'Queue';
      }
    } catch (err) {
      alert('Error: ' + err.message);
      btn.disabled = false;
      btn.textContent = 'Queue';
    }
  }

  function updateCardToQueued(card, url, jobId) {
    queuedSessions.add(url);
    card.classList.add('queued');
    const actionsDiv = card.querySelector('.session-actions');
    actionsDiv.innerHTML =
      '<span class="badge badge-queued">Queued</span>' +
      '<button class="btn btn-sm btn-outline btn-cancel-queue" data-id="' + jobId + '" data-url="' + url + '">Cancel</button>' +
      '<a href="' + url + '" target="_blank" class="btn btn-link">View</a>';
    actionsDiv.querySelector('.btn-cancel-queue').addEventListener('click', handleCancelQueue);
  }

  async function handleCancelQueue() {
    const btn = this;
    const id = btn.dataset.id;
    const url = btn.dataset.url;

    btn.disabled = true;
    btn.textContent = 'Cancelling...';

    try {
      const res = await fetch('/api/queue/' + id, { method: 'DELETE' });

      if (res.ok) {
        queuedSessions.delete(url);
        location.reload();
      } else {
        const data = await res.json();
        alert('Error: ' + (data.error || 'Failed to cancel'));
        btn.disabled = false;
        btn.textContent = 'Cancel';
      }
    } catch (err) {
      alert('Error: ' + err.message);
      btn.disabled = false;
      btn.textContent = 'Cancel';
    }
  }

  // ============================================
  // Bulk Queue
  // ============================================

  function initBulkQueueButtons() {
    const queueNext10Btn = document.getElementById('btn-queue-next-10');
    const queueAllBtn = document.getElementById('btn-queue-all');

    if (queueNext10Btn) {
      queueNext10Btn.addEventListener('click', function() {
        handleBulkQueue(this, 10);
      });
    }

    if (queueAllBtn) {
      queueAllBtn.addEventListener('click', function() {
        handleBulkQueue(this, null);
      });
    }
  }

  async function handleBulkQueue(btn, limit) {
    const unprocessedCards = Array.from(
      document.querySelectorAll('.session-card:not(.processed):not(.skipped):not(.queued)')
    );

    const toQueue = (limit ? unprocessedCards.slice(0, limit) : unprocessedCards).map(function(card) {
      return {
        session_url: card.dataset.sessionUrl,
        title: card.querySelector('.session-title').textContent,
        card: card
      };
    });

    if (toQueue.length === 0) {
      alert('No unprocessed sessions to queue');
      return;
    }

    if (!limit && toQueue.length > 20) {
      if (!confirm('This will queue ' + toQueue.length + ' sessions. Continue?')) {
        return;
      }
    }

    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Queueing ' + toQueue.length + '...';

    try {
      const payload = {
        sessions: toQueue.map(function(t) {
          return { session_url: t.session_url, title: t.title };
        })
      };
      if (limit) {
        payload.limit = limit;
      }

      const res = await fetch('/api/queue/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true  // Ensures request completes even if user navigates away
      });

      const data = await res.json();

      if (res.ok) {
        batchTotal = data.queued;
        batchCompleted = 0;

        toQueue.forEach(function(item) {
          item.card.classList.add('queued');
          const actionsDiv = item.card.querySelector('.session-actions');
          actionsDiv.innerHTML =
            '<span class="badge badge-queued">Queued</span>' +
            '<a href="' + item.session_url + '" target="_blank" class="btn btn-link">View</a>';
          queuedSessions.add(item.session_url);
        });

        showQueueProgress(data.queued);
        updateQueueStatus();
      } else {
        alert('Error: ' + (data.error || 'Failed to queue'));
      }
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  function showQueueProgress(count) {
    queueStatusPanel.style.display = 'flex';
    queueStatusText.textContent = 'Starting queue...';
    queueProgressText.textContent = '0/' + count;
    queueProgressFill.style.width = '0%';
  }

  // ============================================
  // Refresh Status Polling
  // ============================================

  let refreshPollingInterval = null;

  function startRefreshPolling() {
    if (refreshPollingInterval) return;

    refreshPollingInterval = setInterval(async function() {
      try {
        const res = await fetch('/api/wave/status');
        if (!res.ok) return;

        const status = await res.json();
        if (!status.refreshing) {
          // Refresh completed, reload page to show new data
          clearInterval(refreshPollingInterval);
          location.reload();
        }
      } catch (err) {
        // Silently fail
      }
    }, 2000);
  }

  function checkInitialRefreshState() {
    if (window.WAVE_STATE && window.WAVE_STATE.refreshing) {
      startRefreshPolling();
    }
  }

  // ============================================
  // Initialize
  // ============================================

  function init() {
    initSkipFilter();
    initHideProcessedFilter();
    initRefreshButton();
    initSkipButtons();
    initProcessButtons();
    initModalControls();
    initAuthForm();
    initQueueButtons();
    initBulkQueueButtons();

    // Check if refresh is in progress
    checkInitialRefreshState();

    // Start queue status polling
    setInterval(updateQueueStatus, 3000);
    updateQueueStatus();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
