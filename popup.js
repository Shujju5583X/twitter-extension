document.addEventListener('DOMContentLoaded', () => {
  const countEl = document.getElementById('streak-count');
  const statusEl = document.getElementById('streak-status');
  const heatmapGrid = document.getElementById('heatmap-grid');
  const queueCountEl = document.getElementById('queue-count');
  const queueHintEl = document.getElementById('queue-hint');
  const queueListEl = document.getElementById('queue-list');
  const clearQueueBtn = document.getElementById('clear-queue-btn');
  const moduleListEl = document.getElementById('module-list');
  const overallProgressEl = document.getElementById('overall-progress');
  const syncedAtEl = document.getElementById('synced-at');
  const scrimbaEmptyEl = document.getElementById('scrimba-empty');

  // --- Streak Data ---
  chrome.runtime.sendMessage({ action: 'checkStreak' }, (streakData) => {
    if (chrome.runtime.lastError || !streakData) {
      console.warn("X-Study-Streak: Could not fetch streak data:", chrome.runtime.lastError?.message);
      countEl.textContent = '—';
      statusEl.textContent = 'Unavailable';
      statusEl.className = 'streak-badge';
      return;
    }

    countEl.textContent = streakData.currentStreak || 0;
    
    if (streakData.isBufferUsed) {
      statusEl.textContent = 'Buffer Used';
      statusEl.className = 'streak-badge status-buffer';
    } else {
      statusEl.textContent = streakData.currentStreak > 0 ? 'Active' : 'Not Started';
      statusEl.className = 'streak-badge ' + (streakData.currentStreak > 0 ? 'status-active' : '');
    }

    // Render Heatmap (last 21 days = 3 weeks, or just a 7x4 grid = 28 days)
    heatmapGrid.innerHTML = '';
    const today = new Date();
    const daysToShow = 28; // 4 weeks
    const datesMap = {};

    // Map history array to date counts
    if (streakData.history) {
      streakData.history.forEach(item => {
        datesMap[item.date] = (datesMap[item.date] || 0) + 1;
      });
    }

    for (let i = daysToShow - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(today.getDate() - i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      
      const count = datesMap[dateStr] || 0;
      const cell = document.createElement('div');
      cell.className = 'xss-heatmap-cell';
      
      if (count === 1) cell.classList.add('level-1');
      else if (count === 2) cell.classList.add('level-2');
      else if (count === 3) cell.classList.add('level-3');
      else if (count >= 4) cell.classList.add('level-4');

      const tooltip = document.createElement('div');
      tooltip.className = 'xss-heatmap-tooltip';
      tooltip.textContent = `${count} post${count !== 1 ? 's' : ''} on ${dateStr}`;
      
      cell.appendChild(tooltip);
      heatmapGrid.appendChild(cell);
    }
  });

  // --- Scrimba Progress ---
  chrome.runtime.sendMessage({ action: 'getScrimbaProgress' }, (data) => {
    if (chrome.runtime.lastError || !data) return;

    // Queue count
    queueCountEl.textContent = data.pendingPosts;
    if (data.pendingPosts > 0) {
      queueCountEl.classList.add('xss-queue-active');
      queueHintEl.textContent = `${data.pendingPosts} post${data.pendingPosts > 1 ? 's' : ''} ready — open X to share`;
      clearQueueBtn.style.display = '';
    } else {
      queueHintEl.textContent = 'No posts queued';
      clearQueueBtn.style.display = 'none';
    }

    const paths = data.paths || [];
    if (paths.length === 0) return;

    const activePaths = paths.filter(p => p.totalLessons > 0);
    if (activePaths.length === 0) return;

    scrimbaEmptyEl.style.display = 'none';

    // Aggregate stats across all paths
    const totalAll = activePaths.reduce((s, p) => s + p.totalLessons, 0);
    const completedAll = activePaths.reduce((s, p) => s + p.completedLessons, 0);
    const aggPct = Math.round((completedAll / totalAll) * 100);

    const radius = 18;
    const circumference = 2 * Math.PI * radius;
    const strokeDasharray = `${(aggPct * circumference) / 100} ${circumference}`;

    overallProgressEl.innerHTML = `
      <div class="xss-global-stats">
        <svg class="xss-donut" width="48" height="48" viewBox="0 0 48 48">
          <circle class="xss-donut-bg" cx="24" cy="24" r="${radius}"></circle>
          <circle class="xss-donut-fill" cx="24" cy="24" r="${radius}" stroke-dasharray="${strokeDasharray}" stroke-dashoffset="${circumference/4}"></circle>
        </svg>
        <div class="xss-global-info">
          <div class="xss-global-pct">${aggPct}% Total Progress</div>
          <div class="xss-global-meta">${completedAll} / ${totalAll} lessons across ${activePaths.length} path${activePaths.length > 1 ? 's' : ''}</div>
        </div>
      </div>
    `;

    // Latest sync time
    const latestScraped = activePaths
      .filter(p => p.scrapedAt)
      .sort((a, b) => new Date(b.scrapedAt) - new Date(a.scrapedAt))[0];
    if (latestScraped) {
      syncedAtEl.textContent = `Synced ${timeAgo(new Date(latestScraped.scrapedAt))}`;
    }

    // Per-path breakdown
    moduleListEl.innerHTML = '';
    activePaths.forEach((path, idx) => {
      const pct = Math.round((path.completedLessons / path.totalLessons) * 100);

      // Separator between paths
      if (idx > 0) {
        const sep = document.createElement('div');
        sep.className = 'xss-path-separator';
        moduleListEl.appendChild(sep);
      }

      // Path header
      const pathRow = document.createElement('div');
      pathRow.className = 'xss-path-header';
      pathRow.innerHTML = `
        <span class="xss-path-name">${path.pathName}</span>
        <span class="xss-path-pct">${pct}%</span>
      `;
      moduleListEl.appendChild(pathRow);

      // Path meta
      const meta = document.createElement('div');
      meta.className = 'xss-path-meta';
      meta.textContent = `${path.completedLessons}/${path.totalLessons} lessons`;
      if (path.scrapedAt) meta.textContent += ` · ${timeAgo(new Date(path.scrapedAt))}`;
      moduleListEl.appendChild(meta);

      // Modules under this path
      (path.modules || []).forEach(mod => {
        const item = document.createElement('div');
        item.className = 'xss-module-item';
        const icon = mod.isComplete ? '+' : (mod.completed > 0 ? '-' : 'o');
        item.innerHTML = `
          <span class="xss-mod-icon">${icon}</span>
          <span class="xss-mod-name">${mod.title}</span>
          <span class="xss-mod-progress ${mod.isComplete ? 'xss-mod-done' : ''}">${mod.percent}%</span>
        `;
        moduleListEl.appendChild(item);
      });
    });
  });

  // Clear queue button
  clearQueueBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'clearQueue' }, () => {
      queueCountEl.textContent = '0';
      queueCountEl.classList.remove('xss-queue-active');
      queueHintEl.textContent = 'Queue cleared';
      clearQueueBtn.style.display = 'none';
      queueListEl.innerHTML = '';
    });
  });

  // --- Render Queue List ---
  function loadQueue() {
    chrome.storage.local.get(['postQueue'], (data) => {
      const queue = data.postQueue || [];
      const pending = queue.filter(p => !p.posted);
      
      queueListEl.innerHTML = '';
      if (pending.length === 0) return;

      pending.forEach(post => {
        const item = document.createElement('div');
        item.className = 'xss-queue-item';

        const textarea = document.createElement('textarea');
        textarea.value = post.text;

        const actions = document.createElement('div');
        actions.className = 'xss-queue-actions';

        const saveBtn = document.createElement('button');
        saveBtn.className = 'xss-queue-btn save';
        saveBtn.textContent = 'Save';
        saveBtn.addEventListener('click', () => {
          chrome.runtime.sendMessage({ action: 'updatePost', postId: post.id, text: textarea.value }, () => {
            saveBtn.textContent = 'Saved!';
            setTimeout(() => saveBtn.textContent = 'Save', 1500);
          });
        });

        const delBtn = document.createElement('button');
        delBtn.className = 'xss-queue-btn delete';
        delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', () => {
          chrome.runtime.sendMessage({ action: 'deletePost', postId: post.id }, () => {
            item.remove();
            // Update counter locally
            const c = parseInt(queueCountEl.textContent) - 1;
            queueCountEl.textContent = c;
            if (c <= 0) {
              queueCountEl.classList.remove('xss-queue-active');
              queueHintEl.textContent = 'No posts queued';
              clearQueueBtn.style.display = 'none';
            } else {
              queueHintEl.textContent = `${c} post${c > 1 ? 's' : ''} ready — open X to share`;
            }
          });
        });

        actions.appendChild(delBtn);
        actions.appendChild(saveBtn);
        item.appendChild(textarea);
        item.appendChild(actions);
        queueListEl.appendChild(item);
      });
    });
  }

  loadQueue();
});

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
