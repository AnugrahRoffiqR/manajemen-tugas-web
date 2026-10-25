-- Skema database Manajemen Tugas (PostgreSQL / Neon).
-- Aman dijalankan ulang: semua perintah idempoten.
-- Enum status/prioritas/peran divalidasi di server.js (TASK_STATUSES, TASK_PRIORITIES, USER_ROLES, USER_STATUSES).

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
  completed     BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  description   TEXT,
  category      VARCHAR(50) DEFAULT 'Umum',
  priority      VARCHAR(20) DEFAULT 'Medium',
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

-- Penghitung login gagal per IP (dipakai bersama oleh semua instance Vercel).
CREATE TABLE IF NOT EXISTS login_attempts (
  ip        TEXT PRIMARY KEY,
  count     INTEGER NOT NULL DEFAULT 1,
  reset_at  TIMESTAMPTZ NOT NULL
);

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
