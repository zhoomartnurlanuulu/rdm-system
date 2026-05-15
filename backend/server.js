'use strict';
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT    = process.env.PORT || 3000;
const PUB_DIR = path.join(__dirname, '..', 'public');
const ADM_DIR = path.join(__dirname, '..', 'admin');

const { MIME, cors, sendJSON } = require('./utils');
const { addLog, getSession }   = require('./db');

// Rate limiter is in utils.js for reuse from routes
const { checkRateLimit } = require('./utils');

// ── Security headers ─────────────────────────────────────────────────────────
function setSecurityHeaders(res, isHTML) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  if (isHTML) {
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline'; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "img-src 'self' data: blob: https:; " +
      "font-src 'self' data: https://fonts.gstatic.com; " +
      "connect-src 'self'; " +
      "frame-ancestors 'self'");
  }
}

// ── Router ───────────────────────────────────────────────────────────────────
const routes = [];
function route(m, pat, fn) { routes.push({ m, re: new RegExp('^' + pat + '$'), fn }); }

require('./routes/api')(route);
require('./routes/admin')(route);
require('./routes/oai')(route);

// ── Request handler ───────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const t0 = Date.now();
  const parsed   = new URL(req.url, 'http://localhost');
  const pathname = parsed.pathname.replace(/\/+$/, '').replace(/\.\./g, '') || '/';
  const query    = Object.fromEntries(parsed.searchParams);

  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }

  const isApi = pathname.startsWith('/api/') || pathname.startsWith('/admin/api/') || pathname === '/oai';

  if (isApi) {
    setSecurityHeaders(res, false);
    const ip  = req.socket?.remoteAddress || 'unknown';
    const isLogin = pathname.includes('/login') || pathname === '/api/register';
    const max = isLogin ? 10 : 120;
    if (!checkRateLimit(`ip:${ip}:${pathname}`, max, 60_000)) {
      sendJSON(res, 429, { error: 'Too many requests', retryAfter: 60 });
      return;
    }

    let matched = false;
    for (const r of routes) {
      if (r.m !== req.method) continue;
      const m = pathname.match(r.re);
      if (m) {
        matched = true;
        try { await r.fn(req, res, query, m); } catch (e) { sendJSON(res, 500, { error: e.message }); }
        break;
      }
    }
    if (!matched) sendJSON(res, 404, { error: 'Route not found' });
    const tok = (req.headers['authorization'] || '').slice(7);
    addLog(req.method, pathname, res.statusCode, Date.now() - t0, tok ? getSession(tok)?.userId : null);
    return;
  }

  // Serve uploaded files
  if (pathname.startsWith('/uploads/')) {
    const fname = path.basename(pathname);
    const fp = path.join(__dirname, 'data', 'uploads', fname);
    if (fs.existsSync(fp)) {
      const ext = path.extname(fp).toLowerCase();
      cors(res);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'max-age=3600' });
      return res.end(fs.readFileSync(fp));
    }
    cors(res); res.writeHead(404); res.end('Not found');
    return;
  }

  // Static: admin panel
  if (pathname.startsWith('/admin')) {
    const fp = pathname === '/admin' || pathname === '/admin/'
      ? path.join(ADM_DIR, 'index.html')
      : path.join(ADM_DIR, pathname.replace('/admin/', ''));
    return serveFile(res, fp, path.join(ADM_DIR, 'index.html'));
  }

  // Static: public site
  const fp = pathname === '/'
    ? path.join(PUB_DIR, 'index.html')
    : path.join(PUB_DIR, pathname.slice(1));
  serveFile(res, fp, path.join(PUB_DIR, 'index.html'));
});

function serveFile(res, fp, fallback) {
  const mime = MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream';
  const isHTML = mime.startsWith('text/html');
  fs.readFile(fp, (err, data) => {
    if (err) {
      fs.readFile(fallback, (err2, data2) => {
        if (err2) { cors(res); res.writeHead(404); res.end('404'); }
        else { cors(res); setSecurityHeaders(res, true); res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }); res.end(data2); }
      });
    } else {
      cors(res);
      setSecurityHeaders(res, isHTML);
      // HTML pages: no cache (so users always get fresh UI). Assets: 5 min.
      const cache = isHTML ? 'no-cache, no-store, must-revalidate' : 'max-age=300';
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': cache });
      res.end(data);
    }
  });
}

server.listen(PORT, () => {
  console.log(`\n  RDM System v2 — KSTU`);
  console.log(`  Public  → http://localhost:${PORT}`);
  console.log(`  Admin   → http://localhost:${PORT}/admin`);
  console.log(`  API     → http://localhost:${PORT}/api`);
  console.log(`  OAI-PMH → http://localhost:${PORT}/oai\n`);
  console.log(`  Admin login: admin@kstu.kg / admin123\n`);
});
module.exports = server;
