initNavigation('users');

let allUsersList = [];
let loggedInUser = null;

const ICON_EDIT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
const ICON_TRASH = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

async function loadUsersData() {
  try {
    const meRes = await fetch('/api/auth/me');
    if (meRes.ok) {
      const d = await meRes.json();
      loggedInUser = d.data;
      if (loggedInUser.role !== 'Owner') {
        showToast('Akses ditolak. Halaman ini hanya untuk Owner.', 'error');
        setTimeout(() => window.location.href = '/dashboard', 1000);
        return;
      }
    }

    const res = await apiFetch('/api/users');
    if (res && res.data) {
      allUsersList = res.data;
      renderUsersTable(allUsersList);
      renderResetRequests(allUsersList);
    }
    loadLoginEvents();
  } catch (err) {
    showLoadError(['#users-table-rows'], 'loadUsersData', err);
  }
}

const LOGIN_REASONS = {
  OK: ['Berhasil', 'badge-done'],
  WRONG_PASSWORD: ['Kata sandi salah', 'badge-overdue'],
  UNKNOWN_EMAIL: ['Email tidak terdaftar', 'badge-overdue'],
  INACTIVE: ['Akun nonaktif', 'badge-todo'],
  WRONG_2FA: ['Kode 2FA salah', 'badge-overdue'],
  RESET_REQUESTED: ['Minta reset sandi', 'badge-todo'],
  PASSWORD_RESET: ['Sandi direset via email', 'badge-done'],
  RESET_MAIL_FAILED: ['Email reset gagal terkirim', 'badge-urgent'],
};

// Short, readable device label from the user-agent string.
function describeDevice(ua) {
  if (!ua) return '–';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : null;
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : null;
  return browser || os ? [browser, os].filter(Boolean).join(' · ') : ua.slice(0, 40);
}

async function loadLoginEvents() {
  const tbody = document.getElementById('login-events-rows');
  try {
    const res = await apiFetch('/api/login-events');
    const events = res.data || [];
    if (!events.length) {
      tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state-box compact">Belum ada percobaan login tercatat.</div></td></tr>';
      return;
    }
    tbody.innerHTML = events.map(e => {
      const [label, cls] = LOGIN_REASONS[e.reason] || [e.success ? 'Berhasil' : 'Gagal', e.success ? 'badge-done' : 'badge-overdue'];
      return `
        <tr>
          <td class="nowrap font-mono muted" style="font-size: 0.8125rem;">${formatDateWIB(e.created_at)}</td>
          <td style="overflow-wrap: anywhere;">${escapeHtml(e.email)}</td>
          <td><span class="badge ${cls}">${label}</span></td>
          <td class="nowrap font-mono" style="font-size: 0.8125rem;">${escapeHtml(e.ip || '–')}</td>
          <td class="muted" title="${escapeHtml(e.user_agent || '')}">${escapeHtml(describeDevice(e.user_agent))}</td>
        </tr>`;
    }).join('');
  } catch (err) {
    showLoadError(['#login-events-rows'], 'loadLoginEvents', err);
  }
}

function renderUsersTable(users) {
  const tbody = document.getElementById('users-table-rows');
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state-box compact">Belum ada pengguna tercatat.</div></td></tr>';
    return;
  }

  tbody.innerHTML = users.map(u => {
    const id = Number(u.id);
    const name = escapeHtml(u.name);
    const isSelf = loggedInUser && loggedInUser.id === u.id;
    const isOwner = u.role === 'Owner';
    const active = u.status === 'Active';
    const total = parseInt(u.total_tasks, 10) || 0;
    const done = parseInt(u.completed_tasks, 10) || 0;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    return `
      <tr>
        <td>
          <div style="display: flex; align-items: center; gap: 0.75rem; min-width: 220px;">
            <span class="avatar${isOwner ? '' : ' avatar-muted'}" aria-hidden="true">${escapeHtml(u.name.charAt(0).toUpperCase())}</span>
            <div style="min-width: 0;">
              <p style="font-weight: 600; overflow-wrap: anywhere;">${name}${isSelf ? ' <span class="muted" style="font-weight: 500; font-size: 0.75rem;">(Anda)</span>' : ''}</p>
              <p class="cell-sub" style="overflow-wrap: anywhere;">${escapeHtml(u.email)}</p>
            </div>
          </div>
        </td>
        <td><span class="badge ${isOwner ? 'badge-in-progress' : 'badge-todo'}">${escapeHtml(u.role)}</span></td>
        <td class="nowrap">
          <span class="badge ${active ? 'badge-done' : 'badge-overdue'}">${escapeHtml(u.status)}</span>
          ${u.totp_enabled ? '<span class="badge badge-in-progress" title="Verifikasi dua langkah aktif">2FA</span>' : ''}
        </td>
        <td>
          <div style="width: 110px;">
            <div class="bar-row-head font-mono" style="font-size: 0.75rem; margin-bottom: 4px;">
              <span>${done}/${total}</span><span class="muted">${pct}%</span>
            </div>
            <div class="bar-track" style="height: 6px;"><div class="bar-fill" style="width: ${pct}%; background: var(--primary);"></div></div>
          </div>
        </td>
        <td class="nowrap font-mono muted" style="font-size: 0.8125rem;">${formatDateWIB(u.created_at)}</td>
        <td class="right">
          <div class="cell-actions">
            <button type="button" data-click="openEditUserModal" data-args='[${id}]' class="btn-action-icon" aria-label="Edit akun: ${name}" title="Edit">${ICON_EDIT}</button>
            ${isSelf ? '' : `<button type="button" data-click="deleteUserAccount" data-args='[${id}]' class="btn-action-icon is-danger" aria-label="Hapus akun: ${name}" title="Hapus">${ICON_TRASH}</button>`}
          </div>
        </td>
      </tr>`;
  }).join('');
}

