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
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
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
app.param('id', (req, res, next, value) => {
  if (!/^\d+$/.test(value) || Number(value) > 2147483647) {
    return res.status(400).json({ success: false, error: 'BAD_REQUEST', message: 'ID tidak valid.' });
  }
  next();
});

function isValidPassword(password) {
  return typeof password === 'string' && password.trim().length >= PASSWORD_MIN_LENGTH;
}

// ==========================================
// INPUT VALIDATION HELPERS
// ==========================================
const TASK_STATUSES = ['To Do', 'In Progress', 'Done'];
const TASK_PRIORITIES = ['Low', 'Medium', 'High'];
const USER_ROLES = ['Owner', 'User'];
const USER_STATUSES = ['Active', 'Inactive'];
const MAX_INT = 2147483647;

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
  const { title, description, category, priority, status, due_date, user_id } = body;
  if (isCreate || title !== undefined) {
    if (typeof title !== 'string' || !title.trim()) return 'Judul tugas wajib diisi.';
    if (title.trim().length > 200) return 'Judul tugas maksimal 200 karakter.';
  }
  if (description !== undefined && description !== null && typeof description !== 'string') return 'Deskripsi tidak valid.';
  if (typeof description === 'string' && description.trim().length > 5000) return 'Deskripsi maksimal 5000 karakter.';
  if (category !== undefined && (typeof category !== 'string' || !category.trim() || category.trim().length > 50)) {
    return 'Kategori tidak valid (maksimal 50 karakter).';
  }
  if (priority !== undefined && !TASK_PRIORITIES.includes(priority)) return 'Prioritas harus Low, Medium, atau High.';
  if (status !== undefined && !TASK_STATUSES.includes(status)) return 'Status harus To Do, In Progress, atau Done.';
  if (isCreate && isBlankOptional(due_date)) return 'Tenggat waktu (deadline) wajib diisi.';
  if (!isBlankOptional(due_date) && !parseDateInput(due_date)) return 'Format tenggat waktu tidak valid.';
  if (!isBlankOptional(user_id) && !isPositiveIntLike(user_id)) return 'Penanggung jawab tugas tidak valid.';
  return null;
}

