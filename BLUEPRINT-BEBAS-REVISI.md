# BLUEPRINT-BEBAS-REVISI.md — Dokumen Penguncian Spesifikasi (Zero-Revision Covenant)
> **Proyek**: Sistem Website Manajemen Tugas  
> **Status**: FINAL & TERKUNCI (*Locked Specification*)  
> **Tujuan**: Memastikan 100% alur, desain visual, antarmuka, backend, database, dan interaksi telah disepakati bersama sehingga proses koding berjalan mulus tanpa revisi atau perubahan di tengah jalan.

---

## 1. Peta Rute Halaman & Hak Akses (Sitemap & Routing Tree)

Website memiliki 6 halaman utama dengan otorisasi berbasis sesi (*Role-Based Access Control*):

```
/ (Root)
│
├── /login ──────────────> [Semua Guest] Halaman Masuk Akun
│
├── /dashboard ──────────> [Owner & User] Ringkasan Metrik Bento & Banner Reminder
│
├── /tasks ──────────────> [Owner & User] Workspace Utama (Dual View: Kanban & Tabel List)
│
├── /reminders ──────────> [Owner & User] Daftar Tugas Mendesak & Pengingat Kustom
│
├── /reports ────────────> [Owner & User] Analitik Kinerja & Ekspor Siap Cetak (Print View)
│
└── /users ──────────────> [KHUSUS OWNER] Manajemen Akun Anggota Tim (User biasa 403 Forbidden)
```

---

## 2. Spesifikasi Detail Per Halaman (Zero Ambiguity Screen Specs)

### 2.1 Halaman Login (`/login`)
* **Tampilan**: Card *Double-Bezel* minimalis di tengah layar, tema gelap obsidian elegan.
* **Elemen**:
  1. Header: Logo tanda centang modern + teks *"Manajemen Tugas"* + badge *"Portal Resmi"*.
  2. Input Email: Placeholder `nama@email.com`, validasi format email aktif.
  3. Input Password: Tipe password dengan tombol toggle *"Lihat / Sembunyikan Sandi"*.
  4. Tombol *"Masuk ke Sistem"*: Memiliki state loading spinner otomatis saat diklik.
  5. Pesan Error: Alert merah di atas form jika password salah atau akun `Inactive`.

---

### 2.2 Halaman Dashboard (`/dashboard`)
* **Widget Metrik Utama (4 Kartu Bento Statis)**:
  1. **Total Tugas**: Angka total tugas + label progres keseluruhan.
  2. **Sedang Dikerjakan**: Jumlah tugas berstatus `In Progress` (Aksen Kuning Emas).
  3. **Tugas Selesai**: Jumlah tugas berstatus `Done` (Aksen Hijau Emerald).
  4. **Tugas Terlambat (Overdue)**: Jumlah tugas lewat tenggat belum selesai (Aksen Merah Crimson).
* **Banner Peringatan Mendesak**:
  - Muncul di baris paling atas jika ada tugas yang jatuh tempo dalam $< 24$ jam atau sudah lewat waktu.
  - Berisi judul tugas, sisa jam, dan tombol cepat *"Tandai Selesai Langsung"*.
* **Tugas Prioritas Terbaru**: Daftar 5 tugas paling mendesak untuk diselesaikan hari ini.
* **Tombol Cepat**: Tombol `+ Buat Tugas Baru` langsung membuka modal tanpa pindah halaman.

---

### 2.3 Halaman Workspace Tugas (`/tasks`)
* **Fitur Sakelar Tampilan (Dual-View Switcher)**:
  - **Tombol Mode Kanban**: Menampilkan 3 kolom vertikal berjejer: `To Do (Antrean)`, `In Progress (Sedang Jalan)`, dan `Done (Selesai)`. Kartu tugas dapat diubah statusnya dengan 1 klik tombol aksi.
  - **Tombol Mode Tabel**: Menampilkan tabel data yang rapi dan padat dengan kolom: Judul, Kategori, Prioritas, Deadline, Assignee, Status, dan Tombol Aksi (Edit/Hapus).
