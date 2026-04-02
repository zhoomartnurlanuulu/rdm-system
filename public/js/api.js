// HTTP client — wraps fetch with auth token injection
import { state, API } from './state.js';

export async function apiFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (state.pubToken) headers['Authorization'] = 'Bearer ' + state.pubToken;
  return fetch(API + path, { ...opts, headers });
}

export async function apiJSON(path, opts = {}) {
  const r = await apiFetch(path, opts);
  const data = await r.json();
  return { ok: r.ok, status: r.status, data };
}
