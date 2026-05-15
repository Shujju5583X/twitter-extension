// content.js
console.log("X-Study-Streak: Content script loaded.");

/** Check if extension context is still alive (survives reload/update). */
function isContextValid() {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

// ===================================================================
// Utility: fallback selector queries
// ===================================================================

/**
 * Try multiple selectors in order, return first match.
 * Handles fragile DOM selectors when X updates its markup.
 */
function queryFallback(...selectors) {
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) return el;
    } catch {
      // Invalid selector — skip
    }
  }
  return null;
}

// ===================================================================
// Error toast for user-visible errors
// ===================================================================

function showErrorToast(message) {
  const existing = document.querySelector('.xss-error-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'xss-error-toast';
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');
  toast.innerHTML = `
    <span class="xss-error-toast-icon">⚠</span>
    <span class="xss-error-toast-msg">${message}</span>
    <button class="xss-error-toast-close" aria-label="Dismiss error">✕</button>
  `;

  document.body.appendChild(toast);

  toast.querySelector('.xss-error-toast-close').addEventListener('click', () => {
    toast.style.animation = 'xssToastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  });

  setTimeout(() => {
    if (toast.parentElement) {
      toast.style.animation = 'xssToastOut 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }
  }, 5000);
}

// ===================================================================
// State
// ===================================================================

let streakData = null;
let currentQueuePost = null;

// Fetch streak data on load
chrome.runtime.sendMessage({ action: 'checkStreak' }, (response) => {
  if (chrome.runtime.lastError) {
    console.warn("X-Study-Streak: Could not reach background:", chrome.runtime.lastError.message);
    showErrorToast("Could not connect to extension background. Try reloading.");
    return;
  }
  console.log("X-Study-Streak: Current streak status:", response);
  streakData = response;
});

// ===================================================================
// Queue badge
// ===================================================================

function updateButtonBadge() {
  if (!isContextValid()) return;
  chrome.runtime.sendMessage({ action: 'getNextPost' }, (response) => {
    if (chrome.runtime.lastError || !response) return;
    const btn = document.querySelector('.study-streak-btn');
    if (!btn) return;

    const badge = btn.querySelector('.xss-queue-badge');
    if (response.remaining > 0) {
      if (badge) {
        badge.textContent = response.remaining;
      } else {
        const b = document.createElement('span');
        b.className = 'xss-queue-badge';
        b.textContent = response.remaining;
        btn.appendChild(b);
      }
    } else if (badge) {
      badge.remove();
    }
  });
}

// ===================================================================
// React-compatible tweet posting
// ===================================================================

async function postTweetDirectly(text) {
  try {
    // Open compose dialog — fallback selectors
    const newTweetBtn = queryFallback(
      '[data-testid="SideNav_NewTweet_Button"]',
      '[aria-label="Post"]',
      '[aria-label="Compose post"]',
      '[href="/compose/tweet"]',
      'a[aria-label="Post"]'
    );
    if (!newTweetBtn) {
      showErrorToast("Could not find compose button. X may have updated.");
      return false;
    }
    newTweetBtn.click();

    // Wait for compose dialog textarea
    let textarea = null;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 100));
      textarea = queryFallback(
        '[role="dialog"] [data-testid="tweetTextarea_0"]',
        '[role="dialog"] [contenteditable="true"]',
        '[data-testid="tweetTextarea_0"]',
        '[role="dialog"] .public-DraftEditor-content'
      );
      if (textarea) break;
    }
    if (!textarea) {
      showErrorToast("Compose dialog did not open. Try posting manually.");
      return false;
    }

    textarea.focus();

    // Primary: ClipboardEvent paste (React-compatible, non-deprecated)
    let inputSuccess = false;
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      });
      textarea.dispatchEvent(pasteEvent);

      // Verify text was inserted
      await new Promise(r => setTimeout(r, 200));
      const currentText = textarea.textContent || textarea.innerText || '';
      if (currentText.includes(text.substring(0, 20))) {
        inputSuccess = true;
      }
    } catch (e) {
      console.warn("X-Study-Streak: ClipboardEvent paste failed:", e);
    }

    // Fallback: deprecated execCommand (belt-and-suspenders)
    if (!inputSuccess) {
      console.warn("X-Study-Streak: Using deprecated execCommand as fallback");
      document.execCommand('insertText', false, text);
    }

    await new Promise(r => setTimeout(r, 500));

    // Click post button — fallback selectors
    const postBtn = queryFallback(
      '[role="dialog"] [data-testid="tweetButton"]',
      '[role="dialog"] [data-testid="tweetButtonInline"]',
      '[role="dialog"] button[data-testid="tweetButton"]',
      '[role="dialog"] [type="submit"]'
    );
    if (postBtn) {
      postBtn.click();
      return true;
    } else {
      showErrorToast("Could not find post button. Try posting manually.");
    }
  } catch (e) {
    console.error("Direct post failed:", e);
    showErrorToast("Post failed: " + e.message);
  }
  return false;
}

