const { Pool } = require('pg');
require('dotenv').config();

let connectionString = process.env.DATABASE_URL;
if (connectionString) {
  connectionString = connectionString.replace('&channel_binding=require', '');
}

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false,
  },
  max: 10,
  idleTimeoutMillis: 5000,
  connectionTimeoutMillis: 15000,
});

pool.on('error', (err) => {
  // Cegah unhandled error crash saat idle socket ditutup oleh Neon
  console.warn('[DATABASE] Neon idle connection event (safe):', err.message);
});

async function query(text, params, retries = 2) {
  let client;
  try {
    client = await pool.connect();
    const res = await client.query(text, params);
    return res;
  } catch (err) {
    const isConnErr = err.message && (
      err.message.includes('Connection terminated') ||
      err.message.includes('timeout') ||
      err.message.includes('closed')
    );

    if (retries > 0 && isConnErr) {
      console.warn(`[DATABASE] Reconnecting to Neon DB... (Sisa retry: ${retries})`);
      await new Promise((r) => setTimeout(r, 600));
      return query(text, params, retries - 1);
    }
    throw err;
  } finally {
    if (client) {
      try {
        client.release();
      } catch (releaseErr) {
        // Abaikan error release pada dead socket
      }
    }
  }
}

module.exports = {
  query,
  pool,
};
