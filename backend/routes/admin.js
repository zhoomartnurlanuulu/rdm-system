'use strict';
const db = require('../db');
const { auth } = require('../auth');
const { sha256, genToken, sendJSON, readBody } = require('../utils');

module.exports = function registerAdminRoutes(route) {

  // ── Auth ─────────────────────────────────────────────────────────────────

  route('POST', '/admin/api/login', async (req, res) => {
    const { email, password } = await readBody(req).catch(() => ({}));
    const user = db.findUserByEmail(email);
    if (!user || !user.active || user.role !== 'admin' || user.passwordHash !== sha256(password || ''))
      return sendJSON(res, 401, { error: 'Invalid admin credentials' });
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
      passwordHash: sha256(body.password), active: true, created: new Date().toISOString(),
    });
    sendJSON(res, 201, { ...user, passwordHash: undefined });
  });

  route('PUT', '/admin/api/users/(\\d+)', async (req, res, _q, p) => {
    if (!auth(req, 'admin')) return sendJSON(res, 401, { error: 'Unauthorized' });
    const body = await readBody(req).catch(() => null);
    if (!body) return sendJSON(res, 400, { error: 'Bad request' });
    const id = parseInt(p[1]);
    if (!db.findUserById(id)) return sendJSON(res, 404, { error: 'Not found' });
    if (body.password) { body.passwordHash = sha256(body.password); delete body.password; }
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

};
