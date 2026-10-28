# Backup & Restore (Neon)

Satu proyek Neon, PostgreSQL 18, region `aws-ap-southeast-1`.
Branch: `production` (root) dan `dev` (anak production). ID proyek/branch/snapshot sengaja tidak ditulis di repo;
lihat di Neon Console.

## Kondisi saat ini (dicek read-only 28 Okt 2026)

| Aspek | Nilai | Bukti |
|---|---|---|
| Paket | Free | `describe_project` |
| Riwayat point-in-time | 6 jam | `history_retention_seconds=21600`; titik 30 jam lalu ditolak "before retention window" |
| Jadwal backup otomatis | tidak ada | `get_snapshot_schedule(production)` → `[]` |
| Snapshot tersedia | 1: "post-fix-2026-10-26", manual, 2026-10-26 04:04 UTC, ±32 MB | `list_snapshots` |
| Batas snapshot manual | 1 (Free), 100 (paket berbayar) | dokumentasi & halaman harga resmi Neon |

Akibatnya: snapshot baru **tidak bisa** dibuat tanpa menghapus snapshot yang ada, dan tidak ada backup harian.
Snapshot yang ada **tidak** berisi perubahan sesudah 26 Okt (mis. tugas 31 yang dibuat 27 Okt).

## Uji restore 28 Okt 2026 (sudah dijalankan, dengan izin)

- Snapshot: "post-fix-2026-10-26" (2026-10-26 04:04:23 UTC).
- Cara: `restore_snapshot` ke **branch baru** `restore-drill-2026-10-28`, `finalize: false`,
  tanpa `target_branch_id`. Status `restored`, endpoint sendiri; endpoint production tidak berubah.
- Skema identik dengan production: hash skema sama, 53 kolom, 44 constraint, 14 index, `compare_database_schema` kosong.
- 0 constraint/index invalid, 0 FK yatim, sequence = ID maksimum (tasks 30, users 38, reminders 1, login_events 32).
- Query yang dipakai kode live (KPI, filter `completed`, join users) berjalan; tulis + hapus 1 baris uji berhasil.
- Selisih dengan production hanya data sesudah snapshot: tugas 31, 4 catatan login, 3 sesi dicabut, `totp_secret`
  Owner terisi (2FA belum aktif). Tidak ada baris hilang/rusak.
- Branch uji dihapus. Sesudahnya hanya `production` dan `dev`; hash data & skema keduanya sama seperti sebelum uji;
  snapshot utuh.

Kesimpulan: snapshot ini **bisa dipulihkan**, tapi hanya ke kondisi 26 Okt.

## Opsi backup

Harga dari https://neon.com/pricing (dibaca 28 Okt 2026). Cek ulang di Neon Console → Billing sebelum memutuskan.

| | Opsi 1: tetap Free | Opsi 2: Launch (berbayar) |
|---|---|---|
| Snapshot manual | 1 | 100 |
| Jadwal backup | tidak ada | harian/mingguan/bulanan, **harus diatur sendiri** (default "No schedule") |
| Riwayat point-in-time | 6 jam | hingga 7 hari |
| Biaya | $0 | pay-as-you-go, tanpa minimum: snapshot $0.09/GB-bulan, storage $0.35/GB-bulan, compute $0.106/CU-jam, instant restore $0.20/GB-bulan. Tagihan < $0.50 tidak ditagih |
| Snapshot pra-migrasi | hapus snapshot lama dulu → ada jeda **tanpa snapshot sama sekali**; jika snapshot baru gagal, tidak ada backup | buat snapshot baru, snapshot lama tetap ada |
| Risiko | kerusakan data yang ketahuan > 6 jam kemudian tidak bisa dipulihkan kecuali dari snapshot terakhir | lebih rendah; tetap perlu uji restore berkala |

Dengan data ±32 MB, biaya snapshot dan storage sangat kecil; biaya terbesar Launch adalah **compute** yang tergantung
pemakaian. Perkiraan bulanan pasti harus dicek manual di Neon Console (Usage) karena tidak bisa diverifikasi dari sini.

**Rekomendasi:** Opsi 2 (Launch) sebelum migrasi production, lalu aktifkan jadwal snapshot harian di branch production
dan cek `get_snapshot_schedule` tidak kosong. Jika tetap Free: hapus snapshot lama hanya tepat sebelum membuat snapshot
baru, langsung verifikasi snapshot baru muncul di `list_snapshots`, lalu ulangi uji restore.
Upgrade, penghapusan, dan pembuatan snapshot butuh persetujuan pemilik akun.

## Prosedur sebelum rilis (butuh izin untuk tiap langkah yang mengubah Neon)

1. **Backup terbaru:** buat snapshot manual production, catat ID dan `created_at`. Pastikan muncul di `list_snapshots`
   dan tidak punya `expires_at` yang dekat.
2. **Tidak tertimpa/terhapus:** jangan hapus snapshot itu sampai rilis dan `drop-legacy` selesai dan stabil.
   Di paket Free, jangan membuat snapshot lain (akan memaksa penghapusan).
3. **Restore terisolasi:** Console → Backup & restore → snapshot → **Restore → Multi-step restore** (atau API
   `restore_snapshot` dengan `finalize: false`, tanpa `target_branch_id`). Jangan pakai *One-step restore*.
   Pastikan endpoint production tidak berubah.
4. **Validasi skema & data** di branch restore dibanding production (jalankan segera setelah snapshot, sehingga
   harus identik): jumlah baris + md5 isi per tabel, hash skema, jumlah kolom/constraint/index, constraint/index
   invalid = 0, FK yatim = 0, sequence ≥ ID maksimum.
5. **Query aplikasi:** KPI (`COUNT(*) FILTER (WHERE status='Done')`), join `tasks`-`users`, satu tulis + hapus baris uji.
6. **Catat & bersihkan:** catat hasil di `RELEASE-CHECKLIST.md`, lalu hapus branch uji (setelah izin), dan pastikan
   hanya `production` dan `dev` tersisa serta snapshot masih ada.

## Memulihkan production (insiden)

Restore tidak instan dan **tidak tanpa kehilangan**: semua data sesudah waktu snapshot hilang. Sebelum memutuskan,
ekspor data yang dibuat sesudah snapshot (mis. tugas baru) dari production agar bisa dimasukkan ulang manual.
Langkah: Multi-step restore → validasi seperti di atas → Owner memilih: arahkan `DATABASE_URL` Vercel ke branch itu
(butuh redeploy) atau finalize restore agar branch itu menggantikan production.
