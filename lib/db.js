const { Pool } = require('pg');
require('dotenv').config();

// Neon serves publicly trusted certificates, so verify them fully. Normalising sslmode
// also silences pg's warning about 'require' changing meaning in pg v9.
function normalizeConnectionString(raw) {
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    url.searchParams.delete('channel_binding');
    url.searchParams.set('sslmode', 'verify-full');
    return url.toString();
  } catch {
    return raw;
  }
}

const pool = new Pool({
  connectionString: normalizeConnectionString(process.env.DATABASE_URL),
  max: 10,
  idleTimeoutMillis: 5000,
  connectionTimeoutMillis: 15000,
});

pool.on('error', (err) => {
  // Neon closes idle sockets; the pool drops them, so this only needs logging.
  console.warn('[DATABASE] Neon idle connection event (safe):', err.message);
});

function isConnectionError(err) {
  const msg = err?.message || '';
  return ['Connection terminated', 'timeout', 'closed', 'ECONNRESET'].some((s) => msg.includes(s));
}

async function query(text, params, retries = 2) {
  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    // Only connect failures are retried: the statement has not run yet, so a retry cannot duplicate writes.
    if (retries > 0 && isConnectionError(err)) {
      console.warn(`[DATABASE] Reconnecting to Neon DB... (Sisa retry: ${retries})`);
      await new Promise((r) => setTimeout(r, 600));
      return query(text, params, retries - 1);
    }
    throw err;
  }

  try {
    return await client.query(text, params);
  } catch (err) {
    const broken = isConnectionError(err);
    // Destroy a broken socket instead of handing it back to the pool.
    client.release(broken ? err : undefined);
    client = null;
    // Reads are safe to repeat; writes are not (the first attempt may have committed).
    if (broken && retries > 0 && /^\s*SELECT\b/i.test(text)) {
      console.warn(`[DATABASE] Retry SELECT setelah koneksi putus (Sisa retry: ${retries})`);
      return query(text, params, retries - 1);
    }
    throw err;
  } finally {
    if (client) client.release();
  }
}

module.exports = {
  query,
  pool,
};
