process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});
process.on('exit', (code) => {
  console.log('[PROCESS EXIT EVENT] Exit code:', code);
});
process.on('beforeExit', (code) => {
  console.log('[PROCESS BEFORE_EXIT EVENT] Code:', code);
});

const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const db = require('./lib/db');
const totp = require('./lib/totp');
const { isMailConfigured, sendMail } = require('./lib/mailer');
const { notify, logError, buildMail } = require('./lib/notify');
const turnstile = require('./lib/turnstile');
const {
  COOKIE_NAME,
  COOKIE_OPTIONS,
  PASSWORD_MIN_LENGTH,
  hashPassword,
  comparePassword,
  generateToken,
  revokeToken,
  authMiddleware,
  ownerOnlyMiddleware,
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
} = require('./lib/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust the first proxy hop (Vercel) so req.ip is the real client IP for rate limiting.
app.set('trust proxy', 1);

// Browser security headers. Keep in sync with "headers" in vercel.json (Vercel serves static files itself).
// No inline scripts/handlers allowed: page code lives in /js/pages, events use data-click (api.js).
app.disable('x-powered-by');
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
app.use((req, res, next) => {
  res.set(SECURITY_HEADERS);
  next();
});

// Middleware
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', sameOriginMiddleware);

// Reject non-numeric :id before it reaches SQL (otherwise Postgres throws -> 500).
const checkIdParam = (req, res, next, value) => {
  if (!/^\d+$/.test(value) || Number(value) > 2147483647) {
    return res.status(400).json({ success: false, error: 'BAD_REQUEST', message: 'ID tidak valid.' });
  }
  next();
};
app.param('id', checkIdParam);
app.param('itemId', checkIdParam);

function isValidPassword(password) {
  return typeof password === 'string' && password.trim().length >= PASSWORD_MIN_LENGTH;
}

// ==========================================
// INPUT VALIDATION HELPERS
// ==========================================
const TASK_STATUSES = ['To Do', 'In Progress', 'Done'];
const USER_ROLES = ['Owner', 'User'];
const USER_STATUSES = ['Active', 'Inactive'];
const MAX_INT = 2147483647;

// console + error_logs (fire-and-forget) so the Owner can see server errors in the app.
function reportError(req, tag, err) {
  console.error(tag, err);
  logError('server', tag, err, { path: `${req.method} ${req.originalUrl}`.slice(0, 300), userId: req.user?.id });
}

function badRequest(res, message) {
  return res.status(400).json({ success: false, error: 'BAD_REQUEST', message });
}

// Repeated query keys (?a=1&a=2) arrive as arrays; treat anything but a string as absent.
function queryString(value) {
  return typeof value === 'string' ? value : undefined;
}

function isPositiveIntLike(value) {
  return /^\d+$/.test(String(value)) && Number(value) > 0 && Number(value) <= MAX_INT;
}

function parseDateInput(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function escapeHtmlServer(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function isBlankOptional(value) {
  return value === undefined || value === null || value === '';
}

/** Returns an error message, or null when the task body is valid. */
function validateTaskBody(body, isCreate) {
  const { title, description, status, due_date, user_id } = body;
  if (isCreate || title !== undefined) {
    if (typeof title !== 'string' || !title.trim()) return 'Judul tugas wajib diisi.';
    if (title.trim().length > 200) return 'Judul tugas maksimal 200 karakter.';
  }
  if (description !== undefined && description !== null && typeof description !== 'string') return 'Deskripsi tidak valid.';
  if (typeof description === 'string' && description.trim().length > 5000) return 'Deskripsi maksimal 5000 karakter.';
  if (status !== undefined && !TASK_STATUSES.includes(status)) return 'Status harus To Do, In Progress, atau Done.';
  if (isCreate && isBlankOptional(due_date)) return 'Tenggat waktu (deadline) wajib diisi.';
  if (!isBlankOptional(due_date) && !parseDateInput(due_date)) return 'Format tenggat waktu tidak valid.';
  if (!isBlankOptional(user_id) && !isPositiveIntLike(user_id)) return 'Penanggung jawab tugas tidak valid.';
  return null;
}

/** Penanggung jawab must be an active Owner; returns the id, or null if the target is invalid. */
async function resolveAssignee(rawUserId, fallbackId) {
  if (isBlankOptional(rawUserId)) return fallbackId;
  const id = Number(rawUserId);
  const result = await db.query(`SELECT id FROM users WHERE id = $1 AND status = 'Active' AND role = 'Owner'`, [id]);
  return result.rows.length ? id : null;
}

// ==========================================
// HEALTH CHECK
// ==========================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==========================================
// MODUL AUTENTIKASI API (/api/auth)
// ==========================================
// bcrypt hash (cost 10, same as hashPassword) of a random string nobody knows.
const DUMMY_PASSWORD_HASH = require('bcryptjs').hashSync(crypto.randomBytes(16).toString('hex'), 10);

// Public: the browser needs the site key to render the widget (null = Turnstile off).
app.get('/api/auth/captcha', (req, res) => {
  return res.json({ success: true, data: { siteKey: turnstile.siteKey() } });
});

app.post('/api/auth/login', loginRateLimit, turnstile.requireTurnstile('login'), async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'BAD_REQUEST',
        message: 'Alamat email dan kata sandi wajib diisi.',
      });
    }

    const lockedFor = await accountLockedFor(email);
    if (lockedFor) return sendTooMany(res, lockedFor);

    const userRes = await db.query(
      `SELECT id, name, email, password, role, status, session_version, totp_enabled
       FROM users WHERE LOWER(email) = LOWER($1)`,
      [email.trim()]
    );

    if (userRes.rows.length === 0) {
      // Burn the same bcrypt time as a real check so response time does not reveal registered emails.
      await comparePassword(password, DUMMY_PASSWORD_HASH);
      await recordLoginFailure(req.ip, email);
      await recordLoginEvent(req, { email: email.trim(), success: false, reason: 'UNKNOWN_EMAIL' });
      return res.status(401).json({
        success: false,
        error: 'INVALID_CREDENTIALS',
        message: 'Email atau kata sandi tidak sesuai. Silakan periksa kembali.',
      });
    }

    const user = userRes.rows[0];

    const isMatch = await comparePassword(password, user.password);
    if (!isMatch) {
      await recordLoginFailure(req.ip, user.email);
      await recordLoginEvent(req, { userId: user.id, email: user.email, success: false, reason: 'WRONG_PASSWORD' });
      return res.status(401).json({
        success: false,
        error: 'INVALID_CREDENTIALS',
        message: 'Email atau kata sandi tidak sesuai. Silakan periksa kembali.',
      });
    }

    // Checked after the password so account status is not revealed to guessers.
    if (user.status !== 'Active') {
      await recordLoginEvent(req, { userId: user.id, email: user.email, success: false, reason: 'INACTIVE' });
      return res.status(403).json({
        success: false,
        error: 'ACCOUNT_INACTIVE',
        message: 'Akun Anda dinonaktifkan oleh Administrator. Silakan hubungi Owner.',
      });
    }

    // Password is right but 2FA is on: no session yet, only a 5-minute challenge token.
    if (user.totp_enabled) {
      return res.json({
        success: true,
        twoFactorRequired: true,
        challenge: generateChallenge(user),
        message: 'Masukkan kode 6 digit dari aplikasi authenticator Anda.',
      });
    }

    return completeLogin(req, res, user);
  } catch (err) {
    reportError(req, '[API AUTH LOGIN]', err);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Terjadi kesalahan sistem internal. Silakan coba lagi nanti.',
    });
  }
});

async function completeLogin(req, res, user) {
  await clearLoginFailures(req.ip, user.email);
  await recordLoginEvent(req, { userId: user.id, email: user.email, success: true, reason: 'OK' });
  res.cookie(COOKIE_NAME, generateToken(user), COOKIE_OPTIONS);
  return res.json({
    success: true,
    data: { id: user.id, name: user.name, email: user.email, role: user.role },
    message: `Selamat datang kembali, ${user.name}!`,
  });
}

const INVALID_2FA = {
  success: false,
  error: 'INVALID_2FA_CODE',
  message: 'Kode verifikasi salah atau sudah dipakai. Periksa aplikasi authenticator Anda.',
};

app.post('/api/auth/login/2fa', loginRateLimit, async (req, res) => {
  try {
    const { challenge, code } = req.body || {};
    const decoded = verifyChallenge(challenge);
    if (!decoded) {
      return res.status(401).json({
        success: false,
        error: 'CHALLENGE_EXPIRED',
        message: 'Waktu verifikasi habis. Silakan masukkan email dan kata sandi lagi.',
      });
    }

    const userRes = await db.query(
      `SELECT id, name, email, role, status, session_version, totp_enabled, totp_secret, totp_last_step
       FROM users WHERE id = $1`,
      [decoded.cid]
    );
    const user = userRes.rows[0];
    // Account removed, deactivated, password changed or 2FA reset since the password step.
    if (!user || user.status !== 'Active' || !user.totp_enabled || user.session_version !== decoded.sv) {
      return res.status(401).json({
        success: false,
        error: 'CHALLENGE_EXPIRED',
        message: 'Sesi verifikasi tidak berlaku lagi. Silakan masuk ulang.',
      });
    }

    const lockedFor = await accountLockedFor(user.email);
    if (lockedFor) return sendTooMany(res, lockedFor);

    const step = totp.verify(user.totp_secret, code, { lastUsedStep: user.totp_last_step });
    // Conditional update makes the one-time use atomic even for two parallel requests.
    const claimed = step !== null && (await db.query(
      `UPDATE users SET totp_last_step = $1
       WHERE id = $2 AND (totp_last_step IS NULL OR totp_last_step < $1)`,
      [step, user.id]
    )).rowCount === 1;

    if (!claimed) {
      await recordLoginFailure(req.ip, user.email);
      await recordLoginEvent(req, { userId: user.id, email: user.email, success: false, reason: 'WRONG_2FA' });
      return res.status(401).json(INVALID_2FA);
    }

    return completeLogin(req, res, user);
  } catch (err) {
    reportError(req, '[API AUTH LOGIN 2FA]', err);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Terjadi kesalahan sistem internal. Silakan coba lagi nanti.',
    });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    await revokeToken(req.cookies?.[COOKIE_NAME]);
  } catch (err) {
    // Still clear the cookie; the token then simply expires on its own.
    console.error('[API AUTH LOGOUT]', err.message);
  }
  res.clearCookie(COOKIE_NAME, { path: '/' });
  return res.json({
    success: true,
    message: 'Anda berhasil keluar dari sistem.',
  });
});

// ------------------------------------------
// Lupa kata sandi (email via Resend)
// ------------------------------------------
// The emailed token is random and only its SHA-256 is stored, so a DB leak cannot be
// turned into reset links. Links live 30 minutes and work once.
const RESET_TTL_MINUTES = 30;
const hashResetToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Public on purpose: shown on the forgot-password page so members can reach the Owner.
app.get('/api/auth/contact', (req, res) => {
  const wa = (process.env.OWNER_CONTACT_WA || '').replace(/\D/g, '');
  return res.json({ success: true, data: { whatsapp: /^\d{8,15}$/.test(wa) ? wa : null } });
});

