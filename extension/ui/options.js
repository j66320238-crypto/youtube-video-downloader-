const $ = (id) => document.getElementById(id);

const ACCENTS = {
  amber: ['#ffc46b', '#ff7a18', '#ff4d2e'],
  ice: ['#a5e9ff', '#38bdf8', '#4f6bff'],
  lime: ['#d8ff9a', '#7ee65c', '#12b981'],
  rose: ['#ffc0d9', '#ff5f9e', '#c026d3']
};

const DEFAULTS = {
  defaultHeight: 1080,
  defaultMode: 'video',
  container: 'mp4',
  audioFormat: 'mp3',
  audioBitrate: 320,
  folder: '',
  template: '',
  concurrency: 2,
  extras: { subtitles: false, thumbnail: true, metadata: true },
  notify: true,
  autoReveal: false,
  accent: 'amber',
  reduceMotion: false,
  showThumbButtons: true
};

const DEFAULT_TEMPLATE = '%(title)s [%(id)s].%(ext)s';
const SAMPLE = {
  '%(title)s': 'Deep Work — Full Lecture',
  '%(id)s': 'dQw4w9WgXcQ',
  '%(channel)s': 'Study Hall',
  '%(uploader)s': 'Study Hall',
  '%(upload_date)s': '20261024',
  '%(resolution)s': '1080p',
  '%(height)s': '1080',
  '%(width)s': '1920',
  '%(fps)s': '30',
  '%(duration)s': '1842',
  '%(ext)s': 'mp4'
};

let settings = { ...DEFAULTS };
let saveTimer = null;

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
  $('toastText').textContent = text;
  $('toast').classList.toggle('is-error', isError);
  $('toast').classList.add('is-visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $('toast').classList.remove('is-visible'), 2400);
}

function applyAccent(name) {
  const tones = ACCENTS[name] || ACCENTS.amber;
  document.documentElement.style.setProperty('--acc-1', tones[0]);
  document.documentElement.style.setProperty('--acc-2', tones[1]);
  document.documentElement.style.setProperty('--acc-3', tones[2]);
}

function prettyFolder(path) {
  if (!path) return '~/Downloads/Yak';
  if (path.length <= 46) return path;
  return `${path.slice(0, 18)}…${path.slice(-24)}`;
}

/* ---------- form binding ---------- */

function fillForm() {
  $('defaultHeight').value = String(settings.defaultHeight ?? 1080);
  $('audioBitrate').value = String(settings.audioBitrate ?? 320);
  $('concurrency').value = String(settings.concurrency ?? 2);
  $('concurrencyOut').textContent = String(settings.concurrency ?? 2);
  $('template').value = settings.template || '';
  $('template').placeholder = DEFAULT_TEMPLATE;

  $('extSubtitles').checked = Boolean(settings.extras?.subtitles);
  $('extThumbnail').checked = Boolean(settings.extras?.thumbnail);
  $('extMetadata').checked = Boolean(settings.extras?.metadata);
  $('notify').checked = Boolean(settings.notify);
  $('autoReveal').checked = Boolean(settings.autoReveal);
  $('showThumbButtons').checked = Boolean(settings.showThumbButtons);
  $('reduceMotion').checked = Boolean(settings.reduceMotion);

  setSeg('containerSeg', settings.container || 'mp4');
  setSeg('audioSeg', settings.audioFormat || 'mp3');
  setSwatch(settings.accent || 'amber');
  $('folderLabel').textContent = prettyFolder(settings.folder);
  $('folderLabel').title = settings.folder || 'Default: Downloads/Yak';
  updatePreview();
}

function setSeg(id, value) {
  document.querySelectorAll(`#${id} button`).forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.value === value);
  });
}

function setSwatch(value) {
  document.querySelectorAll('#accents .swatch').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.value === value);
  });
}

function updatePreview() {
  const raw = $('template').value.trim() || DEFAULT_TEMPLATE;
  let preview = raw;
  for (const [token, sample] of Object.entries(SAMPLE)) {
    preview = preview.split(token).join(sample);
  }
  preview = preview.replace(/%\([a-zA-Z0-9_]+\)s/g, '');
  preview = preview.replace(/\s+/g, ' ').trim();
  if (!preview.includes('.')) preview += '.mp4';
  $('templatePreview').textContent = preview.slice(0, 90);
}

