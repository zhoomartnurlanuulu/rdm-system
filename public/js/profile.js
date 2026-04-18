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
  if (id === 'dmp')  loadDmp();
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
      const isDraft = d.status === 'draft';
      const isPublished = d.status === 'published';
      return `<div class="pf-ds ${isRejected ? 'pf-ds-rejected' : ''}">
        <div class="pf-ds-top" onclick="closeProfile();openDetail(${d.id})" style="cursor:pointer">
          <div class="pf-ds-title">${d.title}</div>
          <span class="pf-ds-status ${statusClass[d.status] || 'draft'}">${statusMap[d.status] || d.status}</span>
        </div>
        ${isRejected && d.rejectComment ? `<div class="pf-reject-comment">💬 ${d.rejectComment}</div>` : ''}
        <div class="pf-ds-meta" onclick="closeProfile();openDetail(${d.id})" style="cursor:pointer">
          <span>↓ ${d.downloads}</span><span>👁 ${d.views}</span>
          <span>FAIR ${fairAvg}%</span><span style="font-family:var(--mono);font-size:10px">${d.doi || '–'}</span>
        </div>
        <div class="pf-ds-fair-bar">
          <div class="pf-ds-fair-seg" style="width:${d.fair.F}%;background:var(--F)" title="F: ${d.fair.F}%"></div>
          <div class="pf-ds-fair-seg" style="width:${d.fair.A}%;background:var(--A)" title="A: ${d.fair.A}%"></div>
          <div class="pf-ds-fair-seg" style="width:${d.fair.I}%;background:var(--I)" title="I: ${d.fair.I}%"></div>
          <div class="pf-ds-fair-seg" style="width:${d.fair.R}%;background:var(--R)" title="R: ${d.fair.R}%"></div>
        </div>
        <div class="pf-ds-actions">
          <button class="pf-edit-btn" onclick="openEditDs(${d.id})">${editIcon} Редактировать</button>
          ${isDraft ? `<button class="pf-publish-btn" onclick="publishDs(${d.id})">↑ Опубликовать</button>` : ''}
          ${isPublished ? `<button class="pf-unpublish-btn" onclick="unpublishDs(${d.id})">↓ Снять</button>` : ''}
          ${isRejected ? `<button class="pf-resubmit-btn" onclick="resubmitDs(${d.id})">↺ Переподать</button>` : ''}
          ${isDraft ? `<button class="pf-delete-btn" onclick="deleteDs(${d.id})">✕</button>` : ''}
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

// ── Dataset lifecycle actions ─────────────────────────────────────────────────
export async function publishDs(id) {
  if (!confirm('Опубликовать набор данных? Он станет виден всем пользователям.')) return;
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (state.pubToken) headers['Authorization'] = 'Bearer ' + state.pubToken;
    const r = await fetch(API + `/api/my/datasets/${id}/publish`, { method: 'POST', headers });
    const data = await r.json();
    if (r.ok) { showToast('Набор данных опубликован', 'success'); loadProfile(); loadDatasets(); }
    else showToast(data.error || 'Ошибка', 'error');
  } catch { showToast('Нет соединения', 'error'); }
}

export async function unpublishDs(id) {
  if (!confirm('Снять с публикации? Набор вернётся в черновики.')) return;
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (state.pubToken) headers['Authorization'] = 'Bearer ' + state.pubToken;
    const r = await fetch(API + `/api/my/datasets/${id}/unpublish`, { method: 'POST', headers });
    const data = await r.json();
    if (r.ok) { showToast('Снято с публикации', 'success'); loadProfile(); loadDatasets(); }
    else showToast(data.error || 'Ошибка', 'error');
  } catch { showToast('Нет соединения', 'error'); }
}

export async function deleteDs(id) {
  if (!confirm('Удалить черновик навсегда? Это действие нельзя отменить.')) return;
  try {
    const headers = state.pubToken ? { 'Authorization': 'Bearer ' + state.pubToken } : {};
    const r = await fetch(API + `/api/my/datasets/${id}`, { method: 'DELETE', headers });
    const data = await r.json();
    if (r.ok) { showToast('Набор данных удалён', 'success'); loadProfile(); loadDatasets(); }
    else showToast(data.error || 'Ошибка', 'error');
  } catch { showToast('Нет соединения', 'error'); }
}

export function exportDmp() {
  const el = id => document.getElementById(id);
  const dmp = {
    dmp: {
      title: `DMP: ${state.currentUser?.name || 'Research Project'}`,
      created: new Date().toISOString().slice(0, 10),
      contact: { name: state.currentUser?.name || '', mbox: state.currentUser?.email || '' },
      dataset: [{
        title: 'Research Dataset',
        data_description: el('dmp-data-desc')?.value || '',
        storage_plan: el('dmp-storage')?.value || '',
        access_control: el('dmp-access')?.value || '',
        retention_period: el('dmp-retention')?.value || '',
        sharing_plan: el('dmp-sharing')?.value || '',
        funder: el('dmp-funder')?.value || '',
      }],
    },
  };
  const blob = new Blob([JSON.stringify(dmp, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'dmp-madmp.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── DMP tab ───────────────────────────────────────────────────────────────────
export async function loadDmp() {
  try {
    const headers = state.pubToken ? { 'Authorization': 'Bearer ' + state.pubToken } : {};
    const r = await fetch(API + '/api/my/dmp', { headers });
    if (!r.ok) return;
    const dmp = await r.json();
    const el = id => document.getElementById(id);
    if (el('dmp-data-desc')) el('dmp-data-desc').value = dmp.dataDescription || '';
    if (el('dmp-storage'))   el('dmp-storage').value   = dmp.storagePlan     || '';
    if (el('dmp-access'))    el('dmp-access').value     = dmp.accessControl   || '';
    if (el('dmp-retention')) el('dmp-retention').value  = dmp.retentionPeriod || '';
    if (el('dmp-sharing'))   el('dmp-sharing').value    = dmp.sharingPlan     || '';
    if (el('dmp-funder'))    el('dmp-funder').value     = dmp.funder          || '';
    const msg = el('dmp-msg');
    if (msg && dmp.updated) { msg.textContent = `Последнее сохранение: ${dmp.updated.slice(0,10)}`; msg.className = 'pf-msg ok'; }
  } catch { /* ignore */ }
}

export async function saveDmp() {
  const el = id => document.getElementById(id);
  const body = {
    dataDescription: el('dmp-data-desc')?.value.trim() || '',
    storagePlan:     el('dmp-storage')?.value.trim()   || '',
    accessControl:   el('dmp-access')?.value.trim()    || '',
    retentionPeriod: el('dmp-retention')?.value.trim() || '',
    sharingPlan:     el('dmp-sharing')?.value.trim()   || '',
    funder:          el('dmp-funder')?.value.trim()     || '',
  };
  const msg = el('dmp-msg');
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (state.pubToken) headers['Authorization'] = 'Bearer ' + state.pubToken;
    const r = await fetch(API + '/api/my/dmp', { method: 'POST', headers, body: JSON.stringify(body) });
    if (!r.ok) throw new Error();
    if (msg) { msg.textContent = 'DMP сохранён'; msg.className = 'pf-msg ok'; }
  } catch { if (msg) { msg.textContent = 'Ошибка сохранения'; msg.className = 'pf-msg err'; } }
}

// ── Edit dataset modal ────────────────────────────────────────────────────────
export async function openEditDs(id) {
  document.getElementById('edit-ds-id').value = id;
  document.getElementById('editDsErr').textContent = '';
  document.getElementById('edit-fair-hints').innerHTML = '';
  document.getElementById('editDsModal').classList.add('open');
  try {
    const authH = state.pubToken ? { 'Authorization': 'Bearer ' + state.pubToken } : {};
    const [dsRes, fairRes] = await Promise.all([
      fetch(API + `/api/my/datasets`, { headers: authH }).then(r => r.json()),
      fetch(API + `/api/datasets/${id}/fair`).catch(() => null),
    ]);
    const ds = (dsRes.datasets || []).find(d => d.id === id) ||
               await fetch(API + `/api/datasets/${id}`).then(r => r.ok ? r.json() : null).catch(() => null);
    if (ds) {
      document.getElementById('edit-title').value    = ds.title || '';
      document.getElementById('edit-title-ru').value = ds.titleRu || '';
      document.getElementById('edit-title-ky').value = ds.titleKy || '';
      document.getElementById('edit-author').value   = ds.creator?.name || '';
      document.getElementById('edit-orcid').value    = ds.creator?.orcid || '';
      document.getElementById('edit-desc').value     = ds.description || '';
      document.getElementById('edit-kw').value       = (ds.keywords || []).join(', ');
      document.getElementById('edit-lic').value      = ds.license || 'CC-BY-4.0';
      document.getElementById('edit-type').value     = ds.resourceType || 'Dataset';
      document.getElementById('edit-funder').value   = ds.funder?.name || '';
      document.getElementById('edit-grant').value    = ds.funder?.grantId || '';
      document.getElementById('edit-spatial').value  = ds.spatial?.description || '';
    }
    // Show FAIR hints if dataset is published
    if (fairRes) {
      const fairData = await fairRes.json().catch(() => null);
      if (fairData?.hints?.length) {
        const colors = { F: '#2563eb', A: '#16a34a', I: '#d97706', R: '#9333ea' };
        document.getElementById('edit-fair-hints').innerHTML = `
          <div style="background:var(--bg2);border-radius:10px;padding:12px 14px;margin-bottom:8px">
            <div style="font-size:12px;font-weight:600;color:var(--t2);margin-bottom:8px">Рекомендации FAIR</div>
            ${fairData.hints.slice(0,5).map(h => `
              <div style="font-size:12px;color:var(--t2);margin-bottom:4px">
                <span style="color:${colors[h.p]||'#666'};font-weight:700">[${h.p}]</span> ${h.msg}
              </div>`).join('')}
          </div>`;
      }
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
  const funderName  = document.getElementById('edit-funder').value.trim();
  const grantId     = document.getElementById('edit-grant').value.trim();
  const spatialDesc = document.getElementById('edit-spatial').value.trim();
  const body = {
    title, description: desc,
    creator:      { name: document.getElementById('edit-author').value.trim(), orcid: document.getElementById('edit-orcid').value.trim() || undefined },
    keywords:     document.getElementById('edit-kw').value.split(',').map(s => s.trim()).filter(Boolean),
    license:      document.getElementById('edit-lic').value,
    resourceType: document.getElementById('edit-type').value,
    titleRu:      document.getElementById('edit-title-ru').value.trim() || undefined,
    titleKy:      document.getElementById('edit-title-ky').value.trim() || undefined,
    funder:       funderName ? { name: funderName, grantId: grantId || '' } : undefined,
    spatial:      spatialDesc ? { description: spatialDesc } : undefined,
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
