'use strict';
const path     = require('path');
const fs       = require('fs');
const Database = require('better-sqlite3');
const { sha256, calcFAIR } = require('./utils');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const sql = new Database(path.join(DATA_DIR, 'rdm.db'));
sql.pragma('journal_mode = WAL');
sql.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────────────────────
sql.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    role          TEXT NOT NULL DEFAULT 'researcher',
    password_hash TEXT NOT NULL,
    active        INTEGER NOT NULL DEFAULT 1,
    created       TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS datasets (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    doi           TEXT UNIQUE NOT NULL,
    title         TEXT NOT NULL,
    description   TEXT NOT NULL,
    creator_name  TEXT,
    creator_orcid TEXT,
    keywords      TEXT NOT NULL DEFAULT '[]',
    license       TEXT NOT NULL,
    access        TEXT NOT NULL DEFAULT 'open',
    format        TEXT,
    size          INTEGER DEFAULT 0,
    version       INTEGER DEFAULT 1,
    created       TEXT NOT NULL,
    updated       TEXT NOT NULL,
    fair_f        INTEGER DEFAULT 0,
    fair_a        INTEGER DEFAULT 0,
    fair_i        INTEGER DEFAULT 0,
    fair_r        INTEGER DEFAULT 0,
    downloads     INTEGER DEFAULT 0,
    views         INTEGER DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'draft',
    user_id       INTEGER REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token   TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    exp     INTEGER NOT NULL,
    role    TEXT NOT NULL,
    type    TEXT
  );

  CREATE TABLE IF NOT EXISTS logs (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ts      TEXT NOT NULL,
    method  TEXT,
    path    TEXT,
    status  INTEGER,
    ms      INTEGER,
    user_id INTEGER
  );
`);

// ── Schema migrations (add new columns if not present) ───────────────────────
const datasetNewCols = [
  ["embargo_until", "TEXT"],
  ["reject_comment", "TEXT"],
  ["related_ids", "TEXT DEFAULT '[]'"],
  ["file_path", "TEXT"],
  ["file_name", "TEXT"],
  ["file_mime", "TEXT"],
  ["file_size", "INTEGER DEFAULT 0"],
  // TU Wien / FAIR enhancements
  ["resource_type", "TEXT DEFAULT 'Dataset'"],
  ["funder_name", "TEXT"],
  ["funder_grant_id", "TEXT"],
  ["spatial", "TEXT"],
  ["title_ky", "TEXT"],
  ["title_ru", "TEXT"],
  ["description_ky", "TEXT"],
  ["description_ru", "TEXT"],
];
for (const [col, def] of datasetNewCols) {
  try { sql.exec(`ALTER TABLE datasets ADD COLUMN ${col} ${def}`); } catch (e) { /* already exists */ }
}

// ── DMP table ─────────────────────────────────────────────────────────────────
sql.exec(`
  CREATE TABLE IF NOT EXISTS dmp (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER UNIQUE NOT NULL REFERENCES users(id),
    data_description TEXT DEFAULT '',
    storage_plan     TEXT DEFAULT '',
    access_control   TEXT DEFAULT '',
    retention_period TEXT DEFAULT '',
    sharing_plan     TEXT DEFAULT '',
    funder           TEXT DEFAULT '',
    created          TEXT NOT NULL,
    updated          TEXT NOT NULL
  );
`);

// ── API keys table ────────────────────────────────────────────────────────────
sql.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   INTEGER NOT NULL REFERENCES users(id),
    key_hash  TEXT UNIQUE NOT NULL,
    name      TEXT NOT NULL,
    created   TEXT NOT NULL,
    last_used TEXT,
    active    INTEGER NOT NULL DEFAULT 1
  );
`);

// ── FTS5 virtual table ────────────────────────────────────────────────────────
sql.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS datasets_fts USING fts5(
    title, description, keywords,
    content=datasets, content_rowid=id
  );
  CREATE TRIGGER IF NOT EXISTS ds_ai AFTER INSERT ON datasets BEGIN
    INSERT INTO datasets_fts(rowid,title,description,keywords) VALUES(new.id,new.title,new.description,new.keywords);
  END;
  CREATE TRIGGER IF NOT EXISTS ds_au AFTER UPDATE ON datasets BEGIN
    INSERT INTO datasets_fts(datasets_fts,rowid,title,description,keywords) VALUES('delete',old.id,old.title,old.description,old.keywords);
    INSERT INTO datasets_fts(rowid,title,description,keywords) VALUES(new.id,new.title,new.description,new.keywords);
  END;
  CREATE TRIGGER IF NOT EXISTS ds_ad AFTER DELETE ON datasets BEGIN
    INSERT INTO datasets_fts(datasets_fts,rowid,title,description,keywords) VALUES('delete',old.id,old.title,old.description,old.keywords);
  END;
