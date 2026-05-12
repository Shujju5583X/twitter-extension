// scrimba-scraper.js — Content script for Scrimba frontend path
console.log("X-Study-Streak: Scrimba scraper loaded.");

/**
 * Parse the Scrimba frontend path page DOM to extract
 * module and individual lesson completion data.
 */
function scrapeProgress() {
  const pathInfo = extractPathInfo();
  const results = {
    pathId: pathInfo.pathId,
    pathName: pathInfo.pathName,
    modules: [],
    lessons: [],
    scrapedAt: new Date().toISOString()
  };

  // --- Parse modules/sub-modules from toc-item-head elements ---
  const moduleHeaders = document.querySelectorAll('toc-item-head');
  moduleHeaders.forEach(header => {
    const textContent = header.textContent.trim();

    // Extract title — first meaningful text block
    const titleEl = header.querySelector('div > div');
    if (!titleEl) return;
    const title = titleEl.textContent.trim();
    if (!title) return;

    // Extract progress fraction like "34 / 125" or "0 / 7"
    const fractionMatch = textContent.match(/(\d+)\s*\/\s*(\d+)/);
    // Extract percentage like "100%" or "23%"
    const percentMatch = textContent.match(/(\d+)%/);

    if (fractionMatch) {
      const completed = parseInt(fractionMatch[1], 10);
      const total = parseInt(fractionMatch[2], 10);
      const percent = percentMatch ? parseInt(percentMatch[1], 10) : Math.round((completed / total) * 100);

      results.modules.push({
        title,
        completed,
        total,
        percent,
        isComplete: completed === total && total > 0
      });
    }
  });

  // --- Parse individual lessons from toc-scrim-item elements ---
  const lessonItems = document.querySelectorAll('toc-scrim-item');
  lessonItems.forEach(item => {
    const isCompleted = item.classList.contains('completed');
    const isGated = item.classList.contains('gated');

    // Get lesson title
    const titleEl = item.querySelector('div > div');
    if (!titleEl) return;
    const title = titleEl.textContent.trim();
    if (!title) return;

    // Try to determine parent module by walking up/back in DOM
    let parentModule = findParentModuleName(item);

    results.lessons.push({
      title,
      completed: isCompleted,
      gated: isGated,
      parentModule: parentModule || 'Unknown'
    });
  });

  return results;
}

/**
 * Walk backwards through siblings to find the nearest toc-item-head
 * which is the parent module/sub-module for this lesson.
 */
function findParentModuleName(lessonEl) {
  let el = lessonEl.previousElementSibling;
  while (el) {
    if (el.tagName && el.tagName.toLowerCase() === 'toc-item-head') {
      const titleEl = el.querySelector('div > div');
      if (titleEl) return titleEl.textContent.trim();
    }
    // Also check parent containers
    if (el.querySelector && el.querySelector('toc-item-head')) {
      const headers = el.querySelectorAll('toc-item-head');
      if (headers.length > 0) {
        const last = headers[headers.length - 1];
        const titleEl = last.querySelector('div > div');
        if (titleEl) return titleEl.textContent.trim();
      }
    }
    el = el.previousElementSibling;
  }

  // Try parent's context
  const parent = lessonEl.parentElement;
  if (parent) {
    const parentHeader = parent.querySelector('toc-item-head');
    if (parentHeader) {
      const titleEl = parentHeader.querySelector('div > div');
      if (titleEl) return titleEl.textContent.trim();
    }
  }

  return null;
}

/**
 * Extract learning path identity from URL slug and page title.
 */