/* ---------- saving ---------- */

function scheduleSave(patch, syncHelper = false) {
  settings = {
    ...settings,
    ...patch,
    extras: { ...settings.extras, ...(patch.extras || {}) }
  };
  const state = $('saveState');
  state.textContent = 'Saving…';
  state.classList.add('is-saving');

  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const result = await send({ type: 'YAK_SAVE_SETTINGS', patch });
    if (syncHelper) await send({ type: 'YAK_SYNC_HELPER_SETTINGS' });
    if (result.ok) {
      state.textContent = 'Saved';
      state.classList.remove('is-saving');
      clearTimeout(scheduleSave.reset);
      scheduleSave.reset = setTimeout(() => {
        state.textContent = 'All changes save automatically';
      }, 1800);
    } else {
      state.textContent = 'Could not save';
      state.classList.remove('is-saving');
      toast(result.error || 'Could not save settings', true);
    }
  }, 350);
}

/* ---------- engine ---------- */

async function checkHealth() {
  const health = await send({ type: 'YAK_HEALTH', refresh: true });
  const engine = $('engine');
  const running = health.ok || health.app === 'yak-helper';
  if (running) {
    const ffmpegVersion = /ffmpeg version (\S+)/i.exec(health.ffmpeg?.version || '')?.[1] || null;
    engine.className = health.ok ? 'engine-pill is-on' : 'engine-pill is-warn';
    engine.textContent = health.ok ? 'Engine ready' : 'Missing binaries';
    $('engineText').textContent = health.version ? `v${health.version}` : 'Running';
    $('engineText').className = `stat-value ${health.ok ? 'is-ok' : 'is-bad'}`;
    $('ytdlpText').textContent = health.ytdlp?.available ? (health.ytdlp.version || 'ready') : 'missing';
    $('ytdlpText').className = `stat-value ${health.ytdlp?.available ? 'is-ok' : 'is-bad'}`;
    $('ffmpegText').textContent = health.ffmpeg?.available ? (ffmpegVersion || 'ready') : 'missing';
    $('ffmpegText').className = `stat-value ${health.ffmpeg?.available ? 'is-ok' : 'is-bad'}`;
    $('nodeText').textContent = health.node || '—';
    $('offlineHint').classList.add('hidden');
    if (health.folder) {
      $('folderLabel').textContent = prettyFolder(health.folder);
      $('folderLabel').title = health.folder;
    }
    const historyCount = health.downloads?.completed ?? 0;
    $('historyText').textContent = historyCount
      ? `${historyCount} finished download${historyCount === 1 ? '' : 's'}`
      : 'No finished downloads yet';
  } else {
    engine.className = 'engine-pill is-off';
    engine.textContent = 'Offline';
    $('engineText').textContent = 'Not running';
    $('engineText').className = 'stat-value is-bad';
    $('ytdlpText').textContent = '—';
    $('ytdlpText').className = 'stat-value';
    $('ffmpegText').textContent = '—';
    $('ffmpegText').className = 'stat-value';
    $('nodeText').textContent = '—';
    $('offlineHint').classList.remove('hidden');
    $('historyText').textContent = 'Helper offline — history unavailable';
  }
}

/* ---------- events ---------- */

