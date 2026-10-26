const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
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
    // jwtid lets /logout revoke exactly this session (see revoked_sessions).
    { expiresIn: '7d', jwtid: crypto.randomUUID() }
  );
}

// Logout: blacklist this token until it would have expired anyway.
async function revokeToken(token) {
  let decoded;
  try { decoded = jwt.verify(String(token || ''), JWT_SECRET); } catch { return; }
  if (!decoded.jti || !decoded.exp) return;
  await db.query(
    `INSERT INTO revoked_sessions (jti, expires_at) VALUES ($1, to_timestamp($2)) ON CONFLICT (jti) DO NOTHING`,
    [decoded.jti, decoded.exp]
  );
  if (Math.random() < 0.05) {
    db.query('DELETE FROM revoked_sessions WHERE expires_at < NOW()')
      .catch((err) => console.warn('[LOGOUT] Gagal memangkas sesi dicabut:', err.message));
  }
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
    decoded = null;
  }
  // A 2FA challenge token is signed with the same key but must never act as a session.
  if (!decoded || decoded.purpose) {
    return res.status(401).json({
      success: false,
      error: 'INVALID_TOKEN',
      message: 'Sesi tidak valid. Silakan masuk kembali.',
    });
  }

  // The JWT lives 7 days, so re-read the account: deleted/deactivated users lose access
  // immediately and role changes apply without a fresh login.
  db.query(
    `SELECT id, name, email, role, status, session_version, totp_enabled,
            EXISTS (SELECT 1 FROM revoked_sessions WHERE jti = $2) AS revoked
     FROM users WHERE id = $1`,
    [decoded.id, decoded.jti || null]
  )
    .then((result) => {
      const user = result.rows[0];
      if (user?.revoked) {
        return res.status(401).json({
          success: false,
          error: 'SESSION_REVOKED',
          message: 'Sesi ini sudah keluar. Silakan masuk kembali.',
        });
      }
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
          message: 'Kata sandi atau pengaturan keamanan akun ini telah diubah. Silakan masuk kembali.',
        });
      }
      req.user = {
        ...decoded,
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        totp_enabled: user.totp_enabled,
      };
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

// Login limiter with two counters, both stored in Postgres (table login_attempts) so every
// Vercel instance shares them; falls back to a per-instance Map if the DB call fails.
//  - per IP:      5 fails / minute  (slows a single attacker)
//  - per account: 10 fails / 15 min (stops attackers rotating IPs against one account;
//                 password and 2FA failures both count)
// The `ip` column holds the counter key: a raw IP, or `acct:<email>`.
const LIMITS = {
  ip: { max: 5, windowSecs: 60 },
  account: { max: 10, windowSecs: 15 * 60 },
};
const memoryFails = new Map(); // key -> { count, resetAt } (fallback only)

const accountKey = (email) => `acct:${String(email || '').trim().toLowerCase()}`;

async function getAttempts(key) {
  try {
    const r = await db.query(
      'SELECT count, reset_at FROM login_attempts WHERE ip = $1 AND reset_at > NOW()',
      [key]
    );
    if (!r.rows.length) return null;
    return { count: r.rows[0].count, resetAt: new Date(r.rows[0].reset_at).getTime() };
  } catch (err) {
    console.warn('[RATE LIMIT] DB tidak tersedia, pakai penghitung memori:', err.message);
    const entry = memoryFails.get(key);
    return entry && entry.resetAt > Date.now() ? entry : null;
  }
}

// Seconds until the key is unlocked, or 0 when not locked.
async function lockedFor(key, limit) {
  const entry = await getAttempts(key);
  if (!entry || entry.count < limit.max) return 0;
  return Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000));
}

function sendTooMany(res, retryAfter) {
  res.set('Retry-After', String(retryAfter));
  const wait = retryAfter > 90 ? `${Math.ceil(retryAfter / 60)} menit` : `${retryAfter} detik`;
  return res.status(429).json({
    success: false,
    error: 'TOO_MANY_ATTEMPTS',
    message: `Terlalu banyak percobaan login gagal. Coba lagi dalam ${wait}.`,
  });
}

function loginRateLimit(req, res, next) {
  lockedFor(req.ip, LIMITS.ip)
    .then((retryAfter) => (retryAfter ? sendTooMany(res, retryAfter) : next()))
    .catch(next);
}

