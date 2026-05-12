// background.js

const HISTORY_CAP = 100;
const MAX_TWEET_CHARS = 280;

function getTodayDateString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Calculate the number of calendar days between two date strings (YYYY-MM-DD).
 * Returns positive if date2 is after date1, negative if before.
 * Uses UTC to avoid DST edge cases.
 */
function calculateDiffDays(dateString1, dateString2) {
  const [y1, m1, d1] = dateString1.split('-').map(Number);
  const [y2, m2, d2] = dateString2.split('-').map(Number);
  const utc1 = Date.UTC(y1, m1 - 1, d1);
  const utc2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((utc2 - utc1) / (1000 * 60 * 60 * 24));
}

function getDefaultStreakData() {
  return {
    currentStreak: 0,
    lastPostDate: null,
    isBufferUsed: false,
    history: []
  };
}

async function checkStreakStatus() {
  const data = await chrome.storage.local.get(['streakData']);
  const streakData = data.streakData || getDefaultStreakData();

  if (!streakData.lastPostDate) {
    return streakData;
  }

  const today = getTodayDateString();
  const diffDays = calculateDiffDays(streakData.lastPostDate, today);

  if (diffDays > 2) {
    // Streak broken — reset fully
    streakData.currentStreak = 0;
    streakData.isBufferUsed = false;
    streakData.lastPostDate = null;
    await chrome.storage.local.set({ streakData });
  }

  return streakData;
}

async function handlePostSuccess(content) {
  const data = await chrome.storage.local.get(['streakData']);
  const streakData = data.streakData || getDefaultStreakData();

  const today = getTodayDateString();

  const settingsData = await chrome.storage.local.get(['settings']);
  const graceEnabled = settingsData.settings?.gracePeriod !== false;

  if (!streakData.lastPostDate) {
    // New start
    streakData.currentStreak = 1;
    streakData.lastPostDate = today;
  } else {
    const diffDays = calculateDiffDays(streakData.lastPostDate, today);

    if (diffDays === 0) {
      // Already posted today — skip streak update and history
      return streakData;
    } else if (diffDays === 1) {
      // Consecutive day
      streakData.currentStreak++;
      streakData.isBufferUsed = false;
      streakData.lastPostDate = today;
    } else if (diffDays === 2 && graceEnabled) {
      // Grace period (buffer)
      streakData.currentStreak++;
      streakData.isBufferUsed = true;
      streakData.lastPostDate = today;
    } else {
      // Streak broken, restart at 1
      streakData.currentStreak = 1;
      streakData.isBufferUsed = false;
      streakData.lastPostDate = today;
    }
  }

  // Append to history, cap at HISTORY_CAP
  streakData.history.push({ date: today, content });
  if (streakData.history.length > HISTORY_CAP) {
    streakData.history = streakData.history.slice(-HISTORY_CAP);
  }

  await chrome.storage.local.set({ streakData });
  return streakData;
}

// ===================================================================
// Scrimba Progress & Post Queue
// ===================================================================

/**
 * Process incoming Scrimba progress data.
 * Compare with stored progress to find NEW completions.
 * Generate post content and add to queue.
 */