function bind() {
  $('defaultHeight').addEventListener('change', (event) => {
    scheduleSave({ defaultHeight: Number(event.target.value) });
  });

  $('containerSeg').addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-value]');
    if (!btn) return;
    setSeg('containerSeg', btn.dataset.value);
    scheduleSave({ container: btn.dataset.value });
  });

  $('audioSeg').addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-value]');
    if (!btn) return;
    setSeg('audioSeg', btn.dataset.value);
    scheduleSave({ audioFormat: btn.dataset.value });
  });

  $('audioBitrate').addEventListener('change', (event) => {
    scheduleSave({ audioBitrate: Number(event.target.value) });
  });

  $('concurrency').addEventListener('input', (event) => {
    $('concurrencyOut').textContent = event.target.value;
  });
  $('concurrency').addEventListener('change', (event) => {
    scheduleSave({ concurrency: Number(event.target.value) }, true);
  });

  $('template').addEventListener('input', () => {
    updatePreview();
    scheduleSave({ template: $('template').value.trim() }, true);
  });

  document.querySelectorAll('.token').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = $('template');
      const token = btn.dataset.token;
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      input.value = input.value.slice(0, start) + token + input.value.slice(end);
      input.focus();
      input.setSelectionRange(start + token.length, start + token.length);
      updatePreview();
      scheduleSave({ template: input.value.trim() }, true);
    });
  });

  const toggles = [
    ['extSubtitles', (value) => ({ extras: { subtitles: value } })],
    ['extThumbnail', (value) => ({ extras: { thumbnail: value } })],
    ['extMetadata', (value) => ({ extras: { metadata: value } })],
    ['notify', (value) => ({ notify: value })],
    ['autoReveal', (value) => ({ autoReveal: value })],
    ['showThumbButtons', (value) => ({ showThumbButtons: value })],
    ['reduceMotion', (value) => ({ reduceMotion: value })]
  ];

  for (const [id, build] of toggles) {
    $(id).addEventListener('change', (event) => {
      scheduleSave(build(event.target.checked));
    });
  }

  $('accents').addEventListener('click', (event) => {
    const btn = event.target.closest('.swatch');
    if (!btn) return;
    applyAccent(btn.dataset.value);
    setSwatch(btn.dataset.value);
    scheduleSave({ accent: btn.dataset.value });
  });

  $('pickFolder').addEventListener('click', async () => {
    const button = $('pickFolder');
    button.disabled = true;
    button.textContent = 'Choose in popup…';
    const result = await send({ type: 'YAK_PICK_FOLDER' });
    button.disabled = false;
    button.textContent = 'Choose folder';
    if (result.ok && result.folder) {
      settings.folder = result.folder;
      $('folderLabel').textContent = prettyFolder(result.folder);
      $('folderLabel').title = result.folder;
      toast('Folder updated');
    } else if (result.error && !result.cancelled) {
      toast(result.error, true);
    }
  });

  $('revealFolder').addEventListener('click', async () => {
    const result = await send({ type: 'YAK_REVEAL_PATH', path: settings.folder || '' });
    if (!result.ok) toast(result.error || 'Helper offline', true);
  });

  $('recheck').addEventListener('click', async () => {
    $('recheck').disabled = true;
    await checkHealth();
    $('recheck').disabled = false;
    toast('Engine re-checked');
  });

  $('copyStart').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText('start-helper.bat');
      toast('Copied — run it from the helper folder');
    } catch {
      toast('Open the helper folder and run start-helper.bat');
    }
  });

  $('clearHistory').addEventListener('click', async () => {
    const result = await send({ type: 'YAK_CLEAR_HISTORY' });
    if (result.ok) {
      toast('History cleared');
      await checkHealth();
    } else {
      toast(result.error || 'Could not clear history', true);
    }
  });

  $('resetSettings').addEventListener('click', async () => {
    const result = await send({ type: 'YAK_SAVE_SETTINGS', patch: DEFAULTS });
    if (!result.ok) {
      toast(result.error || 'Could not reset', true);
      return;
    }
    settings = { ...DEFAULTS, extras: { ...DEFAULTS.extras } };
    applyAccent(settings.accent);
    fillForm();
    await send({ type: 'YAK_SYNC_HELPER_SETTINGS' });
    toast('Settings reset');
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.activeElement) document.activeElement.blur();
  });
}

async function init() {
  const saved = await send({ type: 'YAK_GET_SETTINGS' });
  if (saved.ok && saved.settings) {
    settings = {
      ...DEFAULTS,
      ...saved.settings,
      extras: { ...DEFAULTS.extras, ...(saved.settings.extras || {}) }
    };
  }
  applyAccent(settings.accent);
  fillForm();
  bind();
  await checkHealth();
}

init();
