(() => {
  'use strict';

  const DEFAULT_SETTINGS = {
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

  const ACCENTS = {
    amber: ['#ffc46b', '#ff7a18', '#ff4d2e'],
    ice: ['#a5f3fc', '#38bdf8', '#2563eb'],
    lime: ['#d9f99d', '#84cc16', '#15803d'],
    rose: ['#fecdd3', '#fb7185', '#e11d48']
  };

  const CARD_SELECTOR = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-playlist-video-renderer',
    'ytd-playlist-panel-video-renderer',
    'ytd-reel-item-renderer',
    'ytd-rich-grid-media',
    'ytd-rich-grid-slim-media',
    'ytd-compact-radio-renderer',
    'yt-lockup-view-model'
  ].join(',');

  const ICONS = {
    logo: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.8 5.6c1.8 1.5 3.8 2.2 7.2 2.2s5.4-.7 7.2-2.2" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/><path d="M12 8.2v6.6" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/><path d="m8.7 11.9 3.3 3.5 3.3-3.5" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.4 18.2h13.2" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3.5v10.2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="m7.8 9.9 4.2 4.3 4.2-4.3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.8 18.7h14.4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3.5 7.6c0-1.1.9-2 2-2h4l1.7 2h7.3c1.1 0 2 .9 2 2v8.2c0 1.1-.9 2-2 2H5.5c-1.1 0-2-.9-2-2V7.6Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5.5 12.5 4.2 4.2 8.8-9.4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 10 5 5 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  const state = {
    settings: { ...DEFAULT_SETTINGS, extras: { ...DEFAULT_SETTINGS.extras } },
    open: false,
    loading: false,
    error: null,
    offline: false,
    health: null,
    video: null,
    data: null,
    tab: 'video',
    height: null,
    audioIndex: 0,
    extras: { ...DEFAULT_SETTINGS.extras },
    folder: '',
    requestId: 0
  };

  let shadow = null;
  let ui = null;
  let modal = null;
  let sheet = null;
  let bodyEl = null;
  let titleEl = null;
  let subEl = null;
  let statusEl = null;
  let thumbEl = null;
  let tabsEl = null;
  let folderPathEl = null;
  let ctaEl = null;
  let dockEl = null;
  let dockCountEl = null;
  let jobsEl = null;
  let fabEl = null;
  let toastsEl = null;
  let previousFocus = null;

  const jobCards = new Map();
  const dismissed = new Set();
  const seen = new Set();
  let jobsData = { active: [], recent: [] };
  let pollTimer = null;
  let polling = false;
  let badgeCount = -1;
  let bootAt = Date.now();
  let scanTimer = null;
  let lastScanAt = 0;
  let extensionAlive = true;

  // ---------------------------------------------------------------- tiny dom kit

  function h(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'style') node.setAttribute('style', value);
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else {
        node.setAttribute(key, value);
      }
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function svgNode(markup) {
    const wrap = document.createElement('span');
    wrap.innerHTML = markup;
    return wrap.firstElementChild;
  }

  function clear(node) {
    if (node) node.replaceChildren();
  }

  function firstLine(text) {
    return String(text || '').split(/\r?\n/).filter(Boolean)[0] || 'Unknown error';
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
      value /= 1024;
      i += 1;
    }
    return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
  }

  function formatSpeed(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    return `${formatBytes(bytes)}/s`;
  }

  function formatEta(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '';
    const total = Math.round(seconds);
    if (total < 60) return `${total}s left`;
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (m < 60) return `${m}m ${String(s).padStart(2, '0')}s left`;
    return `${Math.floor(m / 60)}h ${m % 60}m left`;
  }

  function formatViews(count) {
    if (!Number.isFinite(count) || count <= 0) return '';
    try {
      return `${new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(count)} views`;
    } catch {
      return `${count} views`;
    }
  }

  function prettyPath(value) {
    const text = String(value || '');
    if (text.length <= 52) return text;
    return `${text.slice(0, 22)}…${text.slice(-27)}`;
  }

  function videoIdFromHref(href) {
    try {
      const url = new URL(href, location.origin);
      const host = url.hostname.replace(/^www\./, '');
      if (host === 'youtu.be') {
        const id = url.pathname.split('/').filter(Boolean)[0];
        return /^[\w-]{11}$/.test(id || '') ? id : null;
      }
      if (!host.endsWith('youtube.com')) return null;
      if (url.pathname === '/watch') {
        const id = url.searchParams.get('v') || '';
        return /^[\w-]{11}$/.test(id) ? id : null;
      }
      const match = url.pathname.match(/^\/(shorts|live|embed)\/([\w-]{11})/);
      return match ? match[2] : null;
    } catch {
      return null;
    }
  }

  function currentVideoId() {
    return videoIdFromHref(location.href);
  }

  function sendToBackground(type, payload = {}) {
    return new Promise((resolve) => {
      if (!extensionAlive || !chrome?.runtime?.id) {
        resolve({ ok: false, offline: false, error: 'Extension reloaded. Page refresh karo.' });
        return;
      }
      try {
        chrome.runtime.sendMessage({ type, ...payload }, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response || { ok: false, error: 'No response from Yak background.' });
        });
      } catch (error) {
        resolve({ ok: false, error: error.message });
      }
    });
  }

  // ---------------------------------------------------------------- settings

  async function loadSettings() {
    try {
      const stored = await chrome.storage.sync.get('settings');
      state.settings = {
        ...DEFAULT_SETTINGS,
        ...(stored.settings || {}),
        extras: { ...DEFAULT_SETTINGS.extras, ...(stored.settings?.extras || {}) }
      };
    } catch {
      state.settings = { ...DEFAULT_SETTINGS, extras: { ...DEFAULT_SETTINGS.extras } };
    }
    applyTheme();
  }

  function applyTheme() {
    const accent = ACCENTS[state.settings.accent] || ACCENTS.amber;
    if (shadow) {
      const host = shadow.host;
      host.style.setProperty('--acc-1', accent[0]);
      host.style.setProperty('--acc-2', accent[1]);
      host.style.setProperty('--acc-3', accent[2]);
    }
    const root = document.documentElement;
    root.style.setProperty('--yak-page-acc-1', accent[0]);
    root.style.setProperty('--yak-page-acc-2', accent[1]);
    root.style.setProperty('--yak-page-acc-3', accent[2]);
    if (ui) ui.classList.toggle('yak-reduce-motion', Boolean(state.settings.reduceMotion));
  }

  // ---------------------------------------------------------------- shadow ui

  function buildUi() {
    if (document.getElementById('yak-host')) return;

    const host = document.createElement('div');
    host.id = 'yak-host';
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483000;pointer-events:none;';
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });

    const fontStyle = document.createElement('style');
    try {
      const fontUrl = chrome.runtime.getURL('assets/font/Manrope.woff2');
      fontStyle.textContent = `@font-face{font-family:'Yak Sans';src:url('${fontUrl}') format('woff2');font-weight:200 800;font-style:normal;font-display:swap;}`;
    } catch {
      fontStyle.textContent = '';
    }
    shadow.appendChild(fontStyle);

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    try {
      link.href = chrome.runtime.getURL('content/shadow.css');
    } catch {
      link.href = '';
    }
    shadow.appendChild(link);

    const wrap = h('div', { class: 'yak-ui' });
    wrap.innerHTML = `
      <div class="yak-layer">
        <div class="yak-modal" data-modal aria-hidden="true">
          <div class="yak-scrim" data-close></div>
          <section class="yak-sheet" role="dialog" aria-modal="true" aria-labelledby="yak-sheet-title" tabindex="-1" data-sheet>
            <header class="yak-head">
              <div class="yak-thumbwrap"><img class="yak-thumb" data-thumb alt=""></div>
              <div class="yak-headtext">
                <div class="yak-eyebrow">
                  <span class="yak-mark">${ICONS.logo}</span>
                  <span>Yak Downloader</span>
                  <span class="yak-status" data-status>connecting</span>
                </div>
                <h2 class="yak-title" id="yak-sheet-title" data-title>YouTube video</h2>
                <div class="yak-sub" data-sub>Fetching details…</div>
              </div>
              <button class="yak-icon-btn" type="button" data-close aria-label="Close">&#215;</button>
            </header>
            <div class="yak-tabs" role="tablist" aria-label="Download type" style="--tab:0" data-tabs>
              <span class="yak-glider"></span>
              <button class="yak-tab is-active" type="button" role="tab" aria-selected="true" data-tab="video">Video</button>
              <button class="yak-tab" type="button" role="tab" aria-selected="false" data-tab="audio">Audio</button>
            </div>
            <div class="yak-body" data-body></div>
            <div class="yak-folder">
              <span class="yak-folder-icon">${ICONS.folder}</span>
              <div class="yak-folder-text">
                <div class="yak-folder-label">Save to</div>
                <div class="yak-folder-path" data-folder-path>Default download folder</div>
              </div>
              <button class="yak-folder-change" type="button" data-change-folder>Change</button>
            </div>
            <footer class="yak-foot">
              <span class="yak-hint"><span class="yak-kbd">&#8629;</span> download</span>
              <button class="yak-cta" type="button" data-cta disabled><span>Loading…</span></button>
            </footer>
          </section>
        </div>
        <aside class="yak-dock" data-dock hidden aria-label="Yak downloads">
          <button class="yak-dock-head" type="button" data-dock-head aria-expanded="true">
            <span class="yak-dock-mark">${ICONS.logo}</span>
            <span class="yak-dock-name">Yak</span>
            <span class="yak-dock-count" data-dock-count>0 active</span>
            <span class="yak-dock-spacer"></span>
            <span class="yak-chevron">${ICONS.chevron}</span>
          </button>
          <div class="yak-jobs" data-jobs></div>
        </aside>
        <button class="yak-fab" type="button" data-fab hidden aria-label="Download this short">${ICONS.download}</button>
        <div class="yak-toasts" data-toasts aria-live="polite"></div>
      </div>`;

    shadow.appendChild(wrap);
    ui = wrap;
    modal = shadow.querySelector('[data-modal]');
    sheet = shadow.querySelector('[data-sheet]');
    bodyEl = shadow.querySelector('[data-body]');
    titleEl = shadow.querySelector('[data-title]');
    subEl = shadow.querySelector('[data-sub]');
    statusEl = shadow.querySelector('[data-status]');
    thumbEl = shadow.querySelector('[data-thumb]');
    tabsEl = shadow.querySelector('[data-tabs]');
    folderPathEl = shadow.querySelector('[data-folder-path]');
    ctaEl = shadow.querySelector('[data-cta]');
    dockEl = shadow.querySelector('[data-dock]');
    dockCountEl = shadow.querySelector('[data-dock-count]');
    jobsEl = shadow.querySelector('[data-jobs]');
    fabEl = shadow.querySelector('[data-fab]');
    toastsEl = shadow.querySelector('[data-toasts]');

    applyTheme();
    wireUi();
  }

  function wireUi() {
    shadow.addEventListener('click', onUiClick);
    modal.addEventListener('keydown', onModalKeydown);
    fabEl.addEventListener('click', () => {
      const id = fabEl.dataset.yakId;
      if (!id) return;
      openSheet({
        id,
        url: `https://www.youtube.com/watch?v=${id}`,
        title: 'YouTube Short',
        thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        channel: ''
      });
    });
  }

  function onUiClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target.closest('[data-close]')) {
      closeSheet();
      return;
    }

    const tabBtn = target.closest('[data-tab]');
    if (tabBtn && !target.closest('[data-body]')) {
      switchTab(tabBtn.dataset.tab);
      return;
    }

    const qualityBtn = target.closest('[data-height]');
    if (qualityBtn) {
      state.height = Number(qualityBtn.dataset.height);
      updateSelectionUi();
      renderFooter();
      return;
    }

    const audioBtn = target.closest('[data-audio-index]');
    if (audioBtn) {
      state.audioIndex = Number(audioBtn.dataset.audioIndex);
      updateSelectionUi();
      renderFooter();
      return;
    }

    const chip = target.closest('[data-extra]');
    if (chip) {
      const key = chip.dataset.extra;
      state.extras = { ...state.extras, [key]: !state.extras[key] };
      chip.classList.toggle('is-on', Boolean(state.extras[key]));
      chip.setAttribute('aria-pressed', String(Boolean(state.extras[key])));
      return;
    }

    if (target.closest('[data-change-folder]')) {
      pickFolder();
      return;
    }

    if (target.closest('[data-cta]')) {
      const action = ctaEl.dataset.action;
      if (action === 'retry') loadSheetData(state.requestId);
      else if (action === 'download') startDownload();
      return;
    }

    if (target.closest('[data-retry]')) {
      loadSheetData(state.requestId);
      return;
    }

    if (target.closest('[data-options]')) {
      sendToBackground('YAK_OPEN_OPTIONS');
      return;
    }

    if (target.closest('[data-copy-command]')) {
      copyText('helper\\start-helper.bat', 'Start command copied');
      return;
    }

    if (target.closest('[data-goto-audio]')) {
      switchTab('audio');
      return;
    }

    if (target.closest('[data-dock-head]')) {
      const minimized = dockEl.classList.toggle('is-min');
      shadow.querySelector('[data-dock-head]').setAttribute('aria-expanded', String(!minimized));
      return;
    }

    const cancelBtn = target.closest('[data-cancel]');
    if (cancelBtn) {
      cancelJob(cancelBtn.dataset.cancel);
      return;
    }

    const revealBtn = target.closest('[data-reveal]');
    if (revealBtn) {
      sendToBackground('YAK_REVEAL', { id: revealBtn.dataset.reveal });
      return;
    }

    const dismissBtn = target.closest('[data-dismiss]');
    if (dismissBtn) {
      dismissed.add(dismissBtn.dataset.dismiss);
      renderDock();
    }
  }

  function onModalKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSheet();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusables = [...sheet.querySelectorAll('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => el.getClientRects().length > 0);
    if (!focusables.length) {
      event.preventDefault();
      sheet.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = shadow.activeElement;
    if (event.shiftKey && (active === first || active === sheet)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function copyText(text, successMessage) {
    try {
      await navigator.clipboard.writeText(text);
      toast(successMessage, 'success');
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.cssText = 'position:fixed;opacity:0;';
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); } catch {}
      area.remove();
      toast(successMessage, 'success');
    }
  }

  // ---------------------------------------------------------------- sheet

  function currentVideoInfo() {
    const id = currentVideoId();
    if (!id) return null;
    const titleNode = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, h1 yt-formatted-string, #title h1');
    const channelNode = document.querySelector('#owner #channel-name a, ytd-channel-name a');
    return {
      id,
      url: `https://www.youtube.com/watch?v=${id}`,
      title: (titleNode?.textContent || document.title.replace(/\s*-\s*YouTube$/, '')).trim(),
      thumbnail: document.querySelector('meta[property="og:image"]')?.content
        || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      channel: (channelNode?.textContent || '').trim()
    };
  }

  function openSheet(video) {
    if (!video?.id) return;
    if (!sheet) return;
    state.requestId += 1;
    state.open = true;
    state.video = video;
    state.health = null;
    state.data = null;
    state.error = null;
    state.offline = false;
    state.loading = true;
    state.tab = state.settings.defaultMode === 'audio' ? 'audio' : 'video';
    state.extras = { ...state.settings.extras };
    state.folder = state.settings.folder || '';
    state.height = null;
    state.audioIndex = 0;
    previousFocus = document.activeElement;

    titleEl.textContent = video.title || 'YouTube video';
    subEl.textContent = 'Fetching stream details…';
    thumbEl.removeAttribute('src');
    const initialThumb = video.thumbnail || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;
    thumbEl.onerror = () => {
      thumbEl.onerror = null;
      thumbEl.src = `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;
    };
    thumbEl.src = initialThumb;
    renderAll();

    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(() => {
      if (ctaEl && !ctaEl.disabled) ctaEl.focus({ preventScroll: true });
      else sheet.focus({ preventScroll: true });
    }, 360);

    loadSheetData(state.requestId);
  }

  function closeSheet() {
    if (!state.open) return;
    state.open = false;
    state.requestId += 1;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    if (previousFocus && typeof previousFocus.focus === 'function') {
      try { previousFocus.focus({ preventScroll: true }); } catch {}
    }
  }

  async function loadSheetData(requestId) {
    if (!state.video) return;
    state.loading = true;
    state.error = null;
    state.offline = false;
    renderAll();

    const [health, formats] = await Promise.all([
      sendToBackground('YAK_HEALTH'),
      sendToBackground('YAK_FORMATS', { url: state.video.url })
    ]);
    if (requestId !== state.requestId) return;

    state.health = health || null;
    state.loading = false;
    if (health?.folder) state.folder = health.folder;

    if (!formats?.ok) {
      state.offline = Boolean(formats?.offline);
      state.error = formats?.error || health?.error || 'Streams load nahi hue.';
      renderAll();
      return;
    }

    state.data = formats.data;
    if (formats.data?.thumbnailHQ) {
      thumbEl.src = formats.data.thumbnailHQ;
    }
    if (formats.data?.title) titleEl.textContent = formats.data.title;

    const heights = (formats.data.qualities || []).map((item) => item.height);
    const preferred = Number(state.settings.defaultHeight) || 1080;
    state.height = heights.includes(preferred)
      ? preferred
      : (heights.find((height) => height <= preferred) ?? heights[0] ?? null);

    const audioOptions = formats.data.audioOptions || [];
    let audioIndex = audioOptions.findIndex((item) =>
      item.format === state.settings.audioFormat && Number(item.bitrate) === Number(state.settings.audioBitrate)
    );
    if (audioIndex < 0) audioIndex = 0;
    state.audioIndex = audioIndex;

    renderAll();
  }

  function renderAll() {
    if (!sheet) return;
    renderStatus();
    renderHeader();
    renderTabs();
    renderBody();
    renderFolder();
    renderFooter();
  }

  function renderStatus() {
    if (!statusEl) return;
    statusEl.classList.remove('is-off', 'is-warn');
    if (state.offline) {
      statusEl.classList.add('is-off');
      statusEl.textContent = 'engine offline';
      return;
    }
    if (state.loading && !state.health) {
      statusEl.textContent = 'connecting';
      return;
    }
    if (state.health && state.health.ok === false) {
      statusEl.classList.add('is-warn');
      statusEl.textContent = 'needs setup';
      return;
    }
    statusEl.textContent = 'engine ready';
  }

  function renderHeader() {
    if (!titleEl) return;
    const data = state.data;
    titleEl.textContent = data?.title || state.video?.title || 'YouTube video';
    if (state.offline) {
      subEl.textContent = 'Local engine se connect nahi hua';
      return;
    }
    if (state.loading) {
      subEl.textContent = 'Fetching stream details…';
      return;
    }
    if (state.error) {
      subEl.textContent = 'Details unavailable';
      return;
    }
    if (!data) return;
    const bits = [data.channel, data.durationLabel, formatViews(data.viewCount)].filter(Boolean);
    subEl.textContent = bits.join('  ·  ');
    if (data.thumbnail) {
      thumbEl.onerror = () => {
        thumbEl.onerror = null;
        thumbEl.src = data.thumbnail;
      };
      if (!thumbEl.src) thumbEl.src = data.thumbnail;
    }
  }

  function renderTabs() {
    if (!tabsEl) return;
    tabsEl.style.setProperty('--tab', state.tab === 'audio' ? '1' : '0');
    tabsEl.querySelectorAll('[data-tab]').forEach((btn) => {
      const active = btn.dataset.tab === state.tab;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    });
  }

  function switchTab(tab) {
    if (!tab || tab === state.tab) return;
    state.tab = tab;
    renderTabs();
    renderBody();
    renderFooter();
  }

  function renderBody() {
    if (!bodyEl) return;
    clear(bodyEl);

    if (state.loading) {
      const skeleton = h('div', { class: 'yak-skeleton' });
      for (let i = 0; i < 6; i += 1) skeleton.append(h('div', { class: 'yak-skel' }));
      skeleton.append(h('div', { class: 'yak-skel yak-skel-wide' }));
      bodyEl.append(skeleton);
      return;
    }

    if (state.offline) {
      bodyEl.append(offlineNotice());
      return;
    }

    if (state.error) {
      bodyEl.append(errorNotice(state.error));
      return;
    }

    if (!state.data) {
      bodyEl.append(errorNotice('Formats available nahi hain.'));
      return;
    }

    if (state.tab === 'audio') {
      renderAudioPanel();
    } else {
      renderVideoPanel();
    }
  }

  function renderVideoPanel() {
    const qualities = state.data?.qualities || [];
    if (!qualities.length) {
      bodyEl.append(h('div', { class: 'yak-notice is-info' },
        h('div', { class: 'yak-notice-title' }, h('span', { class: 'yak-notice-dot' }), 'Sirf audio mila'),
        h('p', { text: 'Is video me downloadable video stream nahi hai. Audio tab se download kar sakte ho.' }),
        h('div', { class: 'yak-notice-actions' },
          h('button', { class: 'yak-ghost-btn', type: 'button', 'data-goto-audio': '', text: 'Audio open karo' })
        )
      ));
      return;
    }

    const bestHeight = qualities[0]?.height;
    const grid = h('div', { class: 'yak-grid' });
    qualities.forEach((quality, index) => {
      const active = Number(quality.height) === Number(state.height);
      const card = h('button', {
        class: `yak-q${active ? ' is-active' : ''}`,
        type: 'button',
        'data-height': String(quality.height),
        'aria-pressed': String(active),
        style: `--i:${index}`
      });
      const meta = h('span', { class: 'yak-q-meta' });
      const label = h('span', { class: 'yak-q-label' }, quality.label);
      if (quality.height === bestHeight) {
        label.append(h('span', { class: 'yak-best', text: 'best' }));
      }
      const subBits = [];
      if (quality.fps) subBits.push(`${quality.fps}fps`);
      if (quality.hdr) subBits.push('HDR');
      if (quality.container) subBits.push(String(quality.container).toUpperCase());
      meta.append(label, h('span', { class: 'yak-q-sub', text: subBits.join(' · ') || 'video' }));
      card.append(
        h('span', { class: 'yak-q-tier', text: quality.tier }),
        meta,
        h('span', { class: 'yak-q-size', text: quality.sizeLabel || '' }),
        h('span', { class: 'yak-q-check' })
      );
      grid.append(card);
    });
    bodyEl.append(grid);
    bodyEl.append(extrasRow(true));
  }

  function renderAudioPanel() {
    const options = state.data?.audioOptions || [];
    if (!options.length) {
      bodyEl.append(errorNotice('Audio format available nahi hai.'));
      return;
    }
    const list = h('div', { class: 'yak-audio-list' });
    options.forEach((option, index) => {
      const active = index === state.audioIndex;
      const row = h('button', {
        class: `yak-audio${active ? ' is-active' : ''}`,
        type: 'button',
        'data-audio-index': String(index),
        'aria-pressed': String(active),
        style: `--i:${index}`
      });
      const main = h('span', { class: 'yak-audio-main' });
      main.append(
        h('span', { class: 'yak-audio-title', text: option.format === 'm4a' ? 'M4A · Original' : `${option.label} · ${option.detail}` }),
        h('span', { class: 'yak-audio-sub', text: option.format === 'm4a' ? 'Best available audio' : 'Re-encoded with LAME' })
      );
      row.append(
        h('span', { class: 'yak-radio' }),
        main,
        h('span', { class: 'yak-audio-size', text: option.size ? formatBytes(option.size) : '' }),
        h('span', { class: 'yak-q-check' })
      );
      list.append(row);
    });
    bodyEl.append(list);
    bodyEl.append(extrasRow(false));
  }

  function extrasRow(includeSubtitles) {
    const row = h('div', { class: 'yak-extras' });
    const defs = [
      { key: 'subtitles', label: 'Subtitles', when: includeSubtitles },
      { key: 'thumbnail', label: 'Cover art' },
      { key: 'metadata', label: 'Metadata' }
    ];
    for (const def of defs) {
      if (def.when === false) continue;
      const on = Boolean(state.extras[def.key]);
      const chip = h('button', {
        class: `yak-chip${on ? ' is-on' : ''}`,
        type: 'button',
        'data-extra': def.key,
        'aria-pressed': String(on),
        title: def.key === 'subtitles' ? 'English/Hindi subtitles embed karo' : def.label
      }, h('span', { class: 'yak-chip-dot' }), def.label);
      row.append(chip);
    }
    return row;
  }

  function offlineNotice() {
    return h('div', { class: 'yak-notice' },
      h('div', { class: 'yak-notice-title' }, h('span', { class: 'yak-notice-dot' }), 'Helper offline hai'),
      h('p', { text: 'Yak ka local engine band hai. Project folder me helper\\start-helper.bat chalao, phir Retry dabao.\n\nChrome/Brave/Edge teeno par yahi helper kaam karta hai.' }),
      h('div', { class: 'yak-notice-actions' },
        h('button', { class: 'yak-ghost-btn', type: 'button', 'data-retry': '', text: 'Retry' }),
        h('button', { class: 'yak-ghost-btn', type: 'button', 'data-copy-command': '', text: 'Copy command' }),
        h('button', { class: 'yak-ghost-btn', type: 'button', 'data-options': '', text: 'Setup' })
      )
    );
  }

  function errorNotice(message) {
    return h('div', { class: 'yak-notice' },
      h('div', { class: 'yak-notice-title' }, h('span', { class: 'yak-notice-dot' }), 'Streams load nahi hue'),
      h('p', { text: String(message || 'Unknown error') }),
      h('div', { class: 'yak-notice-actions' },
        h('button', { class: 'yak-ghost-btn', type: 'button', 'data-retry': '', text: 'Try again' }),
        h('button', { class: 'yak-ghost-btn', type: 'button', 'data-options': '', text: 'Settings' })
      )
    );
  }

  function renderFolder() {
    if (!folderPathEl) return;
    const folder = state.folder || state.settings.folder || (state.health?.folder) || '';
    folderPathEl.textContent = folder ? prettyPath(folder) : 'Default download folder';
    folderPathEl.title = folder;
  }

  function selectedQuality() {
    return (state.data?.qualities || []).find((item) => Number(item.height) === Number(state.height)) || null;
  }

  function selectedAudio() {
    return (state.data?.audioOptions || [])[state.audioIndex] || null;
  }

  function renderFooter() {
    if (!ctaEl) return;
    ctaEl.replaceChildren();
    const setContent = (label, icon, spinner) => {
      if (spinner) ctaEl.append(h('span', { class: 'yak-cta-spinner' }));
      else if (icon) ctaEl.append(svgNode(icon));
      ctaEl.append(h('span', { text: label }));
    };

    if (state.loading) {
      ctaEl.disabled = true;
      ctaEl.dataset.action = '';
      setContent('Loading formats…', null, true);
      return;
    }

    if (state.offline) {
      ctaEl.disabled = false;
      ctaEl.dataset.action = 'retry';
      setContent('Helper start karke retry', null, false);
      return;
    }

    if (state.error) {
      ctaEl.disabled = false;
      ctaEl.dataset.action = 'retry';
      setContent('Try again', null, false);
      return;
    }

    if (!state.data) {
      ctaEl.disabled = true;
      ctaEl.dataset.action = '';
      setContent('Unavailable', null, false);
      return;
    }

    ctaEl.disabled = false;
    ctaEl.dataset.action = 'download';

    if (state.tab === 'audio') {
      const audio = selectedAudio();
      if (!audio) {
        ctaEl.disabled = true;
        ctaEl.dataset.action = '';
        setContent('No audio stream', null, false);
        return;
      }
      setContent(
        `Download · ${audio.format === 'm4a' ? 'M4A' : `${audio.label} ${audio.bitrate}`}`,
        ICONS.download,
        false
      );
      return;
    }

    const quality = selectedQuality();
    if (!quality) {
      ctaEl.disabled = true;
      ctaEl.dataset.action = '';
      setContent('No video stream', null, false);
      return;
    }
    const size = quality.sizeLabel ? ` · ${quality.sizeLabel}` : '';
    setContent(`Download · ${quality.label}${size}`, ICONS.download, false);
  }

  function updateSelectionUi() {
    if (!bodyEl) return;
    bodyEl.querySelectorAll('.yak-q').forEach((btn) => {
      const active = Number(btn.dataset.height) === Number(state.height);
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    bodyEl.querySelectorAll('.yak-audio').forEach((btn) => {
      const active = Number(btn.dataset.audioIndex) === state.audioIndex;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  async function pickFolder() {
    const button = shadow.querySelector('[data-change-folder]');
    if (!button) return;
    if (button.dataset.busy === '1') return;
    if (state.offline) {
      toast('Pehle helper start karo', 'error');
      return;
    }
    button.dataset.busy = '1';
    const original = button.textContent;
    button.textContent = 'Choosing…';
    const result = await sendToBackground('YAK_PICK_FOLDER');
    button.dataset.busy = '';
    button.textContent = original;
    if (result?.ok && result.folder) {
      state.folder = result.folder;
      state.settings.folder = result.folder;
      renderFolder();
      toast('Download folder set ho gaya', 'success', prettyPath(result.folder));
    } else if (result?.error && !/cancel/i.test(result.error)) {
      toast('Folder select nahi hua', 'error', firstLine(result.error));
    }
  }

  async function startDownload() {
    if (ctaEl.disabled) return;
    const video = state.video;
    const data = state.data;
    if (!video?.url || !data) return;

    const payload = {
      url: video.url,
      mode: state.tab,
      title: data.title,
      thumbnail: data.thumbnail,
      channel: data.channel,
      container: state.settings.container,
      extras: { ...state.extras },
      folder: state.folder || undefined,
      template: state.settings.template || undefined
    };

    let label = '';
    if (state.tab === 'audio') {
      const audio = selectedAudio();
      if (!audio) return;
      payload.audioFormat = audio.format;
      payload.audioBitrate = audio.bitrate || 320;
      label = audio.format === 'm4a' ? 'M4A' : `MP3 ${audio.bitrate}`;
    } else {
      const quality = selectedQuality();
      if (!quality) return;
      payload.height = quality.height;
      label = quality.label;
    }

    ctaEl.disabled = true;
    ctaEl.replaceChildren(h('span', { class: 'yak-cta-spinner' }), h('span', { text: 'Starting…' }));

    const result = await sendToBackground('YAK_DOWNLOAD', payload);
    if (!result?.ok) {
      renderFooter();
      if (result?.offline) {
        state.offline = true;
        state.error = result.error;
        renderAll();
      }
      toast('Download start nahi hua', 'error', firstLine(result?.error));
      return;
    }

    const qualityText = state.tab === 'audio'
      ? label
      : (selectedQuality()?.sizeLabel ? `${label} · ${selectedQuality().sizeLabel}` : label);
    closeSheet();
    toast('Download shuru ho gaya', 'success', qualityText);
    pollNow();
  }

  // ---------------------------------------------------------------- dock / polling

  async function pollNow() {
    if (polling) return;
    polling = true;
    const result = await sendToBackground('YAK_JOBS');
    polling = false;
    clearTimeout(pollTimer);
    if (!result?.ok) {
      if (dockEl && !dockEl.hidden) pollTimer = setTimeout(pollNow, 5000);
      return;
    }
    jobsData = { active: result.active || [], recent: result.recent || [] };
    handleJobUpdates([...jobsData.active, ...jobsData.recent]);
    renderDock();
    const count = jobsData.active.length;
    if (count !== badgeCount) {
      badgeCount = count;
      sendToBackground('YAK_BADGE', { count });
    }
    if (count > 0) pollTimer = setTimeout(pollNow, 900);
    else if (hasFreshRecent()) pollTimer = setTimeout(pollNow, 5000);
  }

  function hasFreshRecent() {
    const now = Date.now();
    return (jobsData.recent || []).some((job) => {
      if (dismissed.has(job.id)) return false;
      if (!['done', 'error'].includes(job.status)) return false;
      const finished = job.finishedAt ? Date.parse(job.finishedAt) : 0;
      return finished && now - finished < 180_000;
    });
  }

  function handleJobUpdates(list) {
    const now = Date.now();
    for (const job of list) {
      if (!['done', 'error'].includes(job.status)) continue;
      if (seen.has(job.id)) continue;
      seen.add(job.id);
      const finished = job.finishedAt ? Date.parse(job.finishedAt) : 0;
      if (finished && finished < bootAt - 4000) continue;
      sendToBackground('YAK_NOTIFY_JOB', { job });
      if (job.status === 'done') {
        toast('Download complete', 'success', `${job.title || 'Video'} · ${job.qualityLabel || ''}`);
      } else if (job.status === 'error') {
        toast('Download failed', 'error', firstLine(job.error));
      }
      if (job.status === 'done' && state.settings.autoReveal) {
        sendToBackground('YAK_REVEAL', { id: job.id });
      }
      if (finished && now - finished < 1000) pollTimer = setTimeout(pollNow, 300);
    }
  }

  function renderDock() {
    if (!dockEl) return;
    const active = jobsData.active || [];
    const recent = jobsData.recent || [];
    const done = recent.filter((job) =>
      job.status === 'done'
      && !dismissed.has(job.id)
      && job.finishedAt
      && Date.now() - Date.parse(job.finishedAt) < 180_000
    ).slice(0, 1);
    const errors = recent.filter((job) =>
      ['error', 'cancelled'].includes(job.status)
      && !dismissed.has(job.id)
      && job.finishedAt
      && Date.now() - Date.parse(job.finishedAt) < 180_000
    ).slice(0, 1);

    const visible = [...active, ...errors, ...done];
    if (!visible.length) {
      dockEl.hidden = true;
      clear(jobsEl);
      jobCards.clear();
      return;
    }

    dockEl.hidden = false;
    dockCountEl.textContent = active.length
      ? `${active.length} active`
      : (done.length ? 'saved' : 'error');

    const ids = new Set(visible.map((job) => job.id));
    for (const [id, entry] of jobCards) {
      if (!ids.has(id)) {
        entry.el.remove();
        jobCards.delete(id);
      }
    }

    for (const job of visible) {
      let entry = jobCards.get(job.id);
      if (!entry) {
        entry = createJobCard(job);
        jobCards.set(job.id, entry);
        jobsEl.append(entry.el);
      }
      updateJobCard(entry, job);
    }
  }

  function createJobCard(job) {
    const el = h('article', { class: 'yak-job', 'data-job': job.id, 'data-status': job.status });
    const thumb = h('img', { class: 'yak-job-thumb', alt: '', loading: 'lazy' });
    const title = h('div', { class: 'yak-job-title' });
    const meta = h('div', { class: 'yak-job-meta' });
    const main = h('div', { class: 'yak-job-main' }, title, meta);
    const actions = h('div', { class: 'yak-job-actions' });
    const fill = h('i', { class: 'yak-bar-fill' });
    const bar = h('div', { class: 'yak-bar' }, fill);
    el.append(thumb, main, actions, bar);
    return { el, thumb, title, meta, actions, fill, status: null, thumbSrc: '' };
  }

  function updateJobCard(entry, job) {
    const { el } = entry;
    el.dataset.status = job.status;

    const thumbSrc = job.thumbnail || '';
    if (thumbSrc && entry.thumbSrc !== thumbSrc) {
      entry.thumbSrc = thumbSrc;
      entry.thumb.src = thumbSrc;
      entry.thumb.onerror = () => { entry.thumb.style.visibility = 'hidden'; };
    }

    entry.title.textContent = job.title || 'Fetching title…';
    entry.title.title = job.title || '';

    const metaBits = [];
    if (job.qualityLabel) metaBits.push(job.qualityLabel);
    if (job.status === 'queued') metaBits.push('queue me…');
    else if (job.status === 'starting') metaBits.push('starting…');
    else if (job.status === 'downloading') {
      if (Number.isFinite(job.percent)) metaBits.push(`${Math.floor(job.percent)}%`);
      const speed = formatSpeed(job.speed);
      if (speed) metaBits.push(speed);
      const eta = formatEta(job.eta);
      if (eta) metaBits.push(eta);
      if (Number(job.phase) > 1) metaBits.push(`stream ${job.phase}`);
    } else if (job.status === 'processing') metaBits.push('finalizing…');
    else if (job.status === 'done') metaBits.push('saved');
    else if (job.status === 'error') metaBits.push(firstLine(job.error).slice(0, 60));
    else if (job.status === 'cancelled') metaBits.push('cancelled');
    entry.meta.textContent = metaBits.filter(Boolean).join(' · ');

    const percent = job.status === 'done'
      ? 100
      : (Number.isFinite(job.percent) ? Math.max(0, Math.min(100, job.percent)) : 0);
    entry.fill.style.width = `${percent}%`;

    if (entry.status !== job.status) {
      entry.status = job.status;
      clear(entry.actions);
      if (['queued', 'starting', 'downloading', 'processing'].includes(job.status)) {
        entry.actions.append(h('button', {
          class: 'yak-mini', type: 'button', 'data-cancel': job.id, title: 'Cancel', 'aria-label': 'Cancel download', text: '\u00d7'
        }));
      } else {
        if (job.status === 'done' && job.filePath) {
          const reveal = h('button', {
            class: 'yak-mini', type: 'button', 'data-reveal': job.id, title: 'Show in folder', 'aria-label': 'Show in folder'
          }, svgNode(ICONS.folder));
          entry.actions.append(reveal);
        }
        entry.actions.append(h('button', {
          class: 'yak-mini', type: 'button', 'data-dismiss': job.id, title: 'Dismiss', 'aria-label': 'Dismiss', text: '\u00d7'
        }));
      }
    }
  }

  async function cancelJob(id) {
    const result = await sendToBackground('YAK_CANCEL', { id });
    if (!result?.ok) toast('Cancel nahi hua', 'error', firstLine(result?.error));
    else toast('Cancel request bheji', 'info');
    setTimeout(pollNow, 500);
  }

  function toast(title, tone = 'info', detail = '') {
    if (!toastsEl) return;
    const node = h('div', { class: `yak-toast is-${tone}`, role: 'status' },
      h('span', { class: 'yak-toast-dot' }),
      h('div', { class: 'yak-toast-text' },
        h('div', { class: 'yak-toast-title', text: title }),
        detail ? h('div', { class: 'yak-toast-detail', text: detail }) : null
      )
    );
    toastsEl.prepend(node);
    while (toastsEl.children.length > 3) toastsEl.lastElementChild.remove();
    setTimeout(() => {
      node.classList.add('is-leaving');
      setTimeout(() => node.remove(), 320);
    }, 4200);
  }

  // ---------------------------------------------------------------- injection

  function findThumbAnchor(card) {
    const selectors = [
      'a#thumbnail',
      'a.yt-lockup-view-model__content-image',
      'a.ytd-thumbnail',
      'a[href*="/watch?v="]',
      'a[href*="/shorts/"]'
    ];
    for (const selector of selectors) {
      const anchors = card.querySelectorAll(selector);
      for (const anchor of anchors) {
        if (anchor.querySelector('img')) return anchor;
      }
    }
    return null;
  }

  function cardTitle(card, anchor) {
    const node = card.querySelector(
      '#video-title, #video-title-link, .yt-lockup-metadata-view-model__title, h3 a, h3, yt-formatted-string#video-title'
    );
    const text = (node?.getAttribute('title') || node?.textContent || '').trim();
    if (text) return text.replace(/\s+/g, ' ');
    const alt = anchor?.querySelector('img')?.alt || '';
    return alt.trim() || 'YouTube video';
  }

  function cardChannel(card) {
    const node = card.querySelector(
      '#channel-name a, ytd-channel-name a, .yt-content-metadata-view-model__metadata-row a, #text.ytd-channel-name'
    );
    return (node?.textContent || '').trim().replace(/^@/, '');
  }

  function processCard(card) {
    if (card.hasAttribute('data-yak-card')) return false;
    if (card.matches('ytd-ad-slot-renderer') || card.querySelector('ytd-ad-slot-renderer, .badge-style-type-ad, #ad-badge')) return false;

    const anchor = findThumbAnchor(card);
    if (!anchor) return false;
    const id = videoIdFromHref(anchor.getAttribute('href') || anchor.href || '');
    if (!id) return false;

    if (anchor.querySelector(':scope > .yak-thumb-btn')) {
      card.setAttribute('data-yak-card', '1');
      return false;
    }

    card.setAttribute('data-yak-card', '1');

    const video = {
      id,
      url: `https://www.youtube.com/watch?v=${id}`,
      title: cardTitle(card, anchor),
      channel: cardChannel(card),
      thumbnail: anchor.querySelector('img')?.currentSrc
        || anchor.querySelector('img')?.src
        || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
    };

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'yak-thumb-btn';
    button.dataset.yakId = id;
    button.setAttribute('aria-label', `Download ${video.title} with Yak`);
    button.title = 'Download with Yak  ·  Shift+click for quick download';
    button.innerHTML = ICONS.download;

    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) {
        quickDownload(video, button);
      } else {
        openSheet(video);
      }
    });

    if (getComputedStyle(anchor).position === 'static') {
      anchor.style.position = 'relative';
    }
    anchor.appendChild(button);
    return true;
  }

  function scanNow(limit = 320) {
    if (!state.settings.showThumbButtons) return;
    const now = Date.now();
    if (now - lastScanAt < 900) {
      scheduleScan(950 - (now - lastScanAt));
      return;
    }
    lastScanAt = now;
    const cards = document.querySelectorAll(CARD_SELECTOR);
    let count = 0;
    for (const card of cards) {
      if (count >= limit) {
        scheduleScan(700);
        break;
      }
      if (card.hasAttribute('data-yak-card')) continue;
      count += 1;
      processCard(card);
    }
    injectWatchButton();
    updateShortsFab();
  }

  function scheduleScan(delay = 420) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => scanNow(), delay);
  }

  function injectWatchButton() {
    if (!state.settings.showThumbButtons) return;
    if (!location.pathname.startsWith('/watch')) return;
    const id = currentVideoId();
    if (!id) return;

    const containers = [
      ...document.querySelectorAll('#top-level-buttons-computed, ytd-watch-metadata #actions #top-level-buttons-computed, #above-the-fold #actions-inner, #actions-inner')
    ];
    const container = containers.find((el) => el && el.getClientRects().length > 0);
    if (!container) return;

    const existing = containers.map((el) => el.querySelector('#yak-watch-btn')).find(Boolean);
    if (existing) {
      existing.dataset.yakId = id;
      return;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'yak-watch-btn';
    button.className = 'yak-watch-btn';
    button.dataset.yakId = id;
    button.innerHTML = `${ICONS.download}<span>Download</span>`;
    button.title = 'Download with Yak';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const info = currentVideoInfo();
      if (info) openSheet(info);
    });
    container.prepend(button);
  }

  function updateShortsFab() {
    if (!fabEl) return;
    if (!state.settings.showThumbButtons || !location.pathname.startsWith('/shorts')) {
      fabEl.hidden = true;
      return;
    }
    let id = location.pathname.match(/^\/shorts\/([\w-]{11})/)?.[1] || '';
    if (!id) {
      const activeAnchor = document.querySelector('ytd-reel-video-renderer[is-active] a[href*="/shorts/"], ytd-shorts a[href*="/shorts/"]');
      if (activeAnchor) id = videoIdFromHref(activeAnchor.getAttribute('href') || '') || '';
    }
    fabEl.hidden = !id;
    if (id) fabEl.dataset.yakId = id;
  }

  async function quickDownload(video, button) {
    if (button?.classList.contains('is-busy')) return;
    button?.classList.add('is-busy');
    const mode = state.settings.defaultMode === 'audio' ? 'audio' : 'video';
    const payload = {
      url: video.url,
      mode,
      title: video.title,
      thumbnail: video.thumbnail,
      channel: video.channel,
      container: state.settings.container,
      extras: { ...state.settings.extras },
      height: mode === 'video' ? state.settings.defaultHeight : undefined,
      audioFormat: state.settings.audioFormat,
      audioBitrate: state.settings.audioBitrate
    };
    const result = await sendToBackground('YAK_DOWNLOAD', payload);
    button?.classList.remove('is-busy');
    if (!result?.ok) {
      toast('Quick download fail hua', 'error', firstLine(result?.error));
      return;
    }
    button?.classList.add('is-done');
    setTimeout(() => button?.classList.remove('is-done'), 1800);
    toast('Download shuru', 'success', `${video.title.slice(0, 60)} · default quality`);
    pollNow();
  }

  function removeInjectedButtons() {
    document.querySelectorAll('.yak-thumb-btn, #yak-watch-btn').forEach((node) => node.remove());
    document.querySelectorAll('[data-yak-card]').forEach((node) => node.removeAttribute('data-yak-card'));
    if (fabEl) fabEl.hidden = true;
  }

  function handleSettingsChange() {
    applyTheme();
    if (!state.settings.showThumbButtons) {
      removeInjectedButtons();
    } else {
      scheduleScan(120);
    }
    updateShortsFab();
  }

  // ---------------------------------------------------------------- boot

  async function init() {
    await loadSettings();
    buildUi();
    bootAt = Date.now();

    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync' || !changes.settings?.newValue) return;
        state.settings = {
          ...DEFAULT_SETTINGS,
          ...changes.settings.newValue,
          extras: { ...DEFAULT_SETTINGS.extras, ...(changes.settings.newValue.extras || {}) }
        };
        handleSettingsChange();
      });
    } catch {}

    chrome.runtime.onMessage.addListener((message) => {
      if (!message) return;
      if (message.type === 'YAK_JOBS_CHANGED') pollNow();
      if (message.type === 'YAK_OPEN_SHEET' && message.url) {
        const id = videoIdFromHref(message.url);
        if (!id) return;
        openSheet({
          id,
          url: `https://www.youtube.com/watch?v=${id}`,
          title: 'YouTube video',
          thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
          channel: ''
        });
      }
    });

    document.addEventListener('yt-navigate-finish', () => {
      closeSheet();
      scheduleScan(180);
      updateShortsFab();
      pollNow();
    });
    window.addEventListener('popstate', () => scheduleScan(250));

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length) {
          scheduleScan();
          break;
        }
      }
    });
    try {
      observer.observe(document.documentElement, { childList: true, subtree: true });
    } catch {}

    setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (state.settings.showThumbButtons) {
        injectWatchButton();
        updateShortsFab();
        scanNow(120);
      }
    }, 6000);

    scanNow();
    setTimeout(() => scanNow(400), 1200);
    pollNow();

    const pending = await sendToBackground('YAK_TAKE_PENDING');
    if (pending?.pending?.url) {
      const id = videoIdFromHref(pending.pending.url);
      if (id) {
        setTimeout(() => openSheet({
          id,
          url: `https://www.youtube.com/watch?v=${id}`,
          title: 'YouTube video',
          thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
          channel: ''
        }), 700);
      }
    }
  }

  try {
    init().catch((error) => {
      console.warn('[Yak] init failed:', error);
    });
  } catch (error) {
    console.warn('[Yak] crashed:', error);
  }
})();
