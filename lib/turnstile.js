// Cloudflare Turnstile. Enforced only when TURNSTILE_SECRET_KEY and TURNSTILE_SITE_KEY are both set;
// the server never trusts a client flag, it always asks Siteverify.
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const isEnabled = () => Boolean(process.env.TURNSTILE_SECRET_KEY && process.env.TURNSTILE_SITE_KEY);
const siteKey = () => (isEnabled() ? process.env.TURNSTILE_SITE_KEY : null);

// Cloudflare's public dummy keys start with 1x00000000/2x00000000/3x00000000; the "always passes" pair
// would turn the captcha into a no-op, so flag them loudly in production.
const isTestKey = (key) => /^[123]x0{8}/.test(String(key || ''));
if (process.env.NODE_ENV === 'production' && isEnabled()
    && (isTestKey(process.env.TURNSTILE_SITE_KEY) || isTestKey(process.env.TURNSTILE_SECRET_KEY))) {
  console.error('[TURNSTILE] PERINGATAN: test key Cloudflare terpasang di production. Ganti dengan key asli.');
}

/** Returns { ok: true } or { ok: false, reason: 'missing' | 'rejected' | 'unavailable', codes? }. */
async function verify(token, ip, expectedAction) {
  if (typeof token !== 'string' || !token || token.length > 2048) return { ok: false, reason: 'missing' };
  let data;
  try {
    const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: token });
    if (ip) body.set('remoteip', ip);
    const res = await fetch(SITEVERIFY, { method: 'POST', body, signal: AbortSignal.timeout(5000) });
    data = await res.json();
  } catch (err) {
    console.error('[TURNSTILE] Siteverify gagal:', err.name, err.message);
    return { ok: false, reason: 'unavailable' };
  }
  if (!data?.success) return { ok: false, reason: 'rejected', codes: data?.['error-codes'] || [] };
  // Test keys return action "test"; only compare when Cloudflare echoes a real action.
  if (expectedAction && data.action && data.action !== 'test' && data.action !== expectedAction) {
    return { ok: false, reason: 'rejected', codes: ['action-mismatch'] };
  }
  return { ok: true };
}

/** Express middleware factory; no-op when Turnstile is not configured. */
function requireTurnstile(action) {
  return async (req, res, next) => {
    if (!isEnabled()) return next();
    const result = await verify(req.body?.turnstile_token, req.ip, action);
    if (result.ok) return next();
    if (result.reason === 'unavailable') {
      return res.status(503).json({ success: false, error: 'CAPTCHA_UNAVAILABLE', message: 'Verifikasi keamanan sedang tidak bisa dihubungi. Coba lagi sebentar.' });
    }
    return res.status(400).json({ success: false, error: 'CAPTCHA_FAILED', message: 'Verifikasi keamanan gagal atau kedaluwarsa. Selesaikan ulang lalu coba lagi.' });
  };
}

module.exports = { isEnabled, isTestKey, siteKey, verify, requireTurnstile };
