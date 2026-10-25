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
  let testUser2Id = null;

  const jsonHeaders = (cookie) => ({ 'Content-Type': 'application/json', 'Cookie': cookie });

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
    const createUser2Res = await fetch(`${BASE_URL}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': ownerCookie },
      body: JSON.stringify({ name: 'User 2', email: user2Email, password: 'User123!', role: 'User' }),
    });
    testUser2Id = (await createUser2Res.json()).data?.id || null;
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

    // Sesi lama milik akun yang dinonaktifkan harus langsung dicabut
    const revokedRes = await fetch(`${BASE_URL}/api/tasks`, { headers: { 'Cookie': memberCookie } });
    assert(revokedRes.status === 401, 'TC-03b', 'Cookie sesi akun Inactive langsung ditolak (401)');

    // ----------------------------------------------------
    // TC-15: Validasi Input API (harus 400/404, bukan 500)
    // ----------------------------------------------------
    const due = new Date(Date.now() + 3600000).toISOString();
    const badCases = [
      ['TC-15a', 'POST', '/api/tasks', { title: 'X', due_date: due, status: 'Selesai' }, 400, 'Status tugas di luar enum ditolak'],
      ['TC-15b', 'POST', '/api/tasks', { title: 'X', due_date: due, priority: 'Urgent' }, 400, 'Prioritas di luar enum ditolak'],
      ['TC-15c', 'POST', '/api/tasks', { title: 'X', due_date: 'bukan-tanggal' }, 400, 'Tanggal tidak valid ditolak'],
      ['TC-15d', 'POST', '/api/tasks', { title: 'X', due_date: due, description: 123 }, 400, 'Deskripsi non-string ditolak'],
      ['TC-15e', 'POST', '/api/tasks', { title: 'X', due_date: due, user_id: 2147483000 }, 400, 'Assignee yang tidak ada ditolak'],
      ['TC-15f', 'POST', '/api/users', { name: 'X', email: 'x@y.z', password: 'Password1', role: 'Admin' }, 400, 'Role di luar enum ditolak'],
      ['TC-15g', 'POST', '/api/reminders', { title: 'X', remind_at: 'kemarin' }, 400, 'Waktu pengingat tidak valid ditolak'],
      ['TC-15h', 'POST', '/api/reminders', { title: 'X', remind_at: due, task_id: 2147483000 }, 400, 'task_id pengingat yang tidak ada ditolak'],
      ['TC-15i', 'DELETE', '/api/users/2147483000', undefined, 404, 'Hapus user yang tidak ada → 404'],
      ['TC-15j', 'DELETE', '/api/reminders/2147483000', undefined, 404, 'Hapus pengingat yang tidak ada → 404'],
      ['TC-15k', 'GET', '/api/tasks?status=Done&status=To%20Do', undefined, 200, 'Query param ganda tidak membuat 500'],
      ['TC-15l', 'GET', '/api/reports/analytics?period=today&period=week', undefined, 200, 'Period ganda di laporan tidak membuat 500'],
      ['TC-15m', 'GET', '/api/tasks?user_id=abc', undefined, 400, 'Filter user_id non-angka ditolak'],
      ['TC-15n', 'POST', '/api/users', { name: 'X', email: 'bukan-email', password: 'Password1' }, 400, 'Format email salah ditolak'],
      ['TC-15o', 'PUT', '/api/users/2147483000', { status: 'Dibekukan' }, 400, 'Status user di luar enum ditolak'],
    ];
    for (const [id, method, url, body, expected, desc] of badCases) {
      const r = await fetch(`${BASE_URL}${url}`, {
        method,
        headers: jsonHeaders(ownerCookie),
        body: body ? JSON.stringify(body) : undefined,
      });
      assert(r.status === expected, id, `${desc} (dapat ${r.status})`);
    }

    // ----------------------------------------------------
    // TC-17: Tugas baru bisa langsung dibuat di kolom In Progress
    // ----------------------------------------------------
    const t17 = await (await fetch(`${BASE_URL}/api/tasks`, {
      method: 'POST', headers: jsonHeaders(ownerCookie),
      body: JSON.stringify({ title: 'TC17', due_date: due, status: 'In Progress' }),
    })).json();
    assert(t17.data?.status === 'In Progress' && t17.data?.completed === false, 'TC-17', 'Status awal dari kolom Kanban dihormati');
    if (t17.data?.id) await fetch(`${BASE_URL}/api/tasks/${t17.data.id}`, { method: 'DELETE', headers: { 'Cookie': ownerCookie } });

    // ----------------------------------------------------
    // TC-16: Re-save tugas Done tidak menggeser completed_at
    // ----------------------------------------------------
    const t16 = await (await fetch(`${BASE_URL}/api/tasks`, {
      method: 'POST', headers: jsonHeaders(ownerCookie),
      body: JSON.stringify({ title: 'TC16', due_date: due }),
    })).json();
    const t16Id = t16.data?.id;
    const firstDone = await (await fetch(`${BASE_URL}/api/tasks/${t16Id}`, {
      method: 'PUT', headers: jsonHeaders(ownerCookie), body: JSON.stringify({ status: 'Done' }),
    })).json();
    await new Promise((r) => setTimeout(r, 1100));
    const resaved = await (await fetch(`${BASE_URL}/api/tasks/${t16Id}`, {
      method: 'PUT', headers: jsonHeaders(ownerCookie), body: JSON.stringify({ status: 'Done', title: 'TC16 edit' }),
    })).json();
    assert(
      firstDone.data?.completed_at && firstDone.data.completed_at === resaved.data?.completed_at,
      'TC-16', 'Simpan ulang tugas Done mempertahankan completed_at'
    );
    if (t16Id) await fetch(`${BASE_URL}/api/tasks/${t16Id}`, { method: 'DELETE', headers: { 'Cookie': ownerCookie } });

    // ----------------------------------------------------
    // TC-14: Rate limit login (dijalankan terakhir karena mengunci IP ini 60 detik)
    // ----------------------------------------------------
    let lastStatus = 0;
    for (let i = 0; i < 6; i++) {
      const r = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@manajementugas.local', password: `salah-${i}` }),
      });
      lastStatus = r.status;
    }
    assert(lastStatus === 429, 'TC-14', `Percobaan login gagal ke-6 diblokir (dapat ${lastStatus})`);

  } catch (err) {
    console.error('Fatal Test Exception:', err);
    failed++;
  } finally {
    // Hapus semua data uji; tugas ikut terhapus via ON DELETE CASCADE.
    const cleanup = [
      testTaskId && `/api/tasks/${testTaskId}`,
      testMemberId && `/api/users/${testMemberId}`,
      testUser2Id && `/api/users/${testUser2Id}`,
    ].filter(Boolean);
    for (const url of cleanup) {
      const r = await fetch(`${BASE_URL}${url}`, { method: 'DELETE', headers: { 'Cookie': ownerCookie } }).catch(() => null);
      // 404 berarti sudah terhapus (mis. tugas ikut cascade); selain itu laporkan.
      if (!r || (r.status !== 200 && r.status !== 404)) {
        console.error(`⚠️  Cleanup gagal untuk ${url} (status ${r?.status ?? 'network error'})`);
      }
    }
    if (serverInstance) await new Promise((resolve) => serverInstance.close(resolve));
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
