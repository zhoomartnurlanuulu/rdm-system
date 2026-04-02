// UI utilities: theme, toast, mobile nav, scroll, reveal, FAIR animation, component tabs

// ── Theme ────────────────────────────────────────────────────────────────────
export function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next = isDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  document.getElementById('themeToggle').textContent = next === 'dark' ? '☀️' : '🌙';
  localStorage.setItem('rdm-theme', next);
}

export function initTheme() {
  const saved = localStorage.getItem('rdm-theme') || 'light';
  if (saved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    const btn = document.getElementById('themeToggle');
    if (btn) btn.textContent = '☀️';
  }
}

// ── Toast ────────────────────────────────────────────────────────────────────
export function showToast(msg, type = 'success') {
  const area = document.getElementById('pubToast');
  const t = document.createElement('div');
  const colors = { success: '#059669', error: '#dc2626', info: '#2563eb' };
  t.style.cssText = `background:var(--bg1);border:1.5px solid ${colors[type]};color:${colors[type]};padding:12px 20px;border-radius:10px;font-size:14px;font-weight:600;box-shadow:0 4px 20px rgba(0,0,0,.12);pointer-events:auto;animation:fadeInUp .3s ease`;
  t.textContent = (type === 'success' ? '✓ ' : type === 'error' ? '✗ ' : 'ℹ ') + msg;
  area.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 3000);
}

// ── Mobile nav ───────────────────────────────────────────────────────────────
export function toggleMobileNav() {
  const nav = document.getElementById('mobileNav');
  const btn = document.getElementById('burgerBtn');
  const open = nav.classList.toggle('open');
  btn.classList.toggle('open', open);
  document.body.style.overflow = open ? 'hidden' : '';
}

export function closeMobileNav(e) {
  if (e.target === document.getElementById('mobileNav')) closeMobileNavFull();
}

export function closeMobileNavFull() {
  document.getElementById('mobileNav').classList.remove('open');
  document.getElementById('burgerBtn').classList.remove('open');
  document.body.style.overflow = '';
}

// ── Scroll to top ─────────────────────────────────────────────────────────────
export function initScrollTop() {
  window.addEventListener('scroll', () => {
    const btn = document.getElementById('scrollTop');
    if (!btn) return;
    if (window.scrollY > 400) { btn.style.opacity = '1'; btn.style.transform = 'translateY(0)'; }
    else                       { btn.style.opacity = '0'; btn.style.transform = 'translateY(10px)'; }
  });
}

// ── Reveal on scroll ──────────────────────────────────────────────────────────
export function initReveal() {
  const obs = new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); obs.unobserve(e.target); }
  }), { threshold: 0.07, rootMargin: '0px 0px -30px 0px' });
  document.querySelectorAll('.reveal').forEach(el => obs.observe(el));
}

// ── FAIR progress bars ────────────────────────────────────────────────────────
export function initFAIRAnimation(getDatasets) {
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      setTimeout(() => {
        const datasets = getDatasets();
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.style.width = val + '%'; };
        if (datasets.length) {
          const avg = key => Math.round(datasets.reduce((s, d) => s + ((d.fair || {})[key] || 0), 0) / datasets.length);
          set('barF', avg('F')); set('barA', avg('A')); set('barI', avg('I')); set('barR', avg('R'));
        } else {
          ['barF', 'barA', 'barI', 'barR'].forEach((id, i) => set(id, [94, 95, 85, 90][i]));
        }
      }, 200);
      obs.unobserve(e.target);
    });
  }, { threshold: 0.3 });
  const el = document.querySelector('.fair-grid');
  if (el) obs.observe(el);
}

// ── Component tabs ────────────────────────────────────────────────────────────
export function showComp(i) {
  document.querySelectorAll('.comp-tab').forEach((t, j) => t.classList.toggle('active', j === i));
  document.querySelectorAll('.comp-panel').forEach((p, j) => p.classList.toggle('active', j === i));
  document.getElementById('components').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Password toggle ───────────────────────────────────────────────────────────
export function togglePwd(id, btn) {
  const inp = document.getElementById(id);
  if (inp.type === 'password') { inp.type = 'text'; btn.textContent = '🙈'; }
  else { inp.type = 'password'; btn.textContent = '👁'; }
}

// ── Animated number counter ───────────────────────────────────────────────────
export function animNum(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  let start = 0, end = parseInt(val) || 0;
  const step = () => {
    start += Math.ceil((end - start) / 8) || 1;
    el.textContent = start >= end ? end : start;
    if (start < end) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
