// RFC 6238 TOTP (SHA-1, 6 digits, 30 s) on node:crypto only — compatible with
// Google Authenticator, Microsoft Authenticator, Authy, 1Password, etc.
const crypto = require('crypto');

const STEP_SECONDS = 30;
const DIGITS = 6;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20)); // 160-bit, the RFC 4226 recommendation
}

function hotp(keyBuf, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', keyBuf).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(bin).padStart(DIGITS, '0');
}

function currentStep(nowMs = Date.now()) {
  return Math.floor(nowMs / 1000 / STEP_SECONDS);
}

// Returns the matched time step (for replay protection) or null. Accepts ±1 step of clock drift.
function verify(secret, code, { nowMs = Date.now(), lastUsedStep = null } = {}) {
  const token = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(token)) return null;
  let key;
  try { key = base32Decode(secret); } catch { return null; }
  const now = currentStep(nowMs);
  // pg returns BIGINT columns as strings.
  if (lastUsedStep !== null) lastUsedStep = Number(lastUsedStep);
  for (const step of [now - 1, now, now + 1]) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue; // a code may be used only once
    const expected = Buffer.from(hotp(key, step));
    if (crypto.timingSafeEqual(expected, Buffer.from(token))) return step;
  }
  return null;
}

function otpauthUri(secret, accountEmail, issuer = 'Manajemen Tugas') {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

module.exports = { generateSecret, verify, otpauthUri, hotp, base32Encode, base32Decode, currentStep };
