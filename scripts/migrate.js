// Applies a SQL file (default db/schema.sql, idempotent) to DATABASE_URL in ONE transaction:
// any failing statement rolls back the whole file. Usage: node scripts/migrate.js [path/to/file.sql]
// Requires DB_TARGET_CONFIRM=<endpoint id of DATABASE_URL> (see lib/db-target.js).
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { assertTarget } = require('../lib/db-target');

assertTarget('MIGRATE');
const db = require('../lib/db');

(async () => {
  const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'db', 'schema.sql'));
  const sql = fs.readFileSync(file, 'utf8');
  console.log(`[MIGRATE] File: ${path.relative(process.cwd(), file)}`);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  console.log('[MIGRATE] Diterapkan.');
  await db.pool.end();
})().catch((err) => {
  console.error('[MIGRATE] Gagal, tidak ada perubahan yang tersimpan:', err.message);
  process.exit(1);
});