// Product decision: the reply says whether the email is registered and which role it has,
// so Owners get an email link and members are sent to the Owner. This reveals accounts;
// the per-IP/per-email limits below are what keeps guessing slow.
app.post('/api/auth/forgot-password', turnstile.requireTurnstile('forgot'), async (req, res) => {
  const reply = (status, body) => res.status(status).json(body);
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    if (!email || email.length > 150 || !email.includes('@')) {
      return badRequest(res, 'Masukkan alamat email yang valid.');
    }
    const wait = await resetRequestLockedFor(req.ip, email);
    if (wait) {
      res.set('Retry-After', String(wait));
      return res.status(429).json({
        success: false,
        error: 'TOO_MANY_REQUESTS',
        message: `Terlalu banyak permintaan. Coba lagi dalam ${Math.ceil(wait / 60)} menit.`,
      });
    }

    const userRes = await db.query(
      `SELECT id, name, email, role, status FROM users WHERE LOWER(email) = LOWER($1)`,
      [email]
    );
    const user = userRes.rows[0];
    if (!user) {
      return reply(404, { success: false, error: 'EMAIL_NOT_FOUND', message: 'Email ini tidak terdaftar. Periksa kembali penulisannya.' });
    }
    if (user.status !== 'Active') {
      return reply(200, { success: true, data: { account: 'inactive' }, message: 'Akun ini sedang nonaktif. Hubungi Owner untuk mengaktifkannya kembali.' });
    }
    // Members never get an email link: the request goes to the Owner's Kelola Tim panel.
    if (user.role !== 'Owner') {
      await db.query('UPDATE users SET reset_requested_at = NOW() WHERE id = $1', [user.id]);
      await recordLoginEvent(req, { userId: user.id, email: user.email, success: true, reason: 'RESET_ASKED_OWNER' });
      return reply(200, {
        success: true,
        data: { account: 'member' },
        message: 'Permintaan Anda sudah diteruskan ke Owner. Hubungi Owner agar kata sandi baru segera dibuatkan.',
      });
    }
    if (!isMailConfigured()) {
      return reply(503, { success: false, error: 'MAIL_NOT_CONFIGURED', message: 'Reset lewat email belum aktif di server.' });
    }

    const token = crypto.randomBytes(32).toString('base64url');
    // One live link per user: a new request invalidates the previous one.
    await db.query('DELETE FROM password_resets WHERE user_id = $1 OR expires_at < NOW()', [user.id]);
    await db.query(
      `INSERT INTO password_resets (token_hash, user_id, expires_at)
       VALUES ($1, $2, NOW() + make_interval(mins => $3))`,
      [hashResetToken(token), user.id, RESET_TTL_MINUTES]
    );

    // Token in the URL fragment: it is never sent to the server in logs or Referer headers.
    const link = `${process.env.APP_URL.replace(/\/+$/, '')}/reset-password#token=${token}`;
    const safeName = escapeHtmlServer(user.name);
    try {
      await sendMail({
      to: user.email,
      subject: 'Atur ulang kata sandi Manajemen Tugas',
      text: `Halo ${user.name},\n\nBuka tautan ini untuk membuat kata sandi baru (berlaku ${RESET_TTL_MINUTES} menit, sekali pakai):\n${link}\n\nJika Anda tidak meminta reset, abaikan email ini. Kata sandi Anda tidak berubah.`,
        html: `<p>Halo ${safeName},</p><p>Klik tautan di bawah untuk membuat kata sandi baru. Tautan berlaku ${RESET_TTL_MINUTES} menit dan hanya bisa dipakai sekali.</p><p><a href="${link}">Atur ulang kata sandi</a></p><p>Jika Anda tidak meminta reset, abaikan email ini. Kata sandi Anda tidak berubah.</p>`,
      });
    } catch (err) {
      console.error('[API AUTH FORGOT] Gagal kirim email:', err.message);
      await db.query('DELETE FROM password_resets WHERE user_id = $1', [user.id]);
      await recordLoginEvent(req, { userId: user.id, email: user.email, success: false, reason: 'RESET_MAIL_FAILED' });
      return reply(502, { success: false, error: 'MAIL_FAILED', message: 'Email reset gagal dikirim. Coba lagi beberapa saat.' });
    }
    await recordLoginEvent(req, { userId: user.id, email: user.email, success: true, reason: 'RESET_REQUESTED' });
    return reply(200, {
      success: true,
      data: { account: 'owner' },
      message: `Tautan reset sudah dikirim ke ${user.email}. Berlaku ${RESET_TTL_MINUTES} menit. Periksa juga folder spam.`,
    });
  } catch (err) {
    console.error('[API AUTH FORGOT]', err.message);
    return reply(500, { success: false, error: 'SERVER_ERROR', message: 'Email belum bisa dikirim. Coba lagi beberapa saat.' });
  }
});

app.post('/api/auth/reset-password', loginRateLimit, async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      await recordLoginFailure(req.ip);
      return res.status(400).json({ success: false, error: 'INVALID_RESET_TOKEN', message: 'Tautan reset tidak valid atau sudah kedaluwarsa. Minta tautan baru.' });
    }
    if (!isValidPassword(password) || password.length > 200) {
      return badRequest(res, `Kata sandi minimal ${PASSWORD_MIN_LENGTH} karakter.`);
    }

    // Atomic claim: two parallel submissions cannot both use the same link.
    const claim = await db.query(
      `UPDATE password_resets SET used_at = NOW()
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
       RETURNING user_id`,
      [hashResetToken(token)]
    );
    if (!claim.rows.length) {
      await recordLoginFailure(req.ip);
      return res.status(400).json({ success: false, error: 'INVALID_RESET_TOKEN', message: 'Tautan reset tidak valid atau sudah kedaluwarsa. Minta tautan baru.' });
    }

    // session_version bump logs out every existing session. 2FA stays on if it was enabled.
    const upd = await db.query(
      `UPDATE users SET password = $1, session_version = session_version + 1, reset_requested_at = NULL
       WHERE id = $2 AND status = 'Active'
       RETURNING id, email`,
      [await hashPassword(password.trim()), claim.rows[0].user_id]
    );
    await db.query('DELETE FROM password_resets WHERE user_id = $1', [claim.rows[0].user_id]);
    if (!upd.rows.length) {
      return res.status(400).json({ success: false, error: 'INVALID_RESET_TOKEN', message: 'Akun ini tidak aktif. Hubungi Owner.' });
    }
    await clearLoginFailures(req.ip, upd.rows[0].email);
    await recordLoginEvent(req, { userId: upd.rows[0].id, email: upd.rows[0].email, success: true, reason: 'PASSWORD_RESET' });
    return res.json({ success: true, message: 'Kata sandi berhasil diganti. Silakan masuk dengan kata sandi baru.' });
  } catch (err) {
    console.error('[API AUTH RESET]', err.message);
    return res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Terjadi kesalahan sistem internal. Silakan coba lagi nanti.' });
  }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const { id, name, email, role, totp_enabled } = req.user;
    const pref = await db.query('SELECT email_notifications FROM users WHERE id = $1', [id]);
    return res.json({
      success: true,
      data: { id, name, email, role, totp_enabled, email_notifications: pref.rows[0]?.email_notifications ?? true },
    });
  } catch (err) {
    reportError(req, '[API AUTH ME]', err);
    return res.status(500).json({ success: false, message: 'Gagal memuat profil.' });
  }
});

// Every user edits their own name and email preference (email address and role stay Owner-managed).
app.put('/api/auth/profile', authMiddleware, async (req, res) => {
  try {
    const { name, email_notifications: emailNotif } = req.body || {};
    if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.trim().length > 100)) {
      return badRequest(res, 'Nama wajib diisi (maksimal 100 karakter).');
    }
    if (emailNotif !== undefined && typeof emailNotif !== 'boolean') return badRequest(res, 'Pilihan email tidak valid.');
    const upd = await db.query(
      `UPDATE users SET name = COALESCE($2, name), email_notifications = COALESCE($3, email_notifications)
       WHERE id = $1 RETURNING id, name, email, role, email_notifications`,
      [req.user.id, name === undefined ? null : name.trim(), emailNotif ?? null]
    );
    return res.json({ success: true, data: upd.rows[0], message: 'Profil disimpan.' });
  } catch (err) {
    reportError(req, '[API AUTH PROFILE]', err);
    return res.status(500).json({ success: false, message: 'Gagal menyimpan profil.' });
  }
});

// Self-service password change. Logs out other devices; this device gets a fresh cookie.
app.post('/api/auth/change-password', authMiddleware, async (req, res) => {
  try {
    const { current_password: current, new_password: next } = req.body || {};
    if (typeof current !== 'string' || !current) return badRequest(res, 'Masukkan kata sandi saat ini.');
    if (!isValidPassword(next)) return badRequest(res, `Kata sandi baru minimal ${PASSWORD_MIN_LENGTH} karakter.`);
    if (next.length > 200) return badRequest(res, 'Kata sandi baru maksimal 200 karakter.');
    if (next === current) return badRequest(res, 'Kata sandi baru harus berbeda dari yang lama.');

    const wait = await accountLockedFor(req.user.email);
    if (wait) return sendTooMany(res, wait);
    const row = (await db.query('SELECT password FROM users WHERE id = $1', [req.user.id])).rows[0];
    if (!row || !(await comparePassword(current, row.password))) {
      await recordLoginFailure(req.ip, req.user.email);
      return res.status(400).json({ success: false, error: 'INVALID_CREDENTIALS', message: 'Kata sandi saat ini salah.' });
    }
    const upd = await db.query(
      `UPDATE users SET password = $2, session_version = session_version + 1, reset_requested_at = NULL
       WHERE id = $1 RETURNING id, name, email, role, session_version`,
      [req.user.id, await hashPassword(next)]
    );
    res.cookie(COOKIE_NAME, generateToken(upd.rows[0]), COOKIE_OPTIONS);
    return res.json({ success: true, message: 'Kata sandi diganti. Perangkat lain telah dikeluarkan.' });
  } catch (err) {
    reportError(req, '[API AUTH CHANGE PASSWORD]', err);
    return res.status(500).json({ success: false, message: 'Gagal mengganti kata sandi.' });
  }
});

// ------------------------------------------
// 2FA (TOTP) — every user manages their own
// ------------------------------------------
// Step 1: create a pending secret. It only takes effect after /enable confirms a code.
app.post('/api/auth/2fa/setup', authMiddleware, async (req, res) => {
  try {
    if (req.user.totp_enabled) {
      return res.status(409).json({ success: false, error: 'ALREADY_ENABLED', message: '2FA sudah aktif.' });
    }
    const secret = totp.generateSecret();
    await db.query('UPDATE users SET totp_secret = $1, totp_last_step = NULL WHERE id = $2', [secret, req.user.id]);
    return res.json({ success: true, data: { secret, otpauthUri: totp.otpauthUri(secret, req.user.email) } });
  } catch (err) {
    reportError(req, '[API 2FA SETUP]', err);
    return res.status(500).json({ success: false, message: 'Gagal menyiapkan 2FA.' });
  }
});

// Step 2: confirm the authenticator works. Logs out other devices (like a password change).
app.post('/api/auth/2fa/enable', authMiddleware, async (req, res) => {
  try {
    const r = await db.query('SELECT totp_secret, totp_enabled FROM users WHERE id = $1', [req.user.id]);
    const row = r.rows[0];
    if (!row?.totp_secret || row.totp_enabled) {
      return res.status(400).json({ success: false, error: 'NO_PENDING_SETUP', message: 'Mulai penyiapan 2FA terlebih dahulu.' });
    }
    const step = totp.verify(row.totp_secret, req.body?.code);
    if (step === null) return res.status(400).json(INVALID_2FA);

    const upd = await db.query(
      `UPDATE users SET totp_enabled = true, totp_last_step = $1, session_version = session_version + 1
       WHERE id = $2 RETURNING id, name, email, role, session_version`,
      [step, req.user.id]
    );
    res.cookie(COOKIE_NAME, generateToken(upd.rows[0]), COOKIE_OPTIONS);
    return res.json({ success: true, message: '2FA aktif. Perangkat lain yang sedang login telah dikeluarkan.' });
  } catch (err) {
    reportError(req, '[API 2FA ENABLE]', err);
    return res.status(500).json({ success: false, message: 'Gagal mengaktifkan 2FA.' });
  }
});

