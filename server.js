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
require('dotenv').config();

const db = require('./lib/db');
const {
  COOKIE_NAME,
  COOKIE_OPTIONS,
  hashPassword,
  comparePassword,
  generateToken,
  authMiddleware,
  ownerOnlyMiddleware,
} = require('./lib/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// AUTO-SEED LOGIC (Akun Owner & Data Awal)
// ==========================================
async function checkAndSeedInitialData() {
  try {
    const userCountRes = await db.query('SELECT COUNT(*) AS count FROM users');
    const userCount = parseInt(userCountRes.rows[0].count, 10);

    if (userCount === 0) {
      console.log('[SEED] Tabel users kosong. Menginisialisasi akun Owner default...');
      const hashedPassword = await hashPassword('Admin123!');
      
      const insertOwnerRes = await db.query(
        `INSERT INTO users (name, email, password, role, status)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, email, role`,
        ['Nugi Pratama (Owner)', 'admin@manajementugas.local', hashedPassword, 'Owner', 'Active']
      );

      const ownerId = insertOwnerRes.rows[0].id;
      console.log('[SEED] Akun Owner default berhasil dibuat: admin@manajementugas.local / Admin123!');

      // Tambah contoh tugas awal agar dashboard langsung informatif
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

      console.log('[SEED] 3 data tugas awal berhasil diinisialisasi.');
    }
  } catch (err) {
    console.error('[SEED] Gagal mengecek/menginisialisasi seed data:', err.message);
  }
}

// ==========================================
// MODUL AUTENTIKASI API (/api/auth)
// ==========================================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'BAD_REQUEST',
        message: 'Alamat email dan kata sandi wajib diisi.',
      });
    }

    const userRes = await db.query(
      'SELECT id, name, email, password, role, status FROM users WHERE LOWER(email) = LOWER($1)',
      [email.trim()]
    );

    if (userRes.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'INVALID_CREDENTIALS',
        message: 'Email atau kata sandi tidak sesuai. Silakan periksa kembali.',
      });
    }

    const user = userRes.rows[0];

    if (user.status !== 'Active') {
      return res.status(403).json({
        success: false,
        error: 'ACCOUNT_INACTIVE',
        message: 'Akun Anda dinonaktifkan oleh Administrator. Silakan hubungi Owner.',
      });
    }

    const isMatch = await comparePassword(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: 'INVALID_CREDENTIALS',
        message: 'Email atau kata sandi tidak sesuai. Silakan periksa kembali.',
      });
    }

    const token = generateToken(user);
    res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);

    return res.json({
      success: true,
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      message: `Selamat datang kembali, ${user.name}!`,
    });
  } catch (err) {
    console.error('[API AUTH LOGIN]', err);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Terjadi kesalahan sistem internal. Silakan coba lagi nanti.',
    });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  return res.json({
    success: true,
    message: 'Anda berhasil keluar dari sistem.',
  });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  return res.json({
    success: true,
    data: req.user,
  });
});