/** Owner may assign tasks to any active user; returns the id, or null if the target is invalid. */
async function resolveAssignee(req, rawUserId, fallbackId) {
  if (req.user.role !== 'Owner' || isBlankOptional(rawUserId)) return fallbackId;
  const id = Number(rawUserId);
  const result = await db.query(`SELECT id FROM users WHERE id = $1 AND status = 'Active'`, [id]);
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

app.post('/api/auth/login', loginRateLimit, async (req, res) => {
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
    console.error('[API AUTH LOGIN]', err);
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
    console.error('[API AUTH LOGIN 2FA]', err);
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
app.post('/api/auth/forgot-password', async (req, res) => {
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

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const { id, name, email, role, totp_enabled } = req.user;
  return res.json({
    success: true,
    data: { id, name, email, role, totp_enabled },
  });
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
    console.error('[API 2FA SETUP]', err);
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
    console.error('[API 2FA ENABLE]', err);
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
    console.error('[API 2FA DISABLE]', err);
    return res.status(500).json({ success: false, message: 'Gagal menonaktifkan 2FA.' });
  }
});

// ==========================================
// MODUL TUGAS API (/api/tasks)
// ==========================================
app.get('/api/tasks', authMiddleware, async (req, res) => {
  try {
    const status = queryString(req.query.status);
    const priority = queryString(req.query.priority);
    const category = queryString(req.query.category);
    const search = queryString(req.query.search);
    const user_id = queryString(req.query.user_id);
    const isOwner = req.user.role === 'Owner';

    if (isOwner && user_id && !isPositiveIntLike(user_id)) {
      return badRequest(res, 'Filter pengguna tidak valid.');
    }

    let queryText = `
      SELECT t.*, u.name AS assignee_name, u.email AS assignee_email
      FROM tasks t
      JOIN users u ON t.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    // Otorisasi RBAC: User biasa hanya melihat miliknya sendiri
    if (!isOwner) {
      params.push(req.user.id);
      queryText += ` AND t.user_id = $${params.length}`;
    } else if (user_id) {
      params.push(user_id);
      queryText += ` AND t.user_id = $${params.length}`;
    }

    if (status && status !== 'Semua') {
      params.push(status);
      queryText += ` AND t.status = $${params.length}`;
    }

    if (priority && priority !== 'Semua') {
      params.push(priority);
      queryText += ` AND t.priority = $${params.length}`;
    }

    if (category && category !== 'Semua') {
      params.push(category);
      queryText += ` AND t.category = $${params.length}`;
    }

    if (search) {
      params.push(`%${search.trim()}%`);
      queryText += ` AND (t.title ILIKE $${params.length} OR t.description ILIKE $${params.length})`;
    }

    queryText += ` ORDER BY t.due_date ASC, t.created_at DESC`;

    const result = await db.query(queryText, params);
    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (err) {
    console.error('[API TASKS GET]', err);
    return res.status(500).json({ success: false, message: 'Gagal memuat daftar tugas.' });
  }
});

// Only the Owner creates and deletes tasks; members work on what they are assigned.
app.post('/api/tasks', authMiddleware, ownerOnlyMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    const { title, description, category, priority, due_date, user_id } = body;

    const validationError = validateTaskBody(body, true);
    if (validationError) return badRequest(res, validationError);

    const assigneeId = await resolveAssignee(req, user_id, req.user.id);
    if (assigneeId === null) return badRequest(res, 'Penanggung jawab tidak ditemukan atau tidak aktif.');

    // Honour the column the task was added from (e.g. "+" on In Progress); defaults to To Do.
    const initialStatus = body.status || 'To Do';
    const isDone = initialStatus === 'Done';

    const insertRes = await db.query(
      `INSERT INTO tasks (user_id, title, description, category, priority, status, due_date, completed, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        assigneeId,
        title.trim(),
        description ? description.trim() || null : null,
        category ? category.trim() : 'Umum',
        priority || 'Medium',
        initialStatus,
        parseDateInput(due_date),
        isDone,
        isDone ? new Date() : null,
      ]
    );

    return res.status(201).json({
      success: true,
      data: insertRes.rows[0],
      message: 'Tugas baru berhasil disimpan ke workspace.',
    });
  } catch (err) {
    console.error('[API TASKS POST]', err);
    return res.status(500).json({ success: false, message: 'Gagal membuat tugas baru.' });
  }
});

app.put('/api/tasks/:id', authMiddleware, async (req, res) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    const body = req.body || {};
    const { title, description, category, priority, status, due_date, user_id } = body;

    const validationError = validateTaskBody(body, false);
    if (validationError) return badRequest(res, validationError);

    // Cek kepemilikan task
    const checkRes = await db.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Tugas tidak ditemukan.' });
    }

    const existingTask = checkRes.rows[0];
    const isOwner = req.user.role === 'Owner';
    if (!isOwner && existingTask.user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Anda tidak memiliki hak mengubah tugas ini.' });
    }

    // State machine logic untuk status Done vs lainnya
    let newStatus = status !== undefined ? status : existingTask.status;
    let isCompleted = existingTask.completed;
    let completedAt = existingTask.completed_at;

    // Only a real status change touches completed_at, so re-saving a Done task keeps its original timestamp.
    if (status !== undefined && status !== existingTask.status) {
      if (newStatus === 'Done') {
        isCompleted = true;
        completedAt = new Date();
      } else {
        isCompleted = false;
        completedAt = null;
      }
    }

    const updatedTitle = title !== undefined ? title.trim() : existingTask.title;
    const updatedDesc = description === undefined
      ? existingTask.description
      : (description ? description.trim() || null : null);
    const updatedCategory = category !== undefined ? category.trim() : existingTask.category;
    const updatedPriority = priority !== undefined ? priority : existingTask.priority;
    const updatedDueDate = isBlankOptional(due_date) ? existingTask.due_date : parseDateInput(due_date);
    const updatedUserId = await resolveAssignee(req, user_id, existingTask.user_id);
    if (updatedUserId === null) return badRequest(res, 'Penanggung jawab tidak ditemukan atau tidak aktif.');

    const updateRes = await db.query(
      `UPDATE tasks
       SET title = $1, description = $2, category = $3, priority = $4, status = $5,
           completed = $6, completed_at = $7, due_date = $8, user_id = $9, updated_at = CURRENT_TIMESTAMP
       WHERE id = $10
       RETURNING *`,
      [
        updatedTitle,
        updatedDesc,
        updatedCategory,
        updatedPriority,
        newStatus,
        isCompleted,
        completedAt,
        updatedDueDate,
        updatedUserId,
        taskId,
      ]
    );

    return res.json({
      success: true,
      data: updateRes.rows[0],
      message: newStatus === 'Done' ? 'Luar biasa! Tugas telah ditandai selesai.' : 'Perubahan tugas berhasil disimpan.',
    });
  } catch (err) {
    console.error('[API TASKS PUT]', err);
    return res.status(500).json({ success: false, message: 'Gagal memperbarui data tugas.' });
  }
});