// Turning 2FA off needs both factors, so a hijacked open session alone cannot remove it.
app.post('/api/auth/2fa/disable', authMiddleware, async (req, res) => {
  try {
    const { password, code } = req.body || {};
    const lockedFor = await accountLockedFor(req.user.email);
    if (lockedFor) return sendTooMany(res, lockedFor);

    const r = await db.query('SELECT password, totp_secret, totp_enabled, totp_last_step FROM users WHERE id = $1', [req.user.id]);
    const row = r.rows[0];
    if (!row?.totp_enabled) {
      return res.status(400).json({ success: false, error: 'NOT_ENABLED', message: '2FA belum aktif.' });
    }
    const passwordOk = typeof password === 'string' && await comparePassword(password, row.password);
    const step = passwordOk ? totp.verify(row.totp_secret, code, { lastUsedStep: row.totp_last_step }) : null;
    if (step === null) {
      await recordLoginFailure(req.ip, req.user.email);
      // 400, not 401: the session is still valid and apiFetch treats 401 as "logged out".
      return res.status(400).json({
        success: false,
        error: 'INVALID_CREDENTIALS',
        message: 'Kata sandi atau kode verifikasi salah.',
      });
    }
    await db.query(
      'UPDATE users SET totp_enabled = false, totp_secret = NULL, totp_last_step = NULL WHERE id = $1',
      [req.user.id]
    );
    return res.json({ success: true, message: '2FA dinonaktifkan.' });
  } catch (err) {
    reportError(req, '[API 2FA DISABLE]', err);
    return res.status(500).json({ success: false, message: 'Gagal menonaktifkan 2FA.' });
  }
});

// ==========================================
// MODUL TUGAS API (/api/tasks)
// ==========================================
const RECURRENCES = ['daily', 'weekly', 'monthly'];
const TASK_SORTS = {
  due_asc: 't.due_date ASC, t.created_at DESC',
  due_desc: 't.due_date DESC, t.created_at DESC',
  created_desc: 't.created_at DESC',
  created_asc: 't.created_at ASC',
  title: 'LOWER(t.title) ASC, t.id ASC',
  updated_desc: 't.updated_at DESC NULLS LAST, t.id DESC',
};
const NOTE_MAX = 2000;

// members = anggota yang ditugaskan (task_assignees); assignee_name tetap nama Penanggung Jawab (Owner).
const TASK_COLUMNS = `
  t.id, t.title, t.description, t.status, t.due_date, t.created_at, t.updated_at, t.completed_at,
  t.user_id, t.done_reported_by, t.done_reported_at, t.deleted_at, t.archived_at, t.recurrence, t.next_task_id,
  u.name AS assignee_name, u.email AS assignee_email, r.name AS done_reported_by_name,
  COALESCE((SELECT json_agg(json_build_object('id', a.user_id, 'name', au.name) ORDER BY au.name)
            FROM task_assignees a JOIN users au ON au.id = a.user_id WHERE a.task_id = t.id), '[]'::json) AS members,
  (SELECT COUNT(*)::int FROM task_checklist c WHERE c.task_id = t.id) AS checklist_total,
  (SELECT COUNT(*)::int FROM task_checklist c WHERE c.task_id = t.id AND c.done) AS checklist_done,
  (SELECT COUNT(*)::int FROM task_comments m WHERE m.task_id = t.id) AS comment_count`;
const TASK_FROM = `FROM tasks t JOIN users u ON t.user_id = u.id LEFT JOIN users r ON t.done_reported_by = r.id`;

async function fetchTask(taskId, { includeDeleted = false } = {}) {
  const result = await db.query(
    `SELECT ${TASK_COLUMNS} ${TASK_FROM} WHERE t.id = $1 ${includeDeleted ? '' : 'AND t.deleted_at IS NULL'}`,
    [taskId]
  );
  return result.rows[0] || null;
}

const taskNotFound = (res) => res.status(404).json({ success: false, message: 'Tugas tidak ditemukan.' });

async function logActivity(taskId, userId, action, detail = null, client = db) {
  try {
    await client.query(
      'INSERT INTO task_activity (task_id, user_id, action, detail) VALUES ($1, $2, $3, $4)',
      [taskId, userId, action, detail ? String(detail).slice(0, 300) : null]
    );
  } catch (err) {
    console.warn('[TASK ACTIVITY] Gagal mencatat:', err.message);
  }
}

/** member_ids → array of ids, or an error string. undefined means "not sent". */
async function parseMemberIds(raw) {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return [];
  if (!Array.isArray(raw) || raw.length > 50 || !raw.every(isPositiveIntLike)) return 'Daftar anggota tidak valid.';
  const ids = [...new Set(raw.map(Number))];
  if (!ids.length) return [];
  const r = await db.query(`SELECT id FROM users WHERE id = ANY($1::int[]) AND role = 'User' AND status = 'Active'`, [ids]);
  if (r.rows.length !== ids.length) return 'Anggota yang dipilih harus anggota aktif.';
  return ids;
}

function validateRecurrence(value) {
  return value === undefined || value === null || value === '' || RECURRENCES.includes(value);
}

/** Validates an optional http(s) link; returns the normalised URL, null when blank, or false when invalid. */
function parseLink(value) {
  if (isBlankOptional(value)) return null;
  if (typeof value !== 'string' || value.trim().length > 500) return false;
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : false;
  } catch {
    return false;
  }
}

/** Optional note; returns trimmed text, null when blank, or false when invalid/too long. */
function parseNote(value, max = NOTE_MAX) {
  if (isBlankOptional(value)) return null;
  if (typeof value !== 'string' || value.trim().length > max) return false;
  return value.trim() || null;
}

/** Next due date for a recurring task, always in the future. */
function nextDueDate(from, recurrence) {
  const next = new Date(from);
  const step = () => {
    if (recurrence === 'daily') next.setUTCDate(next.getUTCDate() + 1);
    else if (recurrence === 'weekly') next.setUTCDate(next.getUTCDate() + 7);
    else next.setUTCMonth(next.getUTCMonth() + 1);
  };
  step();
  for (let i = 0; i < 1000 && next <= new Date(); i += 1) step();
  return next;
}

// Who may report / tick the checklist: assigned members, or any member when nobody is assigned.
async function canWorkOn(taskId, user) {
  if (user.role === 'Owner') return true;
  const r = await db.query(
    `SELECT NOT EXISTS (SELECT 1 FROM task_assignees WHERE task_id = $1)
            OR EXISTS (SELECT 1 FROM task_assignees WHERE task_id = $1 AND user_id = $2) AS ok`,
    [taskId, user.id]
  );
  return Boolean(r.rows[0]?.ok);
}

async function activeMemberIds() {
  const r = await db.query(`SELECT id FROM users WHERE role = 'User' AND status = 'Active'`);
  return r.rows.map((row) => row.id);
}

