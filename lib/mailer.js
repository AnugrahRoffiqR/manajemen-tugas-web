// Minimal Resend client (https://resend.com/docs/api-reference/emails/send-email).
// Uses the built-in fetch, so no extra npm dependency.
// RESEND_API_URL override exists only so tests can capture mail with a local stub.
const RESEND_URL = process.env.RESEND_API_URL || 'https://api.resend.com/emails';

function isMailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM && process.env.APP_URL);
}

async function sendMail({ to, subject, text, html }) {
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: process.env.RESEND_FROM, to: [to], subject, text, html }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    // Resend error bodies never contain the API key, so they are safe to log.
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status}: ${detail.slice(0, 200)}`);
  }
}

module.exports = { isMailConfigured, sendMail };
