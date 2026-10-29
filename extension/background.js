const HELPER = 'http://127.0.0.1:8787';
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

chrome.runtime.onInstalled.addListener(() => {
  ensureSettings();
  buildMenus();
});

chrome.runtime.onStartup.addListener(() => {
  buildMenus();
});

async function ensureSettings() {
  const stored = await chrome.storage.sync.get('settings');
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(stored.settings || {}),
    extras: { ...DEFAULT_SETTINGS.extras, ...(stored.settings?.extras || {}) }
  };
  await chrome.storage.sync.set({ settings });
  return settings;
}

async function getSettings() {
  const stored = await chrome.storage.sync.get('settings');
  return {
    ...DEFAULT_SETTINGS,
    ...(stored.settings || {}),
    extras: { ...DEFAULT_SETTINGS.extras, ...(stored.settings?.extras || {}) }
  };
}

function buildMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'yak-link',
      title: 'Download with Yak',
      contexts: ['link'],
      targetUrlPatterns: [
        '*://*.youtube.com/watch*',
        '*://*.youtube.com/shorts/*',
        '*://youtu.be/*'
      ]
    });
    chrome.contextMenus.create({
      id: 'yak-page',
      title: 'Download this video with Yak',
      contexts: ['page'],
      documentUrlPatterns: ['*://*.youtube.com/watch*', '*://*.youtube.com/shorts/*']
    });
    chrome.contextMenus.create({
      id: 'yak-separator',
      type: 'separator',
      contexts: ['action']
    });
    chrome.contextMenus.create({
      id: 'yak-options',
      title: 'Yak settings',
      contexts: ['action']
    });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'yak-options') {
    chrome.runtime.openOptionsPage();
    return;
  }
  const url = info.linkUrl || info.pageUrl || tab?.url;
  if (!url) return;
  await openSheetInTab(tab, url);
});

async function openSheetInTab(tab, url) {
  if (tab?.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'YAK_OPEN_SHEET', url });
      return;
    } catch {
      // content script not ready in this tab, fall through
    }
  }
  await chrome.storage.session.set({ pendingSheet: { url, at: Date.now() } });
  const target = normalizeVideoUrl(url);
  if (target && tab?.id) {
    chrome.tabs.update(tab.id, { url: target });
  } else if (target) {
    chrome.tabs.create({ url: target });
  }
}

function normalizeVideoUrl(raw) {
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id ? `https://www.youtube.com/watch?v=${id}` : null;
    }
    if (!host.endsWith('youtube.com')) return null;
    const id = url.searchParams.get('v')
      || url.pathname.match(/^\/(shorts|live|embed)\/([\w-]{11})/)?.[2];
    return id ? `https://www.youtube.com/watch?v=${id}` : null;
  } catch {
    return null;
  }
}

async function callHelper(pathname, { method = 'GET', body, timeout = 30_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${HELPER}${pathname}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Yak-Client': 'extension'
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: data.error || `Helper responded with ${response.status}`
      };
    }
    return data;
  } catch {
    return {
      ok: false,
      offline: true,
      error: 'Yak helper offline hai. helper folder me start-helper.bat chalao.'
    };
  } finally {
    clearTimeout(timer);
  }
}

async function notifyTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: '*://*.youtube.com/*' });
    for (const tab of tabs) {
      if (!tab.id) continue;
      chrome.tabs.sendMessage(tab.id, { type: 'YAK_JOBS_CHANGED' }).catch(() => {});
    }
  } catch {}
}

async function setBadge(count) {
  const value = count > 0 ? String(count) : '';
  await chrome.action.setBadgeText({ text: value });
  if (count > 0) {
    await chrome.action.setBadgeBackgroundColor({ color: '#FF7A18' });
    await chrome.action.setBadgeTextColor?.({ color: '#101010' });
  }
}

async function saveSettings(partial) {
  const current = await getSettings();
  const next = {
    ...current,
    ...partial,
    extras: { ...current.extras, ...(partial.extras || {}) }
  };
  await chrome.storage.sync.set({ settings: next });
  return next;
}