`);
sql.exec("INSERT INTO datasets_fts(datasets_fts) VALUES('rebuild')");

// ── Row converters ────────────────────────────────────────────────────────────
function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id, name: row.name, email: row.email,
    role: row.role, passwordHash: row.password_hash,
    active: !!row.active, created: row.created,
  };
}

function rowToDataset(row) {
  if (!row) return null;
  return {
    id: row.id, doi: row.doi, title: row.title, description: row.description,
    creator: { name: row.creator_name, orcid: row.creator_orcid },
    keywords: JSON.parse(row.keywords || '[]'),
    license: row.license, access: row.access, format: row.format,
    size: row.size, version: row.version,
    created: row.created, updated: row.updated,
    fair: { F: row.fair_f, A: row.fair_a, I: row.fair_i, R: row.fair_r },
    downloads: row.downloads, views: row.views,
    status: row.status, userId: row.user_id,
    embargoUntil: row.embargo_until || null,
    rejectComment: row.reject_comment || null,
    relatedIds: JSON.parse(row.related_ids || '[]'),
    file: row.file_path ? { path: row.file_path, name: row.file_name, mime: row.file_mime, size: row.file_size || 0 } : null,
    // TU Wien / FAIR enhancements
    resourceType: row.resource_type || 'Dataset',
    funder: row.funder_name ? { name: row.funder_name, grantId: row.funder_grant_id || '' } : null,
    spatial: row.spatial ? JSON.parse(row.spatial) : null,
    titleKy: row.title_ky || null,
    titleRu: row.title_ru || null,
    descriptionKy: row.description_ky || null,
    descriptionRu: row.description_ru || null,
  };
}

// ── Seed ─────────────────────────────────────────────────────────────────────
if (sql.prepare('SELECT COUNT(*) as c FROM users').get().c === 0) {
  const insertUser = sql.prepare(
    'INSERT INTO users (name,email,role,password_hash,active,created) VALUES (?,?,?,?,?,?)'
  );
  insertUser.run('Admin KSTU',    'admin@kstu.kg',      'admin',      sha256('admin123'), 1, '2024-01-01T00:00:00Z');
  insertUser.run('Researcher A',  'researcher@kstu.kg', 'researcher', sha256('pass123'),  1, '2024-03-01T00:00:00Z');

  const insertDs = sql.prepare(`
    INSERT INTO datasets
      (doi,title,description,creator_name,creator_orcid,keywords,license,access,format,
       size,version,created,updated,fair_f,fair_a,fair_i,fair_r,downloads,views,status,user_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  const seeds = [
    { doi:'10.48436/rdm-001', title:'Air Quality Measurements Bishkek 2024',
      description:'Hourly PM2.5, NO2, CO measurements from 12 stations across Bishkek city',
      cname:'Research Team KSTU',orcid:'0000-0002-1234-5678',
      kw:['air quality','Bishkek','PM2.5','environment','monitoring'],
      lic:'CC-BY-4.0', acc:'open', fmt:'text/csv', size:48200, ver:3,
      cr:'2024-03-15T09:00:00Z', up:'2024-11-20T14:30:00Z',
      fair:[98,95,87,92], dl:142, vi:890, st:'published', uid:2 },
    { doi:'10.48436/rdm-002', title:'Soil Composition Analysis — Chui Valley',
      description:'Chemical composition of agricultural soils across 8 districts, 240 sample points',
      cname:'Environmental Lab KSTU', orchid:'0000-0001-9876-5432',
      kw:['soil','agriculture','chemistry','Chui Valley','Kyrgyzstan'],
      lic:'CC-BY-NC-SA-4.0', acc:'open', fmt:'application/json', size:12500, ver:1,
      cr:'2024-06-10T11:00:00Z', up:'2024-06-10T11:00:00Z',
      fair:[90,88,95,85], dl:67, vi:340, st:'published', uid:2 },
    { doi:'10.48436/rdm-003', title:'Water Quality Dataset — Issyk-Kul Lake 2023–2024',
      description:'Temperature, pH, dissolved oxygen, turbidity monitoring at 24 stations',
      cname:'Hydrology Dept KSTU', orchid:'0000-0003-1111-2222',
      kw:['water','Issyk-Kul','hydrology','monitoring','lake'],
      lic:'CC0-1.0', acc:'open', fmt:'application/vnd.ms-excel', size:87600, ver:2,
      cr:'2024-01-05T08:00:00Z', up:'2024-09-01T12:00:00Z',
      fair:[100,100,78,95], dl:203, vi:1420, st:'published', uid:1 },
    { doi:'10.48436/rdm-004', title:'Mountain Glacier Mass Balance 2020–2024',
      description:'Annual mass balance measurements for 15 glaciers in Tian-Shan range',
      cname:'Glaciology Lab KSTU', orchid:'0000-0004-5555-6666',
      kw:['glaciers','Tian-Shan','climate change','mass balance'],
      lic:'CC-BY-4.0', acc:'open', fmt:'text/csv', size:24300, ver:1,
      cr:'2024-10-01T10:00:00Z', up:'2024-10-15T09:00:00Z',
      fair:[88,92,80,88], dl:31, vi:210, st:'draft', uid:2 },
  ];

  for (const s of seeds) {
    insertDs.run(
      s.doi, s.title, s.description, s.cname, s.orchid || s.orcid,
      JSON.stringify(s.kw), s.lic, s.acc, s.fmt, s.size, s.ver,
      s.cr, s.up, s.fair[0], s.fair[1], s.fair[2], s.fair[3],
      s.dl, s.vi, s.st, s.uid
    );
  }
}

