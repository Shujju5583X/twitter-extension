// background/queue.js — Post queue management

/**
 * Get next post from queue (first unposted item).
 */
export async function getNextPost() {
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
export async function markPostDone(postId) {
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
 * Clear entire post queue.
 */
export async function clearPostQueue() {
  await chrome.storage.local.set({ postQueue: [] });
  return { success: true };
}

/**
 * Update text of an existing post in the queue.
 */
export async function updatePost(postId, text) {
  const data = await chrome.storage.local.get(['postQueue']);
  const queue = data.postQueue || [];
  const idx = queue.findIndex(p => p.id === postId);
  if (idx !== -1) {
    queue[idx].text = text;
    await chrome.storage.local.set({ postQueue: queue });
  }
  return { success: true };
}

/**
 * Delete a post from the queue.
 */
export async function deletePost(postId) {
  const data = await chrome.storage.local.get(['postQueue']);
  const queue = data.postQueue || [];
  const newQueue = queue.filter(p => p.id !== postId);
  await chrome.storage.local.set({ postQueue: newQueue });
  return { success: true };
}
