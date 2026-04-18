'use strict';
const crypto = require('crypto');

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function genToken() { return crypto.randomBytes(32).toString('hex'); }

function calcFAIR(ds) {
  const kw = ds.keywords || [];
  const F = (ds.doi?35:0)+(ds.title?20:0)+(kw.length>0?20:0)+(ds.description?15:0)+(ds.spatial?10:0);
  const A = (ds.access==='open'?50:10)+(ds.license?30:0)+(ds.format?20:0);
  const I = (ds.format?35:0)+(kw.length>2?25:0)+(ds.creator?.orcid?25:0)+(ds.resourceType&&ds.resourceType!=='Dataset'?15:0);
  const funder = ds.funder?.name || ds.funderName;
  const hasRelated = (ds.relatedIds||[]).length > 0;
  const R = (ds.license?30:0)+(ds.version>1?15:0)+((ds.description||'').length>50?15:0)+(ds.creator?15:0)+(funder?15:0)+(hasRelated?10:0);
  return { F: Math.min(F,100), A: Math.min(A,100), I: Math.min(I,100), R: Math.min(R,100) };
}

function fairHints(ds) {
  const kw = ds.keywords || [];
  const hints = [];
  if (!ds.doi)           hints.push({ p:'F', msg:'Добавьте DOI (+35 F)' });
  if (!ds.title)         hints.push({ p:'F', msg:'Добавьте название (+20 F)' });
  if (!kw.length)        hints.push({ p:'F', msg:'Добавьте ключевые слова (+20 F)' });
  if (!ds.description)   hints.push({ p:'F', msg:'Добавьте описание (+15 F)' });
  if (!ds.spatial)       hints.push({ p:'F', msg:'Добавьте географическое покрытие (+10 F)' });
  if (ds.access !== 'open') hints.push({ p:'A', msg:'Откройте доступ к данным (+40 A)' });
  if (!ds.license)       hints.push({ p:'A', msg:'Укажите лицензию (+30 A)' });
  if (!ds.format)        hints.push({ p:'A', msg:'Укажите формат файла (+20 A)' });
  if (!ds.format)        hints.push({ p:'I', msg:'Укажите формат данных (+35 I)' });
  if (kw.length <= 2)    hints.push({ p:'I', msg:'Добавьте более 2 ключевых слов (+25 I)' });
  if (!ds.creator?.orcid) hints.push({ p:'I', msg:'Добавьте ORCID автора (+25 I)' });
  if (!ds.resourceType || ds.resourceType === 'Dataset')
                         hints.push({ p:'I', msg:'Уточните тип ресурса: Software, Image, Workflow... (+15 I)' });
  if (!ds.license)       hints.push({ p:'R', msg:'Укажите лицензию (+30 R)' });
  if (!(ds.version > 1)) hints.push({ p:'R', msg:'Публикуйте новые версии набора (+15 R)' });
  if ((ds.description||'').length <= 50) hints.push({ p:'R', msg:'Расширьте описание (50+ символов) (+15 R)' });
  if (!ds.creator)       hints.push({ p:'R', msg:'Укажите автора (+15 R)' });
  if (!ds.funder?.name && !ds.funderName) hints.push({ p:'R', msg:'Укажите источник финансирования (+15 R)' });
  if (!(ds.relatedIds||[]).length) hints.push({ p:'R', msg:'Добавьте связанные работы/публикации (+10 R)' });
  return hints;
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

module.exports = { sha256, genToken, calcFAIR, fairHints, MIME, cors, sendJSON, readBody, readRawBody };
