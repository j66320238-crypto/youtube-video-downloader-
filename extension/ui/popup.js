const $ = (id) => document.getElementById(id);

const els = {
  engine: $('engine'),
  openOptions: $('openOptions'),
  currentCard: $('currentCard'),
  jobList: $('jobList'),
  clearHistory: $('clearHistory'),
  footer: $('footer'),
  footText: $('footText'),
  startHelper: $('startHelper'),
  toast: $('toast'),
  toastText: $('toastText')
};

const ACCENTS = {
  amber: ['#ffc46b', '#ff7a18', '#ff4d2e'],
  ice: ['#a5e9ff', '#38bdf8', '#4f6bff'],
  lime: ['#d8ff9a', '#7ee65c', '#12b981'],
  rose: ['#ffc0d9', '#ff5f9e', '#c026d3']
};

const ICONS = {
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10m0 0 4-4m-4 4-4-4"/><path d="M5 18.5h14"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3l2 2.5h8A2.5 2.5 0 0 1 21 10v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17Z"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m7 7 10 10M17 7 7 17"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>',
  yt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.6" y="6" width="18.8" height="12" rx="3.4"/><path d="M10.2 9.6v4.8l4.2-2.4z" fill="currentColor" stroke="none"/></svg>'
};

let settings = null;
let activeTab = null;
let videoId = null;
let poller = null;
let lastJobs = [];
let lastStatuses = new Map();

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(res || { ok: false, error: 'No response' });
    });
  });
}