const fmtDue = (date) => new Date(date).toLocaleString('id-ID', {
  timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

// New task: in-app for everyone who can work on it; email only to explicitly assigned members.
async function notifyNewTask(task, memberIds, explicit) {
  const ids = memberIds.length ? memberIds : await activeMemberIds();
  await notify(ids, {
    type: 'assigned',
    title: `Tugas baru: ${task.title}`,
    taskId: task.id,
    email: explicit && memberIds.length ? {
      subject: `Tugas baru: ${task.title}`,
      lines: [`Anda ditugaskan pada "${task.title}".`, `Tenggat: ${fmtDue(task.due_date)} WIB.`],
    } : null,
  });
}

// Creates the next occurrence once (next_task_id guards against double clicks / repeated saves).
async function spawnNextRecurring(taskId, actorId) {
  const client = await db.pool.connect();
  let created = null;
  try {
    await client.query('BEGIN');
    const cur = (await client.query(
      `SELECT * FROM tasks WHERE id = $1 AND recurrence IS NOT NULL AND next_task_id IS NULL AND deleted_at IS NULL FOR UPDATE`,
      [taskId]
    )).rows[0];
    if (!cur) { await client.query('ROLLBACK'); return null; }
    created = (await client.query(
      `INSERT INTO tasks (user_id, title, description, status, due_date, recurrence)
       VALUES ($1, $2, $3, 'To Do', $4, $5) RETURNING *`,
      [cur.user_id, cur.title, cur.description, nextDueDate(cur.due_date, cur.recurrence), cur.recurrence]
    )).rows[0];
    await client.query(
      'INSERT INTO task_assignees (task_id, user_id) SELECT $1, user_id FROM task_assignees WHERE task_id = $2',
      [created.id, cur.id]
    );
    await client.query(
      `INSERT INTO task_checklist (task_id, text, position) SELECT $1, text, position FROM task_checklist WHERE task_id = $2`,
      [created.id, cur.id]
    );
    await client.query('UPDATE tasks SET next_task_id = $1 WHERE id = $2', [created.id, cur.id]);
    await logActivity(created.id, actorId, 'created', `Tugas berulang dari #${cur.id}`, client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  const members = (await db.query('SELECT user_id FROM task_assignees WHERE task_id = $1', [created.id])).rows.map((r) => r.user_id);
  await notifyNewTask(created, members, true);
  return created;
}

app.get('/api/tasks', authMiddleware, async (req, res) => {
  try {
    const status = queryString(req.query.status);
    const search = queryString(req.query.search);
    const view = ['active', 'archived', 'trash', 'all'].includes(queryString(req.query.view)) ? req.query.view : 'active';
    const sort = TASK_SORTS[queryString(req.query.sort)] ? req.query.sort : 'due_asc';
    const member = queryString(req.query.member);
    const reported = queryString(req.query.reported);
    const dueFrom = parseDateInput(queryString(req.query.due_from));
    const dueTo = parseDateInput(queryString(req.query.due_to));
    const page = isPositiveIntLike(req.query.page) ? Number(req.query.page) : null;
    const limit = isPositiveIntLike(req.query.limit) ? Math.min(Number(req.query.limit), 100) : 20;

    if (view === 'trash' && req.user.role !== 'Owner') {
      return res.status(403).json({ success: false, error: 'FORBIDDEN', message: 'Tempat sampah hanya untuk Owner.' });
    }

    // Every task is visible to the whole team; "member" narrows it to one member's work.
    const where = [];
    const params = [];
    const add = (value) => { params.push(value); return `$${params.length}`; };

    if (view === 'trash') where.push('t.deleted_at IS NOT NULL');
    else where.push('t.deleted_at IS NULL');
    if (view === 'active') where.push('t.archived_at IS NULL');
    if (view === 'archived') where.push('t.archived_at IS NOT NULL');

    if (status && status !== 'Semua' && TASK_STATUSES.includes(status)) where.push(`t.status = ${add(status)}`);
    if (search && search.trim()) {
      const p = add(`%${search.trim().slice(0, 200)}%`);
      where.push(`(t.title ILIKE ${p} OR t.description ILIKE ${p})`);
    }
    if (member === 'me' || isPositiveIntLike(member)) {
      const p = add(member === 'me' ? req.user.id : Number(member));
      where.push(`(EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id AND a.user_id = ${p})
                   OR NOT EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id))`);
    }
    if (reported === 'yes') where.push('t.done_reported_at IS NOT NULL');
    if (reported === 'no') where.push('t.done_reported_at IS NULL');
    if (dueFrom) where.push(`t.due_date >= ${add(dueFrom)}`);
    if (dueTo) where.push(`t.due_date <= ${add(dueTo)}`);

    let sql = `SELECT ${TASK_COLUMNS}, COUNT(*) OVER() AS total_count ${TASK_FROM}
               WHERE ${where.join(' AND ')} ORDER BY ${TASK_SORTS[sort]}`;
    // Without ?page the full list is returned (dashboard and kanban need every task).
    if (page) sql += ` LIMIT ${add(limit)} OFFSET ${add((page - 1) * limit)}`;

    const result = await db.query(sql, params);
    const total = result.rows.length ? Number(result.rows[0].total_count) : 0;
    const data = result.rows.map(({ total_count: _t, ...row }) => row);
    return res.json({
      success: true,
      data,
      meta: { total: page ? total : data.length, page: page || 1, limit: page ? limit : data.length, pages: page ? Math.max(1, Math.ceil(total / limit)) : 1 },
    });
  } catch (err) {
    reportError(req, '[API TASKS GET]', err);
    return res.status(500).json({ success: false, message: 'Gagal memuat daftar tugas.' });
  }
});

// Task + checklist + comments + activity for the detail panel.
app.get('/api/tasks/:id/detail', authMiddleware, async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const task = await fetchTask(taskId, { includeDeleted: req.user.role === 'Owner' });
    if (!task) return taskNotFound(res);
    const [checklist, comments, activity, canWork] = await Promise.all([
      db.query(
        `SELECT c.id, c.text, c.done, c.position, d.name AS done_by_name
         FROM task_checklist c LEFT JOIN users d ON d.id = c.done_by
         WHERE c.task_id = $1 ORDER BY c.position ASC, c.id ASC`, [taskId]),
      db.query(
        `SELECT m.id, m.kind, m.body, m.link_url, m.created_at, m.user_id, u.name AS user_name, u.role AS user_role
         FROM task_comments m LEFT JOIN users u ON u.id = m.user_id
         WHERE m.task_id = $1 ORDER BY m.created_at ASC, m.id ASC`, [taskId]),
      db.query(
        `SELECT a.id, a.action, a.detail, a.created_at, u.name AS user_name
         FROM task_activity a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.task_id = $1 ORDER BY a.created_at DESC, a.id DESC LIMIT 100`, [taskId]),
      canWorkOn(taskId, req.user),
    ]);
    return res.json({
      success: true,
      data: { task, checklist: checklist.rows, comments: comments.rows, activity: activity.rows, can_work: canWork },
    });
  } catch (err) {
    reportError(req, '[API TASK DETAIL]', err);
    return res.status(500).json({ success: false, message: 'Gagal memuat detail tugas.' });
  }
});

// Only the Owner creates, edits, moves and deletes tasks; members work on them and report done.
app.post('/api/tasks', authMiddleware, ownerOnlyMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    const { title, description, due_date, user_id, recurrence } = body;

    const validationError = validateTaskBody(body, true);
    if (validationError) return badRequest(res, validationError);
    if (!validateRecurrence(recurrence)) return badRequest(res, 'Pengulangan harus harian, mingguan, atau bulanan.');
    const memberIds = await parseMemberIds(body.member_ids);
    if (typeof memberIds === 'string') return badRequest(res, memberIds);

    const assigneeId = await resolveAssignee(user_id, req.user.id);
    if (assigneeId === null) return badRequest(res, 'Penanggung jawab harus Owner yang aktif.');

    // Honour the column the task was added from (e.g. "+" on In Progress); defaults to To Do.
    const initialStatus = body.status || 'To Do';
    const isDone = initialStatus === 'Done';
    const members = memberIds || [];

    const client = await db.pool.connect();
    let task;
    try {
      await client.query('BEGIN');
      task = (await client.query(
        `INSERT INTO tasks (user_id, title, description, status, due_date, completed_at, recurrence)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          assigneeId,
          title.trim(),
          description ? description.trim() || null : null,
          initialStatus,
          parseDateInput(due_date),
          isDone ? new Date() : null,
          recurrence || null,
        ]
      )).rows[0];
      if (members.length) {
        await client.query(
          'INSERT INTO task_assignees (task_id, user_id) SELECT $1, uid FROM UNNEST($2::int[]) AS uid',
          [task.id, members]
        );
      }
      await logActivity(task.id, req.user.id, 'created', null, client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    const full = await fetchTask(task.id);
    await notifyNewTask(full, members, true);
    if (isDone && full.recurrence) await spawnNextRecurring(full.id, req.user.id);

    return res.status(201).json({
      success: true,
      data: full,
      message: 'Tugas baru berhasil disimpan ke workspace.',
    });
  } catch (err) {
    reportError(req, '[API TASKS POST]', err);
    return res.status(500).json({ success: false, message: 'Gagal membuat tugas baru.' });
  }
});

app.put('/api/tasks/:id', authMiddleware, ownerOnlyMiddleware, async (req, res) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    const body = req.body || {};
    const { title, description, status, due_date, user_id, recurrence } = body;

    const validationError = validateTaskBody(body, false);
    if (validationError) return badRequest(res, validationError);
    if (!validateRecurrence(recurrence)) return badRequest(res, 'Pengulangan harus harian, mingguan, atau bulanan.');
    const memberIds = await parseMemberIds(body.member_ids);
    if (typeof memberIds === 'string') return badRequest(res, memberIds);

    const checkRes = await db.query('SELECT * FROM tasks WHERE id = $1 AND deleted_at IS NULL', [taskId]);
    if (checkRes.rows.length === 0) return taskNotFound(res);
    const existingTask = checkRes.rows[0];

    const newStatus = status !== undefined ? status : existingTask.status;
    const statusChanged = status !== undefined && status !== existingTask.status;
    let completedAt = existingTask.completed_at;
    let reportedBy = existingTask.done_reported_by;
    let reportedAt = existingTask.done_reported_at;

    // Only a real status change touches completed_at, so re-saving a Done task keeps its original timestamp.
    // Moving a task out of Done (or between open columns) also clears a pending "Lapor selesai".
    if (statusChanged) {
      const isDone = newStatus === 'Done';
      completedAt = isDone ? new Date() : null;
      if (!isDone) {
        reportedBy = null;
        reportedAt = null;
      }
    }

    const updatedTitle = title !== undefined ? title.trim() : existingTask.title;
    const updatedDesc = description === undefined
      ? existingTask.description
      : (description ? description.trim() || null : null);
    const updatedDueDate = isBlankOptional(due_date) ? existingTask.due_date : parseDateInput(due_date);
    const updatedRecurrence = recurrence === undefined ? existingTask.recurrence : (recurrence || null);
    // Keeping the current PJ is always allowed, even if that account later lost the Owner role.
    const keepsAssignee = !isBlankOptional(user_id) && Number(user_id) === existingTask.user_id;
    const updatedUserId = keepsAssignee ? existingTask.user_id : await resolveAssignee(user_id, existingTask.user_id);
    if (updatedUserId === null) return badRequest(res, 'Penanggung jawab harus Owner yang aktif.');

    const client = await db.pool.connect();
    let addedMembers = [];
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE tasks
         SET title = $1, description = $2, status = $3, completed_at = $4, due_date = $5, user_id = $6,
             done_reported_by = $7, done_reported_at = $8, recurrence = $9,
             archived_at = CASE WHEN $11::boolean THEN archived_at ELSE NULL END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $10`,
        [updatedTitle, updatedDesc, newStatus, completedAt, updatedDueDate, updatedUserId,
          reportedBy, reportedAt, updatedRecurrence, taskId, newStatus === 'Done']
      );
      if (memberIds !== undefined) {
        const before = (await client.query('SELECT user_id FROM task_assignees WHERE task_id = $1', [taskId])).rows.map((r) => r.user_id);
        addedMembers = memberIds.filter((id) => !before.includes(id));
        const removed = before.filter((id) => !memberIds.includes(id));
        if (removed.length) {
          await client.query('DELETE FROM task_assignees WHERE task_id = $1 AND user_id = ANY($2::int[])', [taskId, removed]);
        }
        if (addedMembers.length) {
          await client.query(
            'INSERT INTO task_assignees (task_id, user_id) SELECT $1, uid FROM UNNEST($2::int[]) AS uid ON CONFLICT DO NOTHING',
            [taskId, addedMembers]
          );
        }
        if (addedMembers.length || removed.length) {
          await logActivity(taskId, req.user.id, 'assigned', `Anggota diubah (+${addedMembers.length} / -${removed.length})`, client);
        }
      }
      if (statusChanged) {
        await logActivity(taskId, req.user.id, 'status', `${existingTask.status} → ${newStatus}`, client);
      }
      const edited = updatedTitle !== existingTask.title || updatedDesc !== existingTask.description
        || new Date(updatedDueDate).getTime() !== new Date(existingTask.due_date).getTime()
        || updatedUserId !== existingTask.user_id || updatedRecurrence !== existingTask.recurrence;
      if (edited) await logActivity(taskId, req.user.id, 'updated', null, client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    if (addedMembers.length) {
      await notify(addedMembers, {
        type: 'assigned',
        title: `Anda ditugaskan: ${updatedTitle}`,
        taskId,
        email: {
          subject: `Tugas baru: ${updatedTitle}`,
          lines: [`Anda ditugaskan pada "${updatedTitle}".`, `Tenggat: ${fmtDue(updatedDueDate)} WIB.`],
        },
      });
    }
    let nextTask = null;
    if (statusChanged && newStatus === 'Done') {
      if (existingTask.done_reported_by) {
        await notify([existingTask.done_reported_by], { type: 'approved', title: `Laporan diterima: ${updatedTitle}`, taskId });
      }
      if (updatedRecurrence) nextTask = await spawnNextRecurring(taskId, req.user.id);
    }

    return res.json({
      success: true,
      data: await fetchTask(taskId),
      next_task: nextTask,
      message: newStatus === 'Done'
        ? `Luar biasa! Tugas telah ditandai selesai.${nextTask ? ' Tugas berikutnya sudah dibuat.' : ''}`
        : 'Perubahan tugas berhasil disimpan.',
    });
  } catch (err) {
    reportError(req, '[API TASKS PUT]', err);
    return res.status(500).json({ success: false, message: 'Gagal memperbarui data tugas.' });
  }
});

// Delete moves the task to the trash; it can be restored or purged from there.
app.delete('/api/tasks/:id', authMiddleware, ownerOnlyMiddleware, async (req, res) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    const upd = await db.query(
      'UPDATE tasks SET deleted_at = CURRENT_TIMESTAMP, deleted_by = $2 WHERE id = $1 AND deleted_at IS NULL',
      [taskId, req.user.id]
    );
    if (upd.rowCount === 0) return taskNotFound(res);
    await logActivity(taskId, req.user.id, 'deleted');
    return res.json({ success: true, message: 'Tugas dipindahkan ke tempat sampah.' });
  } catch (err) {
    reportError(req, '[API TASKS DELETE]', err);
    return res.status(500).json({ success: false, message: 'Gagal menghapus tugas.' });
  }
});

app.post('/api/tasks/:id/restore', authMiddleware, ownerOnlyMiddleware, async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const upd = await db.query(
      'UPDATE tasks SET deleted_at = NULL, deleted_by = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND deleted_at IS NOT NULL',
      [taskId]
    );
    if (upd.rowCount === 0) return taskNotFound(res);
    await logActivity(taskId, req.user.id, 'restored');
    return res.json({ success: true, data: await fetchTask(taskId), message: 'Tugas dipulihkan.' });
  } catch (err) {
    reportError(req, '[API TASKS RESTORE]', err);
    return res.status(500).json({ success: false, message: 'Gagal memulihkan tugas.' });
  }
});

