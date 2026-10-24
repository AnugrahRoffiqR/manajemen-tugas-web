# API-SPEC.md — REST API Contract & Interface Specification
> **Base URL**: `/api`  
> **Protokol**: HTTPS / JSON REST  
> **Autentikasi**: Signed HTTP-Only Cookie (`session_token`)  
> **Format Data**: `application/json`

---

## 1. Standar Format Respons & Error Handling

Seluruh endpoint mengembalikan struktur respons JSON terstandarisasi:

### Format Respons Sukses
```json
{
  "success": true,
  "data": { ... },
  "message": "Operasi berhasil"
}
```

### Format Respons Error
```json
{
  "success": false,
  "error": "UNAUTHORIZED_ACCESS",
  "message": "Email atau kata sandi tidak valid."
}
```

### Kode Status HTTP yang Digunakan:
* `200 OK`: Permintaan berhasil diproses.
* `201 Created`: Entitas baru (tugas/user) berhasil dibuat.
* `400 Bad Request`: Input validasi gagal (contoh: judul kosong, email tidak valid).
* `401 Unauthorized`: Belum login atau sesi telah kedaluwarsa.
* `403 Forbidden`: Tidak memiliki izin akses (contoh: User biasa mengakses modul Owner).
* `404 Not Found`: Data yang dicari tidak ditemukan.
* `500 Internal Server Error`: Kesalahan sistem backend / kegagalan koneksi database.

---

## 2. Modul Autentikasi (`/api/auth`)

### 2.1 Login Pengguna
* **Metode**: `POST`
* **Endpoint**: `/api/auth/login`
* **Akses**: Publik
* **Request Body**:
```json
{
  "email": "user@perusahaan.com",
  "password": "PasswordRahasia123!"
}
```
* **Respons Sukses (200 OK)**:
  * Mengirim Header: `Set-Cookie: session_token=...; HttpOnly; Path=/; Secure; SameSite=Lax; Max-Age=604800`
```json
{
  "success": true,
  "data": {
    "user": {
      "id": 1,
      "name": "Nugi Pratama",
      "email": "user@perusahaan.com",
      "role": "Owner"
    }
  },
  "message": "Login berhasil"
}
```
* **Respons Error**:
  - `400`: `{"success": false, "message": "Email dan kata sandi wajib diisi"}`
  - `401`: `{"success": false, "message": "Email atau kata sandi salah"}`
  - `403`: `{"success": false, "message": "Akun Anda berstatus Inactive. Hubungi Owner."}`

---

### 2.2 Verifikasi Sesi Aktif
* **Metode**: `GET`
* **Endpoint**: `/api/auth/me`
* **Akses**: Terautentikasi (Owner & User)
* **Respons Sukses (200 OK)**:
```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "Nugi Pratama",
    "email": "user@perusahaan.com",
    "role": "Owner"
  }
}
```

---

### 2.3 Logout Pengguna
* **Metode**: `POST`
* **Endpoint**: `/api/auth/logout`
* **Akses**: Terautentikasi
* **Respons Sukses (200 OK)**:
  * Mengirim Header: `Set-Cookie: session_token=; Max-Age=0; Path=/`
```json
{
  "success": true,
  "message": "Berhasil keluar dari sistem"
}
```

---

## 3. Modul Manajemen Tugas (`/api/tasks`)

### 3.1 Mengambil Daftar Tugas
* **Metode**: `GET`
* **Endpoint**: `/api/tasks`
* **Query Parameters**:
  - `status` (opsional): `'To Do'`, `'In Progress'`, `'Done'`
  - `priority` (opsional): `'Low'`, `'Medium'`, `'High'`
  - `category` (opsional): String nama kategori
  - `search` (opsional): Pencarian teks pada judul tugas
  - `sort` (opsional): `'due_date_asc'`, `'due_date_desc'`, `'created_desc'`
* **Aturan Hak Akses**:
  - Jika **User**: Otomatis difilter hanya tugas dengan `user_id = auth.user.id`.
  - Jika **Owner**: Mengambil semua tugas di organisasi, atau menerima filter `user_id`.
