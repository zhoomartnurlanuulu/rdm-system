// Catalog: server-side filtering/pagination/sort with skeleton loading
import { state, API, PER_PAGE } from './state.js';
import { animNum, showToast } from './ui.js';
import { t, currentLang } from './i18n.js';

let searchDebounce = 0;
let filterOptionsLoaded = false;

// ── Load filter options (licenses, formats) ──────────────────────────────────
async function loadFilterOptions() {
  if (filterOptionsLoaded) return;
  try {
    const r = await fetch(API + '/api/filters');
    if (!r.ok) return;
    const data = await r.json();
    const licSel = document.getElementById('catLicense');
    const fmtSel = document.getElementById('catFormat');
    if (licSel && data.licenses) {
      const cur = licSel.value;
      licSel.innerHTML = `<option value="" data-i18n="cat.lic.all">${t('cat.lic.all')}</option>` +
        data.licenses.map(l => `<option value="${escAttr(l)}">${escHtml(l)}</option>`).join('');
      licSel.value = cur;
    }
    if (fmtSel && data.formats) {
      const cur = fmtSel.value;
      fmtSel.innerHTML = `<option value="" data-i18n="cat.fmt.all">${t('cat.fmt.all')}</option>` +
        data.formats.map(f => {
          const short = f.split('/').pop().toUpperCase();
          return `<option value="${escAttr(f)}">${escHtml(short)}</option>`;
        }).join('');
      fmtSel.value = cur;
    }
    filterOptionsLoaded = true;
  } catch (e) { /* silent */ }
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s) {
  return String(s == null ? '' : s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// ── Render skeleton placeholders ──────────────────────────────────────────────
function renderSkeleton(count = 6) {
  const grid = document.getElementById('dsGrid');
  if (!grid) return;
  grid.innerHTML = Array.from({ length: count }, () => `
    <div class="ds-card skeleton-card">
      <div class="sk sk-pill"></div>
      <div class="sk sk-title"></div>
      <div class="sk sk-line"></div>
      <div class="sk sk-line short"></div>
      <div class="sk sk-fair"></div>
      <div class="sk sk-footer"></div>
    </div>`).join('');
}

// ── Load datasets (server-side filter/page/sort) ──────────────────────────────
export async function loadDatasets() {
  renderSkeleton();
  loadFilterOptions();
  const q   = (document.getElementById('catSearch')?.value || '').trim();
  const acc = document.getElementById('catAccess')?.value || '';
  const lic = document.getElementById('catLicense')?.value || '';
  const fmt = document.getElementById('catFormat')?.value || '';
  const sort = document.getElementById('catSort')?.value || 'newest';
  const params = new URLSearchParams();
  if (q)   params.set('q', q);
  if (acc) params.set('access', acc);
  if (lic) params.set('license', lic);
  if (fmt) params.set('format', fmt);
  if (sort) params.set('sort', sort);
  params.set('page', state.page || 1);
  params.set('limit', PER_PAGE);

  try {
    const r = await fetch(`${API}/api/datasets?${params.toString()}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    state.allDatasets = data.items || [];
    state.filtered = data.items || [];
    state.totalPages = data.pages;
    state.totalCount = data.total;
    renderGrid(data);
    // Update hero stats separately (uses /api/stats)
    fetchHeroStats();
  } catch (e) {
    const grid = document.getElementById('dsGrid');
    if (grid) grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:48px;color:var(--t3)">${t('toast.error.network')}</div>`;
  }
}

async function fetchHeroStats() {
  // When user is logged in, hero shows personal stats (filled by auth._updateHeroForUser).
  // Don't overwrite them with global platform stats here.
  if (state.currentUser) return;
  try {
    const r = await fetch(API + '/api/stats');
    if (!r.ok) return;
    const s = await r.json();
    animNum('st-total', s.total); animNum('st-dl', s.downloads); animNum('st-open', s.open);
    const fairEl = document.getElementById('st-fair');
    if (fairEl) {
      const avg = Math.round(((s.fair?.F || 0) + (s.fair?.A || 0) + (s.fair?.I || 0) + (s.fair?.R || 0)) / 4);
      fairEl.textContent = avg + '%';
    }
    animNum('sb-ds', s.total); animNum('sb-dl', s.downloads); animNum('sb-views', s.views);
  } catch (e) { /* silent */ }
}

// ── Search/Filter wiring ──────────────────────────────────────────────────────
export function initSearch() {
  const search = document.getElementById('catSearch');
  if (search) {
    search.addEventListener('input', () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => { state.page = 1; loadDatasets(); }, 300);
    });
  }
  ['catAccess', 'catLicense', 'catFormat', 'catSort'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => { state.page = 1; loadDatasets(); });
  });
}