function toast(text, isError = false) {
  els.toastText.textContent = text;
  els.toast.classList.toggle('is-error', isError);
  els.toast.classList.add('is-visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove('is-visible'), 2600);
}

function applyAccent(name) {
  const tones = ACCENTS[name] || ACCENTS.amber;
  document.documentElement.style.setProperty('--acc-1', tones[0]);
  document.documentElement.style.setProperty('--acc-2', tones[1]);
  document.documentElement.style.setProperty('--acc-3', tones[2]);
}

function parseVideo(raw) {
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || null;
    if (!host.endsWith('youtube.com')) return null;
    return url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})/)?.[1] || null;
  } catch {
    return null;
  }
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let sized = value;
  while (sized >= 1024 && i < units.length - 1) {
    sized /= 1024;
    i += 1;
  }
  return `${sized.toFixed(sized >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function relativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return '';
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function setEngine(state, text) {
  els.engine.className = `engine-pill ${state}`;
  els.engine.textContent = text;
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab || null;

  const saved = await send({ type: 'YAK_GET_SETTINGS' });
  settings = saved.settings || {};
  applyAccent(settings.accent);

  if (tab?.url) videoId = parseVideo(tab.url);
  renderCurrent(tab);
  await checkHealth();
  await refreshJobs();
  startPolling();
}

function renderCurrent(tab) {
  if (!videoId) {
    els.currentCard.innerHTML = `
      <div class="idle-card">
        <span class="idle-mark">${ICONS.yt}</span>
        <div class="idle-copy">
          <strong>Open a YouTube video</strong>
          <span>Yak's arrow shows on every thumbnail once you're there.</span>
        </div>
      </div>`;
    return;
  }

  const title = (tab?.title || 'YouTube video').replace(/\s*-\s*YouTube\s*$/i, '').trim();
  els.currentCard.innerHTML = `
    <div class="video-row">
      <div class="thumb">
        <img alt="" src="https://i.ytimg.com/vi/${videoId}/mqdefault.jpg" />
        <span class="badge">HD</span>
      </div>
      <div class="video-meta">
        <div class="video-title"></div>
        <div class="video-sub">${settings?.defaultHeight ? settings.defaultHeight + 'p' : '1080p'} · ${(settings?.container || 'mp4').toUpperCase()}</div>
      </div>
    </div>
    <button class="cta" id="openSheet">${ICONS.download}<span>Choose quality &amp; download</span></button>`;

  els.currentCard.querySelector('.video-title').textContent = title;
  const img = els.currentCard.querySelector('img');
  img.addEventListener('error', () => {
    img.src = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  }, { once: true });
  els.currentCard.querySelector('#openSheet').addEventListener('click', openSheet);
}

async function openSheet() {
  const button = els.currentCard.querySelector('#openSheet');
  if (button) button.disabled = true;
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const opened = await new Promise((resolve) => {
    chrome.tabs.sendMessage(activeTab.id, { type: 'YAK_OPEN_SHEET', url }, () => {
      resolve(!chrome.runtime.lastError);
    });
  });
  if (opened) {
    window.close();
    return;
  }
  await send({ type: 'YAK_SET_PENDING', url });
  await chrome.tabs.update(activeTab.id, { url });
  window.close();
}

async function checkHealth() {
  const health = await send({ type: 'YAK_HEALTH' });
  const running = health.ok || health.app === 'yak-helper';
  if (running) {
    const version = health.version ? ` v${health.version}` : '';
    setEngine(health.ok ? 'is-on' : 'is-warn', health.ok ? 'Ready' : 'Engine');
    els.footer.classList.remove('is-off');
    els.footer.classList.add('is-on');
    els.footText.textContent = health.ok ? `Helper online${version}` : 'Helper up · engine missing';
    els.startHelper.classList.add('hidden');
  } else {
    setEngine('is-off', 'Offline');
    els.footer.classList.remove('is-on');
    els.footer.classList.add('is-off');
    els.footText.textContent = 'Helper offline — start it to download';
    els.startHelper.classList.remove('hidden');
  }
}

async function refreshJobs() {
  const result = await send({ type: 'YAK_JOBS' });
  if (!result.ok) {
    if (result.offline) renderJobs([], true);
    return;
  }
  const jobs = [...(result.active || []), ...(result.recent || [])].slice(0, 8);
  lastJobs = jobs;
  renderJobs(jobs, false);
  els.clearHistory.classList.toggle('hidden', !(result.recent || []).length);
  watchForFinishes(jobs);
}

function renderJobs(jobs, offline) {
  if (offline) {
    els.jobList.innerHTML = `
      <div class="empty">
        <div class="empty-ring">${ICONS.folder}</div>
        <p>Helper is not running</p>
        <span>Double-click <b>start-helper.bat</b> in the helper folder, then reopen this popup.</span>
      </div>`;
    return;
  }
  if (!jobs.length) {
    els.jobList.innerHTML = `
      <div class="empty">
        <div class="empty-ring">${ICONS.download}</div>
        <p>No downloads yet.</p>
        <span>Hover any YouTube thumbnail and hit the arrow.</span>
      </div>`;
    return;
  }

  const seen = new Set();
  const html = jobs.map((job) => {
    if (seen.has(job.id)) return '';
    seen.add(job.id);
    return jobMarkup(job);
  }).join('');
  els.jobList.innerHTML = html;

  els.jobList.querySelectorAll('.job').forEach((node) => {
    node.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => jobAction(btn.dataset.act, btn.dataset.id));
    });
  });
}

function jobMarkup(job) {
  const done = job.status === 'done';
  const failed = job.status === 'error';
  const running = !done && !failed;
  const label = job.status === 'queued' ? 'Queued' : job.status === 'processing' ? 'Finishing' : done ? 'Saved' : failed ? 'Failed' : 'Downloading';
  const meta = done
    ? `${job.qualityLabel || ''}${job.total ? ' · ' + formatBytes(job.total) : ''} · ${relativeTime(job.finishedAt)}`
    : failed
      ? (job.error || 'Something went wrong').split('\n')[0]
      : `${Math.round(job.percent || 0)}%${job.speed ? ' · ' + formatBytes(job.speed) + '/s' : ''}${job.eta ? ' · ' + job.eta + 's left' : ''}`;
  const icon = done ? ICONS.check : failed ? ICONS.close : running ? `<span class="spinner"></span>` : ICONS.play;
  const pct = done ? 100 : Math.max(2, Math.min(100, Number(job.percent) || 0));
  const actions = done
    ? `<button class="mini-btn" data-act="reveal" data-id="${job.id}" title="Show in folder">${ICONS.folder}</button>`
    : running
      ? `<button class="mini-btn" data-act="cancel" data-id="${job.id}" title="Cancel">${ICONS.close}</button>`
      : `<button class="mini-btn" data-act="retry" data-id="${job.id}" title="Try again">${ICONS.download}</button>`;

  return `
    <div class="job ${done ? 'is-done' : failed ? 'is-error' : ''}">
      <span class="job-icon">${icon}</span>
      <div class="job-mid">
        <div class="job-title">${escapeHtml(job.title || 'YouTube video')}</div>
        <div class="job-sub">${escapeHtml(`${label} · ${meta}`)}</div>
        <div class="job-bar"><i style="width:${pct}%"></i></div>
      </div>
      <div class="job-act">${actions}</div>
    </div>`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function watchForFinishes(jobs) {
  for (const job of jobs) {
    const previous = lastStatuses.get(job.id);
    if (previous && previous !== job.status) {
      if (job.status === 'done') toast('Saved · ' + (job.qualityLabel || 'download'));
      if (job.status === 'error') toast('Download failed', true);
    }
    lastStatuses.set(job.id, job.status);
  }
}

async function jobAction(action, id) {
  const job = lastJobs.find((item) => item.id === id);
  if (action === 'cancel') await send({ type: 'YAK_CANCEL', id });
  if (action === 'reveal') {
    const result = await send({ type: 'YAK_REVEAL', id });
    if (!result.ok) toast(result.error || 'Could not open folder', true);
  }
  if (action === 'retry' && job?.url) {
    const result = await send({
      type: 'YAK_DOWNLOAD',
      payload: { url: job.url, mode: job.mode, height: job.height, qualityLabel: job.qualityLabel }
    });
    if (result.ok) toast('Retrying…');
    else toast(result.error || 'Could not retry', true);
  }
  await refreshJobs();
}

function startPolling() {
  clearInterval(poller);
  poller = setInterval(async () => {
    const result = await send({ type: 'YAK_JOBS' });
    if (!result.ok) return;
    const jobs = [...(result.active || []), ...(result.recent || [])].slice(0, 8);
    const changed = JSON.stringify(jobs) !== JSON.stringify(lastJobs);
    if (changed) {
      lastJobs = jobs;
      renderJobs(jobs, false);
      watchForFinishes(jobs);
      els.clearHistory.classList.toggle('hidden', !(result.recent || []).length);
    }
  }, 1000);
}

els.openOptions.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

els.startHelper.addEventListener('click', () => {
  toast('Run helper/start-helper.bat, then reopen Yak.');
});

els.clearHistory.addEventListener('click', async () => {
  els.clearHistory.disabled = true;
  const result = await send({ type: 'YAK_CLEAR_HISTORY' });
  els.clearHistory.disabled = false;
  if (result.ok) {
    toast('History cleared');
    await refreshJobs();
  } else {
    toast(result.error || 'Could not clear history', true);
  }
});

init();