// Checked inside the handler once the target email is known. Applies even to a correct
// password, otherwise the lock would not slow a distributed guesser.
async function accountLockedFor(email) {
  return lockedFor(accountKey(email), LIMITS.account);
}

function recordMemoryFailure(key, windowSecs) {
  const now = Date.now();
  const entry = memoryFails.get(key);
  if (!entry || entry.resetAt <= now) memoryFails.set(key, { count: 1, resetAt: now + windowSecs * 1000 });
  else entry.count += 1;
  if (memoryFails.size > 10000) {
    for (const [k, val] of memoryFails) if (val.resetAt <= now) memoryFails.delete(k);
  }
}

async function incrementAttempts(key, windowSecs) {
  try {
    // Atomic upsert: an expired window restarts at 1, otherwise the counter increments.
    await db.query(
      `INSERT INTO login_attempts (ip, count, reset_at)
       VALUES ($1, 1, NOW() + make_interval(secs => $2))
       ON CONFLICT (ip) DO UPDATE SET
         count = CASE WHEN login_attempts.reset_at <= NOW() THEN 1 ELSE login_attempts.count + 1 END,
         reset_at = CASE WHEN login_attempts.reset_at <= NOW()
                         THEN NOW() + make_interval(secs => $2) ELSE login_attempts.reset_at END`,
      [key, windowSecs]
    );
  } catch (err) {
    console.warn('[RATE LIMIT] Gagal mencatat ke DB, pakai memori:', err.message);
    recordMemoryFailure(key, windowSecs);
  }
}

// email is optional: unknown emails still count per account so probing a name is throttled too.
async function recordLoginFailure(ip, email) {
  await incrementAttempts(ip, LIMITS.ip.windowSecs);
  if (email) await incrementAttempts(accountKey(email), LIMITS.account.windowSecs);
  // Opportunistic pruning keeps the table small without a cron job.
  if (Math.random() < 0.05) {
    db.query(`DELETE FROM login_attempts WHERE reset_at < NOW() - INTERVAL '1 hour'`)
      .catch((err) => console.warn('[RATE LIMIT] Gagal memangkas:', err.message));
  }
}

async function clearLoginFailures(ip, email) {
  const keys = email ? [ip, accountKey(email)] : [ip];
  keys.forEach((k) => memoryFails.delete(k));
  try {
    await db.query('DELETE FROM login_attempts WHERE ip = ANY($1)', [keys]);
  } catch (err) {
    console.warn('[RATE LIMIT] Gagal menghapus penghitung:', err.message);
  }
}

// Forgot-password requests: every request counts (not just failures), so the endpoint
// cannot be used to spam a mailbox or to probe emails quickly.
//  - per IP:    5 requests / 15 min
//  - per email: 3 requests / hour
const RESET_LIMITS = {
  ip: { max: 5, windowSecs: 15 * 60 },
  email: { max: 3, windowSecs: 60 * 60 },
};

// Returns seconds to wait (0 = allowed) and records the attempt when allowed.
async function resetRequestLockedFor(ip, email) {
  const ipKey = `rst-ip:${ip}`;
  const emailKey = `rst:${String(email || '').trim().toLowerCase()}`;
  const wait = Math.max(await lockedFor(ipKey, RESET_LIMITS.ip), await lockedFor(emailKey, RESET_LIMITS.email));
  if (wait) return wait;
  await incrementAttempts(ipKey, RESET_LIMITS.ip.windowSecs);
  await incrementAttempts(emailKey, RESET_LIMITS.email.windowSecs);
  return 0;
}

// Short-lived token proving the password step passed; exchanged for a session at /api/auth/login/2fa.
const CHALLENGE_TTL = '5m';
function generateChallenge(user) {
  return jwt.sign({ cid: user.id, sv: user.session_version, purpose: '2fa' }, JWT_SECRET, { expiresIn: CHALLENGE_TTL });
}

function verifyChallenge(token) {
  try {
    const decoded = jwt.verify(String(token || ''), JWT_SECRET);
    return decoded.purpose === '2fa' && Number.isInteger(decoded.cid) ? decoded : null;
  } catch {
    return null;
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
  accountLockedFor,
  sendTooMany,
  resetRequestLockedFor,
  generateChallenge,
  verifyChallenge,
  recordLoginFailure,
  clearLoginFailures,
  recordLoginEvent,
  hashPassword,
  comparePassword,
  generateToken,
  revokeToken,
  authMiddleware,
  ownerOnlyMiddleware,
};
