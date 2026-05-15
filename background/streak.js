// background/streak.js — Streak tracking logic

const HISTORY_CAP = 100;

export function getTodayDateString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Calculate the number of calendar days between two date strings (YYYY-MM-DD).
 * Returns positive if date2 is after date1, negative if before.
 * Uses UTC to avoid DST edge cases.
 */
export function calculateDiffDays(dateString1, dateString2) {
  const [y1, m1, d1] = dateString1.split('-').map(Number);
  const [y2, m2, d2] = dateString2.split('-').map(Number);
  const utc1 = Date.UTC(y1, m1 - 1, d1);
  const utc2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((utc2 - utc1) / (1000 * 60 * 60 * 24));
}

export function getDefaultStreakData() {
  return {
    currentStreak: 0,
    lastPostDate: null,
    isBufferUsed: false,
    history: []
  };
}

export async function checkStreakStatus() {
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

export async function handlePostSuccess(content) {
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
