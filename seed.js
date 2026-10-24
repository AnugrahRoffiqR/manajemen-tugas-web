const db = require('./lib/db');
const { hashPassword } = require('./lib/auth');

async function seed() {
  try {
    console.log('[SEED] Memeriksa data awal di Neon DB...');
    const userCountRes = await db.query('SELECT COUNT(*) AS count FROM users');
    const count = parseInt(userCountRes.rows[0].count, 10);

    if (count === 0) {
      console.log('[SEED] Tabel users kosong. Menambahkan akun Owner default...');
      const hashedPassword = await hashPassword('Admin123!');
      
      const insertOwnerRes = await db.query(
        `INSERT INTO users (name, email, password, role, status)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, email, role`,
        ['Nugi Pratama (Owner)', 'admin@manajementugas.local', hashedPassword, 'Owner', 'Active']
      );

      const ownerId = insertOwnerRes.rows[0].id;
      console.log(`[SEED] Akun Owner berhasil dibuat (ID: ${ownerId}): admin@manajementugas.local / Admin123!`);

      // Buat tugas awal
      const now = new Date();
      const in2Hours = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      await db.query(
        `INSERT INTO tasks (user_id, title, description, category, priority, status, due_date, completed)
         VALUES 
         ($1, 'Finalisasi Review Arsitektur Website', 'Memeriksa integrasi Neon DB dan Vercel API', 'Teknis', 'High', 'In Progress', $2, false),
         ($1, 'Kirim Laporan Mingguan ke Tim', 'Merekap seluruh progres sprint minggu ini', 'Operasional', 'Medium', 'To Do', $3, false),
         ($1, 'Setup Database & Koneksi Pooler Neon', 'Inisialisasi tabel users, tasks, dan reminders', 'Teknis', 'High', 'Done', $4, true)`,
        [ownerId, in2Hours, tomorrow, yesterday]
      );

      await db.query(
        `UPDATE tasks SET completed_at = CURRENT_TIMESTAMP WHERE status = 'Done' AND user_id = $1`,
        [ownerId]
      );

      console.log('[SEED] 3 data tugas awal berhasil dibuat!');
    } else {
      console.log(`[SEED] Database sudah memiliki ${count} pengguna. Tidak perlu seed ulang.`);
    }

    const users = await db.query('SELECT id, name, email, role, status FROM users');
    console.log('[DB USERS]', users.rows);

    const tasks = await db.query('SELECT id, title, category, priority, status FROM tasks');
    console.log('[DB TASKS]', tasks.rows);

    process.exit(0);
  } catch (err) {
    console.error('[SEED ERROR]', err);
    process.exit(1);
  }
}

seed();