// Permanent delete, only for tasks already in the trash.
app.delete('/api/tasks/:id/purge', authMiddleware, ownerOnlyMiddleware, async (req, res) => {
  try {
    const del = await db.query('DELETE FROM tasks WHERE id = $1 AND deleted_at IS NOT NULL', [Number(req.params.id)]);
    if (del.rowCount === 0) return taskNotFound(res);
    return res.json({ success: true, message: 'Tugas dihapus permanen.' });
  } catch (err) {
    reportError(req, '[API TASKS PURGE]', err);
    return res.status(500).json({ success: false, message: 'Gagal menghapus permanen.' });
  }
});

app.post('/api/tasks/:id/archive', authMiddleware, ownerOnlyMiddleware, async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const upd = await db.query(
      `UPDATE tasks SET archived_at = CURRENT_TIMESTAMP WHERE id = $1 AND deleted_at IS NULL AND status = 'Done' AND archived_at IS NULL`,
      [taskId]
    );
    if (upd.rowCount === 0) {
      const t = await fetchTask(taskId);
      if (!t) return taskNotFound(res);
      return res.status(409).json({ success: false, message: t.archived_at ? 'Tugas sudah diarsipkan.' : 'Hanya tugas Done yang bisa diarsipkan.' });
    }
    await logActivity(taskId, req.user.id, 'archived');
    return res.json({ success: true, message: 'Tugas diarsipkan.' });
  } catch (err) {
    reportError(req, '[API TASKS ARCHIVE]', err);
    return res.status(500).json({ success: false, message: 'Gagal mengarsipkan tugas.' });
  }
});

app.post('/api/tasks/:id/unarchive', authMiddleware, ownerOnlyMiddleware, async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const upd = await db.query(
      'UPDATE tasks SET archived_at = NULL WHERE id = $1 AND deleted_at IS NULL AND archived_at IS NOT NULL',
      [taskId]
    );
    if (upd.rowCount === 0) return taskNotFound(res);
    await logActivity(taskId, req.user.id, 'unarchived');
    return res.json({ success: true, message: 'Tugas dikembalikan dari arsip.' });
  } catch (err) {
    reportError(req, '[API TASKS UNARCHIVE]', err);
    return res.status(500).json({ success: false, message: 'Gagal mengembalikan tugas dari arsip.' });
  }
});

// Members cannot change status; they report a task as finished (optional note + link) and the Owner moves it to Done.
app.post('/api/tasks/:id/report-done', authMiddleware, async (req, res) => {
  try {
    if (req.user.role === 'Owner') {
      return res.status(403).json({ success: false, message: 'Owner mengubah status langsung, bukan melapor selesai.' });
    }
    const taskId = Number(req.params.id);
    const note = parseNote(req.body?.note);
    if (note === false) return badRequest(res, `Catatan maksimal ${NOTE_MAX} karakter.`);
    const link = parseLink(req.body?.link);
    if (link === false) return badRequest(res, 'Tautan harus diawali http:// atau https:// (maksimal 500 karakter).');

    const task = await fetchTask(taskId);
    if (!task || task.archived_at) return taskNotFound(res);
    if (!(await canWorkOn(taskId, req.user))) {
      return res.status(403).json({ success: false, error: 'NOT_ASSIGNED', message: 'Tugas ini ditugaskan ke anggota lain.' });
    }

    const result = await db.query(
      `UPDATE tasks SET done_reported_by = $1, done_reported_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND status <> 'Done' AND done_reported_at IS NULL AND deleted_at IS NULL
       RETURNING id, done_reported_at`,
      [req.user.id, taskId]
    );
    if (!result.rows.length) {
      return res.status(409).json({
        success: false,
        message: task.status === 'Done' ? 'Tugas ini sudah selesai.' : 'Tugas ini sudah dilaporkan selesai.',
      });
    }
    if (note || link) {
      await db.query(
        `INSERT INTO task_comments (task_id, user_id, kind, body, link_url) VALUES ($1, $2, 'report', $3, $4)`,
        [taskId, req.user.id, note || 'Lapor selesai', link]
      );
    }
    await logActivity(taskId, req.user.id, 'reported', note ? note.slice(0, 120) : null);
    await notify([task.user_id], {
      type: 'report',
      title: `${req.user.name} melaporkan selesai: ${task.title}`,
      taskId,
      email: {
        subject: `Laporan selesai: ${task.title}`,
        lines: [`${req.user.name} melaporkan "${task.title}" sudah selesai.`, ...(note ? [`Catatan: ${note}`] : []), ...(link ? [`Tautan: ${link}`] : []), 'Periksa lalu tandai Done atau tolak laporannya.'],
      },
    });
    return res.json({ success: true, data: result.rows[0], message: 'Laporan terkirim. Owner akan memeriksa dan menandai selesai.' });
  } catch (err) {
    reportError(req, '[API TASKS REPORT DONE]', err);
    return res.status(500).json({ success: false, message: 'Gagal melaporkan tugas selesai.' });
  }
});

// Owner sends a report back with a reason; the member can report again after fixing it.
app.post('/api/tasks/:id/reject-report', authMiddleware, ownerOnlyMiddleware, async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const reason = parseNote(req.body?.reason, 1000);
    if (!reason) return badRequest(res, 'Alasan penolakan wajib diisi (maksimal 1000 karakter).');
    const prev = await db.query(
      `SELECT done_reported_by, title FROM tasks WHERE id = $1 AND deleted_at IS NULL AND done_reported_at IS NOT NULL AND status <> 'Done'`,
      [taskId]
    );
    if (!prev.rows.length) {
      const t = await fetchTask(taskId);
      if (!t) return taskNotFound(res);
      return res.status(409).json({ success: false, message: 'Tidak ada laporan yang bisa ditolak pada tugas ini.' });
    }
    const { done_reported_by: reporterId, title } = prev.rows[0];
    const upd = await db.query(
      `UPDATE tasks SET done_reported_by = NULL, done_reported_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND done_reported_at IS NOT NULL AND status <> 'Done'`,
      [taskId]
    );
    if (!upd.rowCount) return res.status(409).json({ success: false, message: 'Laporan sudah berubah. Muat ulang halaman.' });
    await db.query(
      `INSERT INTO task_comments (task_id, user_id, kind, body) VALUES ($1, $2, 'reject', $3)`,
      [taskId, req.user.id, reason]
    );
    await logActivity(taskId, req.user.id, 'rejected', reason.slice(0, 120));
    if (reporterId) {
      await notify([reporterId], {
        type: 'rejected',
        title: `Laporan ditolak: ${title}`,
        taskId,
        email: {
          subject: `Laporan ditolak: ${title}`,
          lines: [`Laporan selesai Anda untuk "${title}" dikembalikan oleh ${req.user.name}.`, `Alasan: ${reason}`, 'Perbaiki lalu laporkan selesai lagi.'],
        },
      });
    }
    return res.json({ success: true, message: 'Laporan ditolak dan anggota diberi tahu.' });
  } catch (err) {
    reportError(req, '[API TASKS REJECT REPORT]', err);
    return res.status(500).json({ success: false, message: 'Gagal menolak laporan.' });
  }
});

app.post('/api/tasks/:id/comments', authMiddleware, async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const body = parseNote(req.body?.body);
    if (!body) return badRequest(res, `Komentar wajib diisi (maksimal ${NOTE_MAX} karakter).`);
    const link = parseLink(req.body?.link);
    if (link === false) return badRequest(res, 'Tautan harus diawali http:// atau https:// (maksimal 500 karakter).');
    const task = await fetchTask(taskId);
    if (!task) return taskNotFound(res);
    const ins = await db.query(
      `INSERT INTO task_comments (task_id, user_id, kind, body, link_url) VALUES ($1, $2, 'comment', $3, $4)
       RETURNING id, kind, body, link_url, created_at, user_id`,
      [taskId, req.user.id, body, link]
    );
    await logActivity(taskId, req.user.id, 'commented');
    // Members' comments go to the PJ; the Owner's go to the assigned members (or the reporter).
    const targets = req.user.role === 'Owner'
      ? [...task.members.map((m) => m.id), task.done_reported_by].filter(Boolean)
      : [task.user_id];
    await notify(targets.filter((id) => id !== req.user.id), {
      type: 'comment',
      title: `${req.user.name} berkomentar: ${task.title}`,
      taskId,
    });
    return res.status(201).json({
      success: true,
      data: { ...ins.rows[0], user_name: req.user.name, user_role: req.user.role },
      message: 'Komentar terkirim.',
    });
  } catch (err) {
    reportError(req, '[API TASK COMMENTS POST]', err);
    return res.status(500).json({ success: false, message: 'Gagal mengirim komentar.' });
  }
});

// Comments can be removed by their author or the Owner (report/reject notes stay as history).
app.delete('/api/tasks/:id/comments/:itemId', authMiddleware, async (req, res) => {
  try {
    const del = await db.query(
      `DELETE FROM task_comments WHERE id = $1 AND task_id = $2 AND kind = 'comment' AND (user_id = $3 OR $4)`,
      [Number(req.params.itemId), Number(req.params.id), req.user.id, req.user.role === 'Owner']
    );
    if (!del.rowCount) return res.status(404).json({ success: false, message: 'Komentar tidak ditemukan.' });
    return res.json({ success: true, message: 'Komentar dihapus.' });
  } catch (err) {
    reportError(req, '[API TASK COMMENTS DELETE]', err);
    return res.status(500).json({ success: false, message: 'Gagal menghapus komentar.' });
  }
});

app.post('/api/tasks/:id/checklist', authMiddleware, ownerOnlyMiddleware, async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const text = parseNote(req.body?.text, 200);
    if (!text) return badRequest(res, 'Isi subtugas wajib diisi (maksimal 200 karakter).');
    if (!(await fetchTask(taskId))) return taskNotFound(res);
    const count = await db.query('SELECT COUNT(*)::int AS n, COALESCE(MAX(position), 0) AS p FROM task_checklist WHERE task_id = $1', [taskId]);
    if (count.rows[0].n >= 50) return badRequest(res, 'Maksimal 50 subtugas per tugas.');
    const ins = await db.query(
      'INSERT INTO task_checklist (task_id, text, position) VALUES ($1, $2, $3) RETURNING id, text, done, position',
      [taskId, text, count.rows[0].p + 1]
    );
    await logActivity(taskId, req.user.id, 'checklist', `Tambah: ${text}`);
    return res.status(201).json({ success: true, data: ins.rows[0], message: 'Subtugas ditambahkan.' });
  } catch (err) {
    reportError(req, '[API CHECKLIST POST]', err);
    return res.status(500).json({ success: false, message: 'Gagal menambah subtugas.' });
  }
});