// ── Users ─────────────────────────────────────────────────────────────────────
function findUserByEmail(email) {
  return rowToUser(sql.prepare('SELECT * FROM users WHERE email = ?').get(email));
}

function findUserById(id) {
  return rowToUser(sql.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

function getAllUsers() {
  return sql.prepare('SELECT * FROM users').all().map(rowToUser);
}

function createUser({ name, email, role, passwordHash, active, created }) {
  const r = sql.prepare(
    'INSERT INTO users (name,email,role,password_hash,active,created) VALUES (?,?,?,?,?,?)'
  ).run(name, email, role || 'researcher', passwordHash, active ? 1 : 0, created);
  return findUserById(r.lastInsertRowid);
}

function updateUser(id, fields) {
  const allowed = ['name', 'email', 'role', 'active'];
  const sets = [], vals = [];
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'passwordHash') { sets.push('password_hash = ?'); vals.push(v); }
    else if (allowed.includes(k)) { sets.push(`${k} = ?`); vals.push(k === 'active' ? (v ? 1 : 0) : v); }
  }
  if (!sets.length) return findUserById(id);
  vals.push(id);
  sql.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return findUserById(id);
}

function deleteUser(id) {
  sql.prepare('DELETE FROM users WHERE id = ?').run(id);
}

// ── Sessions ──────────────────────────────────────────────────────────────────
function getSession(token) {
  const row = sql.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!row) return null;
  return { userId: row.user_id, exp: row.exp, role: row.role, type: row.type || undefined };
}

function setSession(token, { userId, exp, role, type }) {
  sql.prepare(
    'INSERT OR REPLACE INTO sessions (token,user_id,exp,role,type) VALUES (?,?,?,?,?)'
  ).run(token, userId, exp, role, type || null);
}

