/**
 * RDM Public App — Entry point
 * Imports all modules and initialises the application on DOMContentLoaded.
 * Functions used by HTML onclick handlers are exposed via window.
 */

import { checkSession, renderAuth,
         openLogin, closeLogin, openRegister, closeRegister,
         openSubmit, closeSubmit, doLogin, doRegister, doLogout, doSubmit } from './auth.js';

import { loadDatasets, initSearch, applyFilters, goPage, resetCatFilters,
         openDetail, closeDetail, downloadDataset, copyDOI, exportDataset } from './catalog.js';

import { openProfile, closeProfile, switchPfTab,
         loadProfile, saveProfile, savePassword,
         openEditDs, closeEditDs, doEditDs,
         loadApiKeys, createApiKey, revokeApiKey, resubmitDs,
         loadDmp, saveDmp, publishDs, unpublishDs, deleteDs, exportDmp } from './profile.js';

import { toggleTheme, initTheme, showToast,
         toggleMobileNav, closeMobileNav, closeMobileNavFull,
         initScrollTop, initReveal, initFAIRAnimation,
         showComp, togglePwd } from './ui.js';

import { state } from './state.js';
import { initLang, applyLang } from './i18n.js';

function setLang(lang) {
  applyLang(lang);
  // Re-render dataset grid so card text picks up new language
  loadDatasets();
  // Re-render hero/nav (logged-in personalised hero + login/register buttons).
  // renderAuth() also re-fetches /api/my/datasets for personal hero stats.
  renderAuth();
}

// ── Expose to window (called from HTML onclick attributes) ────────────────────
Object.assign(window, {
  setLang,
  // auth
  openLogin, closeLogin, openRegister, closeRegister,
  openSubmit, closeSubmit, doLogin, doRegister, doLogout, doSubmit,
  // catalog
  openDetail, closeDetail, downloadDataset, copyDOI, exportDataset, goPage, resetCatFilters,
  // profile
  openProfile, closeProfile, switchPfTab, loadProfile,
  saveProfile, savePassword, openEditDs, closeEditDs, doEditDs,
  loadApiKeys, createApiKey, revokeApiKey, resubmitDs, loadDmp, saveDmp,
  publishDs, unpublishDs, deleteDs, exportDmp,
  // ui
  toggleTheme, toggleMobileNav, closeMobileNav, closeMobileNavFull,
  showComp, togglePwd, showToast,
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initLang();
  initScrollTop();
  initReveal();
  initFAIRAnimation(() => state.allDatasets);
  initSearch();

  // Await session check first so that loadDatasets/fetchHeroStats knows
  // whether to show global platform stats or personal stats in the hero.
  (async () => {
    await checkSession();
    loadDatasets();
  })();

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeDetail(); closeLogin(); closeSubmit(); closeRegister(); closeProfile(); closeEditDs(); }
  });

  // Reload catalog after dataset submit
  window.addEventListener('rdm:datasetsChanged', loadDatasets);

  // Toast animation keyframe (injected once)
  const s = document.createElement('style');
  s.textContent = '@keyframes fadeInUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}';
  document.head.appendChild(s);
});
