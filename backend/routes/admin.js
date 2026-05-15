'use strict';
const db = require('../db');
const { auth } = require('../auth');
const { sha256, genToken, sendJSON, readBody, hashPassword, verifyPassword, isLegacyHash, checkRateLimit } = require('../utils');

module.exports = function registerAdminRoutes(route) {

  // ── Auth ─────────────────────────────────────────────────────────────────

  route('POST', '/admin/api/login', async (req, res) => {
    const { email, password } = await readBody(req).catch(() => ({}));
    if (!email) return sendJSON(res, 422, { error: 'email required' });
    if (!checkRateLimit(`adminLogin:${String(email).toLowerCase()}`, 5, 15 * 60_000)) {
      return sendJSON(res, 429, { error: 'Слишком много попыток. Подождите 15 минут.', retryAfter: 900 });
    }
    const user = db.findUserByEmail(email);
    const ok = user && user.active && user.role === 'admin' && verifyPassword(password || '', user.passwordHash);
    if (!ok) return sendJSON(res, 401, { error: 'Invalid admin credentials' });
    if (isLegacyHash(user.passwordHash)) db.updateUser(user.id, { passwordHash: hashPassword(password) });
    const token = genToken(), refreshToken = genToken();
    db.setSession(token,        { userId: user.id, exp: Date.now() + 8 * 3600 * 1000, role: 'admin' });
    db.setSession(refreshToken, { userId: user.id, exp: Date.now() + 7 * 24 * 3600 * 1000, role: 'admin', type: 'refresh' });
    sendJSON(res, 200, { token, refreshToken, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  });

  route('POST', '/admin/api/refresh', async (req, res) => {
    const { refreshToken } = await readBody(req).catch(() => ({}));
    if (!refreshToken) return sendJSON(res, 400, { error: 'refreshToken required' });
    const sess = db.getSession(refreshToken);
    if (!sess || sess.type !== 'refresh' || sess.exp < Date.now())
      return sendJSON(res, 401, { error: 'Invalid or expired refresh token' });
    const user = db.findUserById(sess.userId);
    if (!user || !user.active || user.role !== 'admin')
      return sendJSON(res, 401, { error: 'User not found' });
    db.deleteSession(refreshToken);
    const token = genToken(), newRefresh = genToken();
    db.setSession(token,      { userId: user.id, exp: Date.now() + 8 * 3600 * 1000, role: 'admin' });
    db.setSession(newRefresh, { userId: user.id, exp: Date.now() + 7 * 24 * 3600 * 1000, role: 'admin', type: 'refresh' });
    sendJSON(res, 200, { token, refreshToken: newRefresh, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  });

  // ── Stats ─────────────────────────────────────────────────────────────────

  route('GET', '/admin/api/stats', (req, res) => {
    if (!auth(req, 'admin')) return sendJSON(res, 401, { error: 'Unauthorized' });
    const all  = db.getAllDatasets();
    const pub  = all.filter(d => d.status === 'published');
    const users = db.getAllUsers();
    const avg  = k => Math.round(all.reduce((s, d) => s + d.fair[k], 0) / (all.length || 1));
    sendJSON(res, 200, {
      datasets: { total: all.length, published: pub.length, draft: all.length - pub.length },
      users: { total: users.length, active: users.filter(u => u.active).length, admins: users.filter(u => u.role === 'admin').length },
      downloads: all.reduce((s, d) => s + d.downloads, 0),
      views:     all.reduce((s, d) => s + d.views, 0),
      fair: { F: avg('F'), A: avg('A'), I: avg('I'), R: avg('R') },
      sessions: db.countSessions(),
      logs_today: db.countLogsToday(),
    });
  });

  // ── Datasets CRUD ─────────────────────────────────────────────────────────

  route('GET', '/admin/api/datasets', (req, res, q) => {
    if (!auth(req, 'admin')) return sendJSON(res, 401, { error: 'Unauthorized' });
    let r = db.getAllDatasets();
    if (q.q) { const s = q.q.toLowerCase(); r = r.filter(d => d.title.toLowerCase().includes(s)); }
    if (q.status) r = r.filter(d => d.status === q.status);
    const page = parseInt(q.page) || 1, lim = parseInt(q.limit) || 20;
    sendJSON(res, 200, { total: r.length, page, limit: lim, pages: Math.ceil(r.length / lim), items: r.slice((page - 1) * lim, page * lim) });
  });

  route('GET', '/admin/api/datasets/(\\d+)', (req, res, _q, p) => {
    if (!auth(req, 'admin')) return sendJSON(res, 401, { error: 'Unauthorized' });
    const ds = db.getDataset(parseInt(p[1]));
    if (!ds) return sendJSON(res, 404, { error: 'Not found' });
    sendJSON(res, 200, ds);
  });

  route('PUT', '/admin/api/datasets/(\\d+)', async (req, res, _q, p) => {
    if (!auth(req, 'admin')) return sendJSON(res, 401, { error: 'Unauthorized' });
    const body = await readBody(req).catch(() => null);
    if (!body) return sendJSON(res, 400, { error: 'Bad request' });
    const id = parseInt(p[1]);
    if (!db.getDataset(id)) return sendJSON(res, 404, { error: 'Not found' });
    const updated = db.updateDataset(id, { ...body, updated: new Date().toISOString() });
    sendJSON(res, 200, updated);
  });

  route('DELETE', '/admin/api/datasets/(\\d+)', (req, res, _q, p) => {
    if (!auth(req, 'admin')) return sendJSON(res, 401, { error: 'Unauthorized' });
    const id = parseInt(p[1]);
    if (!db.getDataset(id)) return sendJSON(res, 404, { error: 'Not found' });
    db.deleteDataset(id);
    sendJSON(res, 200, { message: 'Deleted' });
  });

  route('POST', '/admin/api/datasets/(\\d+)/publish', (req, res, _q, p) => {
    if (!auth(req, 'admin')) return sendJSON(res, 401, { error: 'Unauthorized' });
    const id = parseInt(p[1]);
    const ds = db.getDataset(id);
    if (!ds) return sendJSON(res, 404, { error: 'Not found' });
    const updated = db.updateDataset(id, { status: 'published', updated: new Date().toISOString() });
    sendJSON(res, 200, updated);
  });

  // ── Users CRUD ────────────────────────────────────────────────────────────

  route('GET', '/admin/api/users', (req, res) => {
    if (!auth(req, 'admin')) return sendJSON(res, 401, { error: 'Unauthorized' });
    sendJSON(res, 200, db.getAllUsers().map(u => ({ ...u, passwordHash: undefined })));
  });

  route('POST', '/admin/api/users', async (req, res) => {
    if (!auth(req, 'admin')) return sendJSON(res, 401, { error: 'Unauthorized' });
    const body = await readBody(req).catch(() => null);
    if (!body?.email || !body?.name || !body?.password) return sendJSON(res, 422, { error: 'name, email, password required' });
    if (db.findUserByEmail(body.email)) return sendJSON(res, 409, { error: 'Email already exists' });
    const user = db.createUser({
      name: body.name, email: body.email, role: body.role || 'researcher',
      passwordHash: hashPassword(body.password), active: true, created: new Date().toISOString(),
    });
    sendJSON(res, 201, { ...user, passwordHash: undefined });
  });

  route('PUT', '/admin/api/users/(\\d+)', async (req, res, _q, p) => {
    if (!auth(req, 'admin')) return sendJSON(res, 401, { error: 'Unauthorized' });
    const body = await readBody(req).catch(() => null);
    if (!body) return sendJSON(res, 400, { error: 'Bad request' });
    const id = parseInt(p[1]);
    if (!db.findUserById(id)) return sendJSON(res, 404, { error: 'Not found' });
    if (body.password) { body.passwordHash = hashPassword(body.password); delete body.password; }
    const user = db.updateUser(id, body);
    sendJSON(res, 200, { ...user, passwordHash: undefined });
  });

  route('DELETE', '/admin/api/users/(\\d+)', (req, res, _q, p) => {
    if (!auth(req, 'admin')) return sendJSON(res, 401, { error: 'Unauthorized' });
    const id = parseInt(p[1]);
    if (id === 1) return sendJSON(res, 403, { error: 'Cannot delete root admin' });
    if (!db.findUserById(id)) return sendJSON(res, 404, { error: 'Not found' });
    db.deleteUser(id);
    sendJSON(res, 200, { message: 'Deleted' });
  });

  // ── Reject dataset ────────────────────────────────────────────────────────

  route('POST', '/admin/api/datasets/(\\d+)/reject', async (req, res, _q, p) => {
    if (!auth(req, 'admin')) return sendJSON(res, 401, { error: 'Unauthorized' });
    const body = await readBody(req).catch(() => ({}));
    const id = parseInt(p[1]);
    const ds = db.getDataset(id);
    if (!ds) return sendJSON(res, 404, { error: 'Not found' });
    const updated = db.updateDataset(id, {
      status: 'rejected',
      rejectComment: body.comment || 'Отклонено администратором',
      updated: new Date().toISOString(),
    });
    sendJSON(res, 200, updated);
  });

  // ── Analytics ─────────────────────────────────────────────────────────────

  route('GET', '/admin/api/analytics', (req, res) => {
    if (!auth(req, 'admin')) return sendJSON(res, 401, { error: 'Unauthorized' });
    sendJSON(res, 200, db.getAnalytics());
  });

  // ── Logs ─────────────────────────────────────────────────────────────────

  route('GET', '/admin/api/logs', (req, res, q) => {
    if (!auth(req, 'admin')) return sendJSON(res, 401, { error: 'Unauthorized' });
    const lim = parseInt(q.limit) || 100;
    const logs = db.getLogs(lim);
    sendJSON(res, 200, { total: logs.length, logs });
  });

  route('GET', '/admin/api/logs/export', (req, res) => {
    if (!auth(req, 'admin')) return sendJSON(res, 401, { error: 'Unauthorized' });
    const logs = db.getLogs(500);
    const rows = ['id,timestamp,method,path,status,ms,user_id'];
    for (const l of logs) {
      const path = String(l.path || '').replace(/"/g, '""');
      rows.push([l.id, l.ts, l.method || '', `"${path}"`, l.status || '', l.ms || '', l.user_id || ''].join(','));
    }
    const { cors } = require('../utils');
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/csv;charset=utf-8', 'Content-Disposition': 'attachment;filename="rdm-logs.csv"' });
    res.end(rows.join('\n') + '\n');
  });

  // ── Bulk operations ───────────────────────────────────────────────────────

  route('POST', '/admin/api/datasets/bulk', async (req, res) => {
    if (!auth(req, 'admin')) return sendJSON(res, 401, { error: 'Unauthorized' });
    const body = await readBody(req).catch(() => null);
    if (!body || !Array.isArray(body.ids) || !body.action) {
      return sendJSON(res, 422, { error: 'ids[] and action required' });
    }
    const now = new Date().toISOString();
    const results = { ok: 0, fail: 0, errors: [] };
    for (const id of body.ids) {
      try {
        const ds = db.getDataset(parseInt(id));
        if (!ds) { results.fail++; results.errors.push({ id, error: 'not found' }); continue; }
        if (body.action === 'publish')   db.updateDataset(id, { status: 'published', updated: now });
        else if (body.action === 'unpublish') db.updateDataset(id, { status: 'draft', updated: now });
        else if (body.action === 'delete')    db.deleteDataset(id);
        else { results.fail++; results.errors.push({ id, error: 'unknown action' }); continue; }
        results.ok++;
      } catch (e) { results.fail++; results.errors.push({ id, error: e.message }); }
    }
    sendJSON(res, 200, results);
  });

  route('POST', '/admin/api/users/bulk', async (req, res) => {
    if (!auth(req, 'admin')) return sendJSON(res, 401, { error: 'Unauthorized' });
    const body = await readBody(req).catch(() => null);
    if (!body || !Array.isArray(body.ids) || !body.action) {
      return sendJSON(res, 422, { error: 'ids[] and action required' });
    }
    const results = { ok: 0, fail: 0, errors: [] };
    for (const id of body.ids) {
      try {
        if (parseInt(id) === 1) { results.fail++; results.errors.push({ id, error: 'root admin' }); continue; }
        const u = db.findUserById(parseInt(id));
        if (!u) { results.fail++; results.errors.push({ id, error: 'not found' }); continue; }
        if (body.action === 'activate')   db.updateUser(id, { active: true });
        else if (body.action === 'deactivate') db.updateUser(id, { active: false });
        else if (body.action === 'delete')     db.deleteUser(id);
        else { results.fail++; results.errors.push({ id, error: 'unknown action' }); continue; }
        results.ok++;
      } catch (e) { results.fail++; results.errors.push({ id, error: e.message }); }
    }
    sendJSON(res, 200, results);
  });

};
