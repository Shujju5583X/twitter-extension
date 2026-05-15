// background.js — Entry point, message router only

import { checkStreakStatus, handlePostSuccess } from './background/streak.js';
import { handleScrimbaProgress, getScrimbaProgressSummary } from './background/scrimba.js';
import { getNextPost, markPostDone, clearPostQueue, updatePost, deletePost } from './background/queue.js';

// Message action → handler mapping
const handlers = {
  checkStreak:      () => checkStreakStatus(),
  postSuccess:      (req) => handlePostSuccess(req.content),
  scrimbaProgress:  (req) => handleScrimbaProgress(req.data),
  getNextPost:      () => getNextPost(),
  markPostDone:     (req) => markPostDone(req.postId),
  getScrimbaProgress: () => getScrimbaProgressSummary(),
  clearQueue:       () => clearPostQueue(),
  updatePost:       (req) => updatePost(req.postId, req.text),
  deletePost:       (req) => deletePost(req.postId),
};

// Listen for messages from content scripts or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handler = handlers[request.action];
  if (handler) {
    handler(request).then(sendResponse);
    return true; // Keep message channel open for async response
  }
});