app.delete('/api/tasks/:id', authMiddleware, ownerOnlyMiddleware, async (req, res) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    const checkRes = await db.query('SELECT * FROM tasks WHERE id = $1', [taskId]);

    if (checkRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Tugas tidak ditemukan.' });
    }

    const task = checkRes.rows[0];
    if (req.user.role !== 'Owner' && task.user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Anda tidak memiliki hak menghapus tugas ini.' });
    }

    await db.query('DELETE FROM tasks WHERE id = $1', [taskId]);
    return res.json({ success: true, message: 'Tugas telah dihapus dari daftar.' });
  } catch (err) {
    console.error('[API TASKS DELETE]', err);
    return res.status(500).json({ success: false, message: 'Gagal menghapus tugas.' });
  }
});

// ==========================================
// MODUL PENGINGAT DEADLINE (/api/reminders)
// ==========================================
app.get('/api/reminders/urgent', authMiddleware, async (req, res) => {
  try {
    const isOwner = req.user.role === 'Owner';
    let query = `
      SELECT t.id, t.title, t.category, t.priority, t.due_date, t.status,
             ROUND(EXTRACT(EPOCH FROM (t.due_date - CURRENT_TIMESTAMP)) / 3600.0, 1) AS hours_left
      FROM tasks t
      WHERE t.completed = false
    `;
    const params = [];

    if (!isOwner) {
      params.push(req.user.id);
      query += ` AND t.user_id = $${params.length}`;
    }

    query += ` ORDER BY t.due_date ASC`;

    const result = await db.query(query, params);
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
    console.error('[API REMINDERS URGENT]', err);
    return res.status(500).json({ success: false, message: 'Gagal mengambil pengingat deadline.' });
  }
});

app.get('/api/reminders', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT r.*, t.title AS task_title
       FROM reminders r
       LEFT JOIN tasks t ON r.task_id = t.id
       WHERE r.user_id = $1
       ORDER BY r.remind_at ASC`,
      [req.user.id]
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[API REMINDERS GET]', err);
    return res.status(500).json({ success: false, message: 'Gagal mengambil daftar pengingat kustom.' });
  }
});

app.post('/api/reminders', authMiddleware, async (req, res) => {
  try {
    const { title, remind_at, task_id } = req.body || {};
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
      const taskRes = await db.query('SELECT user_id FROM tasks WHERE id = $1', [taskId]);
      const canLink = taskRes.rows.length
        && (req.user.role === 'Owner' || taskRes.rows[0].user_id === req.user.id);
      if (!canLink) return badRequest(res, 'Tugas terkait tidak ditemukan.');
    }

    const insertRes = await db.query(
      `INSERT INTO reminders (user_id, task_id, title, remind_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.user.id, taskId, title.trim(), remindAt]
    );

    return res.status(201).json({
      success: true,
      data: insertRes.rows[0],
      message: 'Pengingat kustom berhasil dijadwalkan.',
    });
  } catch (err) {
    console.error('[API REMINDERS POST]', err);
    return res.status(500).json({ success: false, message: 'Gagal menambahkan pengingat.' });
  }
});

