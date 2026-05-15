'use strict';
const crypto = require('crypto');

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function genToken() { return crypto.randomBytes(32).toString('hex'); }

// ── Password hashing (PBKDF2-HMAC-SHA256, 120k iters) ─────────────────────────
// Format: pbkdf2$<iters>$<saltHex>$<hashHex>
const PBKDF2_ITERS = 120_000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = 'sha256';

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(String(password), salt, PBKDF2_ITERS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
  return `pbkdf2$${PBKDF2_ITERS}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  // Legacy: plain SHA-256 hex (64 chars) — accepted for back-compat, will be rehashed on login
  if (/^[a-f0-9]{64}$/.test(stored)) {
    const candidate = sha256(String(password));
    try { return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(stored, 'hex')); }
    catch { return false; }
  }
  if (!stored.startsWith('pbkdf2$')) return false;
  const [, itersStr, saltHex, hashHex] = stored.split('$');
  const iters = parseInt(itersStr, 10);
  if (!iters || !saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const candidate = crypto.pbkdf2Sync(String(password), salt, iters, expected.length, PBKDF2_DIGEST);
  try { return crypto.timingSafeEqual(candidate, expected); }
  catch { return false; }
}

function isLegacyHash(stored) {
  return typeof stored === 'string' && /^[a-f0-9]{64}$/.test(stored);
}

function _doiOk(doi)   { return doi && /^10\.\d{4,9}\/[\-._;()/:A-Za-z0-9]+$/.test(String(doi).trim().replace(/^https?:\/\/(dx\.)?doi\.org\//, '')); }
function _orcidOk(o)   {
  if (!o) return false;
  const s = String(o).trim().replace(/^https?:\/\/orcid\.org\//, '');
  if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(s)) return false;
  const d = s.replace(/-/g, ''); let total = 0;
  for (let i = 0; i < 15; i++) total = (total + parseInt(d[i], 10)) * 2;
  const exp = (12 - (total % 11)) % 11;
  const last = d[15] === 'X' ? 10 : parseInt(d[15], 10);
  return exp === last;
}
function _kwOk(kw) { return Array.isArray(kw) && kw.filter(k => k && String(k).trim().length >= 2).length; }
function _isMultilingual(ds) { return (ds.titleRu || ds.titleKy) && (ds.descriptionRu || ds.descriptionKy); }

function calcFAIR(ds) {
  const kw = ds.keywords || [];
  const kwCount = _kwOk(kw);
  const hasValidDoi = _doiOk(ds.doi);
  const hasValidOrcid = _orcidOk(ds.creator?.orcid);

  // Findable (100)
  const F =
      (hasValidDoi ? 30 : (ds.doi ? 15 : 0))
    + (ds.title ? 15 : 0)
    + (kwCount > 0 ? 15 : 0)
    + (ds.description ? 15 : 0)
    + (ds.spatial ? 10 : 0)
    + (_isMultilingual(ds) ? 15 : 0);

  // Accessible (100)
  const A =
      (ds.access === 'open' ? 40 : 10)
    + (ds.license ? 25 : 0)
    + (ds.format ? 15 : 0)
    + (ds.file?.path ? 15 : 0)
    + (ds.access === 'open' && !ds.embargoUntil ? 5 : 0);

  // Interoperable (100)
  const isStandardFmt = /(csv|json|xml|nc|netcdf|parquet|tsv)/i.test(ds.format || '');
  const I =
      (ds.format ? 20 : 0)
    + (isStandardFmt ? 15 : 0)
    + (kwCount > 2 ? 20 : kwCount > 0 ? 10 : 0)
    + (hasValidOrcid ? 20 : 0)
    + (ds.resourceType && ds.resourceType !== 'Dataset' ? 15 : 0)
    + ((ds.relatedIds || []).length > 0 ? 10 : 0);

  // Reusable (100)
  const funder = ds.funder?.name || ds.funderName;
  const hasRelated = (ds.relatedIds || []).length > 0;
  const longDesc = (ds.description || '').length > 50;
  const veryLongDesc = (ds.description || '').length > 200;
  const R =
      (ds.license ? 25 : 0)
    + (ds.version > 1 ? 10 : 0)
    + (longDesc ? 10 : 0)
    + (veryLongDesc ? 10 : 0)
    + (ds.creator ? 10 : 0)
    + (hasValidOrcid ? 10 : 0)
    + (funder ? 15 : 0)
    + (hasRelated ? 10 : 0);

  return { F: Math.min(F, 100), A: Math.min(A, 100), I: Math.min(I, 100), R: Math.min(R, 100) };
}

function fairHints(ds) {
  const kw = ds.keywords || [];
  const kwCount = _kwOk(kw);
  const hints = [];
  if (!ds.doi)              hints.push({ p:'F', msg:'Добавьте DOI (+30 F)' });
  else if (!_doiOk(ds.doi)) hints.push({ p:'F', msg:'Проверьте формат DOI: 10.NNNN/suffix (+15 F)' });
  if (!ds.title)            hints.push({ p:'F', msg:'Добавьте название (+15 F)' });
  if (!kwCount)             hints.push({ p:'F', msg:'Добавьте ключевые слова (+15 F)' });
  if (!ds.description)      hints.push({ p:'F', msg:'Добавьте описание (+15 F)' });
  if (!ds.spatial)          hints.push({ p:'F', msg:'Добавьте географическое покрытие (+10 F)' });
  if (!_isMultilingual(ds)) hints.push({ p:'F', msg:'Добавьте мультиязычные название и описание (+15 F)' });

  if (ds.access !== 'open') hints.push({ p:'A', msg:'Откройте доступ к данным (+30 A)' });
  if (!ds.license)          hints.push({ p:'A', msg:'Укажите лицензию (+25 A)' });
  if (!ds.format)           hints.push({ p:'A', msg:'Укажите формат файла (+15 A)' });
  if (!ds.file?.path)       hints.push({ p:'A', msg:'Загрузите файл данных (+15 A)' });
  if (ds.embargoUntil)      hints.push({ p:'A', msg:'Завершите эмбарго (+5 A)' });

  if (!ds.format)           hints.push({ p:'I', msg:'Укажите формат данных (+20 I)' });
  else if (!/(csv|json|xml|nc|netcdf|parquet|tsv)/i.test(ds.format))
                            hints.push({ p:'I', msg:'Используйте стандартный формат: CSV, JSON, NetCDF, Parquet (+15 I)' });
  if (kwCount <= 2)         hints.push({ p:'I', msg:'Добавьте больше 2 ключевых слов (+20 I)' });
  if (!_orcidOk(ds.creator?.orcid))
                            hints.push({ p:'I', msg:'Добавьте корректный ORCID автора (+20 I)' });
  if (!ds.resourceType || ds.resourceType === 'Dataset')
                            hints.push({ p:'I', msg:'Уточните тип ресурса: Software, Image, Workflow... (+15 I)' });
  if (!(ds.relatedIds || []).length)
                            hints.push({ p:'I', msg:'Добавьте связанные работы/публикации (+10 I)' });

  if (!ds.license)          hints.push({ p:'R', msg:'Укажите лицензию (+25 R)' });
  if (!(ds.version > 1))    hints.push({ p:'R', msg:'Публикуйте новые версии набора (+10 R)' });
  if ((ds.description||'').length <= 50)  hints.push({ p:'R', msg:'Расширьте описание (50+ символов) (+10 R)' });
  if ((ds.description||'').length <= 200) hints.push({ p:'R', msg:'Подробное описание (200+ символов) (+10 R)' });
  if (!ds.creator)          hints.push({ p:'R', msg:'Укажите автора (+10 R)' });
  if (!_orcidOk(ds.creator?.orcid)) hints.push({ p:'R', msg:'Добавьте ORCID автора (+10 R)' });
  if (!(ds.funder?.name || ds.funderName)) hints.push({ p:'R', msg:'Укажите источник финансирования (+15 R)' });
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

// ── Rate limiter (shared across server + routes) ──────────────────────────────
const _rl = new Map();
function checkRateLimit(key, max, windowMs) {
  const now = Date.now();
  const w = _rl.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > w.resetAt) { w.count = 0; w.resetAt = now + windowMs; }
  w.count++;
  _rl.set(key, w);
  return w.count <= max;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of _rl) { if (now > v.resetAt) _rl.delete(k); } }, 5 * 60_000).unref?.();

function readRawBody(req, maxBytes = 100 * 1024 * 1024) {
  return new Promise((ok, fail) => {
    const chunks = [];
    let total = 0;
    req.on('data', c => { total += c.length; if (total > maxBytes) req.destroy(); else chunks.push(c); });
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', fail);
  });
}

// ── DOI / ORCID validation ────────────────────────────────────────────────────
// DOI: must match 10.NNNN/suffix (simplified Crossref pattern)
function validateDOI(doi) {
  if (!doi) return { ok: false, error: 'DOI обязателен' };
  const s = String(doi).trim().replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
  if (!/^10\.\d{4,9}\/[\-._;()/:A-Za-z0-9]+$/.test(s)) {
    return { ok: false, error: 'Неверный формат DOI (ожидается 10.NNNN/suffix)' };
  }
  return { ok: true, value: s };
}

// ORCID: 0000-0000-0000-000X, last char is mod-11 checksum (X allowed)
function validateORCID(orcid) {
  if (!orcid) return { ok: true, value: null };
  const s = String(orcid).trim().replace(/^https?:\/\/orcid\.org\//, '');
  if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(s)) {
    return { ok: false, error: 'Неверный формат ORCID (0000-0000-0000-000X)' };
  }
  const digits = s.replace(/-/g, '');
  let total = 0;
  for (let i = 0; i < 15; i++) total = (total + parseInt(digits[i], 10)) * 2;
  const remainder = total % 11;
  const expected = (12 - remainder) % 11;
  const last = digits[15] === 'X' ? 10 : parseInt(digits[15], 10);
  if (expected !== last) return { ok: false, error: 'Неверная контрольная сумма ORCID' };
  return { ok: true, value: s };
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = {
  sha256, genToken,
  hashPassword, verifyPassword, isLegacyHash,
  calcFAIR, fairHints,
  validateDOI, validateORCID, escapeHtml,
  checkRateLimit,
  MIME, cors, sendJSON, readBody, readRawBody,
};