// ==========================================
// MODUL TUGAS API (/api/tasks)
// ==========================================
app.get('/api/tasks', authMiddleware, async (req, res) => {
  try {
    const { status, priority, category, search, user_id } = req.query;
    const isOwner = req.user.role === 'Owner';

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

app.post('/api/tasks', authMiddleware, async (req, res) => {
  try {
    const { title, description, category, priority, due_date, user_id } = req.body;

    if (!title || title.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Judul tugas wajib diisi.' });
    }

    if (!due_date) {
      return res.status(400).json({ success: false, message: 'Tenggat waktu (deadline) wajib diisi.' });
    }

    // Tentukan assignee
    let assigneeId = req.user.id;
    if (req.user.role === 'Owner' && user_id) {
      assigneeId = parseInt(user_id, 10);
    }

    const insertRes = await db.query(
      `INSERT INTO tasks (user_id, title, description, category, priority, status, due_date, completed)
       VALUES ($1, $2, $3, $4, $5, 'To Do', $6, false)
       RETURNING *`,
      [
        assigneeId,
        title.trim(),
        description ? description.trim() : null,
        category || 'Umum',
        priority || 'Medium',
        new Date(due_date),
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
    const { title, description, category, priority, status, due_date, user_id } = req.body;

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

    if (status !== undefined) {
      if (newStatus === 'Done') {
        isCompleted = true;
        completedAt = new Date();
      } else {
        isCompleted = false;
        completedAt = null;
      }
    }

    const updatedTitle = title !== undefined ? title.trim() : existingTask.title;
    const updatedDesc = description !== undefined ? description.trim() : existingTask.description;
    const updatedCategory = category !== undefined ? category : existingTask.category;
    const updatedPriority = priority !== undefined ? priority : existingTask.priority;
    const updatedDueDate = due_date ? new Date(due_date) : existingTask.due_date;
    const updatedUserId = (isOwner && user_id) ? parseInt(user_id, 10) : existingTask.user_id;

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

app.delete('/api/tasks/:id', authMiddleware, async (req, res) => {
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
    const { title, remind_at, task_id } = req.body;
    if (!title || !remind_at) {
      return res.status(400).json({ success: false, message: 'Catatan pengingat dan waktu wajib diisi.' });
    }

    const insertRes = await db.query(
      `INSERT INTO reminders (user_id, task_id, title, remind_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.user.id, task_id || null, title.trim(), new Date(remind_at)]
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
    await db.query('DELETE FROM reminders WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    return res.json({ success: true, message: 'Pengingat berhasil dihapus.' });
  } catch (err) {
    console.error('[API REMINDERS DELETE]', err);
    return res.status(500).json({ success: false, message: 'Gagal menghapus pengingat.' });
  }
});

// ==========================================
// MODUL LAPORAN & ANALITIK (/api/reports)
// ==========================================
app.get('/api/reports/analytics', authMiddleware, async (req, res) => {
  try {
    const { period } = req.query; // 'today', 'week', 'month', 'all'
    const isOwner = req.user.role === 'Owner';

    let dateFilter = '1970-01-01';
    const now = new Date();

    if (period === 'today') {
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      dateFilter = today.toISOString();
    } else if (period === 'week') {
      const day = now.getDay() || 7;
      const monday = new Date(now);
      monday.setHours(0, 0, 0, 0);
      monday.setDate(now.getDate() - day + 1);
      dateFilter = monday.toISOString();
    } else if (period === 'month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      dateFilter = firstDay.toISOString();
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
      `SELECT u.id, u.name, u.email, u.role, u.status, u.created_at,
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
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Nama, email, dan kata sandi wajib diisi.' });
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
    const { name, role, status, password } = req.body;

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
    if (password && password.trim().length > 0) {
      newPassword = await hashPassword(password.trim());
    }

    const updateRes = await db.query(
      `UPDATE users
       SET name = $1, role = $2, status = $3, password = $4
       WHERE id = $5
       RETURNING id, name, email, role, status`,
      [newName, newRole, newStatus, newPassword, targetId]
    );

    return res.json({
      success: true,
      data: updateRes.rows[0],
      message: 'Data pengguna berhasil diperbarui.',
    });
  } catch (err) {
    console.error('[API USERS PUT]', err);
    return res.status(500).json({ success: false, message: 'Gagal memperbarui data user.' });
  }
});

app.delete('/api/users/:id', authMiddleware, ownerOnlyMiddleware, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);

    // Proteksi Self-Delete
    if (targetId === req.user.id) {
      return res.status(400).json({ success: false, message: 'Owner dilarang menghapus akun sendiri!' });
    }

    await db.query('DELETE FROM users WHERE id = $1', [targetId]);
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

// Jalankan server jika dipanggil lokal
if (require.main === module) {
  app.listen(PORT, async () => {
    console.log(`=================================================`);
    console.log(`🚀 Website Manajemen Tugas Berjalan Aktif!`);
    console.log(`📡 URL Akses Lokal : http://localhost:${PORT}`);
    console.log(`🔐 Akun Default   : admin@manajementugas.local / Admin123!`);
    console.log(`=================================================`);
    await checkAndSeedInitialData();
  });
}

module.exports = app;
