// Minimal `chrome` shim so content.js can run outside the extension, talking to
// the real helper through the same static server. Test-only.
(() => {
  const SETTINGS_KEY = 'yak-harness-settings';
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

  const readSettings = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      return raw ? { ...DEFAULTS, ...raw, extras: { ...DEFAULTS.extras, ...(raw.extras || {}) } } : { ...DEFAULTS };
    } catch {
      return { ...DEFAULTS };
    }
  };

  const writeSettings = (patch) => {
    const next = { ...readSettings(), ...patch, extras: { ...readSettings().extras, ...(patch.extras || {}) } };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    for (const fn of storageListeners) {
      fn({ settings: { newValue: next } }, 'sync');
    }
    return next;
  };

  const storageListeners = [];
  const messageListeners = [];

  const api = async (path, options = {}) => {
    const response = await fetch(`/api${path}`, {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Yak-Client': 'harness' },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, status: response.status, error: data.error || `HTTP ${response.status}` };
    return data;
  };

  async function handle(message, respond) {
    try {
      switch (message?.type) {
        case 'YAK_HEALTH':
          respond(await api(`/health${message.refresh ? '?refresh=1' : ''}`));
          return;
        case 'YAK_FORMATS':
          respond(await api(`/formats?url=${encodeURIComponent(message.url)}`));
          return;
        case 'YAK_DOWNLOAD': {
          const settings = readSettings();
          respond(await api('/jobs', {
            method: 'POST',
            body: {
              ...message.payload,
              folder: message.payload?.folder || settings.folder || undefined,
              template: message.payload?.template || settings.template || undefined
            }
          }));
          return;
        }
        case 'YAK_JOBS':
          respond(await api('/jobs'));
          return;
        case 'YAK_CANCEL':
          respond(await api(`/jobs/${message.id}/cancel`, { method: 'POST', body: {} }));
          return;
        case 'YAK_REVEAL':
          respond({ ok: false, error: 'Reveal is disabled in the harness' });
          return;
        case 'YAK_REVEAL_PATH':
          respond(await api('/reveal', { method: 'POST', body: { path: message.path } }));
          return;
        case 'YAK_PICK_FOLDER':
          respond({ ok: false, error: 'Folder picker needs the real extension' });
          return;
        case 'YAK_GET_SETTINGS':
          respond({ ok: true, settings: readSettings() });
          return;
        case 'YAK_SAVE_SETTINGS':
          respond({ ok: true, settings: writeSettings(message.patch || {}) });
          return;
        case 'YAK_OPEN_OPTIONS':
          respond({ ok: true });
          return;
        case 'YAK_SET_PENDING':
          respond({ ok: true });
          return;
        case 'YAK_CLEAR_HISTORY':
          respond(await api('/clear-history', { method: 'POST', body: {} }));
          return;
        case 'YAK_NOTIFY_TABS':
        case 'YAK_BADGE':
          respond({ ok: true });
          return;
        default:
          respond({ ok: false, error: `harness: unhandled ${message?.type}` });
      }
    } catch (error) {
      respond({ ok: false, offline: true, error: error.message });
    }
  }

  window.chrome = {
    runtime: {
      id: 'harness-extension',
      lastError: null,
      getURL: (path) => `/extension/${path}`,
      sendMessage: (message, callback) => {
        handle(message, (response) => {
          if (typeof callback === 'function') callback(response);
        });
      },
      onMessage: {
        addListener: (fn) => messageListeners.push(fn)
      }
    },
    storage: {
      sync: {
        get: async () => ({ settings: readSettings() }),
        set: async (value) => {
          if (value?.settings) writeSettings(value.settings);
        }
      },
      session: {
        get: async () => ({}),
        set: async () => {},
        remove: async () => {}
      },
      local: {
        get: async () => ({}),
        set: async () => {}
      },
      onChanged: {
        addListener: (fn) => storageListeners.push(fn)
      }
    }
  };

  window.__yakHarness = {
    pushMessage: (message) => {
      for (const fn of messageListeners) fn(message, { id: 'harness' }, () => {});
    },
    setSettings: (patch) => writeSettings(patch)
  };

  const label = document.getElementById('harnessState');
  if (label) label.textContent = `settings: ${readSettings().accent}`;
})();