* **Respons Sukses (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "id": 101,
      "user_id": 1,
      "assignee_name": "Nugi Pratama",
      "title": "Finalisasi Revisi PRD & UI Spec",
      "description": "Menambahkan arsitektur backend dan skema database lengkap",
      "category": "Teknis",
      "priority": "High",
      "status": "In Progress",
      "due_date": "2026-10-25T17:00:00Z",
      "completed": false,
      "completed_at": null,
      "created_at": "2026-10-24T09:00:00Z"
    }
  ]
}
```

---

### 3.2 Membuat Tugas Baru
* **Metode**: `POST`
* **Endpoint**: `/api/tasks`
* **Akses**: Terautentikasi
* **Request Body**:
```json
{
  "title": "Audit Database Performance",
  "description": "Memastikan indexing query aktif pada tabel tasks",
  "category": "Teknis",
  "priority": "High",
  "due_date": "2026-10-26T18:00:00+07:00",
  "user_id": 1 
}
```
*(Catatan: `user_id` opsional. Jika diinput oleh User biasa, sistem otomatis memaksakan `user_id` ke ID miliknya sendiri).*
* **Respons Sukses (201 Created)**:
```json
{
  "success": true,
  "data": {
    "id": 102,
    "title": "Audit Database Performance",
    "status": "To Do",
    "completed": false,
    "created_at": "2026-10-24T12:00:00Z"
  },
  "message": "Tugas berhasil dibuat"
}
```

---

### 3.3 Memperbarui Tugas / Mengubah Status
* **Metode**: `PUT`
* **Endpoint**: `/api/tasks/:id`
* **Akses**: Pemilik Tugas atau Owner
* **Request Body**:
```json
{
  "title": "Audit Database Performance (Revisi)",
  "status": "Done"
}
```
* **Logika Backend Otomatis**:
  - Jika `status` berubah menjadi `'Done'`: Sistem otomatis mengisi `completed = true` dan `completed_at = CURRENT_TIMESTAMP`.
  - Jika `status` dikembalikan ke `'In Progress'` atau `'To Do'`: Sistem otomatis mengisi `completed = false` dan `completed_at = NULL`.
* **Respons Sukses (200 OK)**:
```json
{
  "success": true,
  "data": {
    "id": 102,
    "status": "Done",
    "completed": true,
    "completed_at": "2026-10-24T12:30:00Z"
  },
  "message": "Tugas berhasil diperbarui"
}
```

---

### 3.4 Menghapus Tugas
* **Metode**: `DELETE`
* **Endpoint**: `/api/tasks/:id`
* **Akses**: Pemilik Tugas atau Owner
* **Respons Sukses (200 OK)**:
```json
{
  "success": true,
  "message": "Tugas berhasil dihapus secara permanen"
}
```

---

## 4. Modul Manajemen Pengguna (`/api/users` — Owner Only)

### 4.1 Mendapatkan Daftar Seluruh User
* **Metode**: `GET`
* **Endpoint**: `/api/users`
* **Akses**: Khusus **Owner** (Jika User biasa memanggil, kembalikan `403 Forbidden`).
* **Respons Sukses (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Nugi Pratama",
      "email": "admin@manajementugas.local",
      "role": "Owner",
      "status": "Active",
      "total_tasks": 14,
      "created_at": "2026-10-24T00:59:02Z"
    }
  ]
}
```

---

### 4.2 Mendaftarkan Anggota Tim Baru
* **Metode**: `POST`
* **Endpoint**: `/api/users`
* **Akses**: Khusus **Owner**
* **Request Body**:
```json
{
  "name": "Budi Santoso",
  "email": "budi@perusahaan.com",
  "password": "PasswordAman123!",
  "role": "User"
}
```
* **Logika Backend**: Hash password dengan `bcrypt.hash(password, 10)`, periksa keunikan email.
* **Respons Sukses (201 Created)**:
```json
{
  "success": true,
  "data": {
    "id": 2,
    "name": "Budi Santoso",
    "email": "budi@perusahaan.com",
    "role": "User",
    "status": "Active"
  },
  "message": "Pengguna baru berhasil didaftarkan"
}
```

---

### 4.3 Mengubah Data / Status User
* **Metode**: `PUT`
* **Endpoint**: `/api/users/:id`
* **Akses**: Khusus **Owner**
* **Aturan Proteksi**: Owner **DIBLOKIR** menonaktifkan akun sendiri atau mengubah rolenya sendiri.
* **Request Body**:
```json
{
  "role": "Owner",
  "status": "Active"
}
```

---

### 4.4 Menghapus Akun Pengguna
* **Metode**: `DELETE`
* **Endpoint**: `/api/users/:id`
* **Akses**: Khusus **Owner** (Blokir jika `target_id === current_user_id`).
* **Respons Sukses (200 OK)**:
```json
{
  "success": true,
  "message": "Akun pengguna berhasil dihapus"
}
```

---

## 5. Modul Pengingat Deadline & Reminder (`/api/reminders`)

### 5.1 Mengambil Tugas Mendesak & Terlambat
* **Metode**: `GET`
* **Endpoint**: `/api/reminders/urgent`
* **Akses**: Terautentikasi
* **Logika Backend**:
  Memindai tugas yang belum selesai (`completed = false`), mengevaluasi selisih waktu terhadap `NOW()`:
```json
{
  "success": true,
  "data": {
    "summary": {
      "total_urgent": 2,
      "total_overdue": 1
    },
    "urgent_tasks": [
      {
        "id": 105,
        "title": "Submit Rekap Mingguan",
        "due_date": "2026-10-24T18:00:00+07:00",
        "hours_remaining": 3.5,
        "urgency_level": "URGENT"
      }
    ],
    "overdue_tasks": [
      {
        "id": 98,
        "title": "Perbarui Lisensi Server",
        "due_date": "2026-10-23T23:59:00+07:00",
        "hours_overdue": 18.2,
        "urgency_level": "OVERDUE"
      }
    ]
  }
}
```

---

## 6. Modul Laporan & Analitik Kinerja (`/api/reports`)

### 6.1 Mengambil Ringkasan Analitik
* **Metode**: `GET`
* **Endpoint**: `/api/reports/analytics`
* **Query Parameters**:
  - `period`: `'today'`, `'week'`, `'month'`, `'all'`
  - `user_id` (opsional, khusus Owner untuk melihat breakdown per anggota)
* **Respons Sukses (200 OK)**:
```json
{
  "success": true,
  "data": {
    "period": "month",
    "metrics": {
      "total_tasks": 54,
      "completed_tasks": 46,
      "in_progress_tasks": 6,
      "todo_tasks": 2,
      "overdue_tasks": 2,
      "on_time_completed_tasks": 44,
      "completion_rate_percentage": 85.2,
      "on_time_delivery_percentage": 95.6
    },
    "category_distribution": [
      { "category": "Teknis", "count": 22 },
      { "category": "Operasional", "count": 18 },
      { "category": "Administrasi", "count": 14 }
    ],
    "priority_distribution": [
      { "priority": "High", "count": 12 },
      { "priority": "Medium", "count": 30 },
      { "priority": "Low", "count": 12 }
    ]
  }
}
```
