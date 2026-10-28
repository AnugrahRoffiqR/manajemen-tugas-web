# Manajemen Tugas

Aplikasi manajemen tugas tim: Owner membuat dan memantau tugas, anggota mengerjakan dan melaporkan selesai.
Express 5 + HTML/CSS/JS tanpa framework, database Neon Postgres, hosting Vercel.

## Menjalankan lokal

```bash
npm ci
cp .env.example .env    # isi DATABASE_URL (branch DEV, bukan production) dan ADMIN_SESSION_SECRET
npm run migrate         # terapkan db/schema.sql (idempoten)
npm start               # http://localhost:3005
```

Semua variabel dijelaskan di `.env.example`. Ringkasnya:

| Variabel | Wajib | Fungsi |
|---|---|---|
| `DATABASE_URL` | ya | Neon (host `-pooler`) |
| `ADMIN_SESSION_SECRET` | ya | Penanda tangan sesi, ≥32 karakter acak |
| `APP_URL` | prod | Tautan di email |
| `CRON_SECRET` | prod | Mengamankan `/api/cron/daily` (Vercel Cron, 00:00 UTC) |
| `RESEND_API_KEY`, `RESEND_FROM` | opsional | Email reset sandi, notifikasi & ringkasan harian. `RESEND_FROM` harus domain terverifikasi |
| `OWNER_CONTACT_WA` | opsional | Kontak WA di halaman lupa sandi |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | opsional | Cloudflare Turnstile di login & lupa sandi; aktif bila keduanya diisi |

## Uji

```bash
DB_TARGET_CONFIRM=ep-xxx-yyy-12345678 TEST_OWNER_EMAIL=... TEST_OWNER_PASSWORD=... npm test
```

`test-suite.js` menjalankan server sendiri dan menguji API ujung ke ujung terhadap database di `DATABASE_URL`.
**Hanya jalankan terhadap branch DEV**: suite membuat dan menghapus akun & tugas uji.

Penjaga target DB: `npm run migrate` dan `npm test` menolak jalan (exit 2) kecuali `DB_TARGET_CONFIRM` sama dengan
ID endpoint Neon di `DATABASE_URL` (bagian host sebelum titik, tanpa `-pooler`). Nama endpoint bukan rahasia; isinya
memaksa Anda menyebut target secara sadar. Pesan penolakan menampilkan endpoint yang terdeteksi.

CI (`.github/workflows/test.yml`, Node 24, `npm ci`): cek sintaks → migrate → test pada push ke `main` dan PR.
Di GitHub → Settings → Secrets and variables → Actions isi:
- Secrets: `DATABASE_URL` (branch **DEV**), `ADMIN_SESSION_SECRET`, `TEST_OWNER_EMAIL`, `TEST_OWNER_PASSWORD`.
- Variable: `DB_TARGET_CONFIRM` = ID endpoint DEV.

Jangan pernah mengisi secret CI dengan URL production. Tidak ada script lint/build/typecheck; aplikasi tidak punya
tahap build (Vercel menjalankan `api/index.js` langsung).

## Deploy

Migrasi dibagi dua agar kode lama dan baru sama-sama bisa jalan selama transisi.
`npm run migrate [file]` menjalankan satu file dalam satu transaksi: jika satu perintah gagal, tidak ada yang tersimpan.

1. Ambil snapshot branch production di Neon.
2. Cek pra-syarat: `SELECT count(*) FROM tasks WHERE user_id IS NULL` harus 0 (jika tidak, `SET NOT NULL` gagal dan
   migrasi di-rollback utuh).
3. `npm run migrate` dengan `DATABASE_URL` production dan `DB_TARGET_CONFIRM` = endpoint production:
   `db/schema.sql`, hanya menambah tabel/kolom/indeks. Kode lama tetap berjalan (sudah diuji di branch sementara).
   Kembalikan `.env` ke DEV segera sesudahnya.
4. `npm run deploy` (menjalankan test terhadap DEV lalu `vercel deploy --prod`), lalu smoke test live.
5. Setelah kode baru stabil: `npm run migrate -- db/drop-legacy.sql`. Ini **destruktif** (DROP `category`, `priority`,
   `completed`); satu-satunya jalur kembali adalah snapshot langkah 1. Setelah langkah ini, rollback ke kode lama
   tidak mungkin tanpa restore.

Rollback sebelum langkah 5: redeploy versi lama di Vercel (skema aditif tidak mengganggunya).

Header keamanan (CSP dll.) ada di `server.js` **dan** `vercel.json`; ubah keduanya bersamaan.
Halaman baru butuh rute di `server.js` dan rewrite di `vercel.json`.

## Backup & pemulihan

Lihat `BACKUP-RESTORE.md`: batasan paket Neon, hasil uji restore, opsi backup, dan prosedur restore ke branch terpisah.
Ringkas: paket Free hanya punya 1 snapshot manual, riwayat 6 jam, tanpa jadwal backup. Selalu pakai
**Multi-step restore** (branch baru), jangan *One-step restore* (menimpa production).

Dokumen lain: `API-SPEC.md` (kontrak API), `DESIGN.md` (sistem desain), `TESTING-UAT.md` (skenario UAT).
