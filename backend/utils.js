'use strict';
const crypto = require('crypto');

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function genToken() { return crypto.randomBytes(32).toString('hex'); }

function calcFAIR(ds) {
  const F = (ds.doi?40:0)+(ds.title?20:0)+((ds.keywords||[]).length>0?20:0)+(ds.description?20:0);
  const A = (ds.access==='open'?50:10)+(ds.license?30:0)+(ds.format?20:0);
  const I = (ds.format?40:0)+((ds.keywords||[]).length>2?30:0)+(ds.creator?.orcid?30:0);
  const R = (ds.license?40:0)+(ds.version>1?20:0)+((ds.description||'').length>50?20:0)+(ds.creator?20:0);
  return { F, A, I, R };
}

const MIME = {
  '.html': 'text/html;charset=utf-8',
  '.css':  'text/css;charset=utf-8',
  '.js':   'application/javascript;charset=utf-8',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
};

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

function sendJSON(res, status, data) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

function readBody(req) {
  return new Promise((ok, fail) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { fail(new Error('Bad JSON')); } });
    req.on('error', fail);
  });
}

function readRawBody(req, maxBytes = 100 * 1024 * 1024) {
  return new Promise((ok, fail) => {
    const chunks = [];
    let total = 0;
    req.on('data', c => { total += c.length; if (total > maxBytes) req.destroy(); else chunks.push(c); });
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', fail);
  });
}

module.exports = { sha256, genToken, calcFAIR, MIME, cors, sendJSON, readBody, readRawBody };
