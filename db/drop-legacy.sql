-- DESTRUKTIF: menghapus kolom lama tasks.category, tasks.priority, tasks.completed beserta datanya.
-- Jalankan HANYA setelah:
--   1) snapshot branch production diambil (satu-satunya jalur rollback), dan
--   2) kode versi baru (yang tidak lagi memakai kolom ini) sudah live dan lolos smoke test.
-- Pakai: npm run migrate -- db/drop-legacy.sql
-- Idempoten (IF EXISTS). Status 'Done' + completed_at menggantikan completed.
ALTER TABLE tasks DROP COLUMN IF EXISTS category;
ALTER TABLE tasks DROP COLUMN IF EXISTS priority;
ALTER TABLE tasks DROP COLUMN IF EXISTS completed;
