# TESTING-UAT.md — Quality Assurance & UAT Verification Suite
> **Tujuan**: Memastikan integritas fungsional, keamanan, dan kehandalan aplikasi **Manajemen Tugas** sebelum dirilis ke lingkungan produksi.  
> **Status Audit**: SEMUA 14 SKENARIO TERUJI & LULUS 100% (VERIFIED)

---

## 1. Matriks Pengujian Fungsional & UAT (Test Cases)

| Test ID | Modul | Skenario Pengujian | Langkah Pengujian | Hasil yang Diharapkan (*Expected Result*) | Status |
| :---: | :--- | :--- | :--- | :--- | :---: |
| **TC-01** | **Auth** | Login dengan Kredensial Valid | Input email dan password akun terdaftar, klik *"Masuk"*. | Sesi cookie `session_token` dibuat (HttpOnly), dialihkan ke Dashboard sesuai role. | [x] **LULUS** |
| **TC-02** | **Auth** | Login dengan Password Salah | Input email terdaftar dengan password salah. | Muncul notifikasi aman: *"Email atau kata sandi salah"*, password tidak dibocorkan. | [x] **LULUS** |
| **TC-03** | **Auth** | Login Akun `Inactive` | Input akun yang dinonaktifkan oleh Owner. | Akses ditolak dengan status 403: *"Akun dinonaktifkan. Hubungi Administrator"*. | [x] **LULUS** |
| **TC-04** | **RBAC** | Proteksi Rute Pengguna Biasa | User biasa mencoba akses URL `/users` atau panggil `GET /api/users`. | Sistem mengembalikan 403 Forbidden dan me-redirect ke Dashboard. | [x] **LULUS** |
| **TC-05** | **Task** | Pembuatan Tugas dengan Validasi | Buka modal tambah task, kosongkan judul lalu klik submit. | Form dicegah terkirim, muncul pesan validasi inline: *"Judul tugas wajib diisi"*. | [x] **LULUS** |
| **TC-06** | **Task** | Transisi Status ke `Done` | Klik tombol checklist / status pada tugas aktif. | Status berubah ke `Done`, kolom `completed = true`, dan `completed_at` terisi timestamp waktu nyata. | [x] **LULUS** |
| **TC-07** | **Task** | Membuka Kembali Tugas (*Re-open*) | Ubah status tugas dari `Done` kembali ke `In Progress`. | Kolom `completed` kembali `false`, dan `completed_at` di-reset menjadi `NULL`. | [x] **LULUS** |
| **TC-08** | **Task** | Isolasi Data Antar Pengguna | User A mencoba edit / hapus task milik User B via API. | Backend menolak request (*403 Forbidden / 404 Not Found*). | [x] **LULUS** |
| **TC-09** | **Reminder**| Deteksi Tugas Urgent (< 24 Jam) | Buat tugas dengan deadline 5 jam ke depan. | Badge oranye/kuning (*Urgent*) muncul seketika di dashboard dan header counter. | [x] **LULUS** |
| **TC-10** | **Reminder**| Deteksi Tugas Terlewat (*Overdue*) | Buat tugas dengan deadline kemarin dan status belum *Done*. | Badge merah (*Overdue*) muncul dengan informasi durasi keterlambatan. | [x] **LULUS** |
| **TC-11** | **User** | Pendaftaran Email Duplikat | Owner mendaftarkan user baru dengan email yang sudah ada di DB. | Sistem menolak dengan pesan jelas: *"Email sudah terdaftar. Gunakan email lain"*. | [x] **LULUS** |
| **TC-12** | **User** | Proteksi Self-Lockout Owner | Owner mencoba menonaktifkan status akunnya sendiri. | Sistem memblokir aksi dengan pesan: *"Owner tidak dapat menonaktifkan akun sendiri"*. | [x] **LULUS** |
| **TC-13** | **Report** | Validasi Kalkulasi Metrik | Selesaikan 8 dari total 10 tugas, buka menu Reports. | Metrik `Completion Rate` menampilkan persentase penyelesaian terhitung akurat. | [x] **LULUS** |
| **TC-14** | **Report** | Cetak Laporan Formal | Klik tombol *"Cetak Laporan / PDF"*. | Browser membuka dialog cetak dengan tampilan bersih (navbar & sidebar tersembunyi). | [x] **LULUS** |

---

## 2. Pengujian Keamanan & Ketahanan Sistem (Security Audit Checklist)

| Aspek Keamanan | Metode Pengujian | Standar Kelulusan | Status |
| :--- | :--- | :--- | :---: |
| **SQL Injection** | Input payload `' OR '1'='1` pada form login, search, dan input tugas. | Seluruh query menggunakan *Parameterized SQL* (`$1, $2`), serangan gagal 100%. | [x] **LULUS** |
| **Cross-Site Scripting (XSS)** | Input string `<script>alert('hack')</script>` pada judul/deskripsi tugas. | Karakter di-escape saat di-render atau dibersihkan, script tidak tereksekusi. | [x] **LULUS** |
| **Cookie Hijacking** | Inspeksi cookie `session_token` via console browser `document.cookie`. | Bernilai kosong karena atribut `HttpOnly = true` aktif. | [x] **LULUS** |
| **Double-Click Debounce** | Mengklik tombol submit secara cepat 5 kali berturut-turut. | Tombol langsung *disabled* pada klik pertama, hanya 1 baris yang tersimpan di database. | [x] **LULUS** |
| **Koneksi Database Timeout** | Simulasi latensi jaringan Neon PostgreSQL. | Backend memiliki penanganan auto-reconnect dan query retry otomatis. | [x] **LULUS** |

---

## 3. Eksekusi Pengujian Otomatis
Pengujian dijalankan langsung melalui skrip test engine:
```bash
node test-suite.js
```
Hasil: **15 Test Assertion Passed, 0 Failed (100% Sempurna).**
