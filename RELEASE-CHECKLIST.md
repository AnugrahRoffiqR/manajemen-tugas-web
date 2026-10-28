# Checklist Rilis Production

Status: **PASS** = dijalankan, ada bukti · **FAIL** = diperiksa, gagal · **BLOCKED** = butuh izin/akses/prasyarat ·
**NOT RUN** = belum dijalankan. Kerjakan berurutan; jangan lanjut bila ada FAIL atau BLOCKED sebelumnya.
Terakhir diperbarui: 28 Okt 2026 (pemeriksaan lokal, belum ada commit/deploy).

| # | Item | Status | Bukti / alasan |
|---|---|---|---|
| 1 | Working tree & review diff | PASS (lokal) / BLOCKED (commit) | Branch `main`, HEAD `bdacbe9`, semua perubahan belum di-commit. Tidak ada remote git. `check-prd.js`, `scrollcraft/`, `.agents/skills/scroll-craft/` jangan ikut di-commit. Commit butuh izin. |
| 2 | Test lokal & build | PASS | `npm test` 102/102 (DEV); UI 59/59 di 390/768/1440; `node --check` semua file server; `npm audit` 0 kerentanan. Tidak ada tahap build/lint/typecheck. |
| 3 | CI GitHub berhasil | BLOCKED | Tidak ada remote/repo GitHub; secrets & variable belum ada. Workflow siap (lihat README "Uji"). |
| 4 | Env production lengkap | BLOCKED | Env Vercel tidak boleh dibaca/diubah dari sini. Diduga belum ada: `APP_URL`, `CRON_SECRET`, `OWNER_CONTACT_WA`, `RESEND_*`, `TURNSTILE_*`. Cek manual di Vercel → Settings → Environment Variables (lihat tabel di bawah). |
| 5 | Turnstile production | BLOCKED | Belum ada widget/key production. Wajib key asli (bukan test key `1x00000000…`; server mencatat peringatan bila terpasang). |
| 6 | Resend | BLOCKED | Butuh domain terverifikasi untuk `RESEND_FROM`. Tanpa itu reset sandi Owner via email nonaktif (503 `MAIL_NOT_CONFIGURED`). |
| 7 | Backup production terbaru | BLOCKED | Satu-satunya snapshot dari 26 Okt. Paket Free: 1 snapshot manual. Butuh keputusan (hapus+buat ulang atau upgrade). Lihat `BACKUP-RESTORE.md`. |
| 8 | Restore drill branch terisolasi | PASS (snapshot 26 Okt) / NOT RUN (snapshot pra-migrasi) | 28 Okt: restore ke branch baru, skema identik, 0 invalid, 0 FK yatim, branch dihapus. Ulangi dengan snapshot baru. |
| 9 | Integritas data & FK production | PASS (read-only) | Prod: 0 constraint/index invalid, `tasks.user_id` NULL = 0, FK yatim 0. Ulangi tepat sebelum migrasi. |
| 10 | Migration SQL & target DB | PASS | `schema.sql` aditif & idempoten (diuji di DEV & branch sementara); transaksi tunggal; penjaga `DB_TARGET_CONFIRM` diuji (tanpa/salah → exit 2). Kolom legacy prod nullable + default, jadi INSERT kode baru aman sebelum drop. |
| 11 | Izin eksplisit sebelum migration | BLOCKED | Menunggu persetujuan. |
| 12 | Snapshot sebelum migration | BLOCKED | Bergantung pada #7. ID: `__________` |
| 13 | Deployment disetujui | BLOCKED | Menunggu #3–#12 dan persetujuan. |
| 14 | Live smoke test | NOT RUN | Daftar di bawah. Baseline 28 Okt (kode lama): `/login` 200, URL acak 404, header CSP/HSTS/XFO/nosniff/Referrer ada. |
| 15 | Monitoring error & fungsi penting | NOT RUN | Setelah deploy: Owner → halaman Log Error, Vercel → Logs, cron harian 00:00 UTC berjalan (log `/api/cron/daily` 200). |
| 16 | Rollback plan | PASS (tertulis) | Bagian "Rollback" di bawah; belum pernah dipraktikkan di production. |
| 17 | Izin terpisah sebelum `db/drop-legacy.sql` | BLOCKED | Checklist khusus di bawah. |

## Env production (nilai tidak pernah ditulis di sini)

| Variabel | Wajib | Jika kosong | Cara cek tanpa melihat nilai |
|---|---|---|---|
| `DATABASE_URL` | ya | server gagal query | Vercel menampilkan nama saja; pastikan host = endpoint production |
| `ADMIN_SESSION_SECRET` | ya | server menolak start (≥32 karakter) | `/api/health` 200 setelah deploy |
| `APP_URL` | ya bila email aktif | email nonaktif (dicek `isMailConfigured`) | tautan di email reset berawalan URL production |
| `CRON_SECRET` | ya | cron selalu 401, digest & pembersihan tidak jalan | `curl` tanpa header → 401; log cron Vercel 200 |
| `RESEND_API_KEY`, `RESEND_FROM` | opsional | reset email Owner 503, notifikasi email mati | lupa sandi Owner → email diterima |
| `RESEND_API_URL` | **jangan diset** | — | tidak ada di daftar env |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | disarankan, berpasangan | captcha mati (login tetap dibatasi rate limit) | widget tampil di /login; tidak ada log "test key" |
| `OWNER_CONTACT_WA` | opsional | tombol WA tidak tampil | halaman lupa sandi anggota |
| `NODE_ENV` | otomatis Vercel | cookie tanpa `Secure` | header `Set-Cookie` berisi `Secure` |