* **Toolbar Penyaringan (Filter Bar)**:
  - Kotak Pencarian: Filter instan berdasarkan judul tugas secara *real-time*.
  - Filter Status: `Semua`, `To Do`, `In Progress`, `Done`.
  - Filter Prioritas: `Semua`, `High` (Merah), `Medium` (Kuning), `Low` (Hijau).
  - Filter Kategori: `Semua`, `Operasional`, `Teknis`, `Administrasi`, `Umum`.
  - Tombol Reset Filter: Mengembalikan semua filter ke posisi semula dalam 1 klik.

---

### 2.4 Modal Tambah & Sunting Tugas (Task Form Dialog)
* **Form Inputs & Validasi Ketat**:
  1. **Judul Tugas** *(Wajib)*: Teks input, batas 3 s/d 150 karakter. Jika kosong muncul: *"Judul tugas wajib diisi."*
  2. **Deskripsi** *(Opsional)*: Textarea multi-baris, batas maks 1000 karakter.
  3. **Kategori**: Pilihan tombol pill: `Umum`, `Operasional`, `Teknis`, `Administrasi`, `Bisnis`.
  4. **Tingkat Prioritas**: Pilihan radio pill:
     - `🟢 Low` (Prioritas Rendah)
     - `🟡 Medium` (Prioritas Standar - Default)
     - `🔴 High` (Prioritas Tinggi / Mendesak)
  5. **Tenggat Waktu (*Deadline*)** *(Wajib)*: Date & time picker. Default jam `17:00 WIB`.
  6. **Penugasan User (*Assignee*)**:
     - Jika akun yang login adalah **Owner**: Muncul dropdown daftar user untuk mendelegasikan tugas.
     - Jika akun yang login adalah **User**: Otomatis tertuju ke dirinya sendiri tanpa dropdown.
* **Footer Modal**: Tombol *"Batal"* (abu-abu netral) dan Tombol *"Simpan Tugas"* (biru dengan spinner).

---

### 2.5 Halaman Pengingat Deadline (`/reminders`)
* **Tab 1: Pengingat Otomatis Sistem**:
  - Menampilkan ringkasan tugas yang masuk kategori **Terlambat (*Overdue*)** dan **Mendesak (*Jatuh tempo < 24 jam*)**.
* **Tab 2: Pengingat Kustom Mandiri**:
  - User dapat membuat catatan pengingat independen dengan input: Judul Pengingat, Tanggal & Jam Pengingat.
  - Tombol hapus dan tombol centang tandai selesai.

---

### 2.6 Halaman Laporan & Analitik Kinerja (`/reports`)
* **Pemilih Periode Laporan**: Tombol tab cepat `[ Hari Ini ]`, `[ Minggu Ini ]`, `[ Bulan Ini ]`, dan `[ Semua Waktu ]`.
* **Metrik Rasio**:
  - **Tingkat Penyelesaian (*Completion Rate %*)**: `(Task Selesai / Total Task) * 100`.
  - **Ketepatan Waktu (*On-Time Rate %*)**: `(Task Selesai Tepat Waktu / Total Task Selesai) * 100`.
* **Tabel Rincian Kinerja**: Daftar seluruh tugas yang dikerjakan pada periode tersebut beserta status ketepatan waktunya.
* **Mode Cetak / Ekspor PDF**:
  - Tombol *"Cetak / Simpan PDF"*.
  - Menggunakan stylesheet cetak `@media print`: Otomatis menyembunyikan sidebar, navbar, dan tombol filter. Menambahkan kop laporan resmi dengan tanggal cetak dan tanda tangan pelapor.

---

### 2.7 Halaman Manajemen Pengguna (`/users` — Khusus Owner)
* **Tabel Anggota Tim**:
  - Kolom: Nama Lengkap, Alamat Email, Peran (*Badge Owner/User*), Status (*Badge Active/Inactive*), Jumlah Tugas yang Ditangani, dan Tanggal Bergabung.
* **Modal Tambah User Baru**:
  - Input: Nama, Email resmi, Password awal, dan Pilihan Role (`User` atau `Owner`).
  - Backend otomatis memvalidasi keunikan email dan mengenkripsi password dengan salt bcrypt.
* **Aksi Edit & Hapus**:
  - Edit Role (*Promote / Demote*).
  - Sakelar Status Akun (*Active $\leftrightarrow$ Inactive*).
  - Hapus Akun (dengan konfirmasi keamanan ganda).
  - **Aturan Mutlak**: Owner dilarang menonaktifkan atau menghapus akunnya sendiri yang sedang aktif login (*Pencegahan Self-Lockout*).