export function applyFilters() {
  state.page = 1;
  loadDatasets();
}

export function resetCatFilters() {
  ['catSearch'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['catAccess', 'catLicense', 'catFormat'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const sort = document.getElementById('catSort'); if (sort) sort.value = 'newest';
  state.page = 1;
  loadDatasets();
}

// ── Render grid ───────────────────────────────────────────────────────────────
function renderGrid(data) {
  const grid  = document.getElementById('dsGrid');
  const total = data.total || 0;
  const items = data.items || [];
  const totalEl = document.getElementById('catTotal');
  if (totalEl) totalEl.textContent = total + ' ' + t('cat.total');
  if (!items.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:48px;color:var(--t3);font-family:var(--mono)">${t('cat.empty')}</div>`;
    document.getElementById('catPag').innerHTML = '';
    return;
  }
  grid.innerHTML = items.map(cardHTML).join('');
  renderPagination(data.pages, data.page);
}

function cardHTML(d) {
  const f   = d.fair || { F: 0, A: 0, I: 0, R: 0 };
  const sz  = d.size ? (d.size > 1024 * 1024 ? (d.size / 1024 / 1024).toFixed(1) + 'MB' : (d.size / 1024).toFixed(0) + 'KB') : '';
  const kw  = (d.keywords || []).slice(0, 3).map(k => `<span>${escHtml(k)}</span>`).join('');
  const isEmbargoed = d.embargoUntil && new Date(d.embargoUntil) > new Date();
  const embargoDate = isEmbargoed ? new Date(d.embargoUntil).toLocaleDateString(currentLang === 'en' ? 'en-GB' : 'ru-RU') : '';
  const accessLbl = d.access === 'open' ? t('cat.access.lbl.open') : t('cat.access.lbl.res');
  // Pick localized title/description if available
  const title = (currentLang === 'ky' && d.titleKy) ? d.titleKy
              : (currentLang === 'ru' && d.titleRu) ? d.titleRu
              : d.title;
  const desc  = (currentLang === 'ky' && d.descriptionKy) ? d.descriptionKy
              : (currentLang === 'ru' && d.descriptionRu) ? d.descriptionRu
              : d.description;
  return `<div class="ds-card ${d.access}" onclick="openDetail(${d.id})">
    <div class="ds-meta">
      <span class="ds-badge ${d.access}">${accessLbl}</span>
      <span class="ds-doi">${escHtml(d.doi)}</span>
      ${sz ? `<span class="ds-badge" style="background:var(--bg3);color:var(--t3)">${sz}</span>` : ''}
      ${isEmbargoed ? `<span class="ds-badge embargo-badge">🔒 ${t('cat.embargo')} ${embargoDate}</span>` : ''}
    </div>
    <div class="ds-title">${escHtml(title)}</div>
    <div class="ds-desc">${escHtml(desc)}</div>
    <div class="fair-ring">
      <div class="fr-item" data-label="F" style="background:rgba(77,157,255,${f.F/100*0.8+0.1})"></div>
      <div class="fr-item" data-label="A" style="background:rgba(62,203,127,${f.A/100*0.8+0.1})"></div>
      <div class="fr-item" data-label="I" style="background:rgba(240,162,64,${f.I/100*0.8+0.1})"></div>
      <div class="fr-item" data-label="R" style="background:rgba(196,124,255,${f.R/100*0.8+0.1})"></div>
    </div>
    <div class="ds-footer" style="margin-top:12px">
      <div class="ds-kw">${kw}</div>
      <div style="display:flex;align-items:center;gap:8px">
        <div class="ds-stats"><span>↓ ${d.downloads || 0}</span><span>👁 ${d.views || 0}</span></div>
        ${!isEmbargoed && d.access === 'open'
          ? `<button class="ds-dl-btn" onclick="event.stopPropagation();downloadDataset(${d.id},'csv')" title="${t('cat.dl.csv')}">↓ CSV</button>`
          : `<span class="ds-dl-lock" title="${isEmbargoed ? t('cat.embargo') : t('cat.dl.lock')}">🔒</span>`}
      </div>
    </div>
  </div>`;
}

function renderPagination(pages, current) {
  const el = document.getElementById('catPag');
  if (!el) return;
  if (!pages || pages <= 1) { el.innerHTML = ''; return; }
  const buttons = [];
  // Prev
  buttons.push(`<button class="pg-btn ${current === 1 ? 'disabled' : ''}" onclick="goPage(${Math.max(1, current - 1)})" ${current === 1 ? 'disabled' : ''}>‹</button>`);
  // Compact pagination
  const maxBtns = 7;
  let start = Math.max(1, current - 3);
  let end = Math.min(pages, start + maxBtns - 1);
  if (end - start < maxBtns - 1) start = Math.max(1, end - maxBtns + 1);
  if (start > 1) buttons.push(`<button class="pg-btn" onclick="goPage(1)">1</button>`);
  if (start > 2) buttons.push(`<span class="pg-ellipsis">…</span>`);
  for (let i = start; i <= end; i++) {
    buttons.push(`<button class="pg-btn ${i === current ? 'active' : ''}" onclick="goPage(${i})">${i}</button>`);
  }
  if (end < pages - 1) buttons.push(`<span class="pg-ellipsis">…</span>`);
  if (end < pages)     buttons.push(`<button class="pg-btn" onclick="goPage(${pages})">${pages}</button>`);
  // Next
  buttons.push(`<button class="pg-btn ${current === pages ? 'disabled' : ''}" onclick="goPage(${Math.min(pages, current + 1)})" ${current === pages ? 'disabled' : ''}>›</button>`);
  el.innerHTML = buttons.join('');
}

export function goPage(p) {
  state.page = p;
  loadDatasets();
  document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Detail modal ──────────────────────────────────────────────────────────────
export function openDetail(id) {
  const d = state.allDatasets.find(x => x.id === id);
  if (!d) return;
  const f = d.fair || { F: 0, A: 0, I: 0, R: 0 };
  const isEmbargoed = d.embargoUntil && new Date(d.embargoUntil) > new Date();
  const locale = currentLang === 'en' ? 'en-GB' : 'ru-RU';
  const embargoDate = isEmbargoed ? new Date(d.embargoUntil).toLocaleDateString(locale) : '';

  const title = (currentLang === 'ky' && d.titleKy) ? d.titleKy
              : (currentLang === 'ru' && d.titleRu) ? d.titleRu
              : d.title;
  const desc  = (currentLang === 'ky' && d.descriptionKy) ? d.descriptionKy
              : (currentLang === 'ru' && d.descriptionRu) ? d.descriptionRu
              : d.description;

  const related = (d.relatedIds || [])
    .map(rid => state.allDatasets.find(x => x.id === rid))
    .filter(Boolean);
  const relatedHTML = related.length ? `
    <div class="detail-section-title">${t('det.related')}</div>
    <div class="related-list">
      ${related.map(r => `<div class="related-item" onclick="openDetail(${r.id})">
        <span class="related-doi">${escHtml(r.doi)}</span>
        <span class="related-title">${escHtml(r.title)}</span>
      </div>`).join('')}
    </div>` : '';

  document.getElementById('detailContent').innerHTML = `
    <div class="detail-doi">${escHtml(d.doi)}</div>
    <div class="detail-title">${escHtml(title)}</div>
    ${isEmbargoed ? `<div class="embargo-notice">${t('det.embargo.notice').replace('{date}', embargoDate)}</div>` : ''}
    <div class="detail-desc">${escHtml(desc)}</div>
    <div class="fair-detail">
      <div class="fd-item"><div class="fd-letter" style="color:var(--F)">F</div><div class="fd-score">${f.F}%</div></div>
      <div class="fd-item"><div class="fd-letter" style="color:var(--A)">A</div><div class="fd-score">${f.A}%</div></div>
      <div class="fd-item"><div class="fd-letter" style="color:var(--I)">I</div><div class="fd-score">${f.I}%</div></div>
      <div class="fd-item"><div class="fd-letter" style="color:var(--R)">R</div><div class="fd-score">${f.R}%</div></div>
    </div>
    <div class="detail-meta-grid">
      <div class="detail-meta-item"><div class="detail-meta-label">${t('det.author')}</div><div class="detail-meta-val">${escHtml(d.creator?.name || '—')}</div></div>
      <div class="detail-meta-item"><div class="detail-meta-label">${t('det.orcid')}</div><div class="detail-meta-val" style="font-family:var(--mono);font-size:11px">${escHtml(d.creator?.orcid || '—')}</div></div>
      <div class="detail-meta-item"><div class="detail-meta-label">${t('det.license')}</div><div class="detail-meta-val">${escHtml(d.license || '—')}</div></div>
      <div class="detail-meta-item"><div class="detail-meta-label">${t('det.access')}</div><div class="detail-meta-val">${d.access === 'open' ? t('cat.access.lbl.open') : t('cat.access.lbl.res')}</div></div>
      <div class="detail-meta-item"><div class="detail-meta-label">${t('det.version')}</div><div class="detail-meta-val">v${d.version || 1}</div></div>
      <div class="detail-meta-item"><div class="detail-meta-label">${t('det.format')}</div><div class="detail-meta-val">${escHtml(d.format || '—')}</div></div>
      <div class="detail-meta-item"><div class="detail-meta-label">${t('det.downloads')}</div><div class="detail-meta-val">${d.downloads || 0}</div></div>
      <div class="detail-meta-item"><div class="detail-meta-label">${t('det.updated')}</div><div class="detail-meta-val">${d.updated ? d.updated.slice(0,10) : '—'}</div></div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">
      ${(d.keywords || []).map(k => `<span style="font-size:12px;background:var(--bg3);color:var(--t2);padding:4px 10px;border-radius:6px">${escHtml(k)}</span>`).join('')}
    </div>
    ${!isEmbargoed && d.access === 'open' ? `
    <div class="dl-section">
      <div class="dl-title">${t('det.dl.title')}</div>
      <div class="dl-btns">
        <button class="dl-btn" onclick="downloadDataset(${d.id},'csv')">
          <span class="dl-icon">↓</span><div><div class="dl-fmt">CSV</div><div class="dl-desc">${t('det.dl.csv.desc')}</div></div>
        </button>
        <button class="dl-btn" onclick="downloadDataset(${d.id},'json')">
          <span class="dl-icon">↓</span><div><div class="dl-fmt">JSON</div><div class="dl-desc">${t('det.dl.json.desc')}</div></div>
        </button>
        <button class="dl-btn dl-btn-cite" onclick="copyDOI('${escAttr(d.doi)}')">
          <span class="dl-icon">⊕</span><div><div class="dl-fmt">DOI</div><div class="dl-desc">${t('det.dl.doi.desc')}</div></div>
        </button>
      </div>
      <div class="dl-title" style="margin-top:16px">${t('det.export.title')}</div>
      <div class="dl-btns">
        <button class="dl-btn export-btn" onclick="exportDataset(${d.id},'bibtex')">
          <span class="dl-icon">📄</span><div><div class="dl-fmt">BibTeX</div><div class="dl-desc">${t('det.bib.desc')}</div></div>
        </button>
        <button class="dl-btn export-btn" onclick="exportDataset(${d.id},'dublincore')">
          <span class="dl-icon">📋</span><div><div class="dl-fmt">Dublin Core</div><div class="dl-desc">${t('det.dc.desc')}</div></div>
        </button>
        <button class="dl-btn export-btn" onclick="exportDataset(${d.id},'datacite')">
          <span class="dl-icon">🗂</span><div><div class="dl-fmt">DataCite</div><div class="dl-desc">${t('det.datacite.desc')}</div></div>
        </button>
      </div>
    </div>` : `
    <div class="dl-section dl-restricted">
      <span style="font-size:18px">${isEmbargoed ? '⏳' : '🔒'}</span>
      <div><div style="font-weight:600;margin-bottom:3px">${isEmbargoed ? t('det.embargo.until').replace('{date}', embargoDate) : t('det.restricted')}</div>
      <div style="font-size:12px;color:var(--t3)">${isEmbargoed ? '' : t('det.contact')}</div></div>
    </div>`}
    ${relatedHTML}`;
  document.getElementById('detailModal').classList.add('open');
}

export function closeDetail() { document.getElementById('detailModal').classList.remove('open'); }

export async function downloadDataset(id, fmt) {
  const a = document.createElement('a');
  a.href = `${API}/api/datasets/${id}/download?format=${fmt}`;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast(`${t('toast.dl.start')} (${fmt.toUpperCase()})`, 'success');
  setTimeout(loadDatasets, 800);
}

export function exportDataset(id, fmt) {
  const a = document.createElement('a');
  a.href = `${API}/api/datasets/${id}/export?format=${fmt}`;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast(`${t('toast.export.start')} (${fmt})`, 'success');
}

export function copyDOI(doi) {
  navigator.clipboard.writeText(`https://doi.org/${doi}`).then(() => showToast(t('toast.doi.copied'), 'success'));
}