`DB_TARGET_CONFIRM`, `TEST_OWNER_*`, `SEED_OWNER_*`, `PORT` hanya untuk lokal/CI, **jangan** di Vercel.

## Urutan rilis

1. Keputusan backup (#7) → snapshot production baru, catat ID (#12) → restore drill snapshot itu (#8).
2. Read-only di prod: `SELECT count(*) FROM tasks WHERE user_id IS NULL` = 0.
3. `npm run migrate` dengan URL production + `DB_TARGET_CONFIRM`=endpoint production (`db/schema.sql`). Kembalikan `.env` ke DEV.
4. `npm run deploy` (test DEV lalu `vercel deploy --prod`).
5. Smoke test live (di bawah) dalam 15 menit; pantau log 24–48 jam.
6. Baru setelah itu, dengan izin terpisah: `drop-legacy`.

## Smoke test live

- [ ] Login Owner (dengan Turnstile), logout; cookie `Secure; HttpOnly; SameSite=Lax`.
- [ ] Owner buat tugas dengan anggota dipilih; anggota lain tidak bisa lapor (403).
- [ ] Anggota lapor selesai → Owner tolak dengan alasan → anggota lapor lagi → Owner terima (Done).
- [ ] Komentar + subtugas tampil di kedua akun; notifikasi muncul.
- [ ] Ekspor CSV terunduh.
- [ ] `curl -i https://manajemen-tugas-web.vercel.app/api/cron/daily` → 401.
- [ ] URL acak → halaman 404.
- [ ] Lupa sandi Owner → email diterima, tautan hanya berlaku sekali.
- [ ] Header CSP, HSTS, X-Frame-Options ada.
- [ ] Hapus akun/tugas uji yang dibuat saat smoke test (data production — minimal dan dengan izin).

## Rollback

**Kapan menghentikan rilis:** migrasi gagal (otomatis rollback, jangan deploy); `/api/health` bukan 200; login gagal;
error 5xx berulang di log; data tugas tidak tampil/hilang; cron 401 padahal `CRON_SECRET` sudah diset.

**Aplikasi:** Vercel → Deployments → deployment production sebelumnya → *Promote to Production* (instan).
Aman selama `drop-legacy` belum dijalankan: `schema.sql` hanya menambah, dan kode lama masih menulis `completed`
(diuji di branch sementara).

**Database — putuskan dulu apakah perlu restore:**
- Kode bermasalah tapi data utuh → cukup rollback aplikasi. **Jangan** restore.
- Data rusak/hilang → restore. Restore **tidak instan dan tidak tanpa kehilangan**: semua perubahan sesudah waktu
  snapshot hilang (mis. tugas yang dibuat setelah rilis). Ekspor dulu data baru dari production bila memungkinkan.
- Dalam 6 jam pertama, instant restore point-in-time (paket Free) bisa dipakai sebagai alternatif snapshot.

**Prosedur restore:** Multi-step restore ke branch baru → validasi (`BACKUP-RESTORE.md`) → Owner memilih arahkan
`DATABASE_URL` ke branch itu + redeploy, atau finalize restore. Jangan One-step restore tanpa validasi.

**Sesudah `drop-legacy`:** kode lama tidak bisa jalan lagi (kolom `completed` hilang). Kembali ke kode lama hanya
lewat restore snapshot, dengan kehilangan data sesudah snapshot. Karena itu `drop-legacy` ditunda sampai stabil.

## Persetujuan `db/drop-legacy.sql`

Menghapus `tasks.category`, `tasks.priority`, `tasks.completed` beserta isinya (status kini di `status`/`completed_at`).
Kode lokal tidak lagi membaca/menulis kolom ini (dicek grep 28 Okt: hanya muncul di SQL & komentar).

- [ ] Kode baru live ≥ 1–2 hari, smoke test lulus, tidak ada error terkait `tasks` di log.
- [ ] Tidak ada deployment lama yang masih aktif/di-promote.
- [ ] Snapshot production pasca-rilis ada, ID dicatat, restore drill-nya lulus.
- [ ] Data historis `category`/`priority` tidak dibutuhkan lagi (atau sudah diekspor CSV).
- [ ] Uji `drop-legacy` di branch DEV/sementara dulu, lalu jalankan ulang `npm test`.
- [ ] Target dikonfirmasi: `DB_TARGET_CONFIRM` = endpoint production, disebut eksplisit oleh Owner.
- [ ] Izin tertulis Owner untuk langkah ini secara khusus.