function renderResetRequests(users) {
  const pending = users.filter(u => u.reset_requested_at);
  document.getElementById('reset-requests').classList.toggle('hidden', !pending.length);
  document.getElementById('reset-requests-list').innerHTML = pending.map(u => {
    const id = Number(u.id);
    const name = escapeHtml(u.name);
    return `
      <li class="reset-item">
        <div style="min-width: 0;">
          <p style="font-weight: 600; overflow-wrap: anywhere;">${name}</p>
          <p class="cell-sub" style="overflow-wrap: anywhere;">${escapeHtml(u.email)} · ${formatDateWIB(u.reset_requested_at)}</p>
        </div>
        <div class="reset-item-actions">
          <button type="button" data-click="dismissResetRequest" data-args='[${id}]' class="btn-secondary btn-sm" aria-label="Abaikan permintaan: ${name}">Abaikan</button>
          <button type="button" data-click="openResetPassword" data-args='[${id}]' class="btn-primary btn-sm" aria-label="Atur kata sandi baru: ${name}">Atur sandi baru</button>
        </div>
      </li>`;
  }).join('');
}

function openResetPassword(id) {
  openEditUserModal(id);
  document.getElementById('edit-user-password').focus();
}

async function dismissResetRequest(id) {
  try {
    const res = await apiFetch(`/api/users/${id}/reset-request`, { method: 'DELETE' });
    showToast(res.message, 'info');
    loadUsersData();
  } catch (err) {}
}

function openModal(id, focusId) {
  document.body.classList.add('modal-open');
  document.getElementById(id).classList.add('active');
  document.getElementById(focusId).focus();
}

function closeModal(id) {
  document.body.classList.remove('modal-open');
  document.getElementById(id).classList.remove('active');
}

// Modal Add
function openAddUserModal() {
  document.getElementById('add-user-form').reset();
  openModal('add-user-modal', 'new-user-name');
}
function closeAddUserModal() { closeModal('add-user-modal'); }

document.getElementById('add-user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const saveBtn = document.getElementById('save-user-btn');
  saveBtn.disabled = true;

  const name = document.getElementById('new-user-name').value;
  const email = document.getElementById('new-user-email').value;
  const password = document.getElementById('new-user-password').value;
  const role = document.getElementById('new-user-role').value;

  try {
    await apiFetch('/api/users', {
      method: 'POST',
      body: JSON.stringify({ name, email, password, role }),
    });
    showToast('Akun anggota tim berhasil dibuat!', 'success');
    closeAddUserModal();
    loadUsersData();
  } catch (err) {
  } finally {
    saveBtn.disabled = false;
  }
});

// Modal Edit
function openEditUserModal(id) {
  const user = allUsersList.find(u => u.id === id);
  if (!user) return;

  document.getElementById('edit-user-id').value = user.id;
  document.getElementById('edit-user-name').value = user.name;
  document.getElementById('edit-user-role').value = user.role;
  document.getElementById('edit-user-status').value = user.status;
  document.getElementById('edit-user-password').value = '';

  // Proteksi self-lockout di UI
  const isSelf = loggedInUser && loggedInUser.id === user.id;
  document.getElementById('edit-user-role').disabled = isSelf;
  document.getElementById('edit-user-status').disabled = isSelf;
  document.getElementById('self-lock-hint').classList.toggle('hidden', !isSelf);
  // Own 2FA is managed on /account (needs password + code), not reset from here.
  document.getElementById('reset-2fa-row').classList.toggle('hidden', isSelf || !user.totp_enabled);

  openModal('edit-user-modal', 'edit-user-name');
}
function closeEditUserModal() { closeModal('edit-user-modal'); }

async function resetUserTwoFactor() {
  const id = Number(document.getElementById('edit-user-id').value);
  const user = allUsersList.find(u => u.id === id);
  if (!user || !confirm(`Reset 2FA untuk ${user.name}? Akun ini akan dikeluarkan dan bisa login hanya dengan kata sandi sampai 2FA diaktifkan lagi.`)) return;
  try {
    const res = await apiFetch(`/api/users/${id}/reset-2fa`, { method: 'POST' });
    showToast(res.message, 'success');
    closeEditUserModal();
    loadUsersData();
  } catch (err) {}
}

document.getElementById('edit-user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const updateBtn = document.getElementById('update-user-btn');
  updateBtn.disabled = true;

  const id = document.getElementById('edit-user-id').value;
  const name = document.getElementById('edit-user-name').value;
  const role = document.getElementById('edit-user-role').value;
  const status = document.getElementById('edit-user-status').value;
  const password = document.getElementById('edit-user-password').value;

  try {
    await apiFetch(`/api/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name, role, status, password }),
    });
    showToast('Data pengguna berhasil diperbarui!', 'success');
    closeEditUserModal();
    loadUsersData();
  } catch (err) {
  } finally {
    updateBtn.disabled = false;
  }
});

// Name looked up by id — never interpolated into an inline handler.
async function deleteUserAccount(id) {
  const user = allUsersList.find(u => u.id === id);
  if (!user) return;
  if (!confirm(`Hapus akun ${user.name} secara permanen beserta seluruh tugasnya?`)) return;

  try {
    await apiFetch(`/api/users/${id}`, { method: 'DELETE' });
    showToast('Akun berhasil dihapus.', 'info');
    loadUsersData();
  } catch (err) {}
}

loadUsersData();