// Ticking is open to whoever may work on the task; renaming is Owner-only.
app.put('/api/tasks/:id/checklist/:itemId', authMiddleware, async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    const { done } = req.body || {};
    const text = req.body?.text === undefined ? undefined : parseNote(req.body.text, 200);
    if (done !== undefined && typeof done !== 'boolean') return badRequest(res, 'Nilai selesai tidak valid.');
    if (text === null || text === false) return badRequest(res, 'Isi subtugas wajib diisi (maksimal 200 karakter).');
    if (done === undefined && text === undefined) return badRequest(res, 'Tidak ada perubahan.');
    if (text !== undefined && req.user.role !== 'Owner') {
      return res.status(403).json({ success: false, error: 'FORBIDDEN', message: 'Hanya Owner yang dapat mengubah isi subtugas.' });
    }
    const task = await fetchTask(taskId);
    if (!task) return taskNotFound(res);
    if (!(await canWorkOn(taskId, req.user))) {
      return res.status(403).json({ success: false, error: 'NOT_ASSIGNED', message: 'Tugas ini ditugaskan ke anggota lain.' });
    }
    const upd = await db.query(
      `UPDATE task_checklist
       SET text = COALESCE($3, text),
           done = COALESCE($4, done),
           done_by = CASE WHEN $4::boolean IS NULL THEN done_by WHEN $4 THEN $5 ELSE NULL END
       WHERE id = $1 AND task_id = $2
       RETURNING id, text, done, position`,
      [itemId, taskId, text ?? null, done ?? null, req.user.id]
    );
    if (!upd.rowCount) return res.status(404).json({ success: false, message: 'Subtugas tidak ditemukan.' });
    const item = upd.rows[0];
    await logActivity(taskId, req.user.id, 'checklist', done === undefined ? `Ubah: ${item.text}` : `${done ? 'Centang' : 'Batal centang'}: ${item.text}`);
    return res.json({ success: true, data: item });
  } catch (err) {
    reportError(req, '[API CHECKLIST PUT]', err);
    return res.status(500).json({ success: false, message: 'Gagal memperbarui subtugas.' });
  }
});

app.delete('/api/tasks/:id/checklist/:itemId', authMiddleware, ownerOnlyMiddleware, async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const del = await db.query('DELETE FROM task_checklist WHERE id = $1 AND task_id = $2 RETURNING text', [Number(req.params.itemId), taskId]);
    if (!del.rowCount) return res.status(404).json({ success: false, message: 'Subtugas tidak ditemukan.' });
    await logActivity(taskId, req.user.id, 'checklist', `Hapus: ${del.rows[0].text}`);
    return res.json({ success: true, message: 'Subtugas dihapus.' });
  } catch (err) {
    reportError(req, '[API CHECKLIST DELETE]', err);
    return res.status(500).json({ success: false, message: 'Gagal menghapus subtugas.' });
  }
});

// ==========================================
// MODUL PENGINGAT DEADLINE (/api/reminders)
// ==========================================
app.get('/api/reminders/urgent', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT t.id, t.title, t.due_date, t.status, t.done_reported_at,
              ROUND(EXTRACT(EPOCH FROM (t.due_date - CURRENT_TIMESTAMP)) / 3600.0, 1) AS hours_left
       FROM tasks t
       WHERE t.status <> 'Done' AND t.deleted_at IS NULL AND t.archived_at IS NULL
       ORDER BY t.due_date ASC`
    );
    const overdueTasks = [];
    const urgentTasks = [];

    result.rows.forEach((row) => {
      const hours = parseFloat(row.hours_left);
      if (hours < 0) {
        overdueTasks.push({ ...row, urgency: 'OVERDUE' });
      } else if (hours <= 24) {
        urgentTasks.push({ ...row, urgency: 'URGENT' });
      }
    });

    return res.json({
      success: true,
      data: {
        total_urgent: urgentTasks.length,
        total_overdue: overdueTasks.length,
        urgent_tasks: urgentTasks,
        overdue_tasks: overdueTasks,
      },
    });
  } catch (err) {
    reportError(req, '[API REMINDERS URGENT]', err);
    return res.status(500).json({ success: false, message: 'Gagal mengambil pengingat deadline.' });
  }
});

// Owner sees every reminder they sent (with recipient); members see the ones sent to them.
app.get('/api/reminders', authMiddleware, async (req, res) => {
  try {
    const isOwner = req.user.role === 'Owner';
    const result = await db.query(
      `SELECT r.id, r.title, r.remind_at, r.task_id, r.created_at, r.batch_id,
              t.title AS task_title, u.name AS recipient_name, c.name AS sender_name
       FROM reminders r
       LEFT JOIN tasks t ON r.task_id = t.id
       JOIN users u ON r.user_id = u.id
       LEFT JOIN users c ON r.created_by = c.id
       WHERE ${isOwner ? 'r.created_by = $1' : 'r.user_id = $1'}
       ORDER BY r.remind_at ASC, u.name ASC`,
      [req.user.id]
    );
    if (!isOwner) return res.json({ success: true, data: result.rows });

    // A "Semua anggota" reminder is one row per member; the Owner sees it once.
    const seen = new Map();
    const data = [];
    for (const row of result.rows) {
      if (!row.batch_id) { data.push(row); continue; }
      const group = seen.get(row.batch_id);
      if (group) { group.recipient_count += 1; continue; }
      const item = { ...row, recipient_name: 'Semua anggota', recipient_count: 1 };
      seen.set(row.batch_id, item);
      data.push(item);
    }
    return res.json({ success: true, data });
  } catch (err) {
    reportError(req, '[API REMINDERS GET]', err);
    return res.status(500).json({ success: false, message: 'Gagal mengambil daftar pengingat kustom.' });
  }
});

// recipient: a member id, or 'all' for every active member (one row each, sharing a batch_id).
app.post('/api/reminders', authMiddleware, ownerOnlyMiddleware, async (req, res) => {
  try {
    const { title, remind_at, task_id, recipient } = req.body || {};
    if (typeof title !== 'string' || !title.trim() || isBlankOptional(remind_at)) {
      return badRequest(res, 'Catatan pengingat dan waktu wajib diisi.');
    }
    if (title.trim().length > 255) return badRequest(res, 'Catatan pengingat maksimal 255 karakter.');

    const remindAt = parseDateInput(remind_at);
    if (!remindAt) return badRequest(res, 'Format waktu pengingat tidak valid.');

    let taskId = null;
    if (!isBlankOptional(task_id)) {
      if (!isPositiveIntLike(task_id)) return badRequest(res, 'Tugas terkait tidak valid.');
      taskId = Number(task_id);
      const taskRes = await db.query('SELECT id FROM tasks WHERE id = $1 AND deleted_at IS NULL', [taskId]);
      if (!taskRes.rows.length) return badRequest(res, 'Tugas terkait tidak ditemukan.');
    }

    let recipients;
    let batchId = null;
    if (recipient === 'all') {
      const r = await db.query(`SELECT id FROM users WHERE role = 'User' AND status = 'Active'`);
      recipients = r.rows.map((row) => row.id);
      if (!recipients.length) return badRequest(res, 'Belum ada anggota aktif untuk diingatkan.');
      batchId = crypto.randomUUID();
    } else {
      if (!isPositiveIntLike(recipient)) return badRequest(res, 'Pilih anggota yang akan diingatkan.');
      const r = await db.query(`SELECT id FROM users WHERE id = $1 AND role = 'User' AND status = 'Active'`, [Number(recipient)]);
      if (!r.rows.length) return badRequest(res, 'Anggota tujuan tidak ditemukan atau tidak aktif.');
      recipients = [r.rows[0].id];
    }

    const insertRes = await db.query(
      `INSERT INTO reminders (user_id, task_id, title, remind_at, created_by, batch_id)
       SELECT uid, $2, $3, $4, $5, $6 FROM UNNEST($1::int[]) AS uid
       RETURNING id, user_id`,
      [recipients, taskId, title.trim(), remindAt, req.user.id, batchId]
    );

    // One bell notification per recipient, shown from remind_at on (reminder_id cascades on delete).
    try {
      await db.query(
        `INSERT INTO notifications (user_id, type, title, task_id, reminder_id, show_at)
         SELECT r.user_id, 'reminder', $2, $3, r.id, $4
         FROM UNNEST($1::int[]) AS rid JOIN reminders r ON r.id = rid`,
        [insertRes.rows.map((r) => r.id), `Pengingat: ${title.trim()}`.slice(0, 300), taskId, remindAt]
      );
    } catch (notifyErr) {
      reportError(req, '[REMINDER NOTIFY]', notifyErr);
    }

    return res.status(201).json({
      success: true,
      data: { count: insertRes.rowCount, batch_id: batchId, id: insertRes.rows[0].id },
      message: batchId ? `Pengingat dikirim ke ${insertRes.rowCount} anggota.` : 'Pengingat dikirim ke anggota.',
    });
  } catch (err) {
    reportError(req, '[API REMINDERS POST]', err);
    return res.status(500).json({ success: false, message: 'Gagal menambahkan pengingat.' });
  }
});

// Deleting a "Semua anggota" reminder removes it for every recipient.
app.delete('/api/reminders/:id', authMiddleware, ownerOnlyMiddleware, async (req, res) => {
  try {
    if (!isPositiveIntLike(req.params.id)) return badRequest(res, 'Pengingat tidak valid.');
    const delRes = await db.query(
      `DELETE FROM reminders
       WHERE created_by = $2 AND (id = $1 OR batch_id = (SELECT batch_id FROM reminders WHERE id = $1 AND batch_id IS NOT NULL))`,
      [Number(req.params.id), req.user.id]
    );
    if (delRes.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Pengingat tidak ditemukan.' });
    }
    return res.json({ success: true, message: 'Pengingat berhasil dihapus.' });
  } catch (err) {
    reportError(req, '[API REMINDERS DELETE]', err);
    return res.status(500).json({ success: false, message: 'Gagal menghapus pengingat.' });
  }
});

// ==========================================
// MODUL LAPORAN & ANALITIK (/api/reports)
// ==========================================
app.get('/api/reports/analytics', authMiddleware, ownerOnlyMiddleware, async (req, res) => {
  try {
    const rawPeriod = queryString(req.query.period);
    const period = ['today', 'week', 'month', 'all'].includes(rawPeriod) ? rawPeriod : 'all';

    // Period boundaries in WIB (UTC+7, no DST) regardless of the host timezone (Vercel runs in UTC).
    const WIB_OFFSET_MS = 7 * 3600 * 1000;
    const wib = new Date(Date.now() + WIB_OFFSET_MS); // UTC getters now read WIB wall-clock
    const wibMidnight = (y, m, d) => new Date(Date.UTC(y, m, d) - WIB_OFFSET_MS).toISOString();
    const [y, m, d] = [wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate()];

    let dateFilter = '1970-01-01T00:00:00Z';
    if (period === 'today') {
      dateFilter = wibMidnight(y, m, d);
    } else if (period === 'week') {
      dateFilter = wibMidnight(y, m, d - ((wib.getUTCDay() + 6) % 7)); // Monday
    } else if (period === 'month') {
      dateFilter = wibMidnight(y, m, 1);
    }

    const params = [dateFilter];
    const kpiRes = await db.query(
      `SELECT 
         COUNT(*) AS total_tasks,
         COUNT(*) FILTER (WHERE status = 'Done') AS completed_tasks,
         COUNT(*) FILTER (WHERE status = 'In Progress') AS in_progress_tasks,
         COUNT(*) FILTER (WHERE status = 'To Do') AS todo_tasks,
         COUNT(*) FILTER (WHERE status != 'Done' AND due_date < CURRENT_TIMESTAMP) AS overdue_tasks,
         COUNT(*) FILTER (WHERE status = 'Done' AND completed_at <= due_date) AS on_time_tasks
       FROM tasks
       WHERE created_at >= $1 AND deleted_at IS NULL`,
      params
    );

    const kpi = kpiRes.rows[0];
    const total = parseInt(kpi.total_tasks, 10);
    const completed = parseInt(kpi.completed_tasks, 10);
    const onTime = parseInt(kpi.on_time_tasks, 10);

    // Who reports work as finished, among tasks created in the period.
    const memberRes = await db.query(
      `SELECT u.name, COUNT(t.id) AS count
       FROM users u
       JOIN tasks t ON t.done_reported_by = u.id AND t.created_at >= $1 AND t.deleted_at IS NULL
       GROUP BY u.id, u.name
       ORDER BY count DESC, u.name ASC`,
      params
    );

    const completionRate = total > 0 ? Math.round((completed / total) * 100 * 10) / 10 : 0;
    const onTimeRate = completed > 0 ? Math.round((onTime / completed) * 100 * 10) / 10 : 100;

    return res.json({
      success: true,
      data: {
        period: period || 'all',
        metrics: {
          total_tasks: total,
          completed_tasks: completed,
          in_progress_tasks: parseInt(kpi.in_progress_tasks, 10),
          todo_tasks: parseInt(kpi.todo_tasks, 10),
          overdue_tasks: parseInt(kpi.overdue_tasks, 10),
          on_time_tasks: onTime,
          completion_rate: completionRate,
          on_time_rate: onTimeRate,
        },
        member_reports: memberRes.rows,
      },
    });
  } catch (err) {
    reportError(req, '[API REPORTS ANALYTICS]', err);
    return res.status(500).json({ success: false, message: 'Gagal menghasilkan laporan analitik.' });
  }
});

// ==========================================
// MODUL KELOLA PENGGUNA (/api/users - Owner Only)
// ==========================================
app.get('/api/users', authMiddleware, ownerOnlyMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.name, u.email, u.role, u.status, u.totp_enabled, u.created_at, u.reset_requested_at,
              (SELECT COUNT(*) FROM tasks t WHERE t.user_id = u.id AND t.deleted_at IS NULL) AS total_tasks,
              (SELECT COUNT(*) FROM tasks t WHERE t.user_id = u.id AND t.status = 'Done' AND t.deleted_at IS NULL) AS completed_tasks,
              (SELECT COUNT(*) FROM tasks t WHERE t.done_reported_by = u.id AND t.deleted_at IS NULL) AS reported_tasks
       FROM users u
       ORDER BY u.created_at ASC`
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    reportError(req, '[API USERS GET]', err);
    return res.status(500).json({ success: false, message: 'Gagal mengambil daftar pengguna.' });
  }
});