// ===================================================================
// Theme sync
// ===================================================================

function syncTheme() {
  const bgStr = window.getComputedStyle(document.body).backgroundColor;
  const rgb = bgStr.match(/\d+/g);
  if (!rgb) return;
  const brightness = (parseInt(rgb[0]) * 299 + parseInt(rgb[1]) * 587 + parseInt(rgb[2]) * 114) / 1000;
  const isDark = brightness < 128;

  const root = document.documentElement;
  if (isDark) {
    root.style.setProperty('--xss-bg', bgStr); // match exactly
    root.style.setProperty('--xss-text', '#e1e8eb');
    root.style.setProperty('--xss-border', '#2f3336'); // X dark border
    root.style.setProperty('--xss-cta-bg', '#eff3f4');
    root.style.setProperty('--xss-cta-text', '#0f1419');
    root.style.setProperty('--xss-input-bg', 'rgba(255,255,255,0.05)');
  } else {
    root.style.setProperty('--xss-bg', bgStr); // #ffffff
    root.style.setProperty('--xss-text', '#0f1419');
    root.style.setProperty('--xss-border', '#eff3f4'); // X light border
    root.style.setProperty('--xss-cta-bg', '#0f1419');
    root.style.setProperty('--xss-cta-text', '#ffffff');
    root.style.setProperty('--xss-input-bg', 'rgba(0,0,0,0.03)');
  }
}

// ===================================================================
// Modal with ARIA
// ===================================================================

