# Yak — YouTube Downloader

> **Personal-use only.** Only download content you have the rights to save. Respect creators and YouTube's Terms of Service.

A cinematic Chrome/Brave/Edge extension that puts a download button on every YouTube thumbnail. Downloads happen locally via yt-dlp + ffmpeg — nothing is uploaded anywhere.

---

## Features

- **Thumbnail buttons** on every video card (home, search, sidebar, playlists)
- **Watch-page Download button** next to Like/Share
- **Shorts FAB** floating button on `/shorts/` pages
- **Shift+click** for instant quick-download at default quality
- **Quality picker sheet** with real file sizes, Video & Audio tabs
- **Audio export** — MP3 320/192 kbps or M4A original quality
- **Extras** — subtitles, embedded thumbnail, metadata tags
- **Download dock** — live progress bar, speed, ETA, cancel, reveal folder
- **Notifications** when each download finishes
- **Custom download folder** — pick via GUI or type path
- **Accent themes** — Amber, Ice, Lime, Rose
- **Reduce motion** mode

---

## Requirements

| Thing | Version |
|---|---|
| Windows 10/11 | — |
| Node.js | 22 or newer |
| Chrome / Brave / Edge | 116 or newer |

---

## Installation

### Step 1 — Start the helper

The extension needs a local server to actually download files. It runs on `127.0.0.1:8787` and never sends anything to the internet.

1. Open `helper\` folder in File Explorer
2. Double-click **`start-helper.bat`**
3. Keep the terminal window open while downloading

> To start minimised to tray: use **`start-helper-minimized.bat`** instead.

### Step 2 — Load the extension

1. Open Chrome and go to `chrome://extensions`
2. Turn on **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the **`extension\`** folder inside this project
5. Yak appears in your toolbar

### Step 3 — Download a video

1. Go to any YouTube page
2. Hover over any video thumbnail — a **↓** button appears
3. Click it → quality sheet opens → pick quality → **Download**
4. Or **Shift+click** the button for an instant download at your default quality

---

## Usage

### Thumbnail buttons
Appear on home feed, search results, sidebar, playlists, and the Up Next panel.

### Watch-page button
On any `/watch?v=…` page, a **Download** pill appears next to the Like/Share row.

### Shorts FAB
On any `/shorts/…` page, a floating button appears in the bottom-right corner.

### Quality sheet
- **Video tab** — choose from all available resolutions with estimated file sizes
- **Audio tab** — MP3 (320 or 192 kbps) or M4A (original quality)
- **Extras** — toggle subtitles, thumbnail cover art, and metadata tags
- **Save to** — click **Change** to pick a folder via GUI

### Dock
After starting a download, a dock appears at the bottom of the page showing:
- Live download progress with speed and ETA
- Cancel button (×)
- Reveal button (folder icon) when done
- Dismiss button when done or failed

### Popup
Click the Yak icon in the toolbar to see the current video and recent downloads.

### Settings
Right-click the Yak icon → **Yak settings**, or click the gear icon in the popup.

---

## Troubleshooting

### "Helper offline"
The local helper is not running.
1. Open the `helper\` folder
2. Double-click `start-helper.bat`
3. Check if Node.js is installed: run `node --version` in a terminal (need v22+)
4. Click **Retry** in the quality sheet

### Port 8787 already in use
Run `helper\stop-helper.bat` then `start-helper.bat` again.

### Antivirus slowing first download
Windows Defender may scan `ffmpeg.exe` on first use. Wait a few seconds; it will pass. You can add `helper\bin\` to your antivirus exclusions.

### Thumbnails not getting download buttons
- Refresh the YouTube page after installing or updating the extension
- Make sure **Thumbnail buttons** is ON in Settings

### Download stuck at 0% forever
- Check if the helper window is open and shows activity
- Check `chrome://extensions` → Yak → **Inspect views: service worker** for errors
- Try a different video to rule out regional restrictions

### Chrome refuses to load the extension
Use Brave or Edge — they both support Load Unpacked in developer mode without extra flags.

---

## File layout

```
F:\youtube video downloader\
├─ extension\          ← Load this folder as unpacked extension
│  ├─ manifest.json
│  ├─ background.js
│  ├─ content\
│  │  ├─ content.js    ← All in-page UI (thumbnail buttons, sheet, dock)
│  │  ├─ content.css   ← Styles for YouTube page elements
│  │  └─ shadow.css    ← Styles for shadow DOM panel
│  ├─ ui\
│  │  ├─ popup.html/css/js    ← Toolbar popup
│  │  └─ options.html/css/js  ← Settings page
│  └─ assets\
│     ├─ font\         ← Manrope variable font
│     └─ icons\        ← 16/32/48/128 PNG icons
├─ helper\             ← Run start-helper.bat before downloading
│  ├─ server.js        ← Local HTTP server (port 8787)
│  ├─ start-helper.bat
│  ├─ stop-helper.bat
│  └─ bin\             ← yt-dlp.exe + ffmpeg.exe + ffprobe.exe
└─ README.md
```

---

## Privacy

- **No accounts, no API keys, no cloud.**
- All downloads happen on your machine via yt-dlp.
- The helper listens only on `127.0.0.1` — other devices on your network cannot reach it.
- Extension storage is local (`chrome.storage.sync` for settings, helper's `state.json` for history).

---

## License

Personal use only. Not for redistribution. yt-dlp and ffmpeg are separate projects with their own licenses.
