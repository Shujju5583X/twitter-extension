// background/scrimba.js — Scrimba progress processing & post generation

import { checkStreakStatus } from './streak.js';

const MAX_TWEET_CHARS = 280;

/**
 * Process incoming Scrimba progress data.
 * Compare with stored progress to find NEW completions.
 * Generate post content and add to queue.
 */
export async function handleScrimbaProgress(progressData) {
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
export function generatePosts(newLessons, newModules, allModules, dayNum, pathName, hashtags) {

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
 * Get Scrimba progress summary for popup display.
 */
export async function getScrimbaProgressSummary() {
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