async function handleScrimbaProgress(progressData) {
  const pathId = progressData.pathId || 'default';
  const pathName = progressData.pathName || 'Unknown Path';

  const stored = await chrome.storage.local.get(['scrimbaPaths', 'postQueue']);
  const allPaths = stored.scrimbaPaths || {};
  const oldProgress = allPaths[pathId] || { modules: [], lessons: [] };
  const postQueue = stored.postQueue || [];

  // Find newly completed lessons (were not completed before, now completed)
  const oldCompletedSet = new Set(
    (oldProgress.lessons || [])
      .filter(l => l.completed)
      .map(l => `${l.parentModule}::${l.title}`)
  );

  const newCompletions = (progressData.lessons || [])
    .filter(l => l.completed && !oldCompletedSet.has(`${l.parentModule}::${l.title}`));

  // Find newly completed modules
  const oldModuleCompleteSet = new Set(
    (oldProgress.modules || [])
      .filter(m => m.isComplete)
      .map(m => m.title)
  );

  const newModuleCompletions = (progressData.modules || [])
    .filter(m => m.isComplete && !oldModuleCompleteSet.has(m.title));

  // Store updated progress for this path
  allPaths[pathId] = progressData;
  await chrome.storage.local.set({ scrimbaPaths: allPaths });

  if (newCompletions.length === 0 && newModuleCompletions.length === 0) {
    return { newCompletions: [], queuedPosts: postQueue.length };
  }

  // Get streak data for day count
  const streakData = await checkStreakStatus();
  const dayNum = (streakData.currentStreak || 0) + 1;

  // Get custom hashtags from settings
  const settingsData = await chrome.storage.local.get(['settings']);
  const customHashtags = settingsData.settings?.hashtags || '#ScrimbaStudent #BuildInPublic #FrontendDev';

  // Generate post content
  const posts = generatePosts(newCompletions, newModuleCompletions, progressData.modules, dayNum, pathName, customHashtags);

  // Add to queue
  const newQueueItems = posts.map((text, i) => ({
    id: `${Date.now()}-${i}`,
    text,
    createdAt: new Date().toISOString(),
    source: 'scrimba-auto',
    posted: false
  }));

  postQueue.push(...newQueueItems);
  await chrome.storage.local.set({ postQueue });

  return {
    newCompletions: [...newCompletions.map(l => l.title), ...newModuleCompletions.map(m => m.title)],
    queuedPosts: postQueue.length
  };
}

/**
 * Generate tweet text(s) from completions.
 * Splits into multiple tweets if content exceeds MAX_TWEET_CHARS.
 */
function generatePosts(newLessons, newModules, allModules, dayNum, pathName, hashtags) {

  // Build content lines
  const lines = [];

  // Module completions get highlighted
  if (newModules.length > 0) {
    newModules.forEach(m => {
      lines.push(`Completed module: ${m.title} (${m.total} lessons)`);
    });
  }

  // Individual lesson completions
  if (newLessons.length > 0) {
    // Group lessons by parent module
    const grouped = {};
    newLessons.forEach(l => {
      if (!grouped[l.parentModule]) grouped[l.parentModule] = [];
      grouped[l.parentModule].push(l.title);
    });

    Object.entries(grouped).forEach(([module, lessons]) => {
      lessons.forEach(lesson => {
        lines.push(`- ${lesson}`);
      });
    });
  }

  // Build overall progress summary
  const inProgressModules = (allModules || []).filter(m => !m.isComplete && m.completed > 0);
  let progressLine = '';
  if (inProgressModules.length > 0) {
    const topModule = inProgressModules[0];
    progressLine = `${topModule.title}: ${topModule.completed}/${topModule.total}`;
  }

  // Compose full tweet(s)
  const header = `${pathName} | Day ${dayNum}\n\n`;
  const footer = `\n\n${progressLine ? progressLine + '\n' : ''}${hashtags}`;
  const maxContentChars = MAX_TWEET_CHARS - header.length - footer.length;

  // If all lines fit in one tweet
  const allContent = lines.join('\n');
  if (allContent.length <= maxContentChars) {
    return [header + allContent + footer];
  }

  // Split into multiple tweets
  const tweets = [];
  let currentLines = [];
  let currentLen = 0;

  lines.forEach(line => {
    if (currentLen + line.length + 1 > maxContentChars && currentLines.length > 0) {
      // Flush current batch
      const threadLabel = `[${tweets.length + 1}/…]\n`;
      tweets.push(header + threadLabel + currentLines.join('\n') + footer);
      currentLines = [];
      currentLen = 0;
    }
    currentLines.push(line);
    currentLen += line.length + 1;
  });

  // Flush remaining
  if (currentLines.length > 0) {
    const threadLabel = tweets.length > 0 ? `[${tweets.length + 1}/${tweets.length + 1}]\n` : '';
    tweets.push(header + threadLabel + currentLines.join('\n') + footer);
  }

  // Fix thread labels with total count
  if (tweets.length > 1) {
    tweets.forEach((tweet, i) => {
      tweets[i] = tweet.replace(`[${i + 1}/…]`, `[${i + 1}/${tweets.length}]`);
    });
  }

  return tweets;
}

/**
 * Get next post from queue (first unposted item).
 */
