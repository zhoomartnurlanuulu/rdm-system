// Authentication: session check, login, register, logout, renderAuth
import { state, API } from './state.js';
import { showToast } from './ui.js';
import { t } from './i18n.js';

export async function checkSession() {
  if (!state.pubToken) return;
  try {
    const r = await fetch(API + '/api/me', { headers: { 'Authorization': 'Bearer ' + state.pubToken } });
    if (r.ok) {
      state.currentUser = await r.json();
      renderAuth();
    } else {
      state.pubToken = null;
      sessionStorage.removeItem('rdm-pub-token');
    }
  } catch (e) { /* no connection */ }
}

// ── Hero personalization ───────────────────────────────────────────────────────
// We don't snapshot the rendered HTML — instead we restore the original i18n
// markup so that the current language is respected on logout/language-change.
const _ORIG_HERO = {
  title:   `<span data-i18n="hero.title" data-i18n-html></span>`,
  sub:     `<span data-i18n="hero.sub"></span>`,
  actions: `<a class="btn-primary" href="#catalog" data-i18n="hero.btn.catalog"></a><button class="btn-outline" onclick="openRegister()" data-i18n="hero.btn.reg"></button>`,
  lbls:    ['hero.lbl.total', 'hero.lbl.dl', 'hero.lbl.open', 'hero.lbl.fair'],
};

async function _restoreHero() {
  // Restore i18n-driven markup and let i18n re-apply translations
  const titleEl   = document.querySelector('.hero-title');
  const subEl     = document.querySelector('.hero-sub');
  const actionsEl = document.querySelector('.hero-actions');
  if (titleEl) {
    titleEl.setAttribute('data-i18n', 'hero.title');
    titleEl.setAttribute('data-i18n-html', '');
  }
  if (subEl) subEl.setAttribute('data-i18n', 'hero.sub');
  if (actionsEl) actionsEl.innerHTML = _ORIG_HERO.actions;
  document.querySelectorAll('.hs-lbl').forEach((el, i) => {
    if (_ORIG_HERO.lbls[i]) el.setAttribute('data-i18n', _ORIG_HERO.lbls[i]);
  });
  // Re-apply current language to refresh translated text
  const { applyLang, currentLang } = await import('./i18n.js');
  applyLang(currentLang);
  // Fetch fresh global platform stats (anonymous view)
  _fetchGlobalStats();
}

async function _fetchGlobalStats() {
  try {
    const r = await fetch(API + '/api/stats');
    if (!r.ok) return;
    const s = await r.json();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('st-total', s.total ?? '–');
    set('st-dl',    s.downloads ?? '–');
    set('st-open',  s.open ?? '–');
    const avg = Math.round(((s.fair?.F || 0) + (s.fair?.A || 0) + (s.fair?.I || 0) + (s.fair?.R || 0)) / 4);
    set('st-fair', avg ? avg + '%' : '0%');
  } catch (e) { /* silent */ }
}

async function _updateHeroForUser(user) {
  const firstName = user.name.split(' ')[0];
  const title   = document.querySelector('.hero-title');
  const sub     = document.querySelector('.hero-sub');
  const actions = document.querySelector('.hero-actions');
  // Remove data-i18n so applyLang doesn't overwrite our personalised content
  [title, sub].forEach(el => { if (!el) return; el.removeAttribute('data-i18n'); el.removeAttribute('data-i18n-html'); });
  if (title)   title.innerHTML   = `${t('user.welcome')}, <em>${firstName}</em>`;
  if (sub)     sub.textContent   = t('user.hero.sub');
  if (actions) actions.innerHTML = `<a class="btn-primary" href="/dashboard.html">${t('user.my.datasets')}</a>
    <button class="btn-outline" onclick="openSubmit()">${t('user.upload.new')}</button>`;
  document.querySelectorAll('.hs-lbl').forEach((el, i) => {
    el.removeAttribute('data-i18n');
    const keys = ['user.hs.total', 'user.hs.dl', 'user.hs.pub', 'user.hs.fair'];
    if (keys[i]) el.textContent = t(keys[i]);
  });
  // fetch personal stats
  try {
    const headers = state.pubToken ? { 'Authorization': 'Bearer ' + state.pubToken } : {};
    const r = await fetch(API + '/api/my/datasets', { headers });
    if (!r.ok) return;
    const { datasets } = await r.json();
    const total = datasets.length;
    const dl    = datasets.reduce((s, d) => s + (d.downloads || 0), 0);
    const pub   = datasets.filter(d => d.status === 'published').length;
    const avgFair = total
      ? Math.round(datasets.reduce((s, d) => { const f = d.fair || {}; return s + ((f.F||0)+(f.A||0)+(f.I||0)+(f.R||0))/4; }, 0) / total)
      : 0;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('st-total', total);
    set('st-dl',    dl);
    set('st-open',  pub);
    set('st-fair',  avgFair ? avgFair + '%' : '0%');
  } catch (e) { /* keep showing current values */ }
}

