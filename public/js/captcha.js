// Cloudflare Turnstile widget for public forms. Does nothing when the server has no site key.
// Usage: const captcha = mountCaptcha(containerEl, 'login'); body.turnstile_token = captcha.token(); captcha.reset();
window.mountCaptcha = function mountCaptcha(container, action) {
  let widgetId = null;
  let current = '';
  let enabled = false;

  const ready = (async () => {
    let siteKey = null;
    try {
      siteKey = (await (await fetch('/api/auth/captcha')).json()).data?.siteKey;
    } catch { /* server unreachable: the form submit shows its own error */ }
    if (!siteKey) return;
    enabled = true;
    container.hidden = false;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    }).catch(() => {
      container.textContent = 'Verifikasi keamanan gagal dimuat. Muat ulang halaman.';
    });
    if (!window.turnstile) return;
    widgetId = window.turnstile.render(container, {
      sitekey: siteKey,
      action,
      theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
      language: 'id',
      callback: (t) => { current = t; },
      'expired-callback': () => { current = ''; },
      'error-callback': () => { current = ''; },
    });
  })();

  return {
    ready,
    get enabled() { return enabled; },
    token: () => current,
    // Tokens are single-use: reset after every submit attempt.
    reset() {
      current = '';
      if (widgetId !== null && window.turnstile) window.turnstile.reset(widgetId);
    },
  };
};