function deleteSession(token) {
  sql.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function countSessions() {
  return sql.prepare('SELECT COUNT(*) as c FROM sessions').get().c;
}

// ── Datasets ──────────────────────────────────────────────────────────────────
function getAllDatasets() {
  return sql.prepare('SELECT * FROM datasets ORDER BY id DESC').all().map(rowToDataset);
}

function getDataset(id) {
  return rowToDataset(sql.prepare('SELECT * FROM datasets WHERE id = ?').get(id));
}

function createDataset(data) {
  const fair = calcFAIR(data);
  const fileObj = data.file || null;
  const r = sql.prepare(`
    INSERT INTO datasets
      (doi,title,description,creator_name,creator_orcid,keywords,license,access,format,
       size,version,created,updated,fair_f,fair_a,fair_i,fair_r,downloads,views,status,user_id,
       embargo_until,reject_comment,related_ids,file_path,file_name,file_mime,file_size,
       resource_type,funder_name,funder_grant_id,spatial,
       title_ky,title_ru,description_ky,description_ru)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    data.doi, data.title, data.description,
    data.creator?.name || null, data.creator?.orcid || null,
    JSON.stringify(data.keywords || []),
    data.license, data.access || 'open', data.format || null,
    data.size || 0, data.version || 1,
    data.created, data.updated,
    fair.F, fair.A, fair.I, fair.R,
    data.downloads || 0, data.views || 0,
    data.status || 'draft', data.userId || null,
    data.embargoUntil || null,
    data.rejectComment || null,
    JSON.stringify(data.relatedIds || []),
    fileObj ? fileObj.path : null,
    fileObj ? fileObj.name : null,
    fileObj ? fileObj.mime : null,
    fileObj ? (fileObj.size || 0) : 0,
    data.resourceType || 'Dataset',
    data.funder?.name || null, data.funder?.grantId || null,
    data.spatial ? JSON.stringify(data.spatial) : null,
    data.titleKy || null, data.titleRu || null,
    data.descriptionKy || null, data.descriptionRu || null
  );
  return getDataset(r.lastInsertRowid);
}

function updateDataset(id, data) {
  const ds = getDataset(id);
  if (!ds) return null;
  const merged = { ...ds, ...data, id: ds.id };
  merged.fair = calcFAIR(merged);
  merged.version = (ds.version || 1) + (data.version !== undefined ? 0 : 1);
  if (data.version !== undefined) merged.version = data.version;
  // Handle file merging
  const fileObj = merged.file || null;
  sql.prepare(`
    UPDATE datasets SET
      title=?, description=?, creator_name=?, creator_orcid=?, keywords=?,
      license=?, access=?, format=?, size=?, version=?, updated=?,
      fair_f=?, fair_a=?, fair_i=?, fair_r=?,
      downloads=?, views=?, status=?, user_id=?,
      embargo_until=?, reject_comment=?, related_ids=?,
      file_path=?, file_name=?, file_mime=?, file_size=?,
      resource_type=?, funder_name=?, funder_grant_id=?, spatial=?,
      title_ky=?, title_ru=?, description_ky=?, description_ru=?
    WHERE id=?
  `).run(
    merged.title, merged.description,
    merged.creator?.name || null, merged.creator?.orcid || null,
    JSON.stringify(merged.keywords || []),
    merged.license, merged.access, merged.format,
    merged.size, merged.version, merged.updated,
    merged.fair.F, merged.fair.A, merged.fair.I, merged.fair.R,
    merged.downloads, merged.views, merged.status,
    merged.userId || null,
    merged.embargoUntil || null,
    merged.rejectComment || null,
    JSON.stringify(merged.relatedIds || []),
    fileObj ? fileObj.path : null,
    fileObj ? fileObj.name : null,
    fileObj ? fileObj.mime : null,
    fileObj ? (fileObj.size || 0) : 0,
    merged.resourceType || 'Dataset',
    merged.funder?.name || null, merged.funder?.grantId || null,
    merged.spatial ? JSON.stringify(merged.spatial) : null,
    merged.titleKy || null, merged.titleRu || null,
    merged.descriptionKy || null, merged.descriptionRu || null,
    id
  );
  return getDataset(id);
}

function deleteDataset(id) {
  sql.prepare('DELETE FROM datasets WHERE id = ?').run(id);
}

function incrementViews(id) {
  sql.prepare('UPDATE datasets SET views = views + 1 WHERE id = ?').run(id);
}

function incrementDownloads(id) {
  sql.prepare('UPDATE datasets SET downloads = downloads + 1 WHERE id = ?').run(id);
}

// ── Logs ──────────────────────────────────────────────────────────────────────
function addLog(method, p, status, ms, userId) {
  sql.prepare(
    'INSERT INTO logs (ts,method,path,status,ms,user_id) VALUES (?,?,?,?,?,?)'
  ).run(new Date().toISOString(), method, p, status, ms, userId || null);
  // Keep only last 500
  sql.prepare(`
    DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 500)
  `).run();
}

function getLogs(limit) {
  return sql.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ?').all(limit || 100);
}

function countLogsToday() {
  const today = new Date().toISOString().slice(0, 10);
  return sql.prepare("SELECT COUNT(*) as c FROM logs WHERE ts LIKE ?").get(today + '%').c;
}

// ── API Keys ──────────────────────────────────────────────────────────────────
function getApiKey(keyHash) {
  const row = sql.prepare('SELECT * FROM api_keys WHERE key_hash=? AND active=1').get(keyHash);
  if (!row) return null;
  return { id: row.id, userId: row.user_id, name: row.name, created: row.created, lastUsed: row.last_used };
}

function getUserApiKeys(userId) {
  return sql.prepare('SELECT id,name,created,last_used FROM api_keys WHERE user_id=? AND active=1 ORDER BY id DESC').all(userId)
    .map(r => ({ id: r.id, name: r.name, created: r.created, lastUsed: r.last_used }));
}

function createApiKey(userId, keyHash, name) {
  const r = sql.prepare('INSERT INTO api_keys(user_id,key_hash,name,created) VALUES(?,?,?,?)').run(userId, keyHash, name, new Date().toISOString());
  return r.lastInsertRowid;
}

function revokeApiKey(id, userId) {
  sql.prepare('UPDATE api_keys SET active=0 WHERE id=? AND user_id=?').run(id, userId);
}

function touchApiKey(id) {
  sql.prepare('UPDATE api_keys SET last_used=? WHERE id=?').run(new Date().toISOString(), id);
}

// ── DMP ───────────────────────────────────────────────────────────────────────
function getDmp(userId) {
  const row = sql.prepare('SELECT * FROM dmp WHERE user_id = ?').get(userId);
  if (!row) return null;
  return {
    id: row.id, userId: row.user_id,
    dataDescription: row.data_description,
    storagePlan: row.storage_plan,
    accessControl: row.access_control,
    retentionPeriod: row.retention_period,
    sharingPlan: row.sharing_plan,
    funder: row.funder,
    created: row.created, updated: row.updated,
  };
}

function upsertDmp(userId, data) {
  const now = new Date().toISOString();
  const existing = sql.prepare('SELECT id FROM dmp WHERE user_id = ?').get(userId);
  if (existing) {
    sql.prepare(`
      UPDATE dmp SET
        data_description=?, storage_plan=?, access_control=?,
        retention_period=?, sharing_plan=?, funder=?, updated=?
      WHERE user_id=?
    `).run(
      data.dataDescription || '', data.storagePlan || '',
      data.accessControl || '', data.retentionPeriod || '',
      data.sharingPlan || '', data.funder || '', now, userId
    );
  } else {
    sql.prepare(`
      INSERT INTO dmp
        (user_id,data_description,storage_plan,access_control,retention_period,sharing_plan,funder,created,updated)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      userId, data.dataDescription || '', data.storagePlan || '',
      data.accessControl || '', data.retentionPeriod || '',
      data.sharingPlan || '', data.funder || '', now, now
    );
  }
  return getDmp(userId);
}