app.post('/api/users', authMiddleware, ownerOnlyMiddleware, async (req, res) => {
  try {
    const { name, email, password, role } = req.body || {};

    if (typeof name !== 'string' || !name.trim() || typeof email !== 'string' || !email.trim() || !password) {
      return res.status(400).json({ success: false, message: 'Nama, email, dan kata sandi wajib diisi.' });
    }
    if (name.trim().length > 100) return badRequest(res, 'Nama maksimal 100 karakter.');
    if (email.trim().length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return badRequest(res, 'Format email tidak valid.');
    }
    if (role !== undefined && !USER_ROLES.includes(role)) return badRequest(res, 'Peran harus Owner atau User.');
    if (!isValidPassword(password)) {
      return res.status(400).json({ success: false, message: `Kata sandi minimal ${PASSWORD_MIN_LENGTH} karakter.` });
    }

    // Cek duplikasi email
    const existCheck = await db.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email.trim()]);
    if (existCheck.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'Alamat email sudah terdaftar. Gunakan email lain.' });
    }

    const hashed = await hashPassword(password);
    const insertRes = await db.query(
      `INSERT INTO users (name, email, password, role, status)
       VALUES ($1, $2, $3, $4, 'Active')
       RETURNING id, name, email, role, status, created_at`,
      [name.trim(), email.trim(), hashed, role === 'Owner' ? 'Owner' : 'User']
    );

    return res.status(201).json({
      success: true,
      data: insertRes.rows[0],
      message: 'Akun anggota tim baru berhasil ditambahkan.',
    });
  } catch (err) {
    reportError(req, '[API USERS POST]', err);
    return res.status(500).json({ success: false, message: 'Gagal mendaftarkan user baru.' });
  }
});

app.put('/api/users/:id', authMiddleware, ownerOnlyMiddleware, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    const { name, role, status, password } = req.body || {};

    if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.trim().length > 100)) {
      return badRequest(res, 'Nama wajib diisi (maksimal 100 karakter).');
    }
    if (role !== undefined && !USER_ROLES.includes(role)) return badRequest(res, 'Peran harus Owner atau User.');
    if (status !== undefined && !USER_STATUSES.includes(status)) return badRequest(res, 'Status harus Active atau Inactive.');
    if (password !== undefined && password !== null && typeof password !== 'string') {
      return badRequest(res, 'Kata sandi tidak valid.');
    }

    // Proteksi Self-Lockout
    if (targetId === req.user.id) {
      if (status === 'Inactive') {
        return res.status(400).json({ success: false, message: 'Owner dilarang menonaktifkan akun sendiri!' });
      }
      if (role && role !== 'Owner') {
        return res.status(400).json({ success: false, message: 'Owner dilarang menurunkan perannya sendiri!' });
      }
    }

    const checkRes = await db.query('SELECT * FROM users WHERE id = $1', [targetId]);
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Pengguna tidak ditemukan.' });
    }

    const user = checkRes.rows[0];
    const newName = name ? name.trim() : user.name;
    const newRole = role ? role : user.role;
    const newStatus = status ? status : user.status;

    let newPassword = user.password;
    let passwordChanged = false;
    if (password && password.trim().length > 0) {
      if (!isValidPassword(password)) {
        return res.status(400).json({ success: false, message: `Kata sandi minimal ${PASSWORD_MIN_LENGTH} karakter.` });
      }
      newPassword = await hashPassword(password.trim());
      passwordChanged = true;
    }

    // A password change bumps session_version, which logs that account out everywhere.
    const updateRes = await db.query(
      `UPDATE users
       SET name = $1, role = $2, status = $3, password = $4,
           session_version = session_version + CASE WHEN $6 THEN 1 ELSE 0 END,
           reset_requested_at = CASE WHEN $6 THEN NULL ELSE reset_requested_at END
       WHERE id = $5
       RETURNING id, name, email, role, status, session_version`,
      [newName, newRole, newStatus, newPassword, targetId, passwordChanged]
    );
    const updated = updateRes.rows[0];

    // Penanggung Jawab must stay an active Owner: move tasks off an Owner who is demoted or deactivated.
    let moved = 0;
    if (newRole !== 'Owner' || newStatus !== 'Active') {
      moved = (await db.query(
        'UPDATE tasks SET user_id = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
        [req.user.id, targetId]
      )).rowCount;
    }

    // Owner changing their own password: re-issue their cookie so only other devices are logged out.
    if (passwordChanged && targetId === req.user.id) {
      res.cookie(COOKIE_NAME, generateToken(updated), COOKIE_OPTIONS);
    }

    const { session_version: _sv, ...publicUser } = updated;
    return res.json({
      success: true,
      data: publicUser,
      message: (passwordChanged
        ? 'Data pengguna diperbarui. Semua sesi lama akun ini telah dikeluarkan.'
        : 'Data pengguna berhasil diperbarui.')
        + (moved ? ` ${moved} tugas yang ia tanggung jawabi dipindahkan ke Anda.` : ''),
    });
  } catch (err) {
    reportError(req, '[API USERS PUT]', err);
    return res.status(500).json({ success: false, message: 'Gagal memperbarui data user.' });
  }
});

app.get('/api/login-events', authMiddleware, ownerOnlyMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT e.id, e.email, e.ip, e.user_agent, e.success, e.reason, e.created_at, u.name AS user_name
       FROM login_events e
       LEFT JOIN users u ON u.id = e.user_id
       ORDER BY e.created_at DESC
       LIMIT 100`
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    reportError(req, '[API LOGIN EVENTS]', err);
    return res.status(500).json({ success: false, message: 'Gagal mengambil riwayat login.' });
  }
});

// Owner dismisses a reset request without changing the password (e.g. the member did not ask for it).
app.delete('/api/users/:id/reset-request', authMiddleware, ownerOnlyMiddleware, async (req, res) => {
  try {
    const upd = await db.query('UPDATE users SET reset_requested_at = NULL WHERE id = $1', [parseInt(req.params.id, 10)]);
    if (upd.rowCount === 0) return res.status(404).json({ success: false, message: 'Pengguna tidak ditemukan.' });
    return res.json({ success: true, message: 'Permintaan reset diabaikan.' });
  } catch (err) {
    reportError(req, '[API USERS RESET REQUEST]', err);
    return res.status(500).json({ success: false, message: 'Gagal memperbarui permintaan reset.' });
  }
});

// Recovery for a member who lost their phone. Also logs that account out everywhere.
app.post('/api/users/:id/reset-2fa', authMiddleware, ownerOnlyMiddleware, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (targetId === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Untuk akun sendiri, nonaktifkan 2FA lewat halaman Keamanan Akun.',
      });
    }
    const upd = await db.query(
      `UPDATE users SET totp_enabled = false, totp_secret = NULL, totp_last_step = NULL,
              session_version = session_version + 1
       WHERE id = $1`,
      [targetId]
    );
    if (upd.rowCount === 0) return res.status(404).json({ success: false, message: 'Pengguna tidak ditemukan.' });
    return res.json({ success: true, message: '2FA akun ini direset. Pengguna perlu login ulang.' });
  } catch (err) {
    reportError(req, '[API USERS RESET 2FA]', err);
    return res.status(500).json({ success: false, message: 'Gagal mereset 2FA.' });
  }
});

app.delete('/api/users/:id', authMiddleware, ownerOnlyMiddleware, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);

    // Proteksi Self-Delete
    if (targetId === req.user.id) {
      return res.status(400).json({ success: false, message: 'Owner dilarang menghapus akun sendiri!' });
    }

    // tasks.user_id cascades on delete, so hand an Owner's tasks to the acting Owner first.
    const client = await db.pool.connect();
    let delRes;
    let moved = 0;
    try {
      await client.query('BEGIN');
      moved = (await client.query('UPDATE tasks SET user_id = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2', [req.user.id, targetId])).rowCount;
      // FK only nulls done_reported_by; clear the timestamp too so the task can be reported again.
      await client.query('UPDATE tasks SET done_reported_by = NULL, done_reported_at = NULL WHERE done_reported_by = $1', [targetId]);
      delRes = await client.query('DELETE FROM users WHERE id = $1', [targetId]);
      await client.query(delRes.rowCount ? 'COMMIT' : 'ROLLBACK');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    if (delRes.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Pengguna tidak ditemukan.' });
    }
    return res.json({
      success: true,
      message: moved
        ? `Akun dihapus. ${moved} tugas yang ia tanggung jawabi dipindahkan ke Anda.`
        : 'Akun pengguna berhasil dihapus secara permanen.',
    });
  } catch (err) {
    reportError(req, '[API USERS DELETE]', err);
    return res.status(500).json({ success: false, message: 'Gagal menghapus user.' });
  }
});

// ==========================================
// NOTIFIKASI (/api/notifications)
// ==========================================
app.get('/api/notifications', authMiddleware, async (req, res) => {
  try {
    const [list, unread] = await Promise.all([
      db.query(
        `SELECT n.id, n.type, n.title, n.task_id, n.show_at AS created_at, n.read_at
         FROM notifications n
         LEFT JOIN tasks t ON t.id = n.task_id
         WHERE n.user_id = $1 AND n.show_at <= CURRENT_TIMESTAMP AND (n.task_id IS NULL OR t.deleted_at IS NULL)
         ORDER BY n.show_at DESC, n.id DESC LIMIT 30`,
        [req.user.id]
      ),
      db.query(
        `SELECT COUNT(*)::int AS n FROM notifications n LEFT JOIN tasks t ON t.id = n.task_id
         WHERE n.user_id = $1 AND n.read_at IS NULL AND n.show_at <= CURRENT_TIMESTAMP AND (n.task_id IS NULL OR t.deleted_at IS NULL)`,
        [req.user.id]
      ),
    ]);
    return res.json({ success: true, data: list.rows, meta: { unread: unread.rows[0].n } });
  } catch (err) {
    reportError(req, '[API NOTIFICATIONS GET]', err);
    return res.status(500).json({ success: false, message: 'Gagal memuat notifikasi.' });
  }
});

// Body { ids: [..] } marks those; no ids marks everything visible as read.
app.post('/api/notifications/read', authMiddleware, async (req, res) => {
  try {
    const ids = req.body?.ids;
    if (ids !== undefined && (!Array.isArray(ids) || ids.length > 100 || !ids.every(isPositiveIntLike))) {
      return badRequest(res, 'Daftar notifikasi tidak valid.');
    }
    await db.query(
      `UPDATE notifications SET read_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND read_at IS NULL AND show_at <= CURRENT_TIMESTAMP
         AND ($2::bigint[] IS NULL OR id = ANY($2::bigint[]))`,
      [req.user.id, ids ? ids.map(Number) : null]
    );
    return res.json({ success: true });
  } catch (err) {
    reportError(req, '[API NOTIFICATIONS READ]', err);
    return res.status(500).json({ success: false, message: 'Gagal memperbarui notifikasi.' });
  }
});

// ==========================================
// EKSPOR CSV (/api/reports/export.csv)
// ==========================================
// Leading = + - @ would make Excel evaluate the cell as a formula, so prefix those with '.
function csvCell(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const wibText = (d) => (d ? new Date(d).toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' }).slice(0, 16) : '');

app.get('/api/reports/export.csv', authMiddleware, ownerOnlyMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT t.id, t.title, t.status, t.due_date, t.created_at, t.completed_at, t.done_reported_at, t.archived_at, t.recurrence,
              u.name AS pj, r.name AS reporter,
              (SELECT string_agg(au.name, ', ' ORDER BY au.name) FROM task_assignees a JOIN users au ON au.id = a.user_id WHERE a.task_id = t.id) AS members,
              (SELECT m.body FROM task_comments m WHERE m.task_id = t.id AND m.kind = 'report' ORDER BY m.created_at DESC LIMIT 1) AS report_note,
              (SELECT m.link_url FROM task_comments m WHERE m.task_id = t.id AND m.kind = 'report' ORDER BY m.created_at DESC LIMIT 1) AS report_link
       FROM tasks t JOIN users u ON u.id = t.user_id LEFT JOIN users r ON r.id = t.done_reported_by
       WHERE t.deleted_at IS NULL
       ORDER BY t.created_at ASC`
    );
    const header = ['ID', 'Judul', 'Status', 'Tenggat (WIB)', 'Dibuat (WIB)', 'Selesai (WIB)', 'Tepat waktu',
      'Penanggung Jawab', 'Anggota', 'Dilaporkan oleh', 'Dilaporkan (WIB)', 'Catatan laporan', 'Tautan laporan', 'Berulang', 'Diarsipkan'];
    const rows = result.rows.map((t) => [
      t.id, t.title, t.status, wibText(t.due_date), wibText(t.created_at), wibText(t.completed_at),
      t.status === 'Done' ? (t.completed_at && new Date(t.completed_at) <= new Date(t.due_date) ? 'Ya' : 'Tidak') : '',
      t.pj, t.members || 'Semua anggota', t.reporter || '', wibText(t.done_reported_at),
      t.report_note || '', t.report_link || '', t.recurrence || '', t.archived_at ? 'Ya' : '',
    ]);
    // BOM so Excel opens UTF-8 correctly; CRLF per RFC 4180.
    const csv = '\uFEFF' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    const stamp = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="laporan-tugas-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    });
    return res.send(csv);
  } catch (err) {
    reportError(req, '[API REPORTS CSV]', err);
    return res.status(500).json({ success: false, message: 'Gagal membuat file CSV.' });
  }
});