export function renderAuth() {
  const a  = document.getElementById('authArea');
  const ma = document.getElementById('mobileAuthBtns');
  if (state.currentUser) {
    const initials = state.currentUser.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    a.innerHTML  = `<a class="nav-avatar" href="/dashboard.html" title="${t('user.dashboard')}">${initials}</a>
                    <button class="nav-btn outline" onclick="doLogout()">${t('nav.logout')}</button>`;
    if (ma) ma.innerHTML = `<a class="nav-avatar" href="/dashboard.html" title="${t('user.dashboard')}">${initials}</a>
                             <button class="nav-btn outline" onclick="closeMobileNavFull();doLogout()">${t('nav.logout')}</button>`;
    const btn = document.getElementById('submitBtn');
    if (btn) btn.style.display = 'block';
    _updateHeroForUser(state.currentUser);
  } else {
    a.innerHTML  = `<button class="nav-btn outline" onclick="openLogin()">${t('nav.login')}</button>
                    <button class="nav-btn" onclick="openRegister()">${t('nav.register')}</button>`;
    if (ma) ma.innerHTML = `<button class="nav-btn outline" onclick="closeMobileNavFull();openLogin()">${t('nav.login')}</button>
                             <button class="nav-btn" onclick="closeMobileNavFull();openRegister()">${t('nav.register')}</button>`;
    const btn = document.getElementById('submitBtn');
    if (btn) btn.style.display = 'none';
    _restoreHero();
  }
}

export function openLogin()    { document.getElementById('loginModal').classList.add('open'); }
export function closeLogin()   { document.getElementById('loginModal').classList.remove('open'); }
export function openRegister() { document.getElementById('registerModal').classList.add('open'); }
export function closeRegister(){ document.getElementById('registerModal').classList.remove('open'); }
export function openSubmit()   { document.getElementById('submitModal').classList.add('open'); }
export function closeSubmit()  { document.getElementById('submitModal').classList.remove('open'); }

export async function doLogin() {
  const email = document.getElementById('lEmail').value.trim();
  const pass  = document.getElementById('lPass').value;
  const err   = document.getElementById('lError');
  if (!email || !pass) { err.textContent = t('err.fill.all'); return; }
  try {
    const r = await fetch(API + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass }),
    });
    const data = await r.json();
    if (!r.ok) { err.textContent = data.error || t('err.login'); return; }
    state.pubToken = data.token;
    sessionStorage.setItem('rdm-pub-token', state.pubToken);
    state.currentUser = data.user;
    closeLogin();
    renderAuth();
    showToast(t('user.welcome') + ', ' + state.currentUser.name + '!');
  } catch (e) { err.textContent = t('err.network'); }
}

export async function doRegister() {
  const name  = document.getElementById('rName').value.trim();
  const email = document.getElementById('rEmail').value.trim();
  const pass  = document.getElementById('rPass').value;
  const err   = document.getElementById('rError');
  if (!name || !email || !pass) { err.textContent = t('err.fill.all'); return; }
  try {
    const r = await fetch(API + '/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password: pass }),
    });
    const data = await r.json();
    if (!r.ok) { err.textContent = data.error || t('err.register'); return; }
    state.pubToken = data.token;
    sessionStorage.setItem('rdm-pub-token', state.pubToken);
    state.currentUser = data.user;
    closeRegister();
    renderAuth();
    showToast(t('user.acc.created') + ' ' + state.currentUser.name + '!');
  } catch (e) { err.textContent = t('err.network'); }
}

export async function doLogout() {
  try {
    await fetch(API + '/api/logout', {
      method: 'POST',
      headers: state.pubToken ? { 'Authorization': 'Bearer ' + state.pubToken } : {},
    });
  } catch (e) { /* ignore */ }
  state.pubToken = null;
  state.currentUser = null;
  sessionStorage.removeItem('rdm-pub-token');
  renderAuth();
}

export async function doSubmit() {
  const title = document.getElementById('sf-title').value.trim();
  const desc  = document.getElementById('sf-desc').value.trim();
  const err   = document.getElementById('sError');
  if (!title || !desc) { err.textContent = t('err.required'); return; }
  const funderName = document.getElementById('sf-funder')?.value.trim();
  const grantId    = document.getElementById('sf-grant')?.value.trim();
  const spatialDesc = document.getElementById('sf-spatial')?.value.trim();
  const body = {
    title, description: desc,
    creator:      { name: document.getElementById('sf-author').value.trim() || 'Anonymous', orcid: document.getElementById('sf-orcid')?.value.trim() || undefined },
    keywords:     document.getElementById('sf-kw').value.split(',').map(s => s.trim()).filter(Boolean),
    license:      document.getElementById('sf-lic').value,
    access:       'open',
    resourceType: document.getElementById('sf-type')?.value || 'Dataset',
    titleRu:      document.getElementById('sf-title-ru')?.value.trim() || undefined,
    titleKy:      document.getElementById('sf-title-ky')?.value.trim() || undefined,
    funder:       funderName ? { name: funderName, grantId: grantId || '' } : undefined,
    spatial:      spatialDesc ? { description: spatialDesc } : undefined,
  };
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (state.pubToken) headers['Authorization'] = 'Bearer ' + state.pubToken;
    const r = await fetch(API + '/api/datasets', { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) { err.textContent = data.error || t('toast.error.generic'); return; }
    closeSubmit();
    // trigger catalog reload via custom event
    window.dispatchEvent(new CustomEvent('rdm:datasetsChanged'));
  } catch (e) { err.textContent = t('err.network'); }
}
