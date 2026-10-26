const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

// Fail fast: a missing or short secret would make session tokens forgeable.
const JWT_SECRET = process.env.ADMIN_SESSION_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('ADMIN_SESSION_SECRET wajib diisi minimal 32 karakter (lihat .env.example).');
}
const COOKIE_NAME = 'session_token';
const PASSWORD_MIN_LENGTH = 8;

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 hari
  path: '/',
};

async function hashPassword(plainPassword) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plainPassword, salt);
}

async function comparePassword(plainPassword, hashedPassword) {
  return bcrypt.compare(plainPassword, hashedPassword);
}

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      sv: user.session_version,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function authMiddleware(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME] || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Sesi tidak ditemukan atau telah kedaluwarsa. Silakan masuk kembali.',
    });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: 'INVALID_TOKEN',
      message: 'Sesi tidak valid. Silakan masuk kembali.',
    });
  }

  // The JWT lives 7 days, so re-read the account: deleted/deactivated users lose access
  // immediately and role changes apply without a fresh login.
  db.query('SELECT id, name, email, role, status, session_version FROM users WHERE id = $1', [decoded.id])
    .then((result) => {
      const user = result.rows[0];
      if (!user || user.status !== 'Active') {
        return res.status(401).json({
          success: false,
          error: 'ACCOUNT_INACTIVE',
          message: 'Akun tidak aktif atau sudah dihapus. Silakan hubungi Owner.',
        });
      }
      // session_version is bumped on password change, revoking every token issued before it.
      if (decoded.sv !== user.session_version) {
        return res.status(401).json({
          success: false,
          error: 'SESSION_REVOKED',
          message: 'Kata sandi akun ini telah diubah. Silakan masuk kembali.',
        });
      }
      req.user = { ...decoded, id: user.id, name: user.name, email: user.email, role: user.role };
      next();
    })
    .catch(next);
}

// CSRF guard for cookie-authenticated writes: browsers always send Origin on
// cross-site POST/PUT/DELETE, so a mismatch with Host means a forged request.
function sameOriginMiddleware(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next(); // non-browser clients (curl, server-to-server)
  let originHost;
  try { originHost = new URL(origin).host; } catch { originHost = null; }
  const host = req.get('x-forwarded-host') || req.get('host');
  if (originHost && originHost === host) return next();
  return res.status(403).json({
    success: false,
    error: 'CSRF_REJECTED',
    message: 'Permintaan ditolak karena berasal dari situs lain.',
  });
}

// Login limiter: max 5 failed attempts per IP per minute.
// Stored in Postgres (table login_attempts) so every Vercel instance shares one counter;
// falls back to a per-instance Map if the DB call fails, so login never hard-fails on it.
const LOGIN_MAX_FAILS = 5;
const LOGIN_WINDOW_MS = 60 * 1000;
const memoryFails = new Map(); // ip -> { count, resetAt } (fallback only)

async function getLoginEntry(ip) {
  try {
    const r = await db.query(
      'SELECT count, reset_at FROM login_attempts WHERE ip = $1 AND reset_at > NOW()',
      [ip]
    );
    if (!r.rows.length) return null;
    return { count: r.rows[0].count, resetAt: new Date(r.rows[0].reset_at).getTime() };
  } catch (err) {
    console.warn('[RATE LIMIT] DB tidak tersedia, pakai penghitung memori:', err.message);
    const entry = memoryFails.get(ip);
    return entry && entry.resetAt > Date.now() ? entry : null;
  }
}

function loginRateLimit(req, res, next) {
  getLoginEntry(req.ip)
    .then((entry) => {
      if (entry && entry.count >= LOGIN_MAX_FAILS) {
        const retryAfter = Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000));
        res.set('Retry-After', String(retryAfter));
        return res.status(429).json({
          success: false,
          error: 'TOO_MANY_ATTEMPTS',
          message: `Terlalu banyak percobaan login gagal. Coba lagi dalam ${retryAfter} detik.`,
        });
      }
      next();
    })
    .catch(next);
}

function recordMemoryFailure(ip) {
  const now = Date.now();
  const entry = memoryFails.get(ip);
  if (!entry || entry.resetAt <= now) memoryFails.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  else entry.count += 1;
  if (memoryFails.size > 10000) {
    for (const [key, val] of memoryFails) if (val.resetAt <= now) memoryFails.delete(key);
  }
}

async function recordLoginFailure(ip) {
  try {
    // Atomic upsert: an expired window restarts at 1, otherwise the counter increments.
    await db.query(
      `INSERT INTO login_attempts (ip, count, reset_at)
       VALUES ($1, 1, NOW() + make_interval(secs => $2))
       ON CONFLICT (ip) DO UPDATE SET
         count = CASE WHEN login_attempts.reset_at <= NOW() THEN 1 ELSE login_attempts.count + 1 END,
         reset_at = CASE WHEN login_attempts.reset_at <= NOW()
                         THEN NOW() + make_interval(secs => $2) ELSE login_attempts.reset_at END`,
      [ip, LOGIN_WINDOW_MS / 1000]
    );
    // Opportunistic pruning keeps the table small without a cron job.
    if (Math.random() < 0.05) {
      await db.query(`DELETE FROM login_attempts WHERE reset_at < NOW() - INTERVAL '1 hour'`);
    }
  } catch (err) {
    console.warn('[RATE LIMIT] Gagal mencatat ke DB, pakai memori:', err.message);
    recordMemoryFailure(ip);
  }
}

async function clearLoginFailures(ip) {
  memoryFails.delete(ip);
  try {
    await db.query('DELETE FROM login_attempts WHERE ip = $1', [ip]);
  } catch (err) {
    console.warn('[RATE LIMIT] Gagal menghapus penghitung:', err.message);
  }
}

// Audit trail for the Owner. Never blocks login: a logging failure is only warned.
async function recordLoginEvent(req, { userId = null, email, success, reason }) {
  try {
    await db.query(
      `INSERT INTO login_events (user_id, email, ip, user_agent, success, reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userId,
        String(email || '').slice(0, 150),
        String(req.ip || '').slice(0, 64),
        String(req.get('user-agent') || '').slice(0, 300),
        success,
        reason,
      ]
    );
    if (Math.random() < 0.02) {
      await db.query(`DELETE FROM login_events WHERE created_at < NOW() - INTERVAL '90 days'`);
    }
  } catch (err) {
    console.warn('[LOGIN EVENTS] Gagal mencatat:', err.message);
  }
}

function ownerOnlyMiddleware(req, res, next) {
  if (!req.user || req.user.role !== 'Owner') {
    return res.status(403).json({
      success: false,
      error: 'FORBIDDEN',
      message: 'Akses ditolak. Fitur ini hanya dapat diakses oleh peran Owner.',
    });
  }
  next();
}

module.exports = {
  COOKIE_NAME,
  COOKIE_OPTIONS,
  PASSWORD_MIN_LENGTH,
  sameOriginMiddleware,
  loginRateLimit,
  recordLoginFailure,
  clearLoginFailures,
  recordLoginEvent,
  hashPassword,
  comparePassword,
  generateToken,
  authMiddleware,
  ownerOnlyMiddleware,
};
