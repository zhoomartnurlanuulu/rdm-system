'use strict';
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { auth, getToken } = require('../auth');
const { sha256, genToken, cors, sendJSON, readBody, readRawBody, fairHints } = require('../utils');

const SESSION_TTL = 8 * 3600 * 1000;

function sanitizeUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, created: u.created };
}

function mkSession(userId, role) {
  const token = genToken();
  db.setSession(token, { userId, exp: Date.now() + SESSION_TTL, role });
  return token;
}

module.exports = function registerPublicRoutes(route) {

  route('GET', '/api/health', (_req, res) => {
    sendJSON(res, 200, {
      status: 'ok', version: '2.0.0',
      uptime: Math.round(process.uptime()),
      ts: new Date().toISOString(),
      principles: ['Findable', 'Accessible', 'Interoperable', 'Reusable'],
    });
  });

  route('GET', '/api/stats', (_req, res) => {
    const pub = db.getAllDatasets().filter(d => d.status === 'published');
    const avg = k => Math.round(pub.reduce((s, d) => s + d.fair[k], 0) / (pub.length || 1));
    sendJSON(res, 200, {
      total: pub.length,
      downloads: pub.reduce((s, d) => s + d.downloads, 0),
      views: pub.reduce((s, d) => s + d.views, 0),
      open: pub.filter(d => d.access === 'open').length,
      fair: { F: avg('F'), A: avg('A'), I: avg('I'), R: avg('R') },
      licenses: [...new Set(pub.map(d => d.license))],
    });
  });

  route('GET', '/api/datasets', (_req, res, q) => {
    let r = db.getAllDatasets().filter(d => {
      if (d.status !== 'published') return false;
      if (d.embargoUntil && new Date(d.embargoUntil) > new Date()) return false;
      return true;
    });
    if (q.q) {
      const ftsIds = db.searchDatasets(q.q);
      if (ftsIds.length > 0) {
        const idSet = new Set(ftsIds);
        r = r.filter(d => idSet.has(d.id));
        const order = Object.fromEntries(ftsIds.map((id, i) => [id, i]));
        r.sort((a, b) => (order[a.id] ?? 999) - (order[b.id] ?? 999));
      } else {
        const s = q.q.toLowerCase();
        r = r.filter(d =>
          d.title.toLowerCase().includes(s) ||
          d.description.toLowerCase().includes(s) ||
          d.keywords.some(k => k.toLowerCase().includes(s))
        );
      }
    }
    if (q.access)  r = r.filter(d => d.access === q.access);
    if (q.license) r = r.filter(d => d.license === q.license);
    const page = parseInt(q.page) || 1, lim = Math.min(parseInt(q.limit) || 12, 100);
    sendJSON(res, 200, { total: r.length, page, limit: lim, pages: Math.ceil(r.length / lim), items: r.slice((page - 1) * lim, page * lim) });
  });

  route('GET', '/api/datasets/(\\d+)', (_req, res, _q, p) => {
    const ds = db.getDataset(parseInt(p[1]));
    if (!ds || ds.status !== 'published') return sendJSON(res, 404, { error: 'Not found' });
    if (ds.embargoUntil && new Date(ds.embargoUntil) > new Date()) return sendJSON(res, 403, { error: 'Dataset under embargo', availableFrom: ds.embargoUntil });
    db.incrementViews(ds.id);
    sendJSON(res, 200, { ...ds, _links: { self: `/api/datasets/${ds.id}`, download: `/api/datasets/${ds.id}/download`, metadata: `/api/datasets/${ds.id}/metadata` } });
  });

  route('GET', '/api/datasets/(\\d+)/fair', (_req, res, _q, p) => {
    const ds = db.getDataset(parseInt(p[1]));
    if (!ds || ds.status !== 'published') return sendJSON(res, 404, { error: 'Not found' });
    sendJSON(res, 200, { fair: ds.fair, hints: fairHints(ds) });
  });

  route('GET', '/api/datasets/(\\d+)/metadata', (_req, res, _q, p) => {
    const ds = db.getDataset(parseInt(p[1]));
    if (!ds || ds.status !== 'published') return sendJSON(res, 404, { error: 'Not found' });
    sendJSON(res, 200, {
      '@context': 'http://schema.org', '@type': 'Dataset',
      identifier: `https://doi.org/${ds.doi}`, name: ds.title, description: ds.description,
      keywords: ds.keywords, license: 'https://creativecommons.org/licenses/',
      creator: { '@type': 'Person', name: ds.creator.name, identifier: `https://orcid.org/${ds.creator.orcid || ''}` },
      dateCreated: ds.created, dateModified: ds.updated, version: String(ds.version),
      encodingFormat: ds.format, contentSize: ds.size, isAccessibleForFree: ds.access === 'open',
      publisher: { '@type': 'Organization', name: 'KSTU Research Data Repository' },
    });
  });

  route('GET', '/api/datasets/(\\d+)/download', (_req, res, q, p) => {
    const ds = db.getDataset(parseInt(p[1]));
    if (!ds || ds.status !== 'published') return sendJSON(res, 404, { error: 'Not found' });
    const fmt = (q.format || 'csv').toLowerCase();
    db.incrementDownloads(ds.id);
    cors(res);
    if (fmt === 'json') {
      const meta = {
        '@context': 'http://schema.org', '@type': 'Dataset',
        id: ds.id, doi: ds.doi, title: ds.title, description: ds.description,
        creator: ds.creator, keywords: ds.keywords, license: ds.license,
        access: ds.access, format: ds.format, size: ds.size, version: ds.version,
        created: ds.created, updated: ds.updated, fair: ds.fair,
      };
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment;filename="${ds.doi.replace('/', '_')}.json"` });
      return res.end(JSON.stringify(meta, null, 2));
    }
    const slug = ds.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const rows = [
      `# Dataset: ${ds.title}`, `# DOI: ${ds.doi}`,
      `# License: ${ds.license}`, `# Author: ${ds.creator?.name || 'Unknown'}`,
      `# Downloaded: ${new Date().toISOString()}`, '',
      'timestamp,value,unit,station,quality_flag',
    ];
    const stations = ['STN-01', 'STN-02', 'STN-03'];
    const units = ds.format?.includes('csv') ? ['μg/m³', 'ppm', '°C'] : ['units'];
    let d = new Date('2024-01-01T00:00:00Z');
    for (let i = 0; i < 24; i++) {
      rows.push(`${d.toISOString()},${(30 + Math.sin(i / 3) * 15 + Math.random() * 5).toFixed(2)},${units[i % units.length]},${stations[i % stations.length]},ok`);
      d = new Date(d.getTime() + 3600000);
    }
    res.writeHead(200, { 'Content-Type': 'text/csv;charset=utf-8', 'Content-Disposition': `attachment;filename="${slug}.csv"` });
    res.end(rows.join('\n') + '\n');
  });

  // ── Profile ──────────────────────────────────────────────────────────────

  route('GET', '/api/me', (req, res) => {
    const user = auth(req);
    if (!user) return sendJSON(res, 401, { error: 'Unauthorized' });
    sendJSON(res, 200, sanitizeUser(user));
  });

  route('PUT', '/api/me', async (req, res) => {
    const user = auth(req);
    if (!user) return sendJSON(res, 401, { error: 'Unauthorized' });
    const { name, email } = await readBody(req).catch(() => ({}));
    if (!name && !email) return sendJSON(res, 422, { error: 'name or email required' });
    if (email && email !== user.email && db.findUserByEmail(email))
      return sendJSON(res, 409, { error: 'Email already in use' });
    const updated = db.updateUser(user.id, { ...(name && { name }), ...(email && { email }) });
    sendJSON(res, 200, sanitizeUser(updated));
  });

  route('PUT', '/api/me/password', async (req, res) => {
    const user = auth(req);
    if (!user) return sendJSON(res, 401, { error: 'Unauthorized' });
    const { currentPassword, newPassword } = await readBody(req).catch(() => ({}));
    if (!currentPassword || !newPassword) return sendJSON(res, 422, { error: 'currentPassword and newPassword required' });
    if (user.passwordHash !== sha256(currentPassword)) return sendJSON(res, 400, { error: 'Неверный текущий пароль' });
    if (newPassword.length < 6) return sendJSON(res, 422, { error: 'Новый пароль минимум 6 символов' });
    db.updateUser(user.id, { passwordHash: sha256(newPassword) });
    sendJSON(res, 200, { message: 'Пароль изменён' });
  });

  // ── Auth ─────────────────────────────────────────────────────────────────

  route('POST', '/api/register', async (req, res) => {
    const { name, email, password } = await readBody(req).catch(() => ({}));
    if (!name || !email || !password) return sendJSON(res, 422, { error: 'name, email, password required' });
    if (db.findUserByEmail(email)) return sendJSON(res, 409, { error: 'Email already exists' });
    const user = db.createUser({ name, email, role: 'researcher', passwordHash: sha256(password), active: true, created: new Date().toISOString() });
    const token = mkSession(user.id, 'researcher');
    sendJSON(res, 201, { token, user: sanitizeUser(user) });
  });

  route('POST', '/api/login', async (req, res) => {
    const { email, password } = await readBody(req).catch(() => ({}));
    const user = db.findUserByEmail(email);
    if (!user || !user.active || user.passwordHash !== sha256(password || ''))
      return sendJSON(res, 401, { error: 'Invalid credentials' });
    const token = mkSession(user.id, user.role);
    sendJSON(res, 200, { token, user: sanitizeUser(user) });
  });

  route('POST', '/api/logout', async (req, res) => {
    const token = getToken(req);
    if (token) db.deleteSession(token);
    sendJSON(res, 200, { message: 'Logged out' });
  });

  // ── My datasets ──────────────────────────────────────────────────────────

  route('GET', '/api/my/datasets', (req, res) => {
    const user = auth(req);
    if (!user) return sendJSON(res, 401, { error: 'Authentication required' });
    const mine = db.getAllDatasets()
      .filter(d => d.userId === user.id)
      .map(d => ({
        id: d.id, doi: d.doi, title: d.title, status: d.status, license: d.license,
        format: d.format, downloads: d.downloads || 0, views: d.views || 0,
        fair: d.fair, created: d.created, updated: d.updated,
      }));
    sendJSON(res, 200, { datasets: mine, total: mine.length });
  });

  route('POST', '/api/my/datasets/(\\d+)/publish', (req, res, _q, p) => {
    const user = auth(req);
    if (!user) return sendJSON(res, 401, { error: 'Authentication required' });
    const id = parseInt(p[1]);
    const ds = db.getDataset(id);
    if (!ds || ds.userId !== user.id) return sendJSON(res, 404, { error: 'Not found or not yours' });
    if (ds.status === 'published') return sendJSON(res, 409, { error: 'Already published' });
    if (!ds.title || !ds.description || !ds.license)
      return sendJSON(res, 422, { error: 'Dataset must have title, description and license before publishing' });
    const updated = db.updateDataset(id, { status: 'published', updated: new Date().toISOString() });
    sendJSON(res, 200, { id: updated.id, status: updated.status, message: 'Dataset published' });
  });

  route('POST', '/api/my/datasets/(\\d+)/unpublish', (req, res, _q, p) => {
    const user = auth(req);
    if (!user) return sendJSON(res, 401, { error: 'Authentication required' });
    const id = parseInt(p[1]);
    const ds = db.getDataset(id);
    if (!ds || ds.userId !== user.id) return sendJSON(res, 404, { error: 'Not found or not yours' });
    if (ds.status !== 'published') return sendJSON(res, 409, { error: 'Dataset is not published' });
    const updated = db.updateDataset(id, { status: 'draft', updated: new Date().toISOString() });
    sendJSON(res, 200, { id: updated.id, status: updated.status, message: 'Dataset unpublished' });
  });

  route('DELETE', '/api/my/datasets/(\\d+)', (req, res, _q, p) => {
    const user = auth(req);
    if (!user) return sendJSON(res, 401, { error: 'Authentication required' });
    const id = parseInt(p[1]);
    const ds = db.getDataset(id);
    if (!ds || ds.userId !== user.id) return sendJSON(res, 404, { error: 'Not found or not yours' });
    if (ds.status === 'published') return sendJSON(res, 403, { error: 'Cannot delete a published dataset. Unpublish it first.' });
    db.deleteDataset(id);
    sendJSON(res, 200, { message: 'Dataset deleted' });
  });

  route('PUT', '/api/my/datasets/(\\d+)', async (req, res, _q, p) => {
    const user = auth(req);
    if (!user) return sendJSON(res, 401, { error: 'Authentication required' });
    const id = parseInt(p[1]);
    const ds = db.getDataset(id);
    if (!ds || ds.userId !== user.id) return sendJSON(res, 404, { error: 'Not found or not yours' });
    const body = await readBody(req).catch(() => null);
    if (!body) return sendJSON(res, 400, { error: 'Bad request' });
    const allowed = ['title', 'description', 'keywords', 'license', 'creator',
                     'resourceType', 'funder', 'spatial',
                     'titleKy', 'titleRu', 'descriptionKy', 'descriptionRu', 'relatedIds'];
    const patch = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
    const updated = db.updateDataset(id, { ...patch, updated: new Date().toISOString() });
    sendJSON(res, 200, { id: updated.id, title: updated.title, status: updated.status, license: updated.license, keywords: updated.keywords, description: updated.description, creator: updated.creator, fair: updated.fair });
  });

  route('POST', '/api/datasets', async (req, res) => {
    const user = auth(req);
    if (!user) return sendJSON(res, 401, { error: 'Authentication required' });
    const body = await readBody(req).catch(() => null);
    if (!body || !body.title || !body.description || !body.license)
      return sendJSON(res, 422, { error: 'title, description, license required' });
    const doiNum = String(Date.now()).slice(-6);
    const ds = db.createDataset({
      doi: `10.48436/rdm-${doiNum}`,
      title: body.title, description: body.description,
      creator: body.creator || { name: user.name },
      keywords: body.keywords || [], license: body.license,
      access: body.access || 'open', format: body.format || 'text/plain',
      size: body.size || 0, version: 1,
      created: new Date().toISOString(), updated: new Date().toISOString(),
      downloads: 0, views: 0, status: 'draft', userId: user.id,
      resourceType: body.resourceType || 'Dataset',
      funder: body.funder || null,
      spatial: body.spatial || null,
      titleKy: body.titleKy || null, titleRu: body.titleRu || null,
      descriptionKy: body.descriptionKy || null, descriptionRu: body.descriptionRu || null,
    });
    sendJSON(res, 201, ds);
  });

  // ── File upload ──────────────────────────────────────────────────────────
  route('POST', '/api/datasets/(\\d+)/file', async (req, res, _q, p) => {
    const user = auth(req);
    if (!user) return sendJSON(res, 401, { error: 'Authentication required' });
    const id = parseInt(p[1]);
    const ds = db.getDataset(id);
    if (!ds || ds.userId !== user.id) return sendJSON(res, 404, { error: 'Not found or not yours' });
    const fileName = decodeURIComponent(req.headers['x-filename'] || 'upload');
    const mime = req.headers['content-type'] || 'application/octet-stream';
    const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
    const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10);
    const uploadsDir = path.join(__dirname, '..', 'data', 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });
    const filePath = path.join(uploadsDir, `${id}${safeExt}`);
    const data = await readRawBody(req).catch(() => null);
    if (!data) return sendJSON(res, 400, { error: 'No file data' });
    await fs.promises.writeFile(filePath, data);
    const updated = db.updateDataset(id, { file: { path: filePath, name: fileName, mime, size: data.length }, updated: new Date().toISOString() });
    sendJSON(res, 200, { message: 'File uploaded', fileName, size: data.length, dataset: updated });
  });

  // ── Export metadata ──────────────────────────────────────────────────────
  route('GET', '/api/datasets/(\\d+)/export', (_req, res, q, p) => {
    const ds = db.getDataset(parseInt(p[1]));
    if (!ds || ds.status !== 'published') return sendJSON(res, 404, { error: 'Not found' });
    const fmt = (q.format || 'bibtex').toLowerCase();
    cors(res);
    if (fmt === 'bibtex') {
      const year = ds.created ? ds.created.slice(0, 4) : new Date().getFullYear();
      const key = ds.doi.replace(/[^a-zA-Z0-9]/g, '_');
      const bib = `@dataset{${key},
  author    = {${ds.creator?.name || 'Unknown'}},
  title     = {${ds.title}},
  year      = {${year}},
  doi       = {${ds.doi}},
  license   = {${ds.license}},
  keywords  = {${(ds.keywords || []).join('; ')}},
  publisher = {KSTU Research Data Repository},
  note      = {Version ${ds.version || 1}}
}`;
      res.writeHead(200, { 'Content-Type': 'text/plain;charset=utf-8', 'Content-Disposition': `attachment;filename="${ds.doi.replace('/', '_')}.bib"` });
      return res.end(bib);
    }
    if (fmt === 'dublincore') {
      const kw = (ds.keywords || []).map(k => `  <dc:subject>${k}</dc:subject>`).join('\n');
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<oai_dc:dc xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>${ds.title}</dc:title>
  <dc:creator>${ds.creator?.name || ''}</dc:creator>
  <dc:description>${ds.description}</dc:description>
  <dc:identifier>https://doi.org/${ds.doi}</dc:identifier>
  <dc:type>Dataset</dc:type>
  <dc:rights>${ds.license}</dc:rights>
  <dc:format>${ds.format || ''}</dc:format>
  <dc:date>${ds.created ? ds.created.slice(0, 10) : ''}</dc:date>
${kw}
</oai_dc:dc>`;
      res.writeHead(200, { 'Content-Type': 'text/xml;charset=utf-8', 'Content-Disposition': `attachment;filename="${ds.doi.replace('/', '_')}_dc.xml"` });
      return res.end(xml);
    }
    if (fmt === 'datacite') {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<resource xmlns="http://datacite.org/schema/kernel-4">
  <identifier identifierType="DOI">${ds.doi}</identifier>
  <creators>
    <creator><creatorName>${ds.creator?.name || ''}</creatorName>${ds.creator?.orcid ? `<nameIdentifier nameIdentifierScheme="ORCID">${ds.creator.orcid}</nameIdentifier>` : ''}</creator>
  </creators>
  <titles><title>${ds.title}</title></titles>
  <publisher>KSTU Research Data Repository</publisher>
  <publicationYear>${ds.created ? ds.created.slice(0, 4) : ''}</publicationYear>
  <resourceType resourceTypeGeneral="Dataset">Dataset</resourceType>
  <descriptions><description descriptionType="Abstract">${ds.description}</description></descriptions>
  <rightsList><rights rightsURI="">${ds.license}</rights></rightsList>
  <version>${ds.version || 1}</version>
</resource>`;
      res.writeHead(200, { 'Content-Type': 'text/xml;charset=utf-8', 'Content-Disposition': `attachment;filename="${ds.doi.replace('/', '_')}_datacite.xml"` });
      return res.end(xml);
    }
    sendJSON(res, 400, { error: 'format must be bibtex, dublincore, or datacite' });
  });

  // ── API Keys ──────────────────────────────────────────────────────────────
  route('GET', '/api/keys', (req, res) => {
    const user = auth(req);
    if (!user) return sendJSON(res, 401, { error: 'Unauthorized' });
    sendJSON(res, 200, db.getUserApiKeys(user.id));
  });

  route('POST', '/api/keys', async (req, res) => {
    const user = auth(req);
    if (!user) return sendJSON(res, 401, { error: 'Unauthorized' });
    const { name } = await readBody(req).catch(() => ({}));
    if (!name) return sendJSON(res, 422, { error: 'name required' });
    const rawKey = genToken();
    const id = db.createApiKey(user.id, sha256(rawKey), name.trim());
    sendJSON(res, 201, { id, name: name.trim(), key: rawKey, created: new Date().toISOString(), message: 'Save this key — it will not be shown again' });
  });

  route('DELETE', '/api/keys/(\\d+)', (req, res, _q, p) => {
    const user = auth(req);
    if (!user) return sendJSON(res, 401, { error: 'Unauthorized' });
    db.revokeApiKey(parseInt(p[1]), user.id);
    sendJSON(res, 200, { message: 'Key revoked' });
  });

  // ── DMP ───────────────────────────────────────────────────────────────────
  route('GET', '/api/my/dmp', (req, res) => {
    const user = auth(req);
    if (!user) return sendJSON(res, 401, { error: 'Unauthorized' });
    sendJSON(res, 200, db.getDmp(user.id) || {});
  });

  route('POST', '/api/my/dmp', async (req, res) => {
    const user = auth(req);
    if (!user) return sendJSON(res, 401, { error: 'Unauthorized' });
    const body = await readBody(req).catch(() => ({}));
    sendJSON(res, 200, db.upsertDmp(user.id, body));
  });

};