function extractPathInfo() {
  const pathname = window.location.pathname.replace(/^\/+|\/+$/g, '');
  const pathId = pathname.split('/').pop() || pathname || 'unknown';

  // Try document title: "The Frontend Developer Career Path | Scrimba"
  const titleParts = document.title.split('|');
  let pathName = titleParts[0].trim();

  // Fallback: clean up URL slug
  if (!pathName || pathName.toLowerCase() === 'scrimba') {
    pathName = pathId
      .replace(/-c[a-z0-9]{2,5}$/, '')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  return { pathId, pathName };
}

/**
 * Wait for SPA content to load, then scrape and send to background.
 * Scrimba is a SPA — DOM may not be ready immediately.
 */
function waitAndScrape() {
  let attempts = 0;
  const maxAttempts = 30; // 15 seconds max

  const interval = setInterval(() => {
    attempts++;
    const headers = document.querySelectorAll('toc-item-head');

    if (headers.length > 0 || attempts >= maxAttempts) {
      clearInterval(interval);

      if (headers.length === 0) {
        console.log("X-Study-Streak: No Scrimba content found after waiting.");
        return;
      }

      const progress = scrapeProgress();
      console.log("X-Study-Streak: Scraped progress:", progress);

      // Send to background script
      chrome.runtime.sendMessage(
        { action: 'scrimbaProgress', data: progress },
        (response) => {
          if (chrome.runtime.lastError) {
            console.warn("X-Study-Streak: Failed to send progress:", chrome.runtime.lastError.message);
            return;
          }
          console.log("X-Study-Streak: Background processed progress:", response);

          // Show notification banner on Scrimba page
          if (response && response.newCompletions && response.newCompletions.length > 0) {
            showScrimbaNotification(response.newCompletions.length, response.queuedPosts);
          }
        }
      );
    }
  }, 500);
}

/**
 * Show a small floating notification on the Scrimba page
 * when new completions are detected and posts queued.
 */
function showScrimbaNotification(newCount, queuedCount) {
  // Remove existing
  const existing = document.querySelector('.xss-scrimba-notification');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.className = 'xss-scrimba-notification';
  banner.innerHTML = `
    <div class="xss-notif-icon">S</div>
    <div class="xss-notif-text">
      <strong>${newCount} new completion${newCount > 1 ? 's' : ''} detected!</strong>
      <span>${queuedCount} post${queuedCount !== 1 ? 's' : ''} queued for X</span>
    </div>
    <button class="xss-notif-close">✕</button>
  `;

  // Style inline for scrimba.com (no separate CSS injected here to keep it minimal)
  banner.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: #fff;
    color: #000;
    padding: 14px 18px;
    border-radius: 14px;
    display: flex;
    align-items: center;
    gap: 12px;
    z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 14px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
    animation: xssSlideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    max-width: 360px;
  `;

  const style = document.createElement('style');
  style.textContent = `
    @keyframes xssSlideIn {
      from { transform: translateY(100px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    .xss-notif-icon { font-size: 24px; }
    .xss-notif-text { display: flex; flex-direction: column; gap: 2px; }
    .xss-notif-text strong { font-size: 14px; }
    .xss-notif-text span { font-size: 12px; opacity: 0.85; }
    .xss-notif-close {
      background: rgba(0,0,0,0.1);
      border: none;
      color: #000;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      cursor: pointer;
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-left: auto;
      flex-shrink: 0;
    }
    .xss-notif-close:hover { background: rgba(0,0,0,0.2); }
  `;
  document.head.appendChild(style);
  document.body.appendChild(banner);

  banner.querySelector('.xss-notif-close').addEventListener('click', () => {
    banner.style.animation = 'xssSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) reverse';
    setTimeout(() => banner.remove(), 300);
  });

  // Auto dismiss after 8 seconds
  setTimeout(() => {
    if (banner.parentElement) {
      banner.style.animation = 'xssSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) reverse';
      setTimeout(() => banner.remove(), 300);
    }
  }, 8000);
}

// Track state to avoid duplicate scrapes
let lastScrapedUrl = null;
let isScraping = false;

function guardedScrape() {
  const currentUrl = window.location.href;
  if (isScraping || lastScrapedUrl === currentUrl) return;
  isScraping = true;
  lastScrapedUrl = currentUrl;

  // Wrap waitAndScrape to reset lock when done
  const origWait = waitAndScrape;
  waitAndScrape();
  // Reset lock after scrape window (max 15s + buffer)
  setTimeout(() => { isScraping = false; }, 18000);
}

// SPA navigation detection — only re-scrape when URL changes
let lastObservedUrl = window.location.href;
const pageObserver = new MutationObserver(() => {
  const currentUrl = window.location.href;
  if (currentUrl !== lastObservedUrl) {
    lastObservedUrl = currentUrl;
    clearTimeout(window.__xssRescrapeTimer);
    window.__xssRescrapeTimer = setTimeout(guardedScrape, 2000);
  }
});

// Scrape on initial load — waitAndScrape handles pages without TOC elements
waitAndScrape();

// Watch for SPA route changes
pageObserver.observe(document.body, { childList: true, subtree: true });
