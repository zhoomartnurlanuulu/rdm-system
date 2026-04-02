// Catalog: dataset loading, filters, card rendering, pagination, detail modal, download
import { state, API, PER_PAGE } from './state.js';
import { animNum, showToast } from './ui.js';

// ── Load ──────────────────────────────────────────────────────────────────────
export async function loadDatasets() {
  try {
    const r = await fetch(API + '/api/datasets?limit=200');
    if (!r.ok) throw new Error();
    const data = await r.json();
    state.allDatasets = data.items || [];
    updateHeroStats(data);
    applyFilters();
  } catch (e) {
    state.allDatasets = getDemoDatasets();
    updateHeroStats({});
    applyFilters();
  }
}

function getDemoDatasets() {
  return [
    { id:1, doi:'10.48436/rdm-001', title:'Air Quality Measurements Bishkek 2024',
      description:'Hourly PM2.5, NO2, CO measurements from 12 stations across Bishkek city',
      creator:{name:'Research Team KSTU',orcid:'0000-0002-1234-5678'},
      keywords:['air quality','Bishkek','PM2.5','environment','monitoring'],
      license:'CC-BY-4.0', access:'open', format:'text/csv', size:48200, version:3,
      fair:{F:98,A:95,I:87,R:92}, downloads:142, views:890 },
    { id:2, doi:'10.48436/rdm-002', title:'Soil Composition Analysis — Chui Valley',
      description:'Chemical composition of agricultural soils across 8 districts, 240 sample points',
      creator:{name:'Environmental Lab KSTU',orcid:'0000-0001-9876-5432'},
      keywords:['soil','agriculture','chemistry','Chui Valley','Kyrgyzstan'],
      license:'CC-BY-NC-SA-4.0', access:'open', format:'application/json', size:12500, version:1,
      fair:{F:90,A:88,I:95,R:85}, downloads:67, views:340 },
    { id:3, doi:'10.48436/rdm-003', title:'Water Quality Dataset — Issyk-Kul Lake 2023–2024',
      description:'Temperature, pH, dissolved oxygen, turbidity monitoring at 24 stations',
      creator:{name:'Hydrology Dept KSTU',orcid:'0000-0003-1111-2222'},
      keywords:['water','Issyk-Kul','hydrology','monitoring','lake'],
      license:'CC0-1.0', access:'open', format:'application/vnd.ms-excel', size:87600, version:2,
      fair:{F:100,A:100,I:78,R:95}, downloads:203, views:1420 },
    { id:4, doi:'10.48436/rdm-004', title:'Mountain Glacier Mass Balance 2020–2024',
      description:'Annual mass balance measurements for 15 glaciers in Tian-Shan range',
      creator:{name:'Glaciology Lab KSTU',orcid:'0000-0004-5555-6666'},
      keywords:['glaciers','Tian-Shan','climate change','mass balance'],
      license:'CC-BY-4.0', access:'open', format:'text/csv', size:24300, version:1,
      fair:{F:88,A:92,I:80,R:88}, downloads:31, views:210 },
  ];
}

function updateHeroStats(data) {
  const ds   = state.allDatasets;
  const total = data.total  ?? ds.length;
  const dl    = data.downloads ?? ds.reduce((s, d) => s + (d.downloads || 0), 0);
  const open  = data.open   ?? ds.filter(d => d.access === 'open').length;
  const avgFair = ds.length
    ? Math.round(ds.reduce((s, d) => { const f = d.fair || {}; return s + ((f.F||0)+(f.A||0)+(f.I||0)+(f.R||0))/4; }, 0) / ds.length)
    : 0;
  animNum('st-total', total); animNum('st-dl', dl); animNum('st-open', open);
  const fairEl = document.getElementById('st-fair');
  if (fairEl) fairEl.textContent = avgFair + '%';
  animNum('sb-ds', total); animNum('sb-dl', dl);
  animNum('sb-views', ds.reduce((s, d) => s + (d.views || 0), 0));
}

// ── Filters ───────────────────────────────────────────────────────────────────
export function initSearch() {
  document.getElementById('catSearch').addEventListener('input', applyFilters);
  document.getElementById('catAccess').addEventListener('change', applyFilters);
  document.getElementById('catLicense').addEventListener('change', applyFilters);
}

