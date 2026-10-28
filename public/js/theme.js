/**
 * THEME.JS — loaded in <head> on every page so the theme is set before first paint.
 * Saved choice (localStorage "theme": "light" | "dark") wins; otherwise follow the system setting.
 * Also registers the service worker (PWA).
 */
(function () {
  const KEY = 'theme';
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const saved = () => {
    try { return localStorage.getItem(KEY); } catch { return null; }
  };
  const resolve = () => {
    const s = saved();
    return s === 'dark' || s === 'light' ? s : (media.matches ? 'dark' : 'light');
  };
  const apply = (theme) => {
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#15120f' : '#faf6f0';
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(theme === 'dark'));
      btn.setAttribute('aria-label', theme === 'dark' ? 'Ganti ke tema terang' : 'Ganti ke tema gelap');
      btn.title = btn.getAttribute('aria-label');
    });
  };

  apply(resolve());
  // Last known role (saved by navbar.js) so .owner-only/.member-only blocks are right on first paint.
  // Cosmetic only: /api/auth/me overwrites it and the API enforces every permission.
  try {
    const role = sessionStorage.getItem('role');
    if (role === 'Owner' || role === 'User') document.documentElement.dataset.role = role;
  } catch { /* storage blocked */ }
  media.addEventListener?.('change', () => { if (!saved()) apply(resolve()); });
  // Another tab changed the theme.
  window.addEventListener('storage', (e) => { if (e.key === KEY) apply(resolve()); });

  window.toggleTheme = function () {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch { /* private mode: still switch for this page */ }
    apply(next);
  };
  // Buttons rendered later (navbar) pick up the current state.
  window.syncThemeToggles = () => apply(document.documentElement.dataset.theme || resolve());

  // Printed reports are always light.
  let beforePrint = null;
  window.addEventListener('beforeprint', () => {
    beforePrint = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = 'light';
  });
  window.addEventListener('afterprint', () => { if (beforePrint) apply(beforePrint); });

  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* PWA is optional */ });
    });
  }
})();