// ── FTS Search ────────────────────────────────────────────────────────────────
function searchDatasets(query) {
  try {
    return sql.prepare(
      "SELECT rowid as id FROM datasets_fts WHERE datasets_fts MATCH ? ORDER BY rank LIMIT 100"
    ).all(query + '*').map(r => r.id);
  } catch (e) { return []; }
}

// ── Analytics ─────────────────────────────────────────────────────────────────
function getAnalytics() {
  const datasets = getAllDatasets();
  const users = getAllUsers();
  // API activity: last 14 days from logs
  const rows = sql.prepare(`
    SELECT substr(ts,1,10) as day, COUNT(*) as count
    FROM logs
    WHERE ts >= date('now','-14 days')
    GROUP BY substr(ts,1,10)
    ORDER BY day ASC
  `).all();
  const topDs = [...datasets].sort((a,b) => b.downloads - a.downloads).slice(0, 8);
  return { datasets, users, apiActivity: rows, topDatasets: topDs };
}

module.exports = {
  // users
  findUserByEmail, findUserById, getAllUsers,
  createUser, updateUser, deleteUser,
  // sessions
  getSession, setSession, deleteSession, countSessions,
  // datasets
  getAllDatasets, getDataset,
  createDataset, updateDataset, deleteDataset,
  incrementViews, incrementDownloads,
  // logs
  addLog, getLogs, countLogsToday,
  // api keys
  getApiKey, getUserApiKeys, createApiKey, revokeApiKey, touchApiKey,
  // search
  searchDatasets,
  // analytics
  getAnalytics,
  // dmp
  getDmp, upsertDmp,
};
