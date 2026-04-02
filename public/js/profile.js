// Profile panel: dashboard tab, settings tab, api keys tab, edit dataset modal
import { state, API } from './state.js';
import { showToast } from './ui.js';
import { renderAuth } from './auth.js';
import { loadDatasets } from './catalog.js';

// ── Panel open/close ──────────────────────────────────────────────────────────
export function openProfile() {
  document.getElementById('profilePanel').classList.add('open');
  document.getElementById('profileOverlay').classList.add('open');
  switchPfTab('dashboard', document.querySelector('.pf-tab'));
  loadProfile();
}

export function closeProfile() {
  document.getElementById('profilePanel').classList.remove('open');
  document.getElementById('profileOverlay').classList.remove('open');
}

// ── Tab switching ─────────────────────────────────────────────────────────────
export function switchPfTab(id, btn) {
  document.querySelectorAll('.pf-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.pf-tab-content').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const tab = document.getElementById('pf-tab-' + id);
  if (tab) tab.classList.add('active');
  if (id === 'settings' && state.currentUser) {
    document.getElementById('set-name').value      = state.currentUser.name  || '';
    document.getElementById('set-email').value     = state.currentUser.email || '';
    document.getElementById('set-cur-pass').value  = '';
    document.getElementById('set-new-pass').value  = '';
    document.getElementById('set-conf-pass').value = '';
    document.getElementById('set-profile-msg').className = 'pf-msg';
    document.getElementById('set-pass-msg').className    = 'pf-msg';
  }
  if (id === 'keys') loadApiKeys();
}

function showPfMsg(id, text, type) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = 'pf-msg ' + type;
}

