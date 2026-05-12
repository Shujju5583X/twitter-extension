# X-Study-Streak

A Chrome extension that tracks your [Scrimba](https://scrimba.com) learning progress and helps you share daily Study Streak updates on X (Twitter).

## Features

- **Streak Tracking** — Tracks consecutive days you post. 1-day grace period. Features streak heatmap UI.
- **Multi-Path Scrimba Integration** — Scrapes progress across multiple Scrimba learning paths. Syncs modules, lessons, completion %.
- **Auto-Generated Posts** — Converts completions into ready tweets. Features editable post queue.
- **Injected UI on X** — "Study Streak" button in X sidebar. Dynamic theme sync with 60-30-10 palette.
- **Popup Dashboard** — View current streak, post queue, multi-path progress, and global stats.
- **Options Page** — Configure extension settings.

## Tech Stack

- Manifest V3 Chrome Extension
- Vanilla JavaScript
- Chrome Storage API
- Content Scripts

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/<your-username>/x-study-streak.git
   ```
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the cloned project folder
5. Pin the extension from the extensions menu for quick access

## Usage

1. **Study on Scrimba** — Visit any Scrimba course page. The extension automatically scrapes your progress.
2. **Open X** — A "Study Streak" button appears in the sidebar. Click it to see your streak and queued posts.
3. **Post your update** — Use the modal or compose a tweet manually. The extension detects successful posts and updates your streak.
4. **Track progress** — Open the popup to view your streak count, Scrimba module progress, and post history.

## Project Structure

```
├── manifest.json          # Extension manifest (MV3)
├── background.js          # Service worker — streak logic, queue management, Scrimba data processing
├── content.js             # Content script for X — injects UI, detects posts
├── content.css            # Styles for injected X UI components
├── scrimba-scraper.js     # Content script for Scrimba — scrapes course progress
├── popup.html             # Extension popup markup
├── popup.js               # Popup logic — renders streak, queue, and progress
├── popup.css              # Popup styles
├── options.html           # Settings page markup
├── options.js             # Settings logic
└── .gitignore
```

## How Streaks Work

| Scenario | Result |
|----------|--------|
| Post today after posting yesterday | Streak increments |
| Post today after missing 1 day | Streak increments (grace period used) |
| Post today after missing 2+ days | Streak resets to 1 |
| Multiple posts same day | Counted as 1 day |

## License

MIT