async function notifyJob(job) {
  const settings = await getSettings();
  if (!settings.notify || !job?.id) return;
  const key = 'notifiedJobs';
  const stored = await chrome.storage.local.get(key);
  const notified = Array.isArray(stored[key]) ? stored[key] : [];
  if (notified.includes(job.id)) return;
  const done = job.status === 'done';
  const title = done ? 'Download complete' : 'Download failed';
  const message = done
    ? `${job.title || 'Video'} · ${job.qualityLabel || ''}`.trim()
    : `${job.title || 'Video'} — ${(job.error || 'unknown error').split('\n')[0].slice(0, 120)}`;
  try {
    chrome.notifications.create(`yak-${job.id}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/icons/128.png'),
      title,
      message,
      priority: 1,
      buttons: done ? [{ title: 'Show in folder' }] : []
    });
  } catch {}
  await chrome.storage.local.set({ [key]: [job.id, ...notified].slice(0, 40) });
}

chrome.notifications.onClicked.addListener(async (notificationId) => {
  if (!notificationId.startsWith('yak-')) return;
  const jobId = notificationId.slice(4);
  await callHelper(`/api/jobs/${jobId}/reveal`, { method: 'POST', body: {} });
  chrome.notifications.clear(notificationId);
});

chrome.notifications.onButtonClicked.addListener(async (notificationId) => {
  if (!notificationId.startsWith('yak-')) return;
  const jobId = notificationId.slice(4);
  await callHelper(`/api/jobs/${jobId}/reveal`, { method: 'POST', body: {} });
  chrome.notifications.clear(notificationId);
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'yak-watch-jobs') return;
  const jobs = await callHelper('/api/jobs');
  if (!jobs.ok) return;
  for (const job of [...jobs.active, ...jobs.recent].slice(0, 12)) {
    if (['done', 'error'].includes(job.status)) await notifyJob(job);
  }
  await setBadge(jobs.active.length);
  if (!jobs.active.length) chrome.alarms.clear('yak-watch-jobs');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message?.type) {
        case 'YAK_HEALTH': {
          sendResponse(await callHelper(`/api/health${message.refresh ? '?refresh=1' : ''}`, { timeout: 20_000 }));
          return;
        }
        case 'YAK_FORMATS': {
          if (!message.url) throw new Error('URL missing');
          sendResponse(await callHelper(`/api/formats?url=${encodeURIComponent(message.url)}`, { timeout: 95_000 }));
          return;
        }
        case 'YAK_DOWNLOAD': {
          const settings = await getSettings();
          const payload = {
            ...message.payload,
            folder: message.payload?.folder || settings.folder || undefined,
            template: message.payload?.template || settings.template || undefined
          };
          const result = await callHelper('/api/jobs', { method: 'POST', body: payload, timeout: 30_000 });
          if (result.ok) {
            chrome.alarms.create('yak-watch-jobs', { periodInMinutes: 1 });
            notifyTabs();
          }
          sendResponse(result);
          return;
        }
        case 'YAK_JOBS': {
          const result = await callHelper('/api/jobs');
          if (result.ok) await setBadge(result.active?.length || 0);
          sendResponse(result);
          return;
        }
        case 'YAK_CANCEL': {
          sendResponse(await callHelper(`/api/jobs/${message.id}/cancel`, { method: 'POST', body: {} }));
          return;
        }
        case 'YAK_REVEAL': {
          sendResponse(await callHelper(`/api/jobs/${message.id}/reveal`, { method: 'POST', body: {} }));
          return;
        }
        case 'YAK_REVEAL_PATH': {
          sendResponse(await callHelper('/api/reveal', { method: 'POST', body: { path: message.path } }));
          return;
        }
        case 'YAK_PICK_FOLDER': {
          const picked = await callHelper('/api/pick-folder', { method: 'POST', body: {}, timeout: 130_000 });
          if (picked.ok) {
            await callHelper('/api/settings', { method: 'PUT', body: { folder: picked.folder } });
            await saveSettings({ folder: picked.folder });
          }
          sendResponse(picked);
          return;
        }
        case 'YAK_SET_FOLDER': {
          const saved = await callHelper('/api/settings', { method: 'PUT', body: { folder: message.folder } });
          if (saved.ok) await saveSettings({ folder: message.folder });
          sendResponse(saved);
          return;
        }
        case 'YAK_SYNC_HELPER_SETTINGS': {
          const settings = await getSettings();
          sendResponse(await callHelper('/api/settings', {
            method: 'PUT',
            body: {
              concurrency: settings.concurrency,
              template: settings.template,
              ...(settings.folder ? { folder: settings.folder } : {})
            }
          }));
          return;
        }
        case 'YAK_SAVE_SETTINGS': {
          sendResponse({ ok: true, settings: await saveSettings(message.patch || {}) });
          return;
        }
        case 'YAK_GET_SETTINGS': {
          sendResponse({ ok: true, settings: await getSettings() });
          return;
        }
        case 'YAK_OPEN_OPTIONS': {
          chrome.runtime.openOptionsPage();
          sendResponse({ ok: true });
          return;
        }
        case 'YAK_NOTIFY_JOB': {
          if (message.job) await notifyJob(message.job);
          sendResponse({ ok: true });
          return;
        }
        case 'YAK_BADGE': {
          await setBadge(Number(message.count) || 0);
          sendResponse({ ok: true });
          return;
        }
        case 'YAK_NOTIFY_TABS': {
          await notifyTabs();
          sendResponse({ ok: true });
          return;
        }
        case 'YAK_SET_PENDING': {
          if (!message.url) throw new Error('URL missing');
          await chrome.storage.session.set({ pendingSheet: { url: message.url, at: Date.now() } });
          sendResponse({ ok: true });
          return;
        }
        case 'YAK_CLEAR_HISTORY': {
          sendResponse(await callHelper('/api/clear-history', { method: 'POST', body: {} }));
          return;
        }
        case 'YAK_TAKE_PENDING': {
          const stored = await chrome.storage.session.get('pendingSheet');
          if (stored.pendingSheet && Date.now() - stored.pendingSheet.at < 120_000) {
            await chrome.storage.session.remove('pendingSheet');
            sendResponse({ ok: true, pending: stored.pendingSheet });
          } else {
            sendResponse({ ok: true, pending: null });
          }
          return;
        }
        default:
          sendResponse({ ok: false, error: `Unknown message: ${message?.type}` });
      }
    } catch (error) {
      sendResponse({ ok: false, error: error.message || String(error) });
    }
  })();
  return true;
});
