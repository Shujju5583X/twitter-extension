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

let streakData = null;
let currentQueuePost = null;

// Fetch streak data on load
chrome.runtime.sendMessage({ action: 'checkStreak' }, (response) => {
  if (chrome.runtime.lastError) {
    console.warn("X-Study-Streak: Could not reach background:", chrome.runtime.lastError.message);
    return;
  }
  console.log("X-Study-Streak: Current streak status:", response);
  streakData = response;
});

// Check queue for badge
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

async function postTweetDirectly(text) {
  try {
    const newTweetBtn = document.querySelector('[data-testid="SideNav_NewTweet_Button"]');
    if (!newTweetBtn) return false;
    newTweetBtn.click();
    
    let textarea = null;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 100));
      textarea = document.querySelector('[role="dialog"] [data-testid="tweetTextarea_0"]');
      if (textarea) break;
    }
    if (!textarea) return false;
    
    textarea.focus();
    document.execCommand('insertText', false, text);
    await new Promise(r => setTimeout(r, 500));
    
    const postBtn = document.querySelector('[role="dialog"] [data-testid="tweetButton"]');
    if (postBtn) {
      postBtn.click();
      return true;
    }
  } catch (e) {
    console.error("Direct post failed:", e);
  }
  return false;
}

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

function createModal() {
  syncTheme();
  if (document.querySelector('.study-streak-modal-overlay')) return;

  const overlay = document.createElement('div');
  overlay.className = 'study-streak-modal-overlay';
  
  const modal = document.createElement('div');
  modal.className = 'study-streak-modal';
  
  // Header row
  const headerRow = document.createElement('div');
  headerRow.className = 'xss-modal-header';

  const title = document.createElement('h2');
  title.textContent = 'Share Study Progress';

  const queueInfo = document.createElement('div');
  queueInfo.className = 'xss-queue-info';
  queueInfo.id = 'xss-queue-info';
  queueInfo.textContent = 'Loading...';

  headerRow.appendChild(title);
  headerRow.appendChild(queueInfo);
  
  const textarea = document.createElement('textarea');
  textarea.className = 'study-streak-textarea';
  textarea.id = 'xss-tweet-textarea';
  textarea.value = 'Today I studied: \n';

  // Character counter
  const counterRow = document.createElement('div');
  counterRow.className = 'xss-counter-row';

  const charCounter = document.createElement('span');
  charCounter.className = 'xss-char-counter';
  charCounter.id = 'xss-char-counter';

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
  skipBtn.style.display = 'none';
  
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'study-streak-cancel';
  cancelBtn.textContent = 'Cancel';
  
  const submitBtn = document.createElement('button');
  submitBtn.className = 'study-streak-submit';
  submitBtn.textContent = 'Post';

  actions.appendChild(skipBtn);
  actions.appendChild(cancelBtn);
  actions.appendChild(submitBtn);

  modal.appendChild(headerRow);
  modal.appendChild(textarea);
  modal.appendChild(counterRow);
  modal.appendChild(actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

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
    if (e.target === overlay) overlay.remove();
  });
  cancelBtn.addEventListener('click', () => overlay.remove());

  // Skip to next post
  skipBtn.addEventListener('click', () => {
    if (!currentQueuePost) return;

    chrome.runtime.sendMessage({ action: 'markPostDone', postId: currentQueuePost.id }, (response) => {
      if (chrome.runtime.lastError || !response) return;

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
        if (nextResponse && nextResponse.post) {
          // Show "next post ready" notification
          showNextPostNotification(nextResponse.remaining);
        }
      });

      overlay.remove();
      updateButtonBadge();
    });
  });
}

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

function injectButton() {
  syncTheme();
  // Try to find the left sidebar nav
  const navSelector = '[data-testid="SideNav_AccountSwitcher_Button"]';
  const navContainer = document.querySelector(navSelector)?.parentElement;
  
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
