// Authentication: session check, login, register, logout, renderAuth
import { state, API } from './state.js';
import { showToast } from './ui.js';

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
const _hero = {};

function _saveHero() {
  if (_hero.saved) return;
  _hero.title   = document.querySelector('.hero-title')?.innerHTML;
  _hero.sub     = document.querySelector('.hero-sub')?.textContent;
  _hero.actions = document.querySelector('.hero-actions')?.innerHTML;
  _hero.lbls    = [...document.querySelectorAll('.hs-lbl')].map(e => e.textContent);
  _hero.saved   = true;
}

function _restoreHero() {
  if (!_hero.saved) return;
  const title   = document.querySelector('.hero-title');
  const sub     = document.querySelector('.hero-sub');
  const actions = document.querySelector('.hero-actions');
  if (title)   title.innerHTML   = _hero.title;
  if (sub)     sub.textContent   = _hero.sub;
  if (actions) actions.innerHTML = _hero.actions;
  document.querySelectorAll('.hs-lbl').forEach((e, i) => { if (_hero.lbls[i]) e.textContent = _hero.lbls[i]; });
  // repopulate from already-loaded global data
  const ds = state.allDatasets || [];
  const total = ds.length;
  const dl    = ds.reduce((s, d) => s + (d.downloads || 0), 0);
  const open  = ds.filter(d => d.access === 'open').length;
  const avgFair = total
    ? Math.round(ds.reduce((s, d) => { const f = d.fair || {}; return s + ((f.F||0)+(f.A||0)+(f.I||0)+(f.R||0))/4; }, 0) / total)
    : 0;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('st-total', total || '–');
  set('st-dl',    dl    || '–');
  set('st-open',  open  || '–');
  set('st-fair',  avgFair ? avgFair + '%' : '–');
}

async function _updateHeroForUser(user) {
  _saveHero();
  const firstName = user.name.split(' ')[0];
  const title   = document.querySelector('.hero-title');
  const sub     = document.querySelector('.hero-sub');
  const actions = document.querySelector('.hero-actions');
  if (title)   title.innerHTML   = `Добро пожаловать, <em>${firstName}</em>`;
  if (sub)     sub.textContent   = 'Ваше пространство для управления исследовательскими данными КГТУ.';
  if (actions) actions.innerHTML = `<button class="btn-primary" onclick="openProfile()">Мои наборы данных →</button>
    <button class="btn-outline" onclick="openSubmit()">Загрузить новый набор</button>`;
  const labelTexts = ['Ваших наборов', 'Скачиваний', 'Опубликовано', 'Средний FAIR'];
  document.querySelectorAll('.hs-lbl').forEach((e, i) => { if (labelTexts[i]) e.textContent = labelTexts[i]; });
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
    a.innerHTML  = `<a class="nav-avatar" href="/dashboard.html" title="Личный кабинет">${initials}</a>
                    <button class="nav-btn outline" onclick="doLogout()">Выйти</button>`;
    if (ma) ma.innerHTML = `<a class="nav-avatar" href="/dashboard.html" title="Личный кабинет">${initials}</a>
                             <button class="nav-btn outline" onclick="closeMobileNavFull();doLogout()">Выйти</button>`;
    const btn = document.getElementById('submitBtn');
    if (btn) btn.style.display = 'block';
    _updateHeroForUser(state.currentUser);
  } else {
    a.innerHTML  = `<button class="nav-btn outline" onclick="openLogin()">Войти</button>
                    <button class="nav-btn" onclick="openRegister()">Регистрация</button>`;
    if (ma) ma.innerHTML = `<button class="nav-btn outline" onclick="closeMobileNavFull();openLogin()">Войти</button>
                             <button class="nav-btn" onclick="closeMobileNavFull();openRegister()">Регистрация</button>`;
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
  if (!email || !pass) { err.textContent = 'Заполните все поля'; return; }
  try {
    const r = await fetch(API + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass }),
    });
    const data = await r.json();
    if (!r.ok) { err.textContent = data.error || 'Ошибка входа'; return; }
    state.pubToken = data.token;
    sessionStorage.setItem('rdm-pub-token', state.pubToken);
    state.currentUser = data.user;
    closeLogin();
    renderAuth();
    showToast('Добро пожаловать, ' + state.currentUser.name + '!');
  } catch (e) { err.textContent = 'Нет соединения с сервером'; }
}

export async function doRegister() {
  const name  = document.getElementById('rName').value.trim();
  const email = document.getElementById('rEmail').value.trim();
  const pass  = document.getElementById('rPass').value;
  const err   = document.getElementById('rError');
  if (!name || !email || !pass) { err.textContent = 'Заполните все поля'; return; }
  try {
    const r = await fetch(API + '/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password: pass }),
    });
    const data = await r.json();
    if (!r.ok) { err.textContent = data.error || 'Ошибка регистрации'; return; }
    state.pubToken = data.token;
    sessionStorage.setItem('rdm-pub-token', state.pubToken);
    state.currentUser = data.user;
    closeRegister();
    renderAuth();
    showToast('Аккаунт создан! Добро пожаловать, ' + state.currentUser.name + '!');
  } catch (e) { err.textContent = 'Нет соединения с сервером'; }
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
  if (!title || !desc) { err.textContent = 'Заполните обязательные поля'; return; }
  const body = {
    title, description: desc,
    creator:  { name: document.getElementById('sf-author').value.trim() || 'Anonymous' },
    keywords: document.getElementById('sf-kw').value.split(',').map(s => s.trim()).filter(Boolean),
    license:  document.getElementById('sf-lic').value,
    access:   'open',
  };
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (state.pubToken) headers['Authorization'] = 'Bearer ' + state.pubToken;
    const r = await fetch(API + '/api/datasets', { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) { err.textContent = data.error || 'Ошибка'; return; }
    closeSubmit();
    // trigger catalog reload via custom event
    window.dispatchEvent(new CustomEvent('rdm:datasetsChanged'));
  } catch (e) { err.textContent = 'Нет соединения с сервером'; }
}
