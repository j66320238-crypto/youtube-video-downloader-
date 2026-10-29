# Yak — Handover Document

> Last updated: 2026-10-29 (session end)
> Project root: `F:\youtube video downloader`
> For: next AI/developer picking this up. Read this fully before touching code.

---

## 1. What this project is

**Yak** is a YouTube video downloader for Chromium browsers (Chrome / Brave / Edge).
It is **two pieces** that must run together:

| Piece | Path | What it does |
|---|---|---|
| **Extension** (MV3) | `extension/` | UI: per-thumbnail download button, quality sheet, download dock, popup, options page, context menus, notifications |
| **Local helper** (Node) | `helper/` | Tiny HTTP server on `127.0.0.1:8787` that actually downloads using portable `yt-dlp.exe` + `ffmpeg.exe` |

A browser extension alone **cannot** merge YouTube's separate video+audio streams or save to an arbitrary folder, so all downloading happens in the helper. The extension is only UI + a secure bridge.

Why this shape: it matches what mature GitHub projects do (cobalt, ui-for-yt-dlp): local server + browser UI, no cloud, no API keys, no uploads.

**Personal-use tool.** README must keep the "download only content you have rights to" note.

---

## 2. Current status (honest)

### Verified working — tested against the real helper + real YouTube
- Helper boots: `yt-dlp 2026.10.26`, `ffmpeg 9.0.2`, `ffprobe 9.0.2`, Node v24.22.1, port 8787.
- `GET /api/health` → binary probe, versions, folder, active/completed counts.
- `GET /api/formats?url=…` → title, channel, duration, thumbnail, **qualities with real sizes**, audio options (MP3 320/192, M4A), 5-min cache.
- Download video-only format (144p) → file lands in the requested folder.
- Download with **merge** (720p Big Buck Bunny: separate f298 video + audio) → single `.mp4` produced by ffmpeg, job ends `done/100%`.
- **MP3 extraction** (320 kbps) via ffmpeg → `.mp3` produced.
- **Real-time progress**: percent, downloaded bytes, total, speed (MB/s), ETA, title — all update live (verified with 720p job at 1.4% → 96.9%).
- **Cancel**: `POST /api/jobs/:id/cancel` → taskkill /T, job status `cancelled`, partial file removed by caller test.
- **Absolute-path validation** for the download folder (rejects relative/drive-relative paths, falls back to default on boot).
- **Title fallback**: if the request had no title, after download it is derived from the filename.
- Icons generated (16/32/48/128 PNG), Manrope font (latin + latin-ext) downloaded into `extension/assets/`.
- Content script loads in a mock YouTube page (harness): shadow host + shadow.css (174 rules) load, **download buttons inject into thumbnails** (4/4 cards, 32×32 rendered), ad card skipped.

