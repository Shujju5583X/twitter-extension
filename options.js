document.addEventListener('DOMContentLoaded', () => {
  const hashtagsInput = document.getElementById('hashtags');
  const gracePeriodInput = document.getElementById('gracePeriod');
  const saveBtn = document.getElementById('saveBtn');
  const statusEl = document.getElementById('status');

  // Load defaults
  chrome.storage.local.get(['settings'], (data) => {
    const settings = data.settings || {
      hashtags: '#ScrimbaStudent #BuildInPublic #FrontendDev',
      gracePeriod: true
    };
    hashtagsInput.value = settings.hashtags;
    gracePeriodInput.checked = settings.gracePeriod;
  });

  saveBtn.addEventListener('click', () => {
    const settings = {
      hashtags: hashtagsInput.value,
      gracePeriod: gracePeriodInput.checked
    };
    chrome.storage.local.set({ settings }, () => {
      statusEl.style.opacity = '1';
      setTimeout(() => statusEl.style.opacity = '0', 2000);
    });
  });
});