export function applyFilters() {
  const q   = document.getElementById('catSearch').value.toLowerCase();
  const acc = document.getElementById('catAccess').value;
  const lic = document.getElementById('catLicense').value;
  state.filtered = state.allDatasets.filter(d => {
    if (acc && d.access !== acc) return false;
    if (lic && d.license !== lic) return false;
    if (q) {
      const hay = (d.title + ' ' + d.description + ' ' + (d.keywords || []).join(' ')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  state.page = 1;
  renderGrid();
}

// ── Render grid ───────────────────────────────────────────────────────────────
function renderGrid() {
  const grid  = document.getElementById('dsGrid');
  const total = state.filtered.length;
  document.getElementById('catTotal').textContent = total + ' набор' + (total === 1 ? '' : 'ов') + ' данных';
  if (!total) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:48px;color:var(--t3);font-family:var(--mono)">Ничего не найдено</div>';
    document.getElementById('catPag').innerHTML = '';
    return;
  }
  const start = (state.page - 1) * PER_PAGE;
  grid.innerHTML = state.filtered.slice(start, start + PER_PAGE).map(cardHTML).join('');
  renderPagination(total);
}

function cardHTML(d) {
  const f   = d.fair || { F: 0, A: 0, I: 0, R: 0 };
  const fmt = d.format ? d.format.split('/').pop().toUpperCase() : 'DATA';
  const sz  = d.size ? (d.size > 1024 * 1024 ? (d.size / 1024 / 1024).toFixed(1) + 'MB' : (d.size / 1024).toFixed(0) + 'KB') : '';
  const kw  = (d.keywords || []).slice(0, 3).map(k => `<span>${k}</span>`).join('');
  const isEmbargoed = d.embargoUntil && new Date(d.embargoUntil) > new Date();
  const embargoDate = isEmbargoed ? new Date(d.embargoUntil).toLocaleDateString('ru-RU') : '';
  return `<div class="ds-card ${d.access}" onclick="openDetail(${d.id})">
    <div class="ds-meta">
      <span class="ds-badge ${d.access}">${d.access === 'open' ? 'Открытый' : 'Ограниченный'}</span>
      <span class="ds-doi">${d.doi}</span>
      ${sz ? `<span class="ds-badge" style="background:var(--bg3);color:var(--t3)">${sz}</span>` : ''}
      ${isEmbargoed ? `<span class="ds-badge embargo-badge">🔒 до ${embargoDate}</span>` : ''}
    </div>
    <div class="ds-title">${d.title}</div>
    <div class="ds-desc">${d.description}</div>
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
          ? `<button class="ds-dl-btn" onclick="event.stopPropagation();downloadDataset(${d.id},'csv')" title="Скачать CSV">↓ CSV</button>`
          : `<span class="ds-dl-lock" title="${isEmbargoed ? 'Эмбарго' : 'Ограниченный доступ'}">🔒</span>`}
      </div>
    </div>
  </div>`;
}

function renderPagination(total) {
  const pages = Math.ceil(total / PER_PAGE);
  if (pages <= 1) { document.getElementById('catPag').innerHTML = ''; return; }
  document.getElementById('catPag').innerHTML = Array.from({ length: pages }, (_, i) =>
    `<button class="pg-btn ${i + 1 === state.page ? 'active' : ''}" onclick="goPage(${i + 1})">${i + 1}</button>`
  ).join('');
}

export function goPage(p) {
  state.page = p;
  renderGrid();
  document.getElementById('catalog').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Detail modal ──────────────────────────────────────────────────────────────
export function openDetail(id) {
  const d = state.allDatasets.find(x => x.id === id);
  if (!d) return;
  const f = d.fair || { F: 0, A: 0, I: 0, R: 0 };
  const isEmbargoed = d.embargoUntil && new Date(d.embargoUntil) > new Date();
  const embargoDate = isEmbargoed ? new Date(d.embargoUntil).toLocaleDateString('ru-RU') : '';

  // Related datasets
  const related = (d.relatedIds || [])
    .map(rid => state.allDatasets.find(x => x.id === rid))
    .filter(Boolean);
  const relatedHTML = related.length ? `
    <div class="detail-section-title">Связанные наборы данных</div>
    <div class="related-list">
      ${related.map(r => `<div class="related-item" onclick="openDetail(${r.id})">
        <span class="related-doi">${r.doi}</span>
        <span class="related-title">${r.title}</span>
      </div>`).join('')}
    </div>` : '';

  document.getElementById('detailContent').innerHTML = `
    <div class="detail-doi">${d.doi}</div>
    <div class="detail-title">${d.title}</div>
    ${isEmbargoed ? `<div class="embargo-notice">🔒 Эмбарго до ${embargoDate} — данные будут доступны позже</div>` : ''}
    <div class="detail-desc">${d.description}</div>
    <div class="fair-detail">
      <div class="fd-item"><div class="fd-letter" style="color:var(--F)">F</div><div class="fd-score">${f.F}%</div></div>
      <div class="fd-item"><div class="fd-letter" style="color:var(--A)">A</div><div class="fd-score">${f.A}%</div></div>
      <div class="fd-item"><div class="fd-letter" style="color:var(--I)">I</div><div class="fd-score">${f.I}%</div></div>
      <div class="fd-item"><div class="fd-letter" style="color:var(--R)">R</div><div class="fd-score">${f.R}%</div></div>
    </div>
    <div class="detail-meta-grid">
      <div class="detail-meta-item"><div class="detail-meta-label">Автор</div><div class="detail-meta-val">${d.creator?.name || '—'}</div></div>
      <div class="detail-meta-item"><div class="detail-meta-label">ORCID</div><div class="detail-meta-val" style="font-family:var(--mono);font-size:11px">${d.creator?.orcid || '—'}</div></div>
      <div class="detail-meta-item"><div class="detail-meta-label">Лицензия</div><div class="detail-meta-val">${d.license || '—'}</div></div>
      <div class="detail-meta-item"><div class="detail-meta-label">Доступ</div><div class="detail-meta-val">${d.access === 'open' ? 'Открытый' : 'Ограниченный'}</div></div>
      <div class="detail-meta-item"><div class="detail-meta-label">Версия</div><div class="detail-meta-val">v${d.version || 1}</div></div>
      <div class="detail-meta-item"><div class="detail-meta-label">Формат</div><div class="detail-meta-val">${d.format || '—'}</div></div>
      <div class="detail-meta-item"><div class="detail-meta-label">Скачиваний</div><div class="detail-meta-val">${d.downloads || 0}</div></div>
      <div class="detail-meta-item"><div class="detail-meta-label">Обновлён</div><div class="detail-meta-val">${d.updated ? d.updated.slice(0,10) : '—'}</div></div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">
      ${(d.keywords || []).map(k => `<span style="font-size:12px;background:var(--bg3);color:var(--t2);padding:4px 10px;border-radius:6px">${k}</span>`).join('')}
    </div>
    ${!isEmbargoed && d.access === 'open' ? `
    <div class="dl-section">
      <div class="dl-title">Скачать данные</div>
      <div class="dl-btns">
        <button class="dl-btn" onclick="downloadDataset(${d.id},'csv')">
          <span class="dl-icon">↓</span><div><div class="dl-fmt">CSV</div><div class="dl-desc">Данные таблицей</div></div>
        </button>
        <button class="dl-btn" onclick="downloadDataset(${d.id},'json')">
          <span class="dl-icon">↓</span><div><div class="dl-fmt">JSON</div><div class="dl-desc">Метаданные</div></div>
        </button>
        <button class="dl-btn dl-btn-cite" onclick="copyDOI('${d.doi}')">
          <span class="dl-icon">⊕</span><div><div class="dl-fmt">DOI</div><div class="dl-desc">Скопировать ссылку</div></div>
        </button>
      </div>
      <div class="dl-title" style="margin-top:16px">Экспорт метаданных</div>
      <div class="dl-btns">
        <button class="dl-btn export-btn" onclick="exportDataset(${d.id},'bibtex')">
          <span class="dl-icon">📄</span><div><div class="dl-fmt">BibTeX</div><div class="dl-desc">.bib файл</div></div>
        </button>
        <button class="dl-btn export-btn" onclick="exportDataset(${d.id},'dublincore')">
          <span class="dl-icon">📋</span><div><div class="dl-fmt">Dublin Core</div><div class="dl-desc">XML формат</div></div>
        </button>
        <button class="dl-btn export-btn" onclick="exportDataset(${d.id},'datacite')">
          <span class="dl-icon">🗂</span><div><div class="dl-fmt">DataCite</div><div class="dl-desc">XML формат</div></div>
        </button>
      </div>
    </div>` : `
    <div class="dl-section dl-restricted">
      <span style="font-size:18px">${isEmbargoed ? '⏳' : '🔒'}</span>
      <div><div style="font-weight:600;margin-bottom:3px">${isEmbargoed ? `Эмбарго до ${embargoDate}` : 'Ограниченный доступ'}</div>
      <div style="font-size:12px;color:var(--t3)">${isEmbargoed ? 'Данные будут открыты в указанную дату' : 'Свяжитесь с автором для получения доступа'}</div></div>
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
  showToast(`Скачивание ${fmt.toUpperCase()} начато`, 'success');
  setTimeout(async () => {
    const r = await fetch(API + '/api/datasets?limit=200');
    if (r.ok) { const data = await r.json(); state.allDatasets = data.items || []; applyFilters(); }
  }, 800);
}

export function exportDataset(id, fmt) {
  const a = document.createElement('a');
  a.href = `${API}/api/datasets/${id}/export?format=${fmt}`;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast(`Экспорт ${fmt} начат`, 'success');
}

export function copyDOI(doi) {
  navigator.clipboard.writeText(`https://doi.org/${doi}`).then(() => showToast('DOI скопирован в буфер', 'success'));
}