### Written but NOT yet verified end-to-end
- Quality **sheet** open/close, tabs (Video/Audio), quality cards, extras chips, CTA → partially exercised only via DOM counts, **no screenshot review** (the browser MCP screenshot call started failing at the end of the session — see §9).
- Watch-page **pill button** (`#yak-watch-btn`) — cannot be tested in the harness because the harness origin is `127.0.0.1`, and `videoIdFromHref()` only accepts `youtube.com` / `youtu.be` hosts. Needs a real YouTube tab.
- **Download dock** (active job cards, cancel/reveal, collapse) — UI code exists, not visually checked.
- **Popup** (`ui/popup.html`) and **Options** (`ui/options.html`) — written, not opened in a browser yet.
- **Real extension load** (chrome://extensions) — never done in this session. Chrome 137+ refuses `--load-extension`; needs manual "Load unpacked" or a Chromium/Edge build.

### Not started
- README.md (user-facing install/usage/troubleshooting).
- `/api/pick-folder` dialog verification (PowerShell FolderBrowserDialog code exists).
- Notification click → reveal folder verification.
- 4K/8K actual download (only formats list verified 2160p available; a 2160p job was started then cancelled on purpose).

---

## 3. File map

```
F:\youtube video downloader\
├─ HANDOVER.md                  ← this file
├─ AGENTS.md                    ← short rules + pointer for AI agents
├─ extension\                   ← LOAD THIS FOLDER AS UNPACKED EXTENSION
│  ├─ manifest.json             MV3, permissions: storage, contextMenus, notifications,
│  │                            alarms, activeTab; host: *://*.youtube.com/*,
│  │                            http://127.0.0.1:8787/*
│  ├─ background.js             service worker: settings store, context menus, message
│  │                            router, badge, notifications, alarms, pending sheet
│  ├─ content\
│  │  ├─ content.js             ALL in-page UI logic (IIFE, ~1528 lines): shadow DOM,
│  │  │                          sheet, tabs, quality cards, dock, toasts, FAB,
│  │  │                          thumbnail injection, watch pill, observers, polling
│  │  ├─ content.css            small page-side styles for injected thumb button/pill
│  │  └─ shadow.css             the entire premium visual system inside shadow DOM
│  ├─ ui\
│  │  ├─ base.css               shared tokens/components for popup + options
│  │  ├─ popup.html/css/js      toolbar popup: current video, jobs, helper status
│  │  └─ options.html/css/js    settings: engine, folder, quality, audio, naming,
│  │                            extras, appearance, data
│  └─ assets\
│     ├─ font\Manrope.woff2 (+Manrope-latin-ext.woff2)
│     └─ icons\16.png 32.png 48.png 128.png
├─ helper\
│  ├─ server.js                 the whole local server (~1021 lines), zero npm deps
│  ├─ package.json              {"type":"module","start":"node server.js"}
│  ├─ state.json                persisted settings + history (auto-created)
│  ├─ bin\yt-dlp.exe            portable, 23 MB
│  ├─ bin\ffmpeg.exe            portable, 101 MB
│  ├─ bin\ffprobe.exe           portable, 101 MB
│  ├─ start-helper.bat          normal start (keeps window open, shows logs)
│  ├─ start-helper-minimized.bat  minimised window
│  └─ stop-helper.bat           kills whatever listens on 127.0.0.1:8787
├─ tests\
│  ├─ harness.html              mock YouTube page (grid + watch layout + ad card)
│  ├─ chrome-stub.js            stub of chrome.runtime/storage that proxies to the
│  │                            real helper through /api
│  └─ serve.js                  static server :8080 + /api proxy (test only)
└─ tools\
   └─ make-icons.js             dependency-free PNG icon generator (rounded gradient
                                square + download glyph, 4× supersampling)
```

Line counts: server 1021 · content.js 1528 · shadow.css 1463 · background 366 ·
options.js 356 · popup.js 345.

---

## 4. How to run / test

### Helper (required for any download)
```bat
cd /d "F:\youtube video downloader\helper"
start-helper.bat
```
Or headless for testing:
```bash
node helper/server.js            # port 8787
node helper/server.js            # YAK_DEBUG=1 logs every raw yt-dlp chunk
```

### Extension
1. `chrome://extensions` → Developer mode ON
2. **Load unpacked** → select `F:\youtube video downloader\extension`
3. Open any YouTube page. On the first load after install, refresh the tab.

### Quick API smoke tests
```bash
curl -s -H "X-Yak-Client: test" http://127.0.0.1:8787/api/health
curl -s -H "X-Yak-Client: test" "http://127.0.0.1:8787/api/formats?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Daqz-KE-bpKQ"
curl -s -X POST -H "Content-Type: application/json" -H "X-Yak-Client: test" \
  -d '{"url":"https://www.youtube.com/watch?v=jNQXAC9IVRw","mode":"video","height":144,"folder":"F:/youtube video downloader/.tmp/dl"}' \
  http://127.0.0.1:8787/api/jobs
```

### UI harness (no extension needed)
```bash
node tests/serve.js        # http://127.0.0.1:8080/watch?v=aqz-KE-bpKQ
```
The stub answers `chrome.runtime.sendMessage` by calling `/api/*` on the same
server, which proxies to the real helper. Fonts/shadow.css are served from
`/extension/...` (stub's `getURL` prefixes `/extension/`).
Harness limitations: watch pill + shorts FAB do not run (origin is not youtube.com).

---

## 5. Contracts that must stay in sync

### 5.1 Extension → background messages (`chrome.runtime.sendMessage`)
| type | payload | response |
|---|---|---|
| `YAK_HEALTH` | `{refresh?}` | health JSON |
| `YAK_FORMATS` | `{url}` | `{ok,data:{qualities,audioOptions,…}}` |
| `YAK_DOWNLOAD` | job payload | `{ok,job}` |
| `YAK_JOBS` | – | `{ok,active[],recent[]}` |
| `YAK_CANCEL` | `{id}` | `{ok}` |
| `YAK_REVEAL` | `{id}` | `{ok}` |
| `YAK_REVEAL_PATH` | `{path}` | `{ok}` |
| `YAK_PICK_FOLDER` | – | `{ok,folder}` (blocks up to ~130 s) |
| `YAK_SET_FOLDER` | `{folder}` | `{ok}` |
| `YAK_GET_SETTINGS` / `YAK_SAVE_SETTINGS` | `{patch}` | `{ok,settings}` |
| `YAK_SYNC_HELPER_SETTINGS` | – | pushes concurrency/template/folder to helper |
| `YAK_SET_PENDING` | `{url}` | stores `storage.session.pendingSheet` |
| `YAK_TAKE_PENDING` | – | `{ok,pending}` (120 s TTL) |
| `YAK_CLEAR_HISTORY` | – | `{ok}` |
| `YAK_OPEN_OPTIONS`, `YAK_NOTIFY_TABS`, `YAK_BADGE`, `YAK_NOTIFY_JOB` | – | `{ok}` |

Background → content: `YAK_JOBS_CHANGED`, `YAK_OPEN_SHEET {url}`.
Every background branch calls `sendResponse` and the listener returns `true`.

### 5.2 Helper HTTP API (all under `http://127.0.0.1:8787`)
```
GET  /                     health (same as /api/health)
GET  /api/health[?refresh=1]
GET  /api/formats?url=…    90 s timeout, 5-min cache, rejects live streams
GET  /api/jobs
POST /api/jobs             {url, mode:'video'|'audio', height, audioFormat,
                            audioBitrate, container, extras, folder, template,
                            title, thumbnail, channel}
POST /api/jobs/:id/cancel
POST /api/jobs/:id/reveal
POST /api/reveal           {path}
POST /api/pick-folder      PowerShell FolderBrowserDialog
GET  /api/settings
PUT  /api/settings         {folder?, concurrency?, template?}
POST /api/clear-history
```
Security: Origin allowlist (`chrome-extension://<32 chars>`, `http://127.0.0.1|localhost[:port]`)
+ `X-Yak-Client` header on every request from the extension. All helper calls go through
the **background** service worker (content scripts can't do cross-origin fetch).

### 5.3 Settings schema (identical in background.js, content.js, both UI pages,
   and `helper/server.js` defaults)
```js
{
  defaultHeight: 1080,        // 0 = best available
  defaultMode: 'video',       // 'video' | 'audio'
  container: 'mp4',           // 'mp4' | 'mkv'
  audioFormat: 'mp3',         // 'mp3' | 'm4a'
  audioBitrate: 320,
  folder: '',                 // absolute path; empty = ~/Downloads/Yak
  template: '',               // empty = '%(title)s [%(id)s].%(ext)s'
  concurrency: 2,             // 1..6
  extras: { subtitles:false, thumbnail:true, metadata:true },
  notify: true,
  autoReveal: false,
  accent: 'amber',            // amber | ice | lime | rose
  reduceMotion: false,
  showThumbButtons: true
}
```
Storage: `chrome.storage.sync['settings']`.

### 5.4 Job object (helper `jobSummary`)
`{id,url,videoId,mode,height,qualityLabel,title,thumbnail,channel,status,percent,
downloaded,total,speed,eta,phase,filePath,error,createdAt,startedAt,finishedAt}`
Statuses: `queued | starting | downloading | processing | done | error | cancelled`.
`phase` increments when the second stream (audio) restarts progress.

---

## 6. yt-dlp invocation (this is the heart — do not "simplify" casually)

`helper/server.js → buildArgs()`:

```
--no-playlist --newline --progress --no-warnings --windows-filenames
--js-runtimes node                       ← REQUIRED: yt-dlp 2026.10 needs a JS runtime
--ffmpeg-location <abs path to ffmpeg.exe>   ← accepts a file path, not just a dir
--concurrent-fragments 8 (video) / 4 (audio)
--retries 10 --fragment-retries 10 --socket-timeout 20 --trim-filenames 180
--progress-template "download:YAKP|%(progress.percent)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(info.title)s"
--print "after_move:YAKFILE|%(filepath)s"
-o <folder>/<template>
```

Video: `-f "bestvideo[height<=H]+bestaudio/bestvideo[height<=H]/best[height<=H]/best"`
`--merge-output-format mp4/mkv` (or `mkv`), `-S "res:H,vcodec:h264,acodec:aac"`.
Audio: `-f bestaudio/best -x --audio-format mp3|m4a --audio-quality 320K|0`.
Extras: `--write-subs --write-auto-subs --sub-langs en.*,hi.* --embed-subs`,
`--embed-thumbnail --convert-thumbnails jpg`, `--embed-metadata`.

Progress percent is usually `NA` → code computes `downloaded/total`. Both stdout
and stderr are parsed; lines are split on `\r\n|\r|\n`.
`childEnv()` prepends `dirname(process.execPath)` and `helper/bin` to PATH.

---

## 7. Bugs already found & fixed (don't re-introduce)

1. **Progress never updated** — `consume()` called `handleLine(job, line)` while
   `handleLine` takes only `(rawLine)`, so `job` was parsed as the line. Fixed to
   `handleLine(line)`. Symptom was: job stuck at `starting / 0%` while the file grew.
2. **`--newline` output still needs `\r` splitting** — now split on `/\r\n|\r|\n/`.
3. **Relative folders silently wrote into `helper\…`** — `ensureFolder` now requires
   an absolute path (`C:\…` or UNC) and `path.resolve` alone was not enough.
4. **Empty title in history** — `finishJob` derives the title from the filename.
5. **Re-download of an existing file reported "file not found"** — handler for
   `[download] … has already been downloaded` sets `filePath`.
6. **Missing background cases** `YAK_SET_PENDING` / `YAK_CLEAR_HISTORY` — added.
7. **Double injection on nested cards** (`ytd-rich-item-renderer` wrapping
   `ytd-rich-grid-media`) — existence check now happens before marking the card.
8. **Shadow CSS never loaded in the harness** — harness stub `getURL` must prefix
   `/extension/` (test-only issue).
9. `chrome.alarms` used without permission (fixed: permission added).
10. Audio tab with no audio options enabled the CTA (fixed: disabled state).
11. Windows paths in the sheet used `direction: rtl` (removed; JS middle-truncates).

---

## 8. Remaining work — in priority order

1. **Visual QA of the sheet** (`content/shadow.css` + `renderVideoPanel`/`renderAudioPanel`).
   Use the harness: open `http://127.0.0.1:8080/watch?v=aqz-KE-bpKQ`, click a thumb button,
   screenshot; check: header thumbnail, engine pill, tabs + glider, quality cards with
   check/best badges, audio rows, extras chips, folder row, CTA, dock appearance,
   mobile width (390 px) and `prefers-reduced-motion`.
2. **Load the real extension** (chrome://extensions → Load unpacked → `extension/`),
   then on a real YouTube watch page verify:
   - thumb buttons on home/search/sidebar, ad cards skipped,
   - watch-page pill injected next to Like/Share,
   - sheet opens, quality list matches `formats`,
   - download → dock card progress → "saved" state → reveal,
   - Shift+click quick download,
   - shorts FAB on `/shorts/…`.
   If Chrome refuses unsigned extensions, use Edge/Brave or a Chromium build.
3. **Popup & options visual pass** — open each page, check layout at 358 px (popup)
   and 900 px (options), toggle every control, confirm the helper sync calls fire
   (helper `/api/settings` PUT), confirm autosave indicator, reset settings.
4. **Folder picker** — `/api/pick-folder` uses PowerShell FolderBrowserDialog. Verify
   it opens, returns the path, cancels cleanly, and that cancel does not leave a
   dangling task (`taskkill` path exists in code).
5. **Notifications** — finish a download, click the notification and the
   "Show in folder" button; both call `/api/jobs/:id/reveal`.
6. **Live stream & edge cases** — live URLs are rejected on purpose; verify the
   sheet shows a clean error. Also check age-restricted/members-only failure copy.
7. **README.md** — install helper, load unpacked, per-browser notes, troubleshooting
   (helper offline, port busy, Node missing, antivirus), personal-use/ToS note.
8. **Optional polish** — batch/playlist downloads, subtitle language picker,
   `--download-sections` trim, per-site accent, auto-start helper on login.

---

## 9. Environment notes / gotchas

- Windows 11, Git-Bash shell. **`/tmp` maps to `F:\tmp`** — never use `/tmp` paths with Node.
  Use project-relative `.tmp/` and `cygpath -w` when a Windows path is needed.
- Heredocs mangle backslashes in JSON: use forward slashes in test paths
  (`F:/youtube video downloader/.tmp/dl`) — the helper resolves them fine.
- Node 24 is installed; the helper needs **Node 22+** (because `--js-runtimes node`
  is only supported there). `start-helper.bat` checks `where node`.
- yt-dlp is a Python binary; it needs a JS runtime for signature deciphering →
  `--js-runtimes node` plus `dirname(process.execPath)` on PATH (already in `childEnv()`).
- Do not run two helpers: port 8787 must be free. `stop-helper.bat` kills the listener.
- Antivirus/Defender may scan a freshly downloaded `ffmpeg.exe`; first `--version`
  probe can take a couple of seconds (probe result cached 30 s).
- Chrome MCP screenshot calls began failing near the end of the session
  (`MCP error -32603`). `evaluate_script`, navigation and DOM inspection still worked —
  retry screenshots, restart the browser, or fall back to the harness + manual check.
- All binaries are **inside the project** (`helper/bin`). Nothing is installed
  system-wide; do not move the binaries out of `helper/bin`.

---

## 10. Design system quick reference

- Palette: molten amber gradient `--acc-1 #ffc46b → --acc-2 #ff7a18 → --acc-3 #ff4d2e`
  over near-black `#07080c`; accents also `ice`, `lime`, `rose` (see `ACCENTS` in
  content.js and both UI scripts — keep all four copies identical).
- Type: Manrope (variable 200–800) via `assets/font/Manrope.woff2`, always as
  `"Yak Sans"` first in a font stack.
- Tokens live in `ui/base.css` (`--ink/--muted/--faint/--line/--card/--ease`) and
  are mirrored inside `content/shadow.css` on `:host`.
- Motion: `cubic-bezier(0.16,1,0.3,1)`, rise/shimmer/dock-in/toast/bar-flow keyframes,
  all disabled under `prefers-reduced-motion` **and** the `reduceMotion` setting
  (`.yak-reduce-motion` on `.yak-ui`).
- Accessibility: focus trap + Escape in the sheet, `aria-modal`, `aria-selected` on
  tabs, `aria-pressed` on chips, 2 px accent focus rings, visible labels on icon buttons.

---

## 11. Session evidence log (2026-10-29)

| Check | Result |
|---|---|
| `/api/health` | ok, yt-dlp 2026.10.26, ffmpeg 9.0.2, ffprobe 9.0.2 |
| formats `aqz-KE-bpKQ` | 2160/1440/1080/720/480/360/240/144 with sizes; MP3 320/192 + M4A |
| download 144p `jNQXAC9IVRw` | done, `Me at the zoo [jNQXAC9IVRw].mp4`, title fallback applied |
| audio MP3 320 | done, `.mp3` produced by ffmpeg |
| download 720p `aqz-KE-bpKQ` | live progress 1.4%→96.9%, merged `… .mp4`, done 100% |
| cancel 2160p job | status `cancelled`, partial file removed |
| relative folder `F:foo` | rejected before fix → now absolute-only |
| harness injection | 4/4 thumb buttons, ad card skipped, shadow.css 174 rules |

Test downloads were written to a temporary folder and deleted; `helper/state.json`
history was cleared (settings preserved) before handover.
