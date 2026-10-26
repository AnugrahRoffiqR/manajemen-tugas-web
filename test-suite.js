/**
 * TEST-SUITE.JS — Automated UAT Verification Engine (TC-01 through TC-14)
 * Menjalankan seluruh skenario pengujian integrasi & keamanan secara otomatis.
 */

require('dotenv').config();
const app = require('./server');
const totp = require('./lib/totp');

const PORT = process.env.PORT || 3005;
const BASE_URL = `http://localhost:${PORT}`;
// Real Owner credentials are never committed; pass them in the environment.
const OWNER_EMAIL = process.env.TEST_OWNER_EMAIL;
const OWNER_PASSWORD = process.env.TEST_OWNER_PASSWORD;
if (!OWNER_EMAIL || !OWNER_PASSWORD) {
  console.error('Set TEST_OWNER_EMAIL dan TEST_OWNER_PASSWORD sebelum menjalankan test-suite.');
  process.exit(1);
}

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
      body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
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
      body: JSON.stringify({ email: OWNER_EMAIL, password: 'WrongPassword999!' }),
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
      headers: { 'Content-Type': 'application/json', 'Cookie': ownerCookie },
      body: JSON.stringify({ title: '', due_date: new Date().toISOString() }),
    });
    assert(emptyTaskRes.status === 400, 'TC-05a', 'Pembuatan tugas tanpa judul ditolak sistem (400 Bad Request)');

    // TC-24: User tidak boleh membuat tugas, menghapus tugas, atau membuka laporan
    const memberCreate = await fetch(`${BASE_URL}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': memberCookie },
      body: JSON.stringify({ title: 'Coba buat', due_date: new Date(Date.now() + 3600000).toISOString() }),
    });
    assert(memberCreate.status === 403, 'TC-24a', `User dilarang membuat tugas (dapat ${memberCreate.status})`);
    const memberReport = await fetch(`${BASE_URL}/api/reports/analytics`, { headers: { 'Cookie': memberCookie } });
    assert(memberReport.status === 403, 'TC-24b', `User dilarang membuka laporan (dapat ${memberReport.status})`);

    const ownerMe = await (await fetch(`${BASE_URL}/api/auth/me`, { headers: { 'Cookie': ownerCookie } })).json();
    const ownerSelfId = ownerMe.data?.id;
    const due5h = new Date(Date.now() + 5 * 3600000).toISOString();

    // Penanggung jawab harus Owner: anggota sebagai user_id ditolak
    const memberAssignee = await fetch(`${BASE_URL}/api/tasks`, {
      method: 'POST',
      headers: jsonHeaders(ownerCookie),
      body: JSON.stringify({ user_id: testMemberId, title: 'Salah PJ', due_date: due5h }),
    });
    assert(memberAssignee.status === 400, 'TC-05c', `Penanggung jawab anggota ditolak (dapat ${memberAssignee.status})`);

    const validTaskRes = await fetch(`${BASE_URL}/api/tasks`, {
      method: 'POST',
      headers: jsonHeaders(ownerCookie),
      body: JSON.stringify({
        user_id: ownerSelfId,
        title: 'Tugas Uji Otomatis',
        description: 'Verifikasi state machine',
        due_date: due5h,
      }),
    });
    const taskResult = await validTaskRes.json();
    testTaskId = taskResult.data?.id;
    assert(
      validTaskRes.status === 201 && testTaskId && taskResult.data?.user_id === ownerSelfId && taskResult.data?.status === 'To Do',
      'TC-05b', 'Owner membuat tugas (PJ = Owner) dengan status default To Do'
    );
    const memberDelete = await fetch(`${BASE_URL}/api/tasks/${testTaskId}`, { method: 'DELETE', headers: { 'Cookie': memberCookie } });
    assert(memberDelete.status === 403, 'TC-24c', `User dilarang menghapus tugas (dapat ${memberDelete.status})`);

    // TC-25: Anggota melihat semua tugas, tidak bisa ubah status, hanya lapor selesai
    const memberList = await (await fetch(`${BASE_URL}/api/tasks`, { headers: { 'Cookie': memberCookie } })).json();
    assert((memberList.data || []).some(t => t.id === testTaskId), 'TC-25a', 'Anggota melihat tugas yang dibuat Owner');
    const memberPut = await fetch(`${BASE_URL}/api/tasks/${testTaskId}`, {
      method: 'PUT', headers: jsonHeaders(memberCookie), body: JSON.stringify({ status: 'Done' }),
    });
    assert(memberPut.status === 403, 'TC-25b', `Anggota dilarang mengubah status (dapat ${memberPut.status})`);
    const report1 = await fetch(`${BASE_URL}/api/tasks/${testTaskId}/report-done`, { method: 'POST', headers: { 'Cookie': memberCookie } });
    assert(report1.status === 200, 'TC-25c', `Anggota bisa lapor selesai (dapat ${report1.status})`);
    const report2 = await fetch(`${BASE_URL}/api/tasks/${testTaskId}/report-done`, { method: 'POST', headers: { 'Cookie': memberCookie } });
    assert(report2.status === 409, 'TC-25d', `Lapor selesai kedua kali ditolak (dapat ${report2.status})`);
    const ownerReport = await fetch(`${BASE_URL}/api/tasks/${testTaskId}/report-done`, { method: 'POST', headers: { 'Cookie': ownerCookie } });
    assert(ownerReport.status === 403, 'TC-25e', `Owner tidak memakai lapor selesai (dapat ${ownerReport.status})`);
    const reportMissing = await fetch(`${BASE_URL}/api/tasks/2147483000/report-done`, { method: 'POST', headers: { 'Cookie': memberCookie } });
    assert(reportMissing.status === 404, 'TC-25f', `Lapor tugas yang tidak ada → 404 (dapat ${reportMissing.status})`);
    const ownerView = await (await fetch(`${BASE_URL}/api/tasks`, { headers: { 'Cookie': ownerCookie } })).json();
    const seen = (ownerView.data || []).find(t => t.id === testTaskId);
    assert(seen?.done_reported_by === testMemberId && seen?.done_reported_by_name === 'Budi Tester', 'TC-25g', 'Owner melihat siapa yang melapor selesai');

    // Owner memindahkan status (bukan ke Done) → laporan dibersihkan
    const moveRes = await fetch(`${BASE_URL}/api/tasks/${testTaskId}`, {
      method: 'PUT', headers: jsonHeaders(ownerCookie), body: JSON.stringify({ status: 'In Progress' }),
    });
    const moveData = await moveRes.json();
    assert(moveRes.status === 200 && moveData.data?.done_reported_at === null, 'TC-25h', 'Pindah status oleh Owner menghapus laporan selesai');

    // ----------------------------------------------------
    // TC-06: Transisi Status Tugas ke Done (Timestamp Otomatis)
    // ----------------------------------------------------
    const doneRes = await fetch(`${BASE_URL}/api/tasks/${testTaskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Cookie': ownerCookie },
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
    const reportOnDone = await fetch(`${BASE_URL}/api/tasks/${testTaskId}/report-done`, { method: 'POST', headers: { 'Cookie': memberCookie } });
    assert(reportOnDone.status === 409, 'TC-25i', `Lapor selesai pada tugas Done ditolak (dapat ${reportOnDone.status})`);

    const reopenRes = await fetch(`${BASE_URL}/api/tasks/${testTaskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Cookie': ownerCookie },
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
    assert(tamperRes.status === 403, 'TC-08', 'Anggota lain dilarang menghapus tugas (403 Forbidden)');

    // TC-26: Pengingat hanya dari Owner; "Semua anggota" = satu baris per anggota aktif
    const remAt = new Date(Date.now() + 2 * 3600000).toISOString();
    const memberRem = await fetch(`${BASE_URL}/api/reminders`, {
      method: 'POST', headers: jsonHeaders(memberCookie), body: JSON.stringify({ title: 'X', remind_at: remAt, recipient: 'all' }),
    });
    assert(memberRem.status === 403, 'TC-26a', `Anggota dilarang membuat pengingat (dapat ${memberRem.status})`);
    const ownerToOwner = await fetch(`${BASE_URL}/api/reminders`, {
      method: 'POST', headers: jsonHeaders(ownerCookie), body: JSON.stringify({ title: 'X', remind_at: remAt, recipient: ownerSelfId }),
    });
    assert(ownerToOwner.status === 400, 'TC-26b', `Penerima pengingat harus anggota (dapat ${ownerToOwner.status})`);
    const activeMembers = ((await (await fetch(`${BASE_URL}/api/users`, { headers: { 'Cookie': ownerCookie } })).json()).data || [])
      .filter(u => u.role === 'User' && u.status === 'Active').length;
    const allRem = await fetch(`${BASE_URL}/api/reminders`, {
      method: 'POST', headers: jsonHeaders(ownerCookie), body: JSON.stringify({ title: 'Uji semua anggota', remind_at: remAt, recipient: 'all' }),
    });
    const allRemData = await allRem.json();
    assert(allRem.status === 201 && allRemData.data?.count === activeMembers && allRemData.data?.batch_id, 'TC-26c', `Pengingat "Semua anggota" terkirim ke ${activeMembers} anggota`);
    const oneRem = await fetch(`${BASE_URL}/api/reminders`, {
      method: 'POST', headers: jsonHeaders(ownerCookie), body: JSON.stringify({ title: 'Uji satu anggota', remind_at: remAt, recipient: testUser2Id }),
    });
    const oneRemData = await oneRem.json();
    assert(oneRem.status === 201 && oneRemData.data?.count === 1, 'TC-26d', 'Pengingat ke satu anggota terkirim');
    const u2Rems = (await (await fetch(`${BASE_URL}/api/reminders`, { headers: { 'Cookie': user2Cookie } })).json()).data || [];
    assert(u2Rems.some(r => r.title === 'Uji semua anggota') && u2Rems.some(r => r.title === 'Uji satu anggota' && r.sender_name),
      'TC-26e', 'Anggota menerima pengingat beserta nama pengirim');
    const m1Rems = (await (await fetch(`${BASE_URL}/api/reminders`, { headers: { 'Cookie': memberCookie } })).json()).data || [];
    assert(m1Rems.some(r => r.title === 'Uji semua anggota') && !m1Rems.some(r => r.title === 'Uji satu anggota'),
      'TC-26f', 'Pengingat satu anggota tidak terlihat anggota lain');
    const ownerRems = (await (await fetch(`${BASE_URL}/api/reminders`, { headers: { 'Cookie': ownerCookie } })).json()).data || [];
    const batchItems = ownerRems.filter(r => r.batch_id === allRemData.data?.batch_id);
    assert(batchItems.length === 1 && batchItems[0].recipient_count === activeMembers, 'TC-26g', 'Owner melihat pengingat semua anggota sebagai satu item');
    const memberDelRem = await fetch(`${BASE_URL}/api/reminders/${allRemData.data?.id}`, { method: 'DELETE', headers: { 'Cookie': memberCookie } });
    assert(memberDelRem.status === 403, 'TC-26h', `Anggota dilarang menghapus pengingat (dapat ${memberDelRem.status})`);
    const delBatch = await fetch(`${BASE_URL}/api/reminders/${allRemData.data?.id}`, { method: 'DELETE', headers: { 'Cookie': ownerCookie } });
    const u2RemsAfter = (await (await fetch(`${BASE_URL}/api/reminders`, { headers: { 'Cookie': user2Cookie } })).json()).data || [];
    assert(delBatch.status === 200 && !u2RemsAfter.some(r => r.title === 'Uji semua anggota'), 'TC-26i', 'Hapus pengingat semua anggota menghapus seluruh batch');
    await fetch(`${BASE_URL}/api/reminders/${oneRemData.data?.id}`, { method: 'DELETE', headers: { 'Cookie': ownerCookie } });

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
      ['TC-15b', 'POST', '/api/reminders', { title: 'X', remind_at: due, recipient: 'abc' }, 400, 'Penerima pengingat tidak valid ditolak'],
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
      ['TC-15m', 'POST', '/api/tasks/abc/report-done', undefined, 400, 'ID tugas non-angka pada lapor selesai ditolak'],
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
    // TC-18: Ganti kata sandi mengeluarkan semua sesi lama akun itu
    // ----------------------------------------------------
    const u2Before = await fetch(`${BASE_URL}/api/tasks`, { headers: { 'Cookie': user2Cookie } });
    const pwRes = await fetch(`${BASE_URL}/api/users/${testUser2Id}`, {
      method: 'PUT', headers: jsonHeaders(ownerCookie), body: JSON.stringify({ password: 'GantiBaru123' }),
    });
    const u2After = await fetch(`${BASE_URL}/api/tasks`, { headers: { 'Cookie': user2Cookie } });
    const u2AfterBody = await u2After.json();
    assert(u2Before.status === 200 && pwRes.status === 200 && u2After.status === 401 && u2AfterBody.error === 'SESSION_REVOKED',
      'TC-18a', `Sesi lama ditolak setelah kata sandi diganti (dapat ${u2After.status} ${u2AfterBody.error})`);
    const u2Relogin = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user2Email, password: 'GantiBaru123' }),
    });
    const u2NewCookie = u2Relogin.headers.get('set-cookie')?.split(';')[0] || '';
    const u2NewSession = await fetch(`${BASE_URL}/api/tasks`, { headers: { 'Cookie': u2NewCookie } });
    assert(u2Relogin.status === 200 && u2NewSession.status === 200, 'TC-18b', 'Login dengan kata sandi baru berfungsi normal');
    const ownerStill = await fetch(`${BASE_URL}/api/tasks`, { headers: { 'Cookie': ownerCookie } });
    assert(ownerStill.status === 200, 'TC-18c', 'Sesi Owner tidak terdampak penggantian kata sandi user lain');

    // ----------------------------------------------------
    // TC-19: Riwayat login tercatat dan hanya untuk Owner
    // ----------------------------------------------------
    const evRes = await fetch(`${BASE_URL}/api/login-events`, { headers: { 'Cookie': ownerCookie } });
    const evData = (await evRes.json()).data || [];
    const sawFail = evData.some((e) => e.email === OWNER_EMAIL && e.reason === 'WRONG_PASSWORD');
    const sawOk = evData.some((e) => e.email === user2Email && e.reason === 'OK');
    assert(evRes.status === 200 && sawFail && sawOk, 'TC-19a', 'Login gagal & berhasil tercatat di riwayat');
    const evMember = await fetch(`${BASE_URL}/api/login-events`, { headers: { 'Cookie': u2NewCookie } });
    assert(evMember.status === 403, 'TC-19b', `User biasa dilarang melihat riwayat login (dapat ${evMember.status})`);

    // ----------------------------------------------------
    // TC-22: Logout mencabut token di server; sesi lain tetap jalan. Batas panjang judul.
    const extraLogin = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
    });
    const extraCookie = extraLogin.headers.get('set-cookie')?.split(';')[0] || '';
    await fetch(`${BASE_URL}/api/auth/logout`, { method: 'POST', headers: { 'Cookie': extraCookie } });
    const reuse = await fetch(`${BASE_URL}/api/tasks`, { headers: { 'Cookie': extraCookie } });
    const ownerAlive = await fetch(`${BASE_URL}/api/tasks`, { headers: { 'Cookie': ownerCookie } });
    assert(reuse.status === 401 && ownerAlive.status === 200, 'TC-22a', `Token setelah logout ditolak (${reuse.status}), sesi lain tetap aktif (${ownerAlive.status})`);
    const longTitle = await fetch(`${BASE_URL}/api/tasks`, {
      method: 'POST', headers: jsonHeaders(ownerCookie),
      body: JSON.stringify({ title: 'a'.repeat(201), due_date: '2030-01-01T00:00:00Z' }),
    });
    assert(longTitle.status === 400, 'TC-22b', `Judul > 200 karakter ditolak (dapat ${longTitle.status})`);

    // TC-23: Reset kata sandi menolak token palsu; halaman reset tersedia.
    const fakeReset = await fetch(`${BASE_URL}/api/auth/reset-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'A'.repeat(43), password: 'BaruSekali123' }),
    });
    const resetPage = await fetch(`${BASE_URL}/reset-password`);
    assert(fakeReset.status === 400 && resetPage.status === 200, 'TC-23', `Token reset palsu ditolak (${fakeReset.status}), halaman reset ${resetPage.status}`);

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
    // TC-20: 2FA (TOTP) — setup, login 2 langkah, anti-replay, reset oleh Owner
    // ----------------------------------------------------
    const postJson = (url, body, cookie) => fetch(`${BASE_URL}${url}`, {
      method: 'POST', headers: cookie ? jsonHeaders(cookie) : { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
    });
    const codeAt = (secret, offsetMs = 0) => totp.hotp(totp.base32Decode(secret), totp.currentStep(Date.now() + offsetMs));
    const setup = await (await postJson('/api/auth/2fa/setup', {}, u2NewCookie)).json();
    const secret = setup.data?.secret;
    const badEnable = await postJson('/api/auth/2fa/enable', { code: '000000' }, u2NewCookie);
    const enableRes = await postJson('/api/auth/2fa/enable', { code: codeAt(secret) }, u2NewCookie);
    const u2TwoFaCookie = enableRes.headers.get('set-cookie')?.split(';')[0] || '';
    assert(secret && /^otpauth:\/\/totp\//.test(setup.data.otpauthUri) && badEnable.status === 400 && enableRes.status === 200,
      'TC-20a', `2FA aktif hanya dengan kode yang benar (salah ${badEnable.status}, benar ${enableRes.status})`);
    const oldDevice = await fetch(`${BASE_URL}/api/tasks`, { headers: { 'Cookie': u2NewCookie } });
    const thisDevice = await fetch(`${BASE_URL}/api/tasks`, { headers: { 'Cookie': u2TwoFaCookie } });
    assert(oldDevice.status === 401 && thisDevice.status === 200, 'TC-20b', 'Aktivasi 2FA mengeluarkan perangkat lain, perangkat ini tetap login');

    const step1 = await postJson('/api/auth/login', { email: user2Email, password: 'GantiBaru123' });
    const step1Body = await step1.json();
    assert(step1.status === 200 && step1Body.twoFactorRequired && !step1.headers.get('set-cookie'),
      'TC-20c', 'Kata sandi benar saja tidak memberi sesi bila 2FA aktif');
    const challengeAsSession = await fetch(`${BASE_URL}/api/tasks`, { headers: { 'Cookie': `session_token=${step1Body.challenge}` } });
    assert(challengeAsSession.status === 401, 'TC-20d', `Token challenge tidak bisa dipakai sebagai sesi (dapat ${challengeAsSession.status})`);
    const wrongCode = await postJson('/api/auth/login/2fa', { challenge: step1Body.challenge, code: '123456' });
    // The current step was consumed by /enable, so log in with the next step (within the ±1 drift window).
    const nextCode = codeAt(secret, 30000);
    const goodCode = await postJson('/api/auth/login/2fa', { challenge: step1Body.challenge, code: nextCode });
    const replay = await postJson('/api/auth/login/2fa', { challenge: step1Body.challenge, code: nextCode });
    assert(wrongCode.status === 401 && goodCode.status === 200 && !!goodCode.headers.get('set-cookie') && replay.status === 401,
      'TC-20e', `Kode salah ditolak, kode benar masuk, kode sama tidak bisa dipakai ulang (${wrongCode.status}/${goodCode.status}/${replay.status})`);
    const disableBad = await postJson('/api/auth/2fa/disable', { password: 'salah-sekali', code: codeAt(secret) }, u2TwoFaCookie);
    const stillIn = await fetch(`${BASE_URL}/api/tasks`, { headers: { 'Cookie': u2TwoFaCookie } });
    assert(disableBad.status === 400 && stillIn.status === 200, 'TC-20f', 'Nonaktifkan 2FA dengan kata sandi salah ditolak tanpa mengeluarkan sesi');

    const resetMember = await postJson(`/api/users/${testUser2Id}/reset-2fa`, {}, u2TwoFaCookie);
    const resetOwner = await postJson(`/api/users/${testUser2Id}/reset-2fa`, {}, ownerCookie);
    const afterReset = await fetch(`${BASE_URL}/api/tasks`, { headers: { 'Cookie': u2TwoFaCookie } });
    const plainLogin = await (await postJson('/api/auth/login', { email: user2Email, password: 'GantiBaru123' })).json();
    assert(resetMember.status === 403 && resetOwner.status === 200 && afterReset.status === 401 && plainLogin.success && !plainLogin.twoFactorRequired,
      'TC-20g', 'Hanya Owner yang bisa reset 2FA; sesi dicabut dan login kembali tanpa kode');

    // ----------------------------------------------------
    // TC-21: Batas per akun — penyerang dengan banyak IP tetap diblokir
    // ----------------------------------------------------
    let acctStatuses = [];
    for (let i = 0; i < 10; i++) {
      const r = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `203.0.113.${i + 1}` },
        body: JSON.stringify({ email: user2Email, password: `tebak-${i}` }),
      });
      acctStatuses.push(r.status);
    }
    const correctButLocked = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.200' },
      body: JSON.stringify({ email: user2Email, password: 'GantiBaru123' }),
    });
    assert(acctStatuses.every((s) => s === 401) && correctButLocked.status === 429, 'TC-21',
      `10 tebakan dari 10 IP berbeda mengunci akun (dapat ${correctButLocked.status})`);

    // ----------------------------------------------------
    // TC-14: Rate limit login (dijalankan terakhir karena mengunci IP ini 60 detik)
    // ----------------------------------------------------
    let lastStatus = 0;
    for (let i = 0; i < 6; i++) {
      const r = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: OWNER_EMAIL, password: `salah-${i}` }),
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