// ==========================================
// ERROR MONITORING (/api/client-errors, /api/error-logs)
// ==========================================
const clientErrorHits = new Map(); // ip -> { count, resetAt } — per instance is enough for noise control
app.post('/api/client-errors', async (req, res) => {
  const now = Date.now();
  const hit = clientErrorHits.get(req.ip);
  if (!hit || hit.resetAt <= now) clientErrorHits.set(req.ip, { count: 1, resetAt: now + 60_000 });
  else if (++hit.count > 10) return res.status(429).json({ success: false, error: 'TOO_MANY_REQUESTS' });
  if (clientErrorHits.size > 5000) {
    for (const [k, v] of clientErrorHits) if (v.resetAt <= now) clientErrorHits.delete(k);
  }
  const { message, stack, path: pagePath } = req.body || {};
  if (typeof message !== 'string' || !message.trim()) return badRequest(res, 'Pesan error wajib diisi.');
  // Global cap across serverless instances: anonymous spam cannot grow the table without bound.
  try {
    const recent = await db.query(`SELECT COUNT(*)::int AS n FROM error_logs WHERE source = 'client' AND created_at > NOW() - INTERVAL '1 hour'`);
    if (recent.rows[0].n >= 300) return res.status(204).end();
  } catch { return res.status(204).end(); }
  await logError('client', '[BROWSER]', { message: message.slice(0, 1000), stack: typeof stack === 'string' ? stack : null }, {
    path: typeof pagePath === 'string' ? pagePath : null,
  });
  return res.status(204).end();
});

app.get('/api/error-logs', authMiddleware, ownerOnlyMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT e.id, e.source, e.tag, e.message, e.stack, e.path, e.created_at, u.name AS user_name
       FROM error_logs e LEFT JOIN users u ON u.id = e.user_id
       ORDER BY e.created_at DESC LIMIT 100`
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    reportError(req, '[API ERROR LOGS]', err);
    return res.status(500).json({ success: false, message: 'Gagal memuat log error.' });
  }
});

app.delete('/api/error-logs', authMiddleware, ownerOnlyMiddleware, async (req, res) => {
  try {
    await db.query('DELETE FROM error_logs');
    return res.json({ success: true, message: 'Log error dibersihkan.' });
  } catch (err) {
    reportError(req, '[API ERROR LOGS DELETE]', err);
    return res.status(500).json({ success: false, message: 'Gagal membersihkan log error.' });
  }
});

// ==========================================
// CRON HARIAN (/api/cron/daily) — dipanggil Vercel Cron dengan Authorization: Bearer $CRON_SECRET
// ==========================================
app.get('/api/cron/daily', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const given = Buffer.from(String(req.get('authorization') || ''));
  const expected = Buffer.from(`Bearer ${secret || ''}`);
  if (!secret || given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
  }
  const summary = { digests: 0, pruned_errors: 0, pruned_notifications: 0, mail: isMailConfigured() };
  try {
    summary.pruned_errors = (await db.query(`DELETE FROM error_logs WHERE created_at < NOW() - INTERVAL '30 days'`)).rowCount;
    summary.pruned_notifications = (await db.query(
      `DELETE FROM notifications WHERE read_at IS NOT NULL AND read_at < NOW() - INTERVAL '60 days'`
    )).rowCount;
    await db.query('DELETE FROM revoked_sessions WHERE expires_at < NOW()');

    if (summary.mail) {
      // Open tasks a member can work on that are overdue or due within 24h.
      const due = await db.query(
        `SELECT u.id AS user_id, u.email, u.name, t.title, t.due_date
         FROM users u
         JOIN tasks t ON t.status <> 'Done' AND t.deleted_at IS NULL AND t.archived_at IS NULL
                     AND t.done_reported_at IS NULL AND t.due_date < NOW() + INTERVAL '24 hours'
         WHERE u.role = 'User' AND u.status = 'Active' AND u.email_notifications = true
           AND (EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id AND a.user_id = u.id)
                OR NOT EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id))
         ORDER BY u.id, t.due_date`
      );
      const pending = await db.query(
        `SELECT u.email, COUNT(t.id)::int AS n
         FROM users u JOIN tasks t ON t.user_id = u.id AND t.done_reported_at IS NOT NULL AND t.status <> 'Done' AND t.deleted_at IS NULL
         WHERE u.role = 'Owner' AND u.status = 'Active' AND u.email_notifications = true
         GROUP BY u.email`
      );
      const byUser = new Map();
      for (const row of due.rows) {
        if (!byUser.has(row.email)) byUser.set(row.email, []);
        const late = new Date(row.due_date) < new Date();
        byUser.get(row.email).push(`• ${row.title} — ${late ? 'TERLAMBAT, ' : ''}tenggat ${fmtDue(row.due_date)} WIB`);
      }
      const jobs = [...byUser].map(([to, lines]) => sendMail({
        to, ...buildMail(`Ringkasan tugas: ${lines.length} perlu perhatian`, ['Tugas yang mendekati atau melewati tenggat:', ...lines]),
      }));
      for (const row of pending.rows) {
        jobs.push(sendMail({
          to: row.email,
          ...buildMail(`${row.n} laporan selesai menunggu diperiksa`, [`Ada ${row.n} tugas yang sudah dilaporkan selesai oleh anggota dan menunggu Anda tandai Done atau tolak.`]),
        }));
      }
      const results = await Promise.allSettled(jobs);
      summary.digests = results.filter((r) => r.status === 'fulfilled').length;
      for (const r of results) if (r.status === 'rejected') await logError('server', '[CRON DIGEST]', r.reason);
    }
    return res.json({ success: true, data: summary });
  } catch (err) {
    reportError(req, '[API CRON DAILY]', err);
    return res.status(500).json({ success: false, message: 'Cron harian gagal.' });
  }
});

// ==========================================
// RUTE HALAMAN WEBSITE (HTML Serving)
// ==========================================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/tasks', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tasks.html'));
});

app.get('/reminders', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reminders.html'));
});

app.get('/reports', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reports.html'));
});

app.get('/users', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'users.html'));
});

app.get('/forgot-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'forgot-password.html'));
});

app.get('/reset-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
});

app.get('/account', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'account.html'));
});

// Unknown API routes answer in JSON so apiFetch can show a readable message.
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Endpoint API tidak ditemukan.' });
});

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// Central error handler: malformed JSON, oversized bodies, and unexpected errors.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const isClientError = err.type === 'entity.parse.failed' || err.type === 'entity.too.large';
  const status = isClientError ? (err.status || 400) : 500;
  if (!isClientError) reportError(req, '[UNHANDLED ROUTE ERROR]', err);
  const message = err.type === 'entity.too.large'
    ? 'Ukuran data yang dikirim terlalu besar.'
    : isClientError ? 'Format data tidak valid.' : 'Terjadi kesalahan sistem internal.';
  if (req.path.startsWith('/api')) {
    return res.status(status).json({ success: false, error: isClientError ? 'BAD_REQUEST' : 'SERVER_ERROR', message });
  }
  return res.status(status).send(message);
});

// Jalankan server jika dipanggil lokal
if (require.main === module) {
  app.listen(PORT, async (err) => {
    // Express 5 passes listen errors (e.g. EADDRINUSE) here instead of throwing.
    if (err) {
      console.error(`[SERVER] Gagal berjalan di port ${PORT}: ${err.code || err.message}`);
      process.exit(1);
    }
    console.log(`=================================================`);
    console.log(`🚀 Website Manajemen Tugas Berjalan Aktif!`);
    console.log(`📡 URL Akses Lokal : http://localhost:${PORT}`);
    console.log(`=================================================`);
    // Lazy require: seed.js is excluded from the Vercel bundle (.vercelignore); local-only.
    // Akun Owner pertama dibuat dari env; tidak ada kata sandi bawaan.
    const { seedIfEmpty } = require('./seed');
    await seedIfEmpty().catch((err) => console.error('[SEED] Gagal mengecek data awal:', err.message));
  });
}

module.exports = app;
