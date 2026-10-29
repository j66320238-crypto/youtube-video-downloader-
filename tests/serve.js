// Static server for the UI harness: serves the project root and proxies /api/*
// to the real Yak helper on 127.0.0.1:8787. Test-only.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8080;
const HELPER = 'http://127.0.0.1:8787';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

async function proxy(req, res, url) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    const response = await fetch(`${HELPER}${url.pathname}${url.search}`, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'X-Yak-Client': 'harness'
      },
      body: req.method === 'GET' ? undefined : Buffer.concat(chunks)
    });
    const body = await response.text();
    res.writeHead(response.status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(body);
  } catch {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, offline: true, error: 'Helper offline' }));
  }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname.startsWith('/api/')) {
    return proxy(req, res, url);
  }

  const route = url.pathname === '/watch' || url.pathname.startsWith('/shorts/') || url.pathname.startsWith('/live/')
    ? '/tests/harness.html'
    : url.pathname;
  const relative = decodeURIComponent(route === '/' ? '/tests/harness.html' : route);
  const file = path.join(ROOT, relative);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Harness: http://127.0.0.1:${PORT}/tests/harness.html`);
});
