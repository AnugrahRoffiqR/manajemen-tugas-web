// Web notifications, notification emails and the error log.
// None of these helpers throw: a failed notification or log must never fail the request that caused it.
const db = require('./db');
const { isMailConfigured, sendMail } = require('./mailer');

const clip = (value, max) => (value == null ? null : String(value).slice(0, max));

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function logError(source, tag, err, { path = null, userId = null } = {}) {
  try {
    // Accepts Error instances and plain { message, stack } objects (browser reports).
    const message = typeof err?.message === 'string' ? err.message : String(err ?? 'Unknown error');
    await db.query(
      `INSERT INTO error_logs (source, tag, message, stack, path, user_id) VALUES ($1, $2, $3, $4, $5, $6)`,
      [source, clip(tag, 80), clip(message || '(kosong)', 1000), clip(err?.stack, 4000), clip(path, 300), userId || null]
    );
  } catch (logErr) {
    console.warn('[ERROR LOG] Gagal mencatat:', logErr.message);
  }
}

// Plain-text + minimal HTML mail with a button back to the app.
function buildMail(subject, lines, linkPath = '/tasks') {
  const url = `${process.env.APP_URL || ''}${linkPath}`;
  const text = `${lines.join('\n')}\n\nBuka aplikasi: ${url}`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a;line-height:1.5">
${lines.map((l) => `<p style="margin:0 0 10px">${escapeHtml(l)}</p>`).join('\n')}
<p style="margin:16px 0 0"><a href="${escapeHtml(url)}" style="background:#0369a1;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">Buka Manajemen Tugas</a></p>
</div>`;
  return { subject, text, html };
}

/**
 * Creates one web notification per user and, when `email` is given, mails users who opted in.
 * showAt in the future hides the notification until then (used for scheduled reminders).
 */
async function notify(userIds, { type, title, taskId = null, reminderId = null, showAt = null, email = null }) {
  const ids = [...new Set((userIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return;
  try {
    await db.query(
      `INSERT INTO notifications (user_id, type, title, task_id, reminder_id, show_at)
       SELECT uid, $2, $3, $4, $5, COALESCE($6::timestamptz, CURRENT_TIMESTAMP) FROM UNNEST($1::int[]) AS uid`,
      [ids, type, clip(title, 300), taskId, reminderId, showAt]
    );
  } catch (err) {
    console.warn('[NOTIFY] Gagal menyimpan notifikasi:', err.message);
    await logError('server', '[NOTIFY]', err);
  }
  if (!email || !isMailConfigured()) return;
  try {
    const r = await db.query(
      `SELECT email FROM users WHERE id = ANY($1::int[]) AND status = 'Active' AND email_notifications = true`,
      [ids]
    );
    const mail = buildMail(email.subject, email.lines, email.linkPath);
    const results = await Promise.allSettled(r.rows.map((u) => sendMail({ to: u.email, ...mail })));
    for (const result of results) {
      if (result.status === 'rejected') await logError('server', '[NOTIFY EMAIL]', result.reason);
    }
  } catch (err) {
    await logError('server', '[NOTIFY EMAIL]', err);
  }
}

module.exports = { notify, logError, buildMail, escapeHtml };