app.delete('/api/reminders/:id', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const delRes = await db.query('DELETE FROM reminders WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (delRes.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Pengingat tidak ditemukan.' });
    }
    return res.json({ success: true, message: 'Pengingat berhasil dihapus.' });
  } catch (err) {
    console.error('[API REMINDERS DELETE]', err);
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
    const isOwner = req.user.role === 'Owner';

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
    let userConstraint = '';
    if (!isOwner) {
      params.push(req.user.id);
      userConstraint = `AND user_id = $2`;
    }

    // 1. Ringkasan KPI
    const kpiRes = await db.query(
      `SELECT 
         COUNT(*) AS total_tasks,
         COUNT(*) FILTER (WHERE status = 'Done') AS completed_tasks,
         COUNT(*) FILTER (WHERE status = 'In Progress') AS in_progress_tasks,
         COUNT(*) FILTER (WHERE status = 'To Do') AS todo_tasks,
         COUNT(*) FILTER (WHERE status != 'Done' AND due_date < CURRENT_TIMESTAMP) AS overdue_tasks,
         COUNT(*) FILTER (WHERE status = 'Done' AND completed_at <= due_date) AS on_time_tasks
       FROM tasks
       WHERE created_at >= $1 ${userConstraint}`,
      params
    );

    const kpi = kpiRes.rows[0];
    const total = parseInt(kpi.total_tasks, 10);
    const completed = parseInt(kpi.completed_tasks, 10);
    const onTime = parseInt(kpi.on_time_tasks, 10);

    const completionRate = total > 0 ? Math.round((completed / total) * 100 * 10) / 10 : 0;
    const onTimeRate = completed > 0 ? Math.round((onTime / completed) * 100 * 10) / 10 : 100;

    // 2. Distribusi Kategori
    const catRes = await db.query(
      `SELECT category, COUNT(*) as count
       FROM tasks
       WHERE created_at >= $1 ${userConstraint}
       GROUP BY category
       ORDER BY count DESC`,
      params
    );

    // 3. Distribusi Prioritas
    const prioRes = await db.query(
      `SELECT priority, COUNT(*) as count
       FROM tasks
       WHERE created_at >= $1 ${userConstraint}
       GROUP BY priority
       ORDER BY count DESC`,
      params
    );

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
        category_distribution: catRes.rows,
        priority_distribution: prioRes.rows,
      },
    });
  } catch (err) {
    console.error('[API REPORTS ANALYTICS]', err);
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
              COUNT(t.id) AS total_tasks,
              COUNT(t.id) FILTER (WHERE t.status = 'Done') AS completed_tasks
       FROM users u
       LEFT JOIN tasks t ON u.id = t.user_id
       GROUP BY u.id
       ORDER BY u.created_at ASC`
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[API USERS GET]', err);
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
    console.error('[API USERS POST]', err);
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

    // Owner changing their own password: re-issue their cookie so only other devices are logged out.
    if (passwordChanged && targetId === req.user.id) {
      res.cookie(COOKIE_NAME, generateToken(updated), COOKIE_OPTIONS);
    }

    const { session_version: _sv, ...publicUser } = updated;
    return res.json({
      success: true,
      data: publicUser,
      message: passwordChanged
        ? 'Data pengguna diperbarui. Semua sesi lama akun ini telah dikeluarkan.'
        : 'Data pengguna berhasil diperbarui.',
    });
  } catch (err) {
    console.error('[API USERS PUT]', err);
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
    console.error('[API LOGIN EVENTS]', err);
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
    console.error('[API USERS RESET REQUEST]', err);
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
    console.error('[API USERS RESET 2FA]', err);
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

    const delRes = await db.query('DELETE FROM users WHERE id = $1', [targetId]);
    if (delRes.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Pengguna tidak ditemukan.' });
    }
    return res.json({ success: true, message: 'Akun pengguna berhasil dihapus secara permanen.' });
  } catch (err) {
    console.error('[API USERS DELETE]', err);
    return res.status(500).json({ success: false, message: 'Gagal menghapus user.' });
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

// Central error handler: malformed JSON, oversized bodies, and unexpected errors.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const isClientError = err.type === 'entity.parse.failed' || err.type === 'entity.too.large';
  const status = isClientError ? (err.status || 400) : 500;
  if (!isClientError) console.error('[UNHANDLED ROUTE ERROR]', err);
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
