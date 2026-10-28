-- Skema database Manajemen Tugas (PostgreSQL / Neon).
-- Aman dijalankan ulang: semua perintah idempoten dan hanya menambah (tidak menghapus kolom/data).
-- Enum status/peran divalidasi di server.js (TASK_STATUSES, USER_ROLES, USER_STATUSES).

CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  email       VARCHAR(150) NOT NULL UNIQUE,
  password    VARCHAR(255) NOT NULL,
  role        VARCHAR(20)  NOT NULL DEFAULT 'User',
  status      VARCHAR(20)  NOT NULL DEFAULT 'Active',
  created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tasks (
  id            SERIAL PRIMARY KEY,
  title         TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  description   TEXT,
  status        VARCHAR(20) DEFAULT 'To Do',
  due_date      TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  completed_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS reminders (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id       INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  title         VARCHAR(255) NOT NULL,
  remind_at     TIMESTAMPTZ NOT NULL,
  is_dismissed  BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reminders_user_id   ON reminders(user_id);
CREATE INDEX IF NOT EXISTS idx_reminders_remind_at ON reminders(remind_at);
CREATE INDEX IF NOT EXISTS idx_tasks_user_id       ON tasks(user_id);

-- Penghitung login gagal (dipakai bersama oleh semua instance Vercel).
-- Kolom ip berisi kunci: alamat IP, atau "acct:<email>" untuk batas per akun.
CREATE TABLE IF NOT EXISTS login_attempts (
  ip        TEXT PRIMARY KEY,
  count     INTEGER NOT NULL DEFAULT 1,
  reset_at  TIMESTAMPTZ NOT NULL
);

-- Riwayat login (berhasil & gagal) untuk dipantau Owner. Dipangkas otomatis > 90 hari.
CREATE TABLE IF NOT EXISTS login_events (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  email       VARCHAR(150) NOT NULL,
  ip          VARCHAR(64),
  user_agent  VARCHAR(300),
  success     BOOLEAN NOT NULL,
  reason      VARCHAR(30) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_login_events_created_at ON login_events(created_at DESC);

-- Versi sesi: dinaikkan saat kata sandi diganti, sehingga semua token lama ditolak.
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;

-- Sesi yang sudah logout (jti token JWT). Dipangkas otomatis setelah kedaluwarsa.
CREATE TABLE IF NOT EXISTS revoked_sessions (
  jti         UUID PRIMARY KEY,
  expires_at  TIMESTAMPTZ NOT NULL
);

-- Tautan lupa kata sandi. Hanya hash SHA-256 token yang disimpan; berlaku 30 menit, sekali pakai.
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash  CHAR(64) PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON password_resets(user_id);

-- Permintaan reset yang belum tertangani (email reset gagal terkirim). Owner melihatnya di halaman Pengguna;
-- dikosongkan saat kata sandi diganti atau Owner mengabaikannya.
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_requested_at TIMESTAMPTZ;

-- 2FA (TOTP). totp_secret terisi saat penyiapan; baru berlaku setelah totp_enabled = true.
-- totp_last_step mencegah kode yang sama dipakai dua kali.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret    VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step BIGINT;

-- Model tugas: Owner membuat & mengatur status; anggota mengerjakan dan bisa "Lapor selesai".
-- tasks.user_id = penanggung jawab (selalu Owner).
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS done_reported_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS done_reported_at TIMESTAMPTZ;

-- Pengingat dibuat Owner untuk anggota. reminders.user_id = penerima; "Semua anggota" = satu baris per anggota.
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS batch_id UUID;
CREATE INDEX IF NOT EXISTS idx_reminders_created_by ON reminders(created_by);

-- Tempat sampah (deleted_at), arsip tugas Done (archived_at), dan tugas berulang.
-- recurrence: NULL | 'daily' | 'weekly' | 'monthly'. next_task_id mencegah tugas berikutnya dibuat dua kali.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deleted_at   TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deleted_by   INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS archived_at  TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence   VARCHAR(10);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS next_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_deleted_at ON tasks(deleted_at);

-- Anggota yang ditugaskan. Tugas tanpa baris di sini boleh dilaporkan anggota mana pun.
CREATE TABLE IF NOT EXISTS task_assignees (
  task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_task_assignees_user_id ON task_assignees(user_id);

-- Catatan pada tugas. kind: 'comment' | 'report' (catatan lapor selesai) | 'reject' (alasan penolakan).
CREATE TABLE IF NOT EXISTS task_comments (
  id          BIGSERIAL PRIMARY KEY,
  task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind        VARCHAR(10) NOT NULL DEFAULT 'comment',
  body        TEXT NOT NULL,
  link_url    VARCHAR(500),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);

-- Riwayat aktivitas per tugas.
CREATE TABLE IF NOT EXISTS task_activity (
  id          BIGSERIAL PRIMARY KEY,
  task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      VARCHAR(20) NOT NULL,
  detail      VARCHAR(300),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_task_activity_task_id ON task_activity(task_id);

-- Subtugas / checklist.
CREATE TABLE IF NOT EXISTS task_checklist (
  id          SERIAL PRIMARY KEY,
  task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  text        VARCHAR(200) NOT NULL,
  done        BOOLEAN NOT NULL DEFAULT false,
  done_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_task_checklist_task_id ON task_checklist(task_id);

-- Notifikasi di web. show_at di masa depan = muncul nanti (dipakai pengingat).
CREATE TABLE IF NOT EXISTS notifications (
  id           BIGSERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         VARCHAR(20) NOT NULL,
  title        VARCHAR(300) NOT NULL,
  task_id      INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  reminder_id  INTEGER REFERENCES reminders(id) ON DELETE CASCADE,
  show_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_show ON notifications(user_id, show_at DESC);

-- Email notifikasi (tugas baru, laporan ditolak, ringkasan harian). Bisa dimatikan di halaman Akun.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_notifications BOOLEAN NOT NULL DEFAULT true;

-- Error server & browser untuk dipantau Owner. Dipangkas otomatis > 30 hari (cron harian).
CREATE TABLE IF NOT EXISTS error_logs (
  id          BIGSERIAL PRIMARY KEY,
  source      VARCHAR(10) NOT NULL,
  tag         VARCHAR(80),
  message     VARCHAR(1000) NOT NULL,
  stack       VARCHAR(4000),
  path        VARCHAR(300),
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON error_logs(created_at DESC);

-- ------------------------------------------------------------------
-- Migrasi untuk database lama (sudah diterapkan di production).
-- ------------------------------------------------------------------

-- 1) tasks.created_at dulu bertipe TIMESTAMP tanpa zona; nilainya disimpan sebagai UTC.
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'tasks' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE tasks ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
  END IF;
END $$;

-- 2) tasks.user_id wajib terisi. Tugas tanpa pemilik harus dihapus/di-assign dulu,
--    jika tidak perintah ini gagal (disengaja, agar tidak ada data hilang diam-diam).
ALTER TABLE tasks ALTER COLUMN user_id SET NOT NULL;

-- 3) Kolom lama category/priority/completed dihapus di db/drop-legacy.sql, TERPISAH dari file ini:
--    kode versi lama masih menulis kolom completed, jadi DROP baru boleh jalan setelah kode baru live.
