const db = require('./lib/db');
const { hashPassword } = require('./lib/auth');

// Creates the first Owner only when the users table is empty.
// Credentials come from SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD; there is no built-in default
// password, so an empty database can never end up with a publicly known login.
async function seedIfEmpty() {
  const userCountRes = await db.query('SELECT COUNT(*) AS count FROM users');
  const count = parseInt(userCountRes.rows[0].count, 10);
  if (count > 0) return { created: false, count };

  const email = (process.env.SEED_OWNER_EMAIL || '').trim();
  const password = process.env.SEED_OWNER_PASSWORD || '';
  if (!email || password.length < 12) {
    console.warn('[SEED] Tabel users kosong. Isi SEED_OWNER_EMAIL dan SEED_OWNER_PASSWORD (min. 12 karakter) di .env lalu jalankan ulang untuk membuat akun Owner pertama.');
    return { created: false, count };
  }

  const insertOwnerRes = await db.query(
    `INSERT INTO users (name, email, password, role, status)
     VALUES ($1, $2, $3, 'Owner', 'Active')
     RETURNING id`,
    [process.env.SEED_OWNER_NAME || 'Owner', email, await hashPassword(password)]
  );
  console.log(`[SEED] Akun Owner pertama dibuat (ID: ${insertOwnerRes.rows[0].id}, email: ${email}). Hapus SEED_OWNER_PASSWORD dari .env sekarang.`);
  return { created: true, count: 1 };
}

module.exports = { seedIfEmpty };

if (require.main === module) {
  seedIfEmpty()
    .then(({ created, count }) => {
      if (!created && count > 0) console.log(`[SEED] Database sudah memiliki ${count} pengguna. Tidak perlu seed ulang.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[SEED ERROR]', err);
      process.exit(1);
    });
}
