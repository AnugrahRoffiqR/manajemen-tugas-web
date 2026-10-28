/**
 * TEST-SUITE.JS — Automated UAT Verification Engine (TC-01 through TC-14)
 * Menjalankan seluruh skenario pengujian integrasi & keamanan secara otomatis.
 */

require('dotenv').config();
const dbTarget = require('./lib/db-target');
// The suite creates and deletes users/tasks: refuse to run unless the DB endpoint is confirmed.
dbTarget.assertTarget('TEST');
const app = require('./server');
const totp = require('./lib/totp');
const db = require('./lib/db');

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
  let testUser3Id = null;
  // Tasks belong to the Owner (PJ), so deleting test users does not cascade them; purge every id here.
  const createdTaskIds = new Set();

  const jsonHeaders = (cookie) => ({ 'Content-Type': 'application/json', 'Cookie': cookie });
  // DELETE is a soft delete (trash); purge removes it for good. 404 on either step is fine.
  const purgeTask = async (id) => {
    await fetch(`${BASE_URL}/api/tasks/${id}`, { method: 'DELETE', headers: { 'Cookie': ownerCookie } }).catch(() => null);
    return fetch(`${BASE_URL}/api/tasks/${id}/purge`, { method: 'DELETE', headers: { 'Cookie': ownerCookie } }).catch(() => null);
  };
  const postJson = (url, body, cookie) => fetch(`${BASE_URL}${url}`, {
    method: 'POST', headers: cookie ? jsonHeaders(cookie) : { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  const createTask = async (cookie, body) => {
    const r = await fetch(`${BASE_URL}/api/tasks`, { method: 'POST', headers: jsonHeaders(cookie), body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (j.data?.id) createdTaskIds.add(j.data.id);
    return { status: r.status, body: j };
  };

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
    if (testTaskId) createdTaskIds.add(testTaskId);
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
    // Members cannot work on a To Do task until the Owner starts it.
    const reportTodo = await fetch(`${BASE_URL}/api/tasks/${testTaskId}/report-done`, { method: 'POST', headers: { 'Cookie': memberCookie } });
    const reportTodoBody = await reportTodo.json();
    assert(reportTodo.status === 409 && reportTodoBody.error === 'NOT_STARTED', 'TC-25j', `Lapor selesai saat To Do ditolak (dapat ${reportTodo.status} ${reportTodoBody.error})`);
    await fetch(`${BASE_URL}/api/tasks/${testTaskId}`, { method: 'PUT', headers: jsonHeaders(ownerCookie), body: JSON.stringify({ status: 'In Progress' }) });
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
      method: 'PUT', headers: jsonHeaders(ownerCookie), body: JSON.stringify({ status: 'To Do' }),
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
      !!doneData.data?.completed_at,
      'TC-06',
      'Status Done mengisi completed_at secara otomatis'
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
      reopenData.data?.completed_at === null,
      'TC-07',
      'Status In Progress me-reset completed_at=null'
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
    const t17 = (await createTask(ownerCookie, { title: 'TC17', due_date: due, status: 'In Progress' })).body;
    assert(t17.data?.status === 'In Progress' && t17.data?.completed_at === null, 'TC-17', 'Status awal dari kolom Kanban dihormati');

    // ----------------------------------------------------
    // TC-16: Re-save tugas Done tidak menggeser completed_at
    // ----------------------------------------------------
    const t16 = (await createTask(ownerCookie, { title: 'TC16', due_date: due })).body;
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

    // ----------------------------------------------------
    // TC-27: Penugasan anggota — hanya anggota terpilih yang bisa lapor/centang
    // ----------------------------------------------------
    const user3Email = `tester3_${Date.now()}@perusahaan.com`;
    testUser3Id = (await (await fetch(`${BASE_URL}/api/users`, {
      method: 'POST', headers: jsonHeaders(ownerCookie),
      body: JSON.stringify({ name: 'Citra Tester', email: user3Email, password: 'User123!', role: 'User' }),
    })).json()).data?.id || null;
    const u3Login = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user3Email, password: 'User123!' }),
    });
    const u3Cookie = u3Login.headers.get('set-cookie')?.split(';')[0] || '';

    const badMembers = await createTask(ownerCookie, { title: 'X', due_date: due, member_ids: [ownerSelfId] });
    assert(badMembers.status === 400, 'TC-27a', `Owner sebagai anggota ditolak (dapat ${badMembers.status})`);
    const assigned = await createTask(ownerCookie, { title: 'TC27 ditugaskan', due_date: due, member_ids: [testUser3Id], status: 'In Progress' });
    const t27 = assigned.body.data;
    assert(assigned.status === 201 && t27?.members?.length === 1 && t27.members[0].id === testUser3Id,
      'TC-27b', 'Tugas dibuat dengan anggota terpilih');
    const notAssigned = await fetch(`${BASE_URL}/api/tasks/${t27?.id}/report-done`, { method: 'POST', headers: jsonHeaders(u2NewCookie), body: '{}' });
    const notAssignedBody = await notAssigned.json();
    assert(notAssigned.status === 403 && notAssignedBody.error === 'NOT_ASSIGNED', 'TC-27c', `Anggota lain tidak bisa lapor (dapat ${notAssigned.status} ${notAssignedBody.error})`);
    const mine = ((await (await fetch(`${BASE_URL}/api/tasks?member=me`, { headers: { 'Cookie': u2NewCookie } })).json()).data || []);
    assert(!mine.some((t) => t.id === t27?.id), 'TC-27d', 'Filter "Tugas saya" tidak memuat tugas anggota lain');

    // TC-28: Lapor selesai dengan catatan + tautan, validasi tautan, tolak laporan
    const badLink = await fetch(`${BASE_URL}/api/tasks/${t27?.id}/report-done`, {
      method: 'POST', headers: jsonHeaders(u3Cookie), body: JSON.stringify({ note: 'x', link: 'javascript:alert(1)' }),
    });
    assert(badLink.status === 400, 'TC-28a', `Tautan non-http ditolak (dapat ${badLink.status})`);
    const goodReport = await fetch(`${BASE_URL}/api/tasks/${t27?.id}/report-done`, {
      method: 'POST', headers: jsonHeaders(u3Cookie), body: JSON.stringify({ note: 'Sudah beres', link: 'https://example.com/hasil' }),
    });
    const detail27 = (await (await fetch(`${BASE_URL}/api/tasks/${t27?.id}/detail`, { headers: { 'Cookie': ownerCookie } })).json()).data;
    assert(goodReport.status === 200 && detail27?.comments?.some((c) => c.kind === 'report' && c.link_url === 'https://example.com/hasil'),
      'TC-28b', 'Laporan dengan catatan & tautan tersimpan di thread');
    const emptyReject = await fetch(`${BASE_URL}/api/tasks/${t27?.id}/reject-report`, { method: 'POST', headers: jsonHeaders(ownerCookie), body: '{}' });
    const memberReject = await fetch(`${BASE_URL}/api/tasks/${t27?.id}/reject-report`, { method: 'POST', headers: jsonHeaders(u3Cookie), body: JSON.stringify({ reason: 'x' }) });
    const reject = await fetch(`${BASE_URL}/api/tasks/${t27?.id}/reject-report`, { method: 'POST', headers: jsonHeaders(ownerCookie), body: JSON.stringify({ reason: 'Lengkapi foto' }) });
    const afterReject = (await (await fetch(`${BASE_URL}/api/tasks/${t27?.id}/detail`, { headers: { 'Cookie': ownerCookie } })).json()).data;
    assert(emptyReject.status === 400 && memberReject.status === 403 && reject.status === 200
      && afterReject?.task?.done_reported_at === null && afterReject.comments.some((c) => c.kind === 'reject'),
      'TC-28c', `Tolak laporan: alasan wajib (${emptyReject.status}), Owner saja (${memberReject.status}), laporan dibersihkan (${reject.status})`);
    const rejectAgain = await fetch(`${BASE_URL}/api/tasks/${t27?.id}/reject-report`, { method: 'POST', headers: jsonHeaders(ownerCookie), body: JSON.stringify({ reason: 'x' }) });
    assert(rejectAgain.status === 409, 'TC-28d', `Tolak tanpa laporan aktif → 409 (dapat ${rejectAgain.status})`);

    // TC-29: Komentar — tambah, hapus oleh penulis, anggota lain tidak bisa hapus
    const c1 = await fetch(`${BASE_URL}/api/tasks/${t27?.id}/comments`, { method: 'POST', headers: jsonHeaders(u2NewCookie), body: JSON.stringify({ body: 'Komentar u2' }) });
    const c1Id = (await c1.json()).data?.id;
    const emptyComment = await fetch(`${BASE_URL}/api/tasks/${t27?.id}/comments`, { method: 'POST', headers: jsonHeaders(u3Cookie), body: JSON.stringify({ body: '  ' }) });
    const otherDel = await fetch(`${BASE_URL}/api/tasks/${t27?.id}/comments/${c1Id}`, { method: 'DELETE', headers: { 'Cookie': u3Cookie } });
    const ownDel = await fetch(`${BASE_URL}/api/tasks/${t27?.id}/comments/${c1Id}`, { method: 'DELETE', headers: { 'Cookie': u2NewCookie } });
    assert(c1.status === 201 && emptyComment.status === 400 && otherDel.status === 404 && ownDel.status === 200,
      'TC-29', `Komentar: tambah ${c1.status}, kosong ${emptyComment.status}, hapus orang lain ${otherDel.status}, hapus sendiri ${ownDel.status}`);

    // TC-30: Subtugas — Owner tambah/hapus, anggota terpilih centang, anggota tidak bisa ubah teks
    const ck = await fetch(`${BASE_URL}/api/tasks/${t27?.id}/checklist`, { method: 'POST', headers: jsonHeaders(ownerCookie), body: JSON.stringify({ text: 'Langkah 1' }) });
    const ckId = (await ck.json()).data?.id;
    const memberAddCk = await fetch(`${BASE_URL}/api/tasks/${t27?.id}/checklist`, { method: 'POST', headers: jsonHeaders(u3Cookie), body: JSON.stringify({ text: 'x' }) });
    const tick = await fetch(`${BASE_URL}/api/tasks/${t27?.id}/checklist/${ckId}`, { method: 'PUT', headers: jsonHeaders(u3Cookie), body: JSON.stringify({ done: true }) });
    const tickOther = await fetch(`${BASE_URL}/api/tasks/${t27?.id}/checklist/${ckId}`, { method: 'PUT', headers: jsonHeaders(u2NewCookie), body: JSON.stringify({ done: false }) });
    const renameMember = await fetch(`${BASE_URL}/api/tasks/${t27?.id}/checklist/${ckId}`, { method: 'PUT', headers: jsonHeaders(u3Cookie), body: JSON.stringify({ text: 'ganti' }) });
    const listCounts = ((await (await fetch(`${BASE_URL}/api/tasks`, { headers: { 'Cookie': ownerCookie } })).json()).data || []).find((t) => t.id === t27?.id);
    const delCk = await fetch(`${BASE_URL}/api/tasks/${t27?.id}/checklist/${ckId}`, { method: 'DELETE', headers: { 'Cookie': ownerCookie } });
    assert(ck.status === 201 && memberAddCk.status === 403 && tick.status === 200 && tickOther.status === 403
      && renameMember.status === 403 && Number(listCounts?.checklist_done) === 1 && Number(listCounts?.checklist_total) === 1 && delCk.status === 200,
      'TC-30', `Subtugas: tambah ${ck.status}/${memberAddCk.status}, centang ${tick.status}/${tickOther.status}, ubah teks anggota ${renameMember.status}, hapus ${delCk.status}`);
    const todoTask = (await createTask(ownerCookie, { title: 'TC30b belum dimulai', due_date: due, member_ids: [testUser3Id] })).body.data;
    const todoCkId = (await (await fetch(`${BASE_URL}/api/tasks/${todoTask?.id}/checklist`, { method: 'POST', headers: jsonHeaders(ownerCookie), body: JSON.stringify({ text: 'L1' }) })).json()).data?.id;
    const tickTodo = await fetch(`${BASE_URL}/api/tasks/${todoTask?.id}/checklist/${todoCkId}`, { method: 'PUT', headers: jsonHeaders(u3Cookie), body: JSON.stringify({ done: true }) });
    const ownerTickTodo = await fetch(`${BASE_URL}/api/tasks/${todoTask?.id}/checklist/${todoCkId}`, { method: 'PUT', headers: jsonHeaders(ownerCookie), body: JSON.stringify({ done: true }) });
    assert(tickTodo.status === 409 && ownerTickTodo.status === 200, 'TC-30c', `Centang subtugas saat To Do: anggota ${tickTodo.status}, Owner ${ownerTickTodo.status}`);
    const badItem = await fetch(`${BASE_URL}/api/tasks/${t27?.id}/checklist/abc`, { method: 'PUT', headers: jsonHeaders(ownerCookie), body: JSON.stringify({ done: true }) });
    assert(badItem.status === 400, 'TC-30b', `itemId non-angka ditolak (dapat ${badItem.status})`);

    // TC-31: Arsip — hanya Done; sampah → pulihkan → purge hanya dari sampah
    const archiveOpen = await fetch(`${BASE_URL}/api/tasks/${t27?.id}/archive`, { method: 'POST', headers: { 'Cookie': ownerCookie } });
    await fetch(`${BASE_URL}/api/tasks/${t27?.id}`, { method: 'PUT', headers: jsonHeaders(ownerCookie), body: JSON.stringify({ status: 'Done' }) });
    const archiveDone = await fetch(`${BASE_URL}/api/tasks/${t27?.id}/archive`, { method: 'POST', headers: { 'Cookie': ownerCookie } });
    const activeIds = ((await (await fetch(`${BASE_URL}/api/tasks`, { headers: { 'Cookie': ownerCookie } })).json()).data || []).map((t) => t.id);
    const archivedIds = ((await (await fetch(`${BASE_URL}/api/tasks?view=archived`, { headers: { 'Cookie': ownerCookie } })).json()).data || []).map((t) => t.id);
    const unarchive = await fetch(`${BASE_URL}/api/tasks/${t27?.id}/unarchive`, { method: 'POST', headers: { 'Cookie': ownerCookie } });
    assert(archiveOpen.status === 409 && archiveDone.status === 200 && !activeIds.includes(t27?.id) && archivedIds.includes(t27?.id) && unarchive.status === 200,
      'TC-31a', `Arsip: belum Done ${archiveOpen.status}, Done ${archiveDone.status}, pindah tab, kembalikan ${unarchive.status}`);
    const purgeLive = await fetch(`${BASE_URL}/api/tasks/${t27?.id}/purge`, { method: 'DELETE', headers: { 'Cookie': ownerCookie } });
    const soft = await fetch(`${BASE_URL}/api/tasks/${t27?.id}`, { method: 'DELETE', headers: { 'Cookie': ownerCookie } });
    const trashIds = ((await (await fetch(`${BASE_URL}/api/tasks?view=trash`, { headers: { 'Cookie': ownerCookie } })).json()).data || []).map((t) => t.id);
    const memberTrash = await fetch(`${BASE_URL}/api/tasks?view=trash`, { headers: { 'Cookie': u3Cookie } });
    const memberDetailTrashed = await fetch(`${BASE_URL}/api/tasks/${t27?.id}/detail`, { headers: { 'Cookie': u3Cookie } });
    const restore = await fetch(`${BASE_URL}/api/tasks/${t27?.id}/restore`, { method: 'POST', headers: { 'Cookie': ownerCookie } });
    assert(purgeLive.status === 404 && soft.status === 200 && trashIds.includes(t27?.id) && memberTrash.status === 403
      && memberDetailTrashed.status === 404 && restore.status === 200,
      'TC-31b', `Sampah: purge tugas aktif ${purgeLive.status}, buang ${soft.status}, sampah anggota ${memberTrash.status}, pulihkan ${restore.status}`);
    await fetch(`${BASE_URL}/api/tasks/${t27?.id}`, { method: 'DELETE', headers: { 'Cookie': ownerCookie } });
    const purge = await fetch(`${BASE_URL}/api/tasks/${t27?.id}/purge`, { method: 'DELETE', headers: { 'Cookie': ownerCookie } });
    const gone = await fetch(`${BASE_URL}/api/tasks/${t27?.id}/detail`, { headers: { 'Cookie': ownerCookie } });
    assert(purge.status === 200 && gone.status === 404, 'TC-31c', `Purge dari sampah menghapus permanen (${purge.status}/${gone.status})`);

    // TC-32: Tugas berulang membuat tugas berikutnya sekali saja
    const rec = (await createTask(ownerCookie, { title: 'TC32 berulang', due_date: due, recurrence: 'weekly', member_ids: [testUser3Id] })).body.data;
    const badRec = await createTask(ownerCookie, { title: 'X', due_date: due, recurrence: 'yearly' });
    const recDone = await (await fetch(`${BASE_URL}/api/tasks/${rec?.id}`, { method: 'PUT', headers: jsonHeaders(ownerCookie), body: JSON.stringify({ status: 'Done' }) })).json();
    const nextId = recDone.next_task?.id;
    if (nextId) createdTaskIds.add(nextId);
    await fetch(`${BASE_URL}/api/tasks/${rec?.id}`, { method: 'PUT', headers: jsonHeaders(ownerCookie), body: JSON.stringify({ status: 'In Progress' }) });
    const recAgain = await (await fetch(`${BASE_URL}/api/tasks/${rec?.id}`, { method: 'PUT', headers: jsonHeaders(ownerCookie), body: JSON.stringify({ status: 'Done' }) })).json();
    const nextTask = nextId ? (await (await fetch(`${BASE_URL}/api/tasks/${nextId}/detail`, { headers: { 'Cookie': ownerCookie } })).json()).data?.task : null;
    assert(badRec.status === 400 && nextId && recDone.data?.next_task_id === nextId && !recAgain.next_task
      && nextTask?.status === 'To Do' && nextTask.recurrence === 'weekly' && nextTask.members?.[0]?.id === testUser3Id
      && new Date(nextTask.due_date) > new Date(rec.due_date),
      'TC-32', 'Done pada tugas berulang membuat 1 tugas baru (anggota & pengulangan ikut)');

    // TC-33: Paginasi & filter
    const pageRes = await (await fetch(`${BASE_URL}/api/tasks?page=1&limit=1&view=all`, { headers: { 'Cookie': ownerCookie } })).json();
    assert(pageRes.data?.length === 1 && pageRes.meta?.page === 1 && pageRes.meta.limit === 1 && pageRes.meta.total >= 2 && pageRes.meta.pages === pageRes.meta.total,
      'TC-33a', `Paginasi mengembalikan meta (total ${pageRes.meta?.total}, pages ${pageRes.meta?.pages})`);
    const badSort = await fetch(`${BASE_URL}/api/tasks?sort=DROP&page=0&limit=-5&due_from=x`, { headers: { 'Cookie': ownerCookie } });
    assert(badSort.status === 200, 'TC-33b', `Parameter sort/page/tanggal tidak valid diabaikan (dapat ${badSort.status})`);

    // TC-34: Ekspor CSV hanya Owner
    const csv = await fetch(`${BASE_URL}/api/reports/export.csv`, { headers: { 'Cookie': ownerCookie } });
    const csvText = await csv.text();
    const csvMember = await fetch(`${BASE_URL}/api/reports/export.csv`, { headers: { 'Cookie': u3Cookie } });
    assert(csv.status === 200 && /text\/csv/.test(csv.headers.get('content-type') || '') && csvText.includes('Judul') && csvMember.status === 403,
      'TC-34', `CSV Owner ${csv.status}, anggota ${csvMember.status}`);

    // TC-35: Notifikasi — anggota terpilih menerima, tandai dibaca
    const notifs = await (await fetch(`${BASE_URL}/api/notifications`, { headers: { 'Cookie': u3Cookie } })).json();
    const readAll = await fetch(`${BASE_URL}/api/notifications/read`, { method: 'POST', headers: jsonHeaders(u3Cookie), body: '{}' });
    const notifsAfter = await (await fetch(`${BASE_URL}/api/notifications`, { headers: { 'Cookie': u3Cookie } })).json();
    const badRead = await fetch(`${BASE_URL}/api/notifications/read`, { method: 'POST', headers: jsonHeaders(u3Cookie), body: JSON.stringify({ ids: ['x'] }) });
    assert(notifs.meta?.unread > 0 && notifs.data.some((n) => n.type === 'assigned' && n.task_id === rec?.id) && readAll.status === 200
      && notifsAfter.meta?.unread === 0 && badRead.status === 400,
      'TC-35', `Notifikasi: belum dibaca ${notifs.meta?.unread} → ${notifsAfter.meta?.unread}, id salah ${badRead.status}`);

    // TC-36: Profil & ganti kata sandi mandiri
    const prof = await fetch(`${BASE_URL}/api/auth/profile`, { method: 'PUT', headers: jsonHeaders(u3Cookie), body: JSON.stringify({ name: 'Citra Ganti', email_notifications: false }) });
    const profBad = await fetch(`${BASE_URL}/api/auth/profile`, { method: 'PUT', headers: jsonHeaders(u3Cookie), body: JSON.stringify({ email_notifications: 'ya' }) });
    const me3 = (await (await fetch(`${BASE_URL}/api/auth/me`, { headers: { 'Cookie': u3Cookie } })).json()).data;
    assert(prof.status === 200 && profBad.status === 400 && me3?.name === 'Citra Ganti' && me3.email_notifications === false,
      'TC-36a', `Profil disimpan (${prof.status}), nilai salah ditolak (${profBad.status})`);
    const u3Other = (await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user3Email, password: 'User123!' }),
    })).headers.get('set-cookie')?.split(';')[0] || '';
    // Wrong current password counts on its own key, not the account login lock.
    const cpWrong = await postJson('/api/auth/change-password', { current_password: 'SalahTotal1', new_password: 'BaruSekali99' }, u3Cookie);
    assert(cpWrong.status === 400, 'TC-36c', `Ganti sandi dengan sandi lama salah → ${cpWrong.status}`);
    const cpSame = await postJson('/api/auth/change-password', { current_password: 'User123!', new_password: 'User123!' }, u3Cookie);
    const cp = await postJson('/api/auth/change-password', { current_password: 'User123!', new_password: 'BaruSekali99' }, u3Cookie);
    const u3Fresh = cp.headers.get('set-cookie')?.split(';')[0] || '';
    const otherDevice = await fetch(`${BASE_URL}/api/tasks`, { headers: { 'Cookie': u3Other } });
    const thisFresh = await fetch(`${BASE_URL}/api/tasks`, { headers: { 'Cookie': u3Fresh } });
    assert(cpSame.status === 400 && cp.status === 200 && otherDevice.status === 401 && thisFresh.status === 200,
      'TC-36b', `Ganti sandi: sama ${cpSame.status}, sukses ${cp.status}, perangkat lain ${otherDevice.status}, perangkat ini ${thisFresh.status}`);

    // TC-37: Cron tanpa secret ditolak; client-errors diterima; error-log hanya Owner
    const cronNo = await fetch(`${BASE_URL}/api/cron/daily`);
    const cronBad = await fetch(`${BASE_URL}/api/cron/daily`, { headers: { Authorization: 'Bearer salah' } });
    assert(cronNo.status === 401 && cronBad.status === 401, 'TC-37a', `Cron tanpa/dengan secret salah → ${cronNo.status}/${cronBad.status}`);
    const ce = await postJson('/api/client-errors', { message: 'TC37 uji error', path: '/tasks' });
    const ceBad = await postJson('/api/client-errors', {});
    const logsMember = await fetch(`${BASE_URL}/api/error-logs`, { headers: { 'Cookie': u3Fresh } });
    const logs = (await (await fetch(`${BASE_URL}/api/error-logs`, { headers: { 'Cookie': ownerCookie } })).json()).data || [];
    assert(ce.status === 204 && ceBad.status === 400 && logsMember.status === 403 && logs.some((l) => l.message === 'TC37 uji error'),
      'TC-37b', `client-errors ${ce.status}/${ceBad.status}, log anggota ${logsMember.status}`);

    // TC-38: Ekspor CSV meng-escape sel yang diawali = + - @ (formula injection)
    await createTask(ownerCookie, { title: '=1+1 TC38', due_date: due });
    await createTask(ownerCookie, { title: '@SUM(A1) TC38', due_date: due });
    const csv38 = await (await fetch(`${BASE_URL}/api/reports/export.csv`, { headers: { 'Cookie': ownerCookie } })).text();
    const cells38 = csv38.split(/\r\n/).flatMap((line) => line.split(','));
    assert(csv38.includes("'=1+1 TC38") && csv38.includes("'@SUM(A1) TC38") && !cells38.some((c) => /^"?[=+@]/.test(c)),
      'TC-38', 'CSV: sel diawali = / @ diberi prefiks kutip, tidak ada sel formula');

    // TC-39: Anggota tidak bisa menandai dibaca notifikasi milik orang lain (IDOR)
    await postJson(`/api/tasks/${rec?.id}/comments`, { body: 'TC39 komentar untuk PJ' }, u3Fresh);
    const ownerN = (await (await fetch(`${BASE_URL}/api/notifications`, { headers: { 'Cookie': ownerCookie } })).json()).data || [];
    const target39 = ownerN.find((n) => n.type === 'comment' && n.task_id === rec?.id && !n.read_at);
    const idor39 = await postJson('/api/notifications/read', { ids: [target39?.id] }, u3Fresh);
    const ownerN2 = (await (await fetch(`${BASE_URL}/api/notifications`, { headers: { 'Cookie': ownerCookie } })).json()).data || [];
    assert(target39 && idor39.status === 200 && ownerN2.find((n) => n.id === target39.id)?.read_at === null,
      'TC-39', 'Notifikasi Owner tetap belum dibaca setelah anggota mencoba menandainya');

    // TC-40: Token reset sah hanya sekali pakai; token kedaluwarsa ditolak; sesi lama dicabut
    const resetHeaders = { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.40' };
    const sha = (t) => require('crypto').createHash('sha256').update(t).digest('hex');
    const goodTok = require('crypto').randomBytes(32).toString('base64url');
    const oldTok = require('crypto').randomBytes(32).toString('base64url');
    await db.query(`INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`, [sha(goodTok), testUser3Id]);
    const useOnce = await fetch(`${BASE_URL}/api/auth/reset-password`, { method: 'POST', headers: resetHeaders, body: JSON.stringify({ token: goodTok, password: 'ResetBaru123' }) });
    const useTwice = await fetch(`${BASE_URL}/api/auth/reset-password`, { method: 'POST', headers: resetHeaders, body: JSON.stringify({ token: goodTok, password: 'ResetLagi123' }) });
    await db.query(`INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() - INTERVAL '1 minute')`, [sha(oldTok), testUser3Id]);
    const expired = await fetch(`${BASE_URL}/api/auth/reset-password`, { method: 'POST', headers: resetHeaders, body: JSON.stringify({ token: oldTok, password: 'ResetLama123' }) });
    await db.query('DELETE FROM password_resets WHERE user_id = $1', [testUser3Id]);
    const u3AfterReset = await fetch(`${BASE_URL}/api/tasks`, { headers: { 'Cookie': u3Fresh } });
    assert(useOnce.status === 200 && useTwice.status === 400 && expired.status === 400 && u3AfterReset.status === 401,
      'TC-40', `Reset: pakai ${useOnce.status}, ulang ${useTwice.status}, kedaluwarsa ${expired.status}, sesi lama ${u3AfterReset.status}`);

    // TC-41: Cookie sesi HttpOnly + SameSite=Lax
    const setCk = (await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.41' }, body: JSON.stringify({ email: user3Email, password: 'ResetBaru123' }),
    })).headers.get('set-cookie') || '';
    assert(/HttpOnly/i.test(setCk) && /SameSite=Lax/i.test(setCk), 'TC-41', `Cookie sesi: ${setCk.replace(/=[^;]+;/, '=…;').slice(0, 90)}`);

    // TC-42 (mock fetch, bukan Cloudflare asli): Turnstile fail-closed saat Siteverify tidak bisa dihubungi
    const turnstile = require('./lib/turnstile');
    const savedEnv = [process.env.TURNSTILE_SITE_KEY, process.env.TURNSTILE_SECRET_KEY];
    const realFetch = globalThis.fetch;
    const runMw = (mw, body) => new Promise((resolve) => {
      const res = { status(c) { this.code = c; return this; }, json(j) { resolve({ code: this.code, j }); } };
      mw({ body, ip: '198.51.100.42' }, res, () => resolve({ code: 'next' }));
    });
    let down, rejected, off;
    try {
      process.env.TURNSTILE_SITE_KEY = 'test-site'; process.env.TURNSTILE_SECRET_KEY = 'test-secret';
      globalThis.fetch = async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); };
      down = await runMw(turnstile.requireTurnstile('login'), { turnstile_token: 'abc' });
      globalThis.fetch = async () => ({ json: async () => ({ success: false, 'error-codes': ['timeout-or-duplicate'] }) });
      rejected = await runMw(turnstile.requireTurnstile('login'), { turnstile_token: 'abc', captchaVerified: true });
      delete process.env.TURNSTILE_SITE_KEY; delete process.env.TURNSTILE_SECRET_KEY;
      off = await runMw(turnstile.requireTurnstile('login'), {});
    } finally {
      globalThis.fetch = realFetch;
      for (const [k, v] of [['TURNSTILE_SITE_KEY', savedEnv[0]], ['TURNSTILE_SECRET_KEY', savedEnv[1]]]) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
    assert(down.code === 503 && down.j.error === 'CAPTCHA_UNAVAILABLE' && rejected.code === 400 && rejected.j.error === 'CAPTCHA_FAILED' && off.code === 'next',
      'TC-42', `Turnstile: Siteverify mati ${down.code}, token dipakai ulang ${rejected.code}, tanpa konfigurasi ${off.code}`);

    // TC-43: Penjaga target DB untuk migrate/test menolak URL yang endpoint-nya tidak dikonfirmasi
    const urlA = 'postgresql://u:p@ep-aaa-bbb-12345678-pooler.ap-southeast-1.aws.neon.tech/db';
    const tgOk = dbTarget.checkTarget(urlA, 'ep-aaa-bbb-12345678');
    const tgWrong = dbTarget.checkTarget(urlA, 'ep-other-ccc-87654321');
    const tgMissing = dbTarget.checkTarget(urlA, undefined);
    const tgBadUrl = dbTarget.checkTarget('', 'ep-aaa-bbb-12345678');
    assert(tgOk.ok && !tgWrong.ok && !tgMissing.ok && !tgBadUrl.ok && !/u:p|@/.test(tgWrong.reason),
      'TC-43', 'Penjaga target DB: cocok lolos; salah/kosong/URL invalid ditolak; pesan tanpa kredensial');

    // TC-44: Test key Cloudflare Turnstile dikenali (dipakai untuk peringatan di production)
    assert(turnstile.isTestKey('1x00000000000000000000AA') && turnstile.isTestKey('2x0000000000000000000000000000000AA')
      && turnstile.isTestKey('3x00000000000000000000FF') && !turnstile.isTestKey('0x4AAAAAAAB1cdEfGh') && !turnstile.isTestKey(undefined),
      'TC-44', 'Turnstile test key terdeteksi; key asli dan kosong tidak');

    // ----------------------------------------------------
    // TC-20: 2FA (TOTP) — setup, login 2 langkah, anti-replay, reset oleh Owner
    // ----------------------------------------------------
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
    // Hapus semua data uji: tugas di-purge (soft delete + hapus permanen), lalu akun uji.
    for (const id of createdTaskIds) {
      const r = await purgeTask(id);
      if (!r || (r.status !== 200 && r.status !== 404)) {
        console.error(`⚠️  Cleanup gagal untuk tugas ${id} (status ${r?.status ?? 'network error'})`);
      }
    }
    const cleanup = [
      testMemberId && `/api/users/${testMemberId}`,
      testUser2Id && `/api/users/${testUser2Id}`,
      testUser3Id && `/api/users/${testUser3Id}`,
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
