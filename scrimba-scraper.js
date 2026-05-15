// scrimba-scraper.js — Content script for Scrimba frontend path
console.log("X-Study-Streak: Scrimba scraper loaded.");

// ===================================================================
// Utility: fallback selector queries
// ===================================================================

/**
 * Try multiple selectors in order via querySelectorAll, return first non-empty NodeList.
 */
function queryAllFallback(...selectors) {
  for (const sel of selectors) {
    try {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) return els;
    } catch {
      // Invalid selector — skip
    }
  }
  return [];
}

/**
 * Try multiple selectors scoped to a parent element, return first match.
 */
function queryScopedFallback(parent, ...selectors) {
  for (const sel of selectors) {
    try {
      const el = parent.querySelector(sel);
      if (el) return el;
    } catch {
      // Invalid selector — skip
    }
  }
  return null;
}

// ===================================================================
// Scraping logic
// ===================================================================

/**
 * Parse the Scrimba path page DOM to extract
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

  // --- Parse modules/sub-modules — fallback selectors ---
  const moduleHeaders = queryAllFallback(
    'toc-item-head',
    '[class*="toc-item-head"]',
    '[class*="module-header"]',
    '[data-type="chapter"]'
  );

  moduleHeaders.forEach(header => {
    const textContent = header.textContent.trim();

    // Extract title — fallback selectors for title element
    const titleEl = queryScopedFallback(
      header,
      'div > div',
      ':scope > [class*="title"]',
      ':scope > span'
    );
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

  // --- Parse individual lessons — fallback selectors ---
  const lessonItems = queryAllFallback(
    'toc-scrim-item',
    '[class*="toc-scrim-item"]',
    '[class*="lesson-item"]',
    '[data-type="scrim"]'
  );

  lessonItems.forEach(item => {
    const isCompleted = item.classList.contains('completed');
    const isGated = item.classList.contains('gated');

    // Get lesson title — fallback selectors
    const titleEl = queryScopedFallback(
      item,
      'div > div',
      ':scope > [class*="title"]',
      ':scope > span'
    );
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
  const headerTags = ['toc-item-head'];
  const headerSelectors = ['toc-item-head', '[class*="toc-item-head"]', '[class*="module-header"]'];

  let el = lessonEl.previousElementSibling;
  while (el) {
    // Check if element itself is a header
    if (el.tagName && headerTags.includes(el.tagName.toLowerCase())) {
      const titleEl = queryScopedFallback(el, 'div > div', ':scope > [class*="title"]', ':scope > span');
      if (titleEl) return titleEl.textContent.trim();
    }
    // Also check for header selectors via class
    for (const sel of headerSelectors) {
      try {
        if (el.matches && el.matches(sel)) {
          const titleEl = queryScopedFallback(el, 'div > div', ':scope > [class*="title"]', ':scope > span');
          if (titleEl) return titleEl.textContent.trim();
        }
      } catch { /* skip invalid */ }
    }
    // Check children for headers
    if (el.querySelector) {
      for (const sel of headerSelectors) {
        try {
          const headers = el.querySelectorAll(sel);
          if (headers.length > 0) {
            const last = headers[headers.length - 1];
            const titleEl = queryScopedFallback(last, 'div > div', ':scope > [class*="title"]', ':scope > span');
            if (titleEl) return titleEl.textContent.trim();
          }
        } catch { /* skip */ }
      }
    }
    el = el.previousElementSibling;
  }

  // Try parent's context
  const parent = lessonEl.parentElement;
  if (parent) {
    for (const sel of headerSelectors) {
      try {
        const parentHeader = parent.querySelector(sel);
        if (parentHeader) {
          const titleEl = queryScopedFallback(parentHeader, 'div > div', ':scope > [class*="title"]', ':scope > span');
          if (titleEl) return titleEl.textContent.trim();
        }
      } catch { /* skip */ }
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

// ===================================================================
// MutationObserver-based wait (replaces setInterval polling)
// ===================================================================

/**
 * Check if any TOC content elements exist in DOM.
 */
function hasTocContent() {
  return queryAllFallback(
    'toc-item-head',
    '[class*="toc-item-head"]',
    '[class*="module-header"]',
    '[data-type="chapter"]'
  ).length > 0;
}

/**
 * Wait for SPA content to load via MutationObserver, then scrape and send to background.
 * Replaces setInterval polling — fires only on actual DOM changes.
 */
function waitAndScrape() {
  // If content already present, scrape immediately
  if (hasTocContent()) {
    performScrape();
    return;
  }

  // Observe DOM for TOC elements appearing
  let resolved = false;

  const contentObserver = new MutationObserver(() => {
    if (resolved) return;
    if (hasTocContent()) {
      resolved = true;
      contentObserver.disconnect();
      performScrape();
    }
  });

  contentObserver.observe(document.body, { childList: true, subtree: true });

  // Safety timeout: 15s max, then disconnect and bail
  setTimeout(() => {
    if (!resolved) {
      resolved = true;
      contentObserver.disconnect();
      // Check one last time
      if (hasTocContent()) {
        performScrape();
      } else {
        console.log("X-Study-Streak: No Scrimba content found after waiting.");
      }
    }
  }, 15000);
}

/**
 * Execute scrape and send results to background.
 */
function performScrape() {
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
  banner.setAttribute('role', 'alert');
  banner.innerHTML = `
    <div class="xss-notif-icon">S</div>
    <div class="xss-notif-text">
      <strong>${newCount} new completion${newCount > 1 ? 's' : ''} detected!</strong>
      <span>${queuedCount} post${queuedCount !== 1 ? 's' : ''} queued for X</span>
    </div>
    <button class="xss-notif-close" aria-label="Dismiss notification">✕</button>
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

// ===================================================================
// SPA navigation detection
// ===================================================================

// Track state to avoid duplicate scrapes
let lastScrapedUrl = null;
let isScraping = false;

function guardedScrape() {
  const currentUrl = window.location.href;
  if (isScraping || lastScrapedUrl === currentUrl) return;
  isScraping = true;
  lastScrapedUrl = currentUrl;

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