---

## 3. Kamus Pesan Sistem & Bahasa Notifikasi (Microcopy Standardization)

Seluruh notifikasi toast (pop-up) menggunakan bahasa Indonesia yang ramah, jelas, dan seragam:

| Kondisi Sistem | Tipe Toast | Pesan yang Ditampilkan |
| :--- | :---: | :--- |
| **Login Berhasil** | Sukses (Hijau) | *"Selamat datang kembali, [Nama User]!"* |
| **Login Gagal** | Error (Merah) | *"Email atau kata sandi tidak sesuai. Silakan periksa kembali."* |
| **Akun Nonaktif** | Peringatan (Kuning)| *"Akun Anda telah dinonaktifkan oleh Administrator."* |
| **Tugas Dibuat** | Sukses (Hijau) | *"Tugas baru berhasil disimpan ke workspace."* |
| **Tugas Diperbarui** | Sukses (Hijau) | *"Perubahan tugas berhasil disimpan."* |
| **Tugas Selesai** | Sukses (Emerald)| *"Luar biasa! Tugas telah ditandai selesai."* |
| **Tugas Dihapus** | Info (Netral) | *"Tugas telah dihapus dari daftar."* |
| **User Didaftarkan** | Sukses (Hijau) | *"Akun anggota tim baru berhasil ditambahkan."* |
| **Akses Ditolak** | Error (Merah) | *"Anda tidak memiliki izin untuk mengakses halaman ini."* |
| **Konfirmasi Hapus** | Modal Dialog | *"Apakah Anda yakin ingin menghapus data ini? Tindakan ini tidak dapat dibatalkan."* |

---

## 4. Akun Default & Kredensial Awal (Seed Data Owner)

Untuk memastikan website dapat langsung digunakan dan diuji coba segera setelah selesai dibuat, sistem akan menyediakan akun Owner utama pertama:

* **Email**: `admin@manajementugas.local` *(atau dapat diubah sesuai permintaan kamu)*
* **Password Default**: `Admin123!` *(terenkripsi aman via bcrypt di database)*
* **Role**: `Owner`
* **Status**: `Active`

*(Owner ini nantinya dapat mengganti email, nama, maupun passwordnya sendiri dari dalam aplikasi, atau membuat akun user baru untuk anggota tim).*

---

## 5. Arsitektur Teknis & Kesiapan Database Neon

1. **Database Neon PostgreSQL**:
   - ✅ Tabel `users` sudah siap.
   - ✅ Tabel `tasks` sudah siap (dengan Foreign Key `ON DELETE CASCADE`).
   - ✅ Tabel `reminders` sudah dibuat dan diindeks.
2. **Koneksi Database**:
   - Terhubung melalui Connection Pooler Neon via string `DATABASE_URL` di [.env](file:///C:/Users/Nugi/Documents/Manajemen%20Tugas/.env).
3. **Teknologi Website**:
   - **Framework**: Next.js (App Router) Fullstack Website — standar resmi platform hosting Vercel.
   - **Styling**: Tailwind CSS dengan konfigurasi token tema [DESIGN.md](file:///C:/Users/Nugi/Documents/Manajemen%20Tugas/DESIGN.md) (Mode Gelap Obsidian & Mode Terang Studio).
   - **Ikonografi**: Lucide Icons (ikon presisi garis tipis berbobot modern).
   - **Keamanan Sesi**: Cookie HTTP-Only yang ditandatangani menggunakan `ADMIN_SESSION_SECRET`.

---

## 6. Protokol Nol-Revisi (No-Revision Checklist)

- [x] Semua 6 halaman website sudah dipetakan rute URL dan hak aksesnya.
- [x] Tampilan ganda (Kanban Board vs Tabel List) sudah dispesifikasikan.
- [x] Form input tugas, batasan karakter, dan validasinya sudah dikunci.
- [x] Seluruh pesan pop-up/notifikasi dalam bahasa Indonesia sudah dibakukan.
- [x] Seluruh 3 tabel database Neon (`users`, `tasks`, `reminders`) sudah aktif dan terindeks.
- [x] Skema keamanan (password bcrypt, proteksi anti-double-click, session cookie) sudah siap.
- [x] Akun Owner awal sudah ditentukan agar bisa langsung login.
