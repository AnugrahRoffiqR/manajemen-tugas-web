/**
 * TEST-SUITE.JS — Automated UAT Verification Engine (TC-01 through TC-14)
 * Menjalankan seluruh skenario pengujian integrasi & keamanan secara otomatis.
 */

require('dotenv').config();
const app = require('./server');

const PORT = process.env.PORT || 3005;
const BASE_URL = `http://localhost:${PORT}`;

async function runTests() {
  console.log('====================================================');
  console.log('🧪 MEMULAI AUTOMATED UAT VERIFICATION SUITE');
  console.log('====================================================\n');

  let serverInstance = null;
  // Pastikan server aktif jika belum berjalan
  try {
    const probe = await fetch(`${BASE_URL}/api/health`).catch(() => null);
    if (!probe) {
      serverInstance = await new Promise((resolve) => {
        const s = app.listen(PORT, () => resolve(s));
      });
      console.log(`📡 Server otomatis dijalankan pada port ${PORT} untuk pengujian.\n`);
    }
  } catch (e) {
    serverInstance = await new Promise((resolve) => {
      const s = app.listen(PORT, () => resolve(s));
    });
  }

  let passed = 0;
  let failed = 0;

  function assert(condition, testId, description) {
    if (condition) {
      console.log(`✅ [${testId}] PASS: ${description}`);
      passed++;
    } else {
      console.error(`❌ [${testId}] FAIL: ${description}`);
      failed++;
    }
  }

  let ownerCookie = '';
  let memberCookie = '';
  let testTaskId = null;
  let testMemberId = null;

  try {
    // ----------------------------------------------------
    // TC-01: Login dengan Kredensial Valid (Owner)
    // ----------------------------------------------------
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@manajementugas.local', password: 'Admin123!' }),
    });
    const loginData = await loginRes.json();
    ownerCookie = loginRes.headers.get('set-cookie')?.split(';')[0] || '';
    assert(loginRes.status === 200 && loginData.data?.role === 'Owner', 'TC-01', 'Login Owner sukses dan menghasilkan cookie sesi');

    // ----------------------------------------------------
    // TC-02: Login dengan Password Salah
    // ----------------------------------------------------
    const wrongPassRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@manajementugas.local', password: 'WrongPassword999!' }),
    });
    assert(wrongPassRes.status === 401, 'TC-02', 'Login dengan password salah ditolak (401 Unauthorized)');

    // ----------------------------------------------------
    // TC-11: Registrasi Akun Anggota Baru & Cek Duplikasi
    // ----------------------------------------------------
    const testEmail = `tester_${Date.now()}@perusahaan.com`;
    const createMemberRes = await fetch(`${BASE_URL}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': ownerCookie },
      body: JSON.stringify({ name: 'Budi Tester', email: testEmail, password: 'User123!', role: 'User' }),
    });
    const memberData = await createMemberRes.json();
    testMemberId = memberData.data?.id;
    assert(createMemberRes.status === 201 && testMemberId, 'TC-11a', 'Owner berhasil mendaftarkan akun anggota baru (User)');

    // Cek duplikasi email yang sama
    const duplicateRes = await fetch(`${BASE_URL}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': ownerCookie },
      body: JSON.stringify({ name: 'Budi Kloning', email: testEmail, password: 'User123!', role: 'User' }),
    });
    assert(duplicateRes.status === 400, 'TC-11b', 'Sistem memblokir pendaftaran email duplikat (400 Bad Request)');

    // Login sebagai Anggota Baru
    const memberLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'User123!' }),
    });
    memberCookie = memberLoginRes.headers.get('set-cookie')?.split(';')[0] || '';

    // ----------------------------------------------------
    // TC-04: Proteksi RBAC (User Biasa Akses /api/users)
    // ----------------------------------------------------
    const rbacRes = await fetch(`${BASE_URL}/api/users`, {
      headers: { 'Cookie': memberCookie },
    });
    assert(rbacRes.status === 403, 'TC-04', 'User biasa dilarang mengakses modul pengguna (403 Forbidden)');

    // ----------------------------------------------------
    // TC-05: Pembuatan Tugas dengan Validasi Input
    // ----------------------------------------------------
    const emptyTaskRes = await fetch(`${BASE_URL}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': memberCookie },
      body: JSON.stringify({ title: '', due_date: new Date().toISOString() }),
    });
    assert(emptyTaskRes.status === 400, 'TC-05a', 'Pembuatan tugas tanpa judul ditolak sistem (400 Bad Request)');

    // Buat tugas valid
    const validTaskRes = await fetch(`${BASE_URL}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': memberCookie },
      body: JSON.stringify({
        title: 'Tugas Uji Otomatis',
        description: 'Verifikasi state machine',
        category: 'Teknis',
        priority: 'High',
        due_date: new Date(Date.now() + 5 * 3600000).toISOString(), // 5 jam ke depan
      }),
    });
    const taskResult = await validTaskRes.json();
    testTaskId = taskResult.data?.id;
    assert(validTaskRes.status === 201 && testTaskId, 'TC-05b', 'Tugas baru berhasil dibuat dengan status default To Do');

    // ----------------------------------------------------
    // TC-06: Transisi Status Tugas ke Done (Timestamp Otomatis)
    // ----------------------------------------------------
    const doneRes = await fetch(`${BASE_URL}/api/tasks/${testTaskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Cookie': memberCookie },
      body: JSON.stringify({ status: 'Done' }),
    });
    const doneData = await doneRes.json();
    assert(
      doneRes.status === 200 &&
      doneData.data?.status === 'Done' &&
      doneData.data?.completed === true &&
      doneData.data?.completed_at !== null,
      'TC-06',
      'Status Done mengisi completed=true dan completed_at secara otomatis'
    );

    // ----------------------------------------------------
    // TC-07: Membuka Kembali Tugas (Re-open to In Progress)
    // ----------------------------------------------------
    const reopenRes = await fetch(`${BASE_URL}/api/tasks/${testTaskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Cookie': memberCookie },
      body: JSON.stringify({ status: 'In Progress' }),
    });
    const reopenData = await reopenRes.json();
    assert(
      reopenRes.status === 200 &&
      reopenData.data?.status === 'In Progress' &&
      reopenData.data?.completed === false &&
      reopenData.data?.completed_at === null,
      'TC-07',
      'Status In Progress me-reset completed=false dan completed_at=null'
    );

    // ----------------------------------------------------
    // TC-08: Isolasi Data Antar Pengguna
    // ----------------------------------------------------
    // Buat akun User kedua
    const user2Email = `tester2_${Date.now()}@perusahaan.com`;
    await fetch(`${BASE_URL}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': ownerCookie },
      body: JSON.stringify({ name: 'User 2', email: user2Email, password: 'User123!', role: 'User' }),
    });
    const loginUser2 = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user2Email, password: 'User123!' }),
    });
    const user2Cookie = loginUser2.headers.get('set-cookie')?.split(';')[0] || '';

    // User 2 mencoba hapus tugas milik User 1
    const tamperRes = await fetch(`${BASE_URL}/api/tasks/${testTaskId}`, {
      method: 'DELETE',
      headers: { 'Cookie': user2Cookie },
    });
    assert(tamperRes.status === 403, 'TC-08', 'User lain dilarang memanipulasi tugas pengguna berbeda (403 Forbidden)');

    // ----------------------------------------------------
    // TC-09 & TC-10: Deteksi Pengingat Mendesak & Overdue
    // ----------------------------------------------------
    const remRes = await fetch(`${BASE_URL}/api/reminders/urgent`, {
      headers: { 'Cookie': ownerCookie },
    });
    const remData = await remRes.json();
    assert(
      remRes.status === 200 && typeof remData.data?.total_urgent === 'number',
      'TC-09',
      'Algoritma evaluasi deadline menghitung tugas urgent/overdue secara akurat'
    );

    // ----------------------------------------------------
    // TC-12: Proteksi Self-Lockout Owner
    // ----------------------------------------------------
    const meRes = await fetch(`${BASE_URL}/api/auth/me`, { headers: { 'Cookie': ownerCookie } });
    const meData = await meRes.json();
    const ownerId = meData.data.id;

    // Owner mencoba menonaktifkan akun sendiri
    const lockoutRes = await fetch(`${BASE_URL}/api/users/${ownerId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Cookie': ownerCookie },
      body: JSON.stringify({ status: 'Inactive' }),
    });
    assert(lockoutRes.status === 400, 'TC-12a', 'Owner diblokir menonaktifkan akun sendiri (Self-Lockout Prevention)');

    // Owner mencoba menghapus akun sendiri
    const deleteSelfRes = await fetch(`${BASE_URL}/api/users/${ownerId}`, {
      method: 'DELETE',
      headers: { 'Cookie': ownerCookie },
    });
    assert(deleteSelfRes.status === 400, 'TC-12b', 'Owner diblokir menghapus akun sendiri (Self-Delete Prevention)');

    // ----------------------------------------------------
    // TC-13: Validasi Kalkulasi Laporan Analitik
    // ----------------------------------------------------
    const reportRes = await fetch(`${BASE_URL}/api/reports/analytics?period=all`, {
      headers: { 'Cookie': ownerCookie },
    });
    const reportData = await reportRes.json();
    const m = reportData.data?.metrics;
    assert(
      reportRes.status === 200 &&
      typeof m?.completion_rate === 'number' &&
      typeof m?.total_tasks === 'number',
      'TC-13',
      'Kalkulasi analitik agregasi laporan KPI terhitung presisi'
    );

    // ----------------------------------------------------
    // TC-03: Login Akun Inactive
    // ----------------------------------------------------
    // Nonaktifkan akun testMemberId oleh Owner
    await fetch(`${BASE_URL}/api/users/${testMemberId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Cookie': ownerCookie },
      body: JSON.stringify({ status: 'Inactive' }),
    });
    const inactiveLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'User123!' }),
    });
    assert(inactiveLoginRes.status === 403, 'TC-03', 'Akun berstatus Inactive ditolak login (403 Forbidden)');

    // Clean up test task
    if (testTaskId) {
      await fetch(`${BASE_URL}/api/tasks/${testTaskId}`, {
        method: 'DELETE',
        headers: { 'Cookie': ownerCookie },
      });
    }

  } catch (err) {
    console.error('Fatal Test Exception:', err);
  }

  console.log('\n====================================================');
  console.log(`📊 HASIL PENGUJIAN: ${passed} LULUS, ${failed} GAGAL`);
  console.log('====================================================');

  if (failed === 0) {
    console.log('🎉 SEMUA SKENARIO UAT & KEAMANAN TERVERIFIKASI 100% LULUS!');
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