function createModal() {
  syncTheme();
  if (document.querySelector('.study-streak-modal-overlay')) return;

  const overlay = document.createElement('div');
  overlay.className = 'study-streak-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'xss-modal-title');

  const modal = document.createElement('div');
  modal.className = 'study-streak-modal';
  modal.setAttribute('tabindex', '-1');

  // Header row
  const headerRow = document.createElement('div');
  headerRow.className = 'xss-modal-header';

  const title = document.createElement('h2');
  title.textContent = 'Share Study Progress';
  title.id = 'xss-modal-title';

  const queueInfo = document.createElement('div');
  queueInfo.className = 'xss-queue-info';
  queueInfo.id = 'xss-queue-info';
  queueInfo.textContent = 'Loading...';

  headerRow.appendChild(title);
  headerRow.appendChild(queueInfo);

  const textarea = document.createElement('textarea');
  textarea.className = 'study-streak-textarea';
  textarea.id = 'xss-tweet-textarea';
  textarea.setAttribute('aria-label', 'Tweet content');
  textarea.value = 'Today I studied: \n';

  // Character counter
  const counterRow = document.createElement('div');
  counterRow.className = 'xss-counter-row';

  const charCounter = document.createElement('span');
  charCounter.className = 'xss-char-counter';
  charCounter.id = 'xss-char-counter';
  charCounter.setAttribute('role', 'status');
  charCounter.setAttribute('aria-live', 'polite');

  const sourceLabel = document.createElement('span');
  sourceLabel.className = 'xss-source-label';
  sourceLabel.id = 'xss-source-label';

  counterRow.appendChild(sourceLabel);
  counterRow.appendChild(charCounter);

  const actions = document.createElement('div');
  actions.className = 'study-streak-actions';

  const skipBtn = document.createElement('button');
  skipBtn.className = 'xss-skip-btn';
  skipBtn.id = 'xss-skip-btn';
  skipBtn.textContent = 'Skip';
  skipBtn.setAttribute('aria-label', 'Skip to next queued post');
  skipBtn.style.display = 'none';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'study-streak-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.setAttribute('aria-label', 'Cancel and close');

  const submitBtn = document.createElement('button');
  submitBtn.className = 'study-streak-submit';
  submitBtn.textContent = 'Post';
  submitBtn.setAttribute('aria-label', 'Post tweet');

  actions.appendChild(skipBtn);
  actions.appendChild(cancelBtn);
  actions.appendChild(submitBtn);

  modal.appendChild(headerRow);
  modal.appendChild(textarea);
  modal.appendChild(counterRow);
  modal.appendChild(actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Focus modal on open
  modal.focus();

  // Escape key closes modal
  function handleEscape(e) {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', handleEscape);
    }
  }
  document.addEventListener('keydown', handleEscape);

  // Update character counter
  function updateCounter() {
    const len = textarea.value.length;
    charCounter.textContent = `${len} / 280`;
    if (len > 280) {
      charCounter.classList.add('xss-over-limit');
    } else {
      charCounter.classList.remove('xss-over-limit');
    }
  }

  textarea.addEventListener('input', updateCounter);

  // Try to load queued post
  chrome.runtime.sendMessage({ action: 'getNextPost' }, (response) => {
    if (chrome.runtime.lastError || !response) {
      queueInfo.textContent = '';
      if (chrome.runtime.lastError) {
        showErrorToast("Failed to load post queue: " + chrome.runtime.lastError.message);
      }
      updateCounter();
      textarea.focus();
      return;
    }

    if (response.post) {
      currentQueuePost = response.post;
      textarea.value = response.post.text;

      queueInfo.innerHTML = `<span class="xss-queue-count">Post ${response.currentIndex} of ${response.remaining + response.currentIndex - 1}</span>`;

      if (response.post.source === 'scrimba-auto') {
        sourceLabel.textContent = 'Auto-generated from Scrimba';
      }

      // Show skip button if there are more posts
      if (response.remaining > 1) {
        skipBtn.style.display = '';
      }
    } else {
      queueInfo.textContent = 'No queued posts';
      currentQueuePost = null;
    }

    updateCounter();
    textarea.focus();
    const len = textarea.value.length;
    textarea.setSelectionRange(len, len);
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
      document.removeEventListener('keydown', handleEscape);
    }
  });
  cancelBtn.addEventListener('click', () => {
    overlay.remove();
    document.removeEventListener('keydown', handleEscape);
  });

  // Skip to next post
  skipBtn.addEventListener('click', () => {
    if (!currentQueuePost) return;

    chrome.runtime.sendMessage({ action: 'markPostDone', postId: currentQueuePost.id }, (response) => {
      if (chrome.runtime.lastError || !response) {
        showErrorToast("Failed to skip post: " + (chrome.runtime.lastError?.message || 'Unknown error'));
        return;
      }

      if (response.post) {
        currentQueuePost = response.post;
        textarea.value = response.post.text;
        queueInfo.innerHTML = `<span class="xss-queue-count">${response.remaining} remaining</span>`;

        if (response.post.source === 'scrimba-auto') {
          sourceLabel.textContent = '🤖 Auto-generated from Scrimba';
        } else {
          sourceLabel.textContent = '';
        }

        if (response.remaining <= 1) {
          skipBtn.style.display = 'none';
        }
      } else {
        textarea.value = 'Today I studied: \n';
        queueInfo.textContent = 'Queue empty';
        sourceLabel.textContent = '';
        currentQueuePost = null;
        skipBtn.style.display = 'none';
      }

      updateCounter();
      textarea.focus();
    });
  });

  submitBtn.addEventListener('click', async () => {
    const content = textarea.value.trim();
    if (!content) return;
    if (content.length > 280) {
      charCounter.classList.add('xss-shake');
      setTimeout(() => charCounter.classList.remove('xss-shake'), 500);
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Posting...';

    // Mark queue item as posted if from queue
    if (currentQueuePost) {
      chrome.runtime.sendMessage({ action: 'markPostDone', postId: currentQueuePost.id });
    }

    chrome.runtime.sendMessage({ action: 'postSuccess', content: content }, async (response) => {
      if (chrome.runtime.lastError) {
        console.error("X-Study-Streak: Failed to update streak:", chrome.runtime.lastError.message);
        showErrorToast("Failed to update streak: " + chrome.runtime.lastError.message);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Post';
        return;
      }

      streakData = response;
      const tweetText = content;

      const success = await postTweetDirectly(tweetText);
      if (!success) {
        // Fallback to Intent URL if direct post fails
        const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;
        window.open(intentUrl, '_blank');
      }

      // Check if there's a next queued post
      chrome.runtime.sendMessage({ action: 'getNextPost' }, (nextResponse) => {
        if (chrome.runtime.lastError) return;
        if (nextResponse && nextResponse.post) {
          showNextPostNotification(nextResponse.remaining);
        }
      });

      overlay.remove();
      document.removeEventListener('keydown', handleEscape);
      updateButtonBadge();
    });
  });
}