// ── Dashboard tab ─────────────────────────────────────────────────────────────
export async function loadProfile() {
  if (!state.currentUser) return;
  const initials = state.currentUser.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const since    = state.currentUser.created ? state.currentUser.created.slice(0, 4) : '–';
  const roleLabel = state.currentUser.role === 'researcher' ? 'Исследователь' : state.currentUser.role;
  document.getElementById('pf-user').innerHTML = `
    <div class="pf-avatar">${initials}</div>
    <div>
      <div class="pf-uname">${state.currentUser.name}</div>
      <div class="pf-uemail">${state.currentUser.email}</div>
      <div class="pf-urole">● ${roleLabel} · с ${since}</div>
    </div>`;

  const list    = document.getElementById('pf-ds-list');
  const statsEl = document.getElementById('pf-stats');
  try {
    const r = await fetch(API + '/api/my/datasets', {
      headers: state.pubToken ? { 'Authorization': 'Bearer ' + state.pubToken } : {},
    });
    if (!r.ok) throw new Error();
    const { datasets } = await r.json();
    const totalDl    = datasets.reduce((s, d) => s + d.downloads, 0);
    const totalViews = datasets.reduce((s, d) => s + d.views, 0);
    statsEl.innerHTML = `
      <div class="pf-stat"><div class="pf-stat-n">${datasets.length}</div><div class="pf-stat-l">Наборов</div></div>
      <div class="pf-stat"><div class="pf-stat-n">${totalDl}</div><div class="pf-stat-l">Скачиваний</div></div>
      <div class="pf-stat"><div class="pf-stat-n">${totalViews}</div><div class="pf-stat-l">Просмотров</div></div>`;
    if (!datasets.length) {
      list.innerHTML = '<div class="pf-empty">У вас пока нет наборов данных</div>';
      return;
    }
    const editIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    list.innerHTML = datasets.map(d => {
      const fairAvg = Math.round((d.fair.F + d.fair.A + d.fair.I + d.fair.R) / 4);
      const statusMap = { published: '● Опубл.', draft: '◐ Черновик', rejected: '✕ Отклонён' };
      const statusClass = { published: 'pub', draft: 'draft', rejected: 'rejected' };
      const isRejected = d.status === 'rejected';
      return `<div class="pf-ds ${isRejected ? 'pf-ds-rejected' : ''}">
        <div class="pf-ds-top" onclick="closeProfile();openDetail(${d.id})" style="cursor:pointer">
          <div class="pf-ds-title">${d.title}</div>
          <span class="pf-ds-status ${statusClass[d.status] || 'draft'}">${statusMap[d.status] || d.status}</span>
        </div>
        ${isRejected && d.rejectComment ? `<div class="pf-reject-comment">💬 ${d.rejectComment}</div>` : ''}
        <div class="pf-ds-meta" onclick="closeProfile();openDetail(${d.id})" style="cursor:pointer">
          <span>↓ ${d.downloads}</span><span>👁 ${d.views}</span>
          <span>FAIR ${fairAvg}%</span><span>${d.doi || '–'}</span>
        </div>
        <div class="pf-ds-actions">
          <button class="pf-edit-btn" onclick="openEditDs(${d.id})">${editIcon} Редактировать</button>
          ${isRejected ? `<button class="pf-resubmit-btn" onclick="resubmitDs(${d.id})">↺ Переподать</button>` : ''}
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = '<div class="pf-empty">Ошибка загрузки данных</div>';
  }
}

// Resubmit rejected dataset → set status back to draft
export async function resubmitDs(id) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (state.pubToken) headers['Authorization'] = 'Bearer ' + state.pubToken;
    const r = await fetch(API + `/api/my/datasets/${id}`, {
      method: 'PUT', headers,
      body: JSON.stringify({ status: 'draft' }),
    });
    if (r.ok) { showToast('Набор данных возвращён в черновики', 'success'); loadProfile(); }
    else { const d = await r.json(); showToast(d.error || 'Ошибка', 'error'); }
  } catch { showToast('Нет соединения', 'error'); }
}

// ── Settings tab ──────────────────────────────────────────────────────────────
export async function saveProfile() {
  const name  = document.getElementById('set-name').value.trim();
  const email = document.getElementById('set-email').value.trim();
  if (!name || !email) { showPfMsg('set-profile-msg', 'Заполните все поля', 'err'); return; }
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (state.pubToken) headers['Authorization'] = 'Bearer ' + state.pubToken;
    const r = await fetch(API + '/api/me', { method: 'PUT', headers, body: JSON.stringify({ name, email }) });
    const data = await r.json();
    if (!r.ok) { showPfMsg('set-profile-msg', data.error || 'Ошибка', 'err'); return; }
    state.currentUser = { ...state.currentUser, name: data.name, email: data.email };
    renderAuth();
    loadProfile();
    showPfMsg('set-profile-msg', 'Данные обновлены', 'ok');
  } catch (e) { showPfMsg('set-profile-msg', 'Нет соединения', 'err'); }
}

export async function savePassword() {
  const cur = document.getElementById('set-cur-pass').value;
  const nw  = document.getElementById('set-new-pass').value;
  const cf  = document.getElementById('set-conf-pass').value;
  if (!cur || !nw || !cf) { showPfMsg('set-pass-msg', 'Заполните все поля', 'err'); return; }
  if (nw !== cf) { showPfMsg('set-pass-msg', 'Пароли не совпадают', 'err'); return; }
  if (nw.length < 6) { showPfMsg('set-pass-msg', 'Минимум 6 символов', 'err'); return; }
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (state.pubToken) headers['Authorization'] = 'Bearer ' + state.pubToken;
    const r = await fetch(API + '/api/me/password', { method: 'PUT', headers, body: JSON.stringify({ currentPassword: cur, newPassword: nw }) });
    const data = await r.json();
    if (!r.ok) { showPfMsg('set-pass-msg', data.error || 'Ошибка', 'err'); return; }
    ['set-cur-pass', 'set-new-pass', 'set-conf-pass'].forEach(id => { document.getElementById(id).value = ''; });
    showPfMsg('set-pass-msg', 'Пароль успешно изменён', 'ok');
  } catch (e) { showPfMsg('set-pass-msg', 'Нет соединения', 'err'); }
}

// ── API Keys tab ──────────────────────────────────────────────────────────────
export async function loadApiKeys() {
  const el = document.getElementById('pf-keys-list');
  if (!el) return;
  el.innerHTML = '<div class="pf-empty">Загрузка...</div>';
  try {
    const headers = state.pubToken ? { 'Authorization': 'Bearer ' + state.pubToken } : {};
    const r = await fetch(API + '/api/keys', { headers });
    if (!r.ok) throw new Error();
    const keys = await r.json();
    if (!keys.length) {
      el.innerHTML = '<div class="pf-empty">У вас нет API-ключей</div>';
      return;
    }
    el.innerHTML = keys.map(k => `
      <div class="pf-key-item">
        <div class="pf-key-info">
          <div class="pf-key-name">${k.name}</div>
          <div class="pf-key-meta">
            Создан ${k.created ? k.created.slice(0,10) : '–'}
            ${k.lastUsed ? ` · Использован ${k.lastUsed.slice(0,10)}` : ' · Не использован'}
          </div>
        </div>
        <button class="pf-key-revoke" onclick="revokeApiKey(${k.id})">Отозвать</button>
      </div>`).join('');
  } catch { el.innerHTML = '<div class="pf-empty">Ошибка загрузки</div>'; }
}

export async function createApiKey() {
  const nameEl = document.getElementById('pf-key-name');
  const msgEl  = document.getElementById('pf-key-msg');
  const newKeyEl = document.getElementById('pf-new-key');
  const name = nameEl?.value.trim();
  if (!name) { if (msgEl) { msgEl.textContent = 'Введите название'; msgEl.className = 'pf-msg err'; } return; }
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (state.pubToken) headers['Authorization'] = 'Bearer ' + state.pubToken;
    const r = await fetch(API + '/api/keys', { method: 'POST', headers, body: JSON.stringify({ name }) });
    const data = await r.json();
    if (!r.ok) { if (msgEl) { msgEl.textContent = data.error || 'Ошибка'; msgEl.className = 'pf-msg err'; } return; }
    // Show the key once
    if (newKeyEl) {
      newKeyEl.textContent = data.key;
      newKeyEl.style.display = 'block';
    }
    if (msgEl) { msgEl.textContent = 'Ключ создан! Скопируйте его сейчас — он больше не будет показан.'; msgEl.className = 'pf-msg ok'; }
    if (nameEl) nameEl.value = '';
    loadApiKeys();
  } catch { if (msgEl) { msgEl.textContent = 'Нет соединения'; msgEl.className = 'pf-msg err'; } }
}

export async function revokeApiKey(id) {
  try {
    const headers = state.pubToken ? { 'Authorization': 'Bearer ' + state.pubToken } : {};
    const r = await fetch(API + `/api/keys/${id}`, { method: 'DELETE', headers });
    if (r.ok) { showToast('API-ключ отозван', 'success'); loadApiKeys(); }
  } catch { showToast('Ошибка', 'error'); }
}

// ── Edit dataset modal ────────────────────────────────────────────────────────
export async function openEditDs(id) {
  document.getElementById('edit-ds-id').value = id;
  document.getElementById('editDsErr').textContent = '';
  document.getElementById('editDsModal').classList.add('open');
  try {
    const r  = await fetch(API + `/api/datasets/${id}`);
    const ds = r.ok ? await r.json() : null;
    if (ds) {
      document.getElementById('edit-title').value  = ds.title || '';
      document.getElementById('edit-author').value = ds.creator?.name || '';
      document.getElementById('edit-desc').value   = ds.description || '';
      document.getElementById('edit-kw').value     = (ds.keywords || []).join(', ');
      document.getElementById('edit-lic').value    = ds.license || 'CC-BY-4.0';
    }
  } catch (e) { /* prefill failed */ }
}

export function closeEditDs() { document.getElementById('editDsModal').classList.remove('open'); }

export async function doEditDs() {
  const id    = parseInt(document.getElementById('edit-ds-id').value);
  const title = document.getElementById('edit-title').value.trim();
  const desc  = document.getElementById('edit-desc').value.trim();
  const err   = document.getElementById('editDsErr');
  if (!title || !desc) { err.textContent = 'Заполните обязательные поля'; return; }
  const body = {
    title, description: desc,
    creator:  { name: document.getElementById('edit-author').value.trim() },
    keywords: document.getElementById('edit-kw').value.split(',').map(s => s.trim()).filter(Boolean),
    license:  document.getElementById('edit-lic').value,
  };
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (state.pubToken) headers['Authorization'] = 'Bearer ' + state.pubToken;
    const r = await fetch(API + `/api/my/datasets/${id}`, { method: 'PUT', headers, body: JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) { err.textContent = data.error || 'Ошибка сохранения'; return; }
    closeEditDs();
    showToast('Изменения сохранены', 'success');
    await loadDatasets();
    openProfile();
  } catch (e) { err.textContent = 'Нет соединения с сервером'; }
}
