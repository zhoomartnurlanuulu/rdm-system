'use strict';
const db = require('./db');
const { sha256 } = require('./utils');

function auth(req, requireRole) {
  const token = getToken(req);
  if (!token) return null;

  // Check session
  const sess = db.getSession(token);
  if (sess && Date.now() <= sess.exp && sess.type !== 'refresh') {
    const user = db.findUserById(sess.userId);
    if (user && user.active) {
      if (requireRole && user.role !== requireRole && user.role !== 'admin') return null;
      return user;
    }
  }

  // Check API key (Bearer token is the raw key)
  const apiKey = db.getApiKey(sha256(token));
  if (apiKey) {
    const user = db.findUserById(apiKey.userId);
    if (user && user.active) {
      db.touchApiKey(apiKey.id);
      if (requireRole && user.role !== requireRole && user.role !== 'admin') return null;
      return user;
    }
  }

  return null;
}

function getToken(req) {
  const h = req.headers['authorization'] || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

module.exports = { auth, getToken };