// ===================================================================
// Next-post toast
// ===================================================================

/**
 * Show a small toast when there are more queued posts after posting.
 */
function showNextPostNotification(remaining) {
  const existing = document.querySelector('.xss-next-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'xss-next-toast';
  toast.innerHTML = `
    <span>${remaining} more post${remaining > 1 ? 's' : ''} queued</span>
    <button class="xss-toast-action">Open</button>
  `;

  document.body.appendChild(toast);

  toast.querySelector('.xss-toast-action').addEventListener('click', () => {
    toast.remove();
    createModal();
  });

  setTimeout(() => {
    if (toast.parentElement) {
      toast.style.animation = 'xssToastOut 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }
  }, 6000);
}

// ===================================================================
// Button injection with fallback selectors
// ===================================================================

function injectButton() {
  syncTheme();
  // Try multiple selectors for sidebar anchor
  const navAnchor = queryFallback(
    '[data-testid="SideNav_AccountSwitcher_Button"]',
    'nav[role="navigation"] [data-testid="AppTabBar_Profile_Link"]',
    'nav[role="navigation"] > div:last-child > div:last-child'
  );
  const navContainer = navAnchor?.parentElement;

  if (navContainer && !document.querySelector('.study-streak-btn')) {
    const btn = document.createElement('button');
    btn.className = 'study-streak-btn';
    btn.innerHTML = 'Study Streak';
    btn.addEventListener('click', createModal);

    // Insert above the account switcher
    navContainer.parentNode.insertBefore(btn, navContainer);

    // Check for queued posts and show badge
    updateButtonBadge();
  }
}

// Observe DOM for the left sidebar load
const observer = new MutationObserver(() => {
  injectButton();
});

observer.observe(document.body, { childList: true, subtree: true });

// Periodically update badge (in case scraper runs while on X)
const badgeInterval = setInterval(() => {
  if (!isContextValid()) {
    clearInterval(badgeInterval);
    observer.disconnect();
    return;
  }
  updateButtonBadge();
}, 30000);
