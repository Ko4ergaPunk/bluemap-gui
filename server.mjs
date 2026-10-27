import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || '127.0.0.1';

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    ...headers
  });
  res.end(body);
}

async function proxy(req, res, target) {
  let url;
  try {
    url = new URL(target);
  } catch {
    return send(res, 400, 'Invalid proxy url');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return send(res, 400, 'Only http and https urls are allowed');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const upstream = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'BlueMap-Config-Studio/1.0',
        Accept: req.headers.accept || '*/*'
      }
    });
    const headers = {
      'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': upstream.headers.get('cache-control') || 'public, max-age=3600'
    };
    res.writeHead(upstream.status, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      ...headers
    });
    if (req.method === 'HEAD' || !upstream.body) return res.end();
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const message = err?.name === 'AbortError' ? 'Upstream timeout' : String(err?.message || err);
    send(res, 502, message, { 'Content-Type': 'text/plain; charset=utf-8' });
  } finally {
    clearTimeout(timer);
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '');

  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (requestUrl.pathname === '/api/proxy') {
    const fetchSite = req.headers['sec-fetch-site'];
    const origin = req.headers.origin;
    const sameOrigin = !fetchSite || fetchSite === 'same-origin' || fetchSite === 'none';
    const originOk = !origin || origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`;
    if (!sameOrigin || !originOk) return send(res, 403, 'Forbidden');
    const target = requestUrl.searchParams.get('url');
    if (!target) return send(res, 400, 'Missing url parameter');
    return proxy(req, res, target);
  }

  if (requestUrl.pathname === '/api/health') {
    return send(res, 200, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json' });
  }

  let pathname;
  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.join(root, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(root)) return send(res, 403, 'Forbidden');

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) return send(res, 404, 'Not found');
    const data = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, data, {
      'Content-Type': mime[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
  } catch {
    send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
});

server.listen(port, host, () => {
  console.log(`BlueMap Config Studio: http://${host}:${port}`);
});
