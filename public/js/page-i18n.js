// Standalone i18n helper for non-module pages (dashboard.html, admin/index.html)
// Reads `window.RDM_PAGE_T` (set by inline script per page) and a `data-i18n` attribute system.
(function () {
  'use strict';

  function t(key) {
    const lang = window.RDM_LANG || localStorage.getItem('rdm-lang') || 'ru';
    const T = window.RDM_PAGE_T || {};
    return (T[lang] && T[lang][key]) || (T.ru && T.ru[key]) || (T.en && T.en[key]) || key;
  }

  function applyLang(lang) {
    if (!lang) lang = localStorage.getItem('rdm-lang') || 'ru';
    window.RDM_LANG = lang;
    localStorage.setItem('rdm-lang', lang);
    document.documentElement.lang = lang === 'ky' ? 'ky' : lang === 'en' ? 'en' : 'ru';

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const val = t(key);
      if (el.hasAttribute('data-i18n-html')) el.innerHTML = val;
      else el.textContent = val;
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => {
      el.placeholder = t(el.getAttribute('data-i18n-ph'));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      el.title = t(el.getAttribute('data-i18n-title'));
    });
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === lang);
    });
    if (typeof window.onLangChange === 'function') window.onLangChange(lang);
  }

  function initLang() {
    applyLang(localStorage.getItem('rdm-lang') || 'ru');
  }

  window.RDM_t = t;
  window.RDM_applyLang = applyLang;
  window.RDM_initLang = initLang;
})();