async function getNextPost() {
  const data = await chrome.storage.local.get(['postQueue']);
  const queue = data.postQueue || [];
  const pending = queue.filter(p => !p.posted);

  if (pending.length === 0) {
    return { post: null, remaining: 0, total: 0 };
  }

  return {
    post: pending[0],
    remaining: pending.length,
    total: queue.length,
    currentIndex: queue.length - pending.length + 1
  };
}

/**
 * Mark a post as posted and advance queue.
 */
async function markPostDone(postId) {
  const data = await chrome.storage.local.get(['postQueue']);
  const queue = data.postQueue || [];

  const idx = queue.findIndex(p => p.id === postId);
  if (idx !== -1) {
    queue[idx].posted = true;
    queue[idx].postedAt = new Date().toISOString();
  }

  // Clean up old posted items (keep last 20 for history)
  const posted = queue.filter(p => p.posted);
  const pending = queue.filter(p => !p.posted);
  const cleaned = [...posted.slice(-20), ...pending];

  await chrome.storage.local.set({ postQueue: cleaned });

  // Return next post
  const nextPending = cleaned.filter(p => !p.posted);
  return {
    post: nextPending.length > 0 ? nextPending[0] : null,
    remaining: nextPending.length
  };
}

/**
 * Get Scrimba progress summary for popup display.
 */
async function getScrimbaProgressSummary() {
  const data = await chrome.storage.local.get(['scrimbaPaths', 'scrimbaProgress', 'postQueue']);
  const queue = data.postQueue || [];
  const pendingPosts = queue.filter(p => !p.posted).length;

  // Migration: convert old single-path format
  let allPaths = data.scrimbaPaths || {};
  if (Object.keys(allPaths).length === 0 && data.scrimbaProgress) {
    const old = data.scrimbaProgress;
    allPaths['frontend-path'] = {
      ...old,
      pathId: 'frontend-path',
      pathName: 'The Frontend Developer Career Path'
    };
    await chrome.storage.local.set({ scrimbaPaths: allPaths });
  }

  const paths = Object.entries(allPaths).map(([id, progress]) => ({
    pathId: id,
    pathName: progress.pathName || id,
    modules: progress.modules || [],
    totalLessons: (progress.lessons || []).length,
    completedLessons: (progress.lessons || []).filter(l => l.completed).length,
    scrapedAt: progress.scrapedAt || null
  }));

  return { paths, pendingPosts };
}

/**
 * Clear entire post queue.
 */
async function clearPostQueue() {
  await chrome.storage.local.set({ postQueue: [] });
  return { success: true };
}

// Listen for messages from content scripts or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'checkStreak') {
    checkStreakStatus().then(sendResponse);
    return true; // Keep message channel open for async response
  }
  if (request.action === 'postSuccess') {
    handlePostSuccess(request.content).then(sendResponse);
    return true;
  }
  if (request.action === 'scrimbaProgress') {
    handleScrimbaProgress(request.data).then(sendResponse);
    return true;
  }
  if (request.action === 'getNextPost') {
    getNextPost().then(sendResponse);
    return true;
  }
  if (request.action === 'markPostDone') {
    markPostDone(request.postId).then(sendResponse);
    return true;
  }
  if (request.action === 'getScrimbaProgress') {
    getScrimbaProgressSummary().then(sendResponse);
    return true;
  }
  if (request.action === 'clearQueue') {
    clearPostQueue().then(sendResponse);
    return true;
  }
  if (request.action === 'updatePost') {
    updatePost(request.postId, request.text).then(sendResponse);
    return true;
  }
  if (request.action === 'deletePost') {
    deletePost(request.postId).then(sendResponse);
    return true;
  }
});

async function updatePost(postId, text) {
  const data = await chrome.storage.local.get(['postQueue']);
  const queue = data.postQueue || [];
  const idx = queue.findIndex(p => p.id === postId);
  if (idx !== -1) {
    queue[idx].text = text;
    await chrome.storage.local.set({ postQueue: queue });
  }
  return { success: true };
}

async function deletePost(postId) {
  const data = await chrome.storage.local.get(['postQueue']);
  const queue = data.postQueue || [];
  const newQueue = queue.filter(p => p.id !== postId);
  await chrome.storage.local.set({ postQueue: newQueue });
  return { success: true };
}
