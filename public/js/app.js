/**
 * RDM Public App — Entry point
 * Imports all modules and initialises the application on DOMContentLoaded.
 * Functions used by HTML onclick handlers are exposed via window.
 */

import { checkSession, renderAuth,
         openLogin, closeLogin, openRegister, closeRegister,
         openSubmit, closeSubmit, doLogin, doRegister, doLogout, doSubmit } from './auth.js';

import { loadDatasets, initSearch, applyFilters, goPage,
         openDetail, closeDetail, downloadDataset, copyDOI, exportDataset } from './catalog.js';

import { openProfile, closeProfile, switchPfTab,
         loadProfile, saveProfile, savePassword,
         openEditDs, closeEditDs, doEditDs,
         loadApiKeys, createApiKey, revokeApiKey, resubmitDs } from './profile.js';

import { toggleTheme, initTheme, showToast,
         toggleMobileNav, closeMobileNav, closeMobileNavFull,
         initScrollTop, initReveal, initFAIRAnimation,
         showComp, togglePwd } from './ui.js';

import { state } from './state.js';

// ── Expose to window (called from HTML onclick attributes) ────────────────────
Object.assign(window, {
  // auth
  openLogin, closeLogin, openRegister, closeRegister,
  openSubmit, closeSubmit, doLogin, doRegister, doLogout, doSubmit,
  // catalog
  openDetail, closeDetail, downloadDataset, copyDOI, exportDataset, goPage,
  // profile
  openProfile, closeProfile, switchPfTab, loadProfile,
  saveProfile, savePassword, openEditDs, closeEditDs, doEditDs,
  loadApiKeys, createApiKey, revokeApiKey, resubmitDs,
  // ui
  toggleTheme, toggleMobileNav, closeMobileNav, closeMobileNavFull,
  showComp, togglePwd, showToast,
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initScrollTop();
  initReveal();
  initFAIRAnimation(() => state.allDatasets);
  initSearch();

  checkSession();
  loadDatasets();

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
