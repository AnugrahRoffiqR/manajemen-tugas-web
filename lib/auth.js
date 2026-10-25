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
  db.query('SELECT id, name, email, role, status FROM users WHERE id = $1', [decoded.id])
    .then((result) => {
      const user = result.rows[0];
      if (!user || user.status !== 'Active') {
        return res.status(401).json({
          success: false,
          error: 'ACCOUNT_INACTIVE',
          message: 'Akun tidak aktif atau sudah dihapus. Silakan hubungi Owner.',
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

// In-memory login limiter: max 5 failed attempts per IP per minute.
// Per-instance only (on Vercel each warm instance keeps its own counter).
const LOGIN_MAX_FAILS = 5;
const LOGIN_WINDOW_MS = 60 * 1000;
const loginFails = new Map(); // ip -> { count, resetAt }

function loginRateLimit(req, res, next) {
  const now = Date.now();
  const entry = loginFails.get(req.ip);
  if (entry && entry.resetAt > now && entry.count >= LOGIN_MAX_FAILS) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({
      success: false,
      error: 'TOO_MANY_ATTEMPTS',
      message: `Terlalu banyak percobaan login gagal. Coba lagi dalam ${retryAfter} detik.`,
    });
  }
  next();
}

function recordLoginFailure(ip) {
  const now = Date.now();
  const entry = loginFails.get(ip);
  if (!entry || entry.resetAt <= now) {
    loginFails.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    entry.count += 1;
  }
  // Keep the map bounded by pruning expired entries opportunistically.
  if (loginFails.size > 10000) {
    for (const [key, val] of loginFails) if (val.resetAt <= now) loginFails.delete(key);
  }
}

function clearLoginFailures(ip) {
  loginFails.delete(ip);
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
  hashPassword,
  comparePassword,
  generateToken,
  authMiddleware,
  ownerOnlyMiddleware,
};
