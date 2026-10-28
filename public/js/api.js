/**
 * API.JS — Client-side REST API Wrapper & Global Utilities
 */

// Global Toast System
function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  if (!container.hasAttribute('role')) {
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = {
    success: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    error: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    warning: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  };

  toast.innerHTML = `<span class="toast-icon" aria-hidden="true">${icons[type] || icons.info}</span><span style="flex:1;"></span>`;
  // Message may contain server/user text — never parse it as HTML.
  toast.lastElementChild.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-8px) scale(0.96)';
    toast.style.transition = 'transform 160ms cubic-bezier(0.23, 1, 0.32, 1), opacity 160ms cubic-bezier(0.23, 1, 0.32, 1)';
    setTimeout(() => toast.remove(), 160);
  }, 3500);
}

// Escape user-controlled text before interpolating into innerHTML templates.
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Shared deadline badge for task rows/cards (overdue or < 24h).
function deadlineBadge(dueDate) {
  const diffHours = (new Date(dueDate) - new Date()) / 3600000;
  if (diffHours < 0) return `<span class="badge badge-overdue">${formatHoursRemaining(diffHours)}</span>`;
  if (diffHours < 24) return `<span class="badge badge-urgent">${formatHoursRemaining(diffHours)}</span>`;
  return '';
}

// Shown to the Owner (and the reporter) while a member's "Lapor selesai" waits for review.
function reportedBadge(task) {
  if (!task.done_reported_at || task.status === 'Done') return '';
  const who = task.done_reported_by_name ? ` oleh ${escapeHtml(task.done_reported_by_name.split(' ')[0])}` : '';
  return `<span class="badge badge-reported" title="Dilaporkan ${formatDateWIB(task.done_reported_at)}">Dilaporkan selesai${who}</span>`;
}

const isOwnerView = () => document.body.dataset.role === 'Owner';

// Penanggung Jawab is always an active Owner; names are listed as-is since every option is an Owner.
async function fillAssigneeSelect(select, selectedId) {
  if (!select.options.length) {
    const res = await apiFetch('/api/users');
    select.innerHTML = (res.data || [])
      .filter((u) => u.status === 'Active' && u.role === 'Owner')
      .map((u) => `<option value="${Number(u.id)}">${escapeHtml(u.name)}</option>`)
      .join('');
  }
  if (selectedId) select.value = String(selectedId);
}

// Checkbox list of active members for task assignment. No box ticked = every member may work on it.
let activeMembersCache = null;
async function fillMemberPicker(container, selectedIds = []) {
  if (!activeMembersCache) {
    const res = await apiFetch('/api/users');
    activeMembersCache = (res.data || []).filter((u) => u.status === 'Active' && u.role === 'User');
  }
  const selected = new Set(selectedIds.map(Number));
  container.innerHTML = activeMembersCache.length
    ? activeMembersCache.map((u) => `
        <label class="check-row">
          <input type="checkbox" name="member_ids" value="${Number(u.id)}" ${selected.has(Number(u.id)) ? 'checked' : ''}>
          <span>${escapeHtml(u.name)}</span>
        </label>`).join('')
    : '<p class="field-hint">Belum ada anggota aktif. Tugas tetap bisa dibuat.</p>';
}

function pickedMemberIds(container) {
  return [...container.querySelectorAll('input[name="member_ids"]:checked')].map((el) => Number(el.value));
}

const RECURRENCE_LABEL = { daily: 'Harian', weekly: 'Mingguan', monthly: 'Bulanan' };

// "Semua anggota" or the assigned members' first names.
function membersLabel(task) {
  const members = task.members || [];
  if (!members.length) return 'Semua anggota';
  return members.map((m) => m.name.split(' ')[0]).join(', ');
}

// Reminder recipients: "Semua anggota" plus each active member.
async function fillMemberSelect(select) {
  const res = await apiFetch('/api/users');
  const members = (res.data || []).filter((u) => u.status === 'Active' && u.role === 'User');
  select.innerHTML = `<option value="all">Semua anggota (${members.length})</option>`
    + members.map((u) => `<option value="${Number(u.id)}">${escapeHtml(u.name)}</option>`).join('');
  return members.length;
}

// Global API Fetch
async function apiFetch(endpoint, options = {}) {
  const defaultHeaders = {
    'Content-Type': 'application/json',
  };

  const config = {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  };

  try {
    const response = await fetch(endpoint, config);
    // Tolerate non-JSON bodies (proxy/platform error pages) instead of throwing a parse error.
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 401 && !window.location.pathname.includes('/login')) {
        showToast(data.message || 'Sesi Anda telah berakhir. Mengalihkan ke halaman login...', 'warning');
        setTimeout(() => {
          window.location.href = '/login';
        }, 1200);
        // Throw (not return null) so callers reading res.data stop cleanly instead of crashing.
        const sessionErr = new Error('SESSION_EXPIRED');
        sessionErr.handled = true;
        throw sessionErr;
      }
      throw new Error(data.message || 'Terjadi kesalahan sistem.');
    }

    return data;
  } catch (err) {
    if (!err.handled) {
      showToast(err instanceof TypeError ? 'Gagal terhubung ke server. Periksa koneksi internet Anda.' : err.message, 'error');
    }
    throw err;
  }
}

// Format Tanggal WIB (Indonesia)
function formatDateWIB(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta', // label says WIB, so format in WIB regardless of the device zone
  }).format(date) + ' WIB';
}

// <input type="datetime-local"> has no zone; send an absolute ISO time so a UTC server stores the right instant.
function localInputToISO(value) {
  if (!value) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

// Format Sisa Waktu Deadline
function formatHoursRemaining(hoursLeft) {
  const h = parseFloat(hoursLeft);
  if (isNaN(h)) return '-';
  if (h < 0) {
    const absH = Math.abs(h);
    if (absH >= 24) {
      const days = Math.floor(absH / 24);
      return `Terlambat ${days} hari`;
    }
    return `Terlambat ${Math.round(absH)} jam`;
  } else if (h === 0) {
    return 'Jatuh tempo sekarang';
  } else if (h < 24) {
    return `Sisa ${Math.round(h)} jam lagi`;
  } else {
    const days = Math.floor(h / 24);
    return `Sisa ${days} hari lagi`;
  }
}

// Replace stale "Memuat…" placeholders with an error and a retry button after a failed load.
function showLoadError(selectors, retryFnName, err) {
  if (err?.handled) return; // session expired: already redirecting to /login
  const retry = retryFnName
    ? ` <button type="button" class="btn-secondary btn-sm" data-click="${escapeHtml(retryFnName)}">Coba lagi</button>`
    : '';
  selectors.forEach((sel) => {
    const el = document.querySelector(sel);
    if (!el || !/Memuat|Memeriksa/.test(el.textContent)) return;
    const html = `<span>Gagal memuat data.</span>${retry}`;
    if (el.tagName === 'TBODY') {
      const cols = el.closest('table')?.querySelectorAll('thead th').length || 1;
      el.innerHTML = `<tr><td colspan="${cols}" class="loading-text">${html}</td></tr>`;
    } else if (el.tagName === 'P') {
      el.innerHTML = html; // <p> cannot contain a <div>
    } else {
      el.innerHTML = `<div class="chart-empty">${html}</div>`;
    }
  });
}

// Debounce helper
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// Delegated event handlers (CSP forbids inline on*= attributes).
// Markup: data-click="fnName" data-args='[1,"Done"]'. The function must be a global;
// it receives only the parsed args (so default parameters still apply), with `this` = the element.
function bindDelegatedEvents() {
  const dispatch = (attr) => (event) => {
    const el = event.target.closest(`[${attr}]`);
    if (!el) return;
    const fn = window[el.getAttribute(attr)];
    if (typeof fn !== 'function') {
      console.error(`Handler tidak ditemukan: ${el.getAttribute(attr)}`);
      return;
    }
    let args = [];
    try { args = JSON.parse(el.dataset.args || '[]'); } catch { /* malformed args: call without them */ }
    fn.apply(el, args);
  };
  document.addEventListener('click', dispatch('data-click'));
  document.addEventListener('change', dispatch('data-change'));
  document.addEventListener('input', dispatch('data-input'));
}
bindDelegatedEvents();

// Browser errors go to /api/client-errors (Owner sees them on the Akun page). Capped per page load.
(function reportClientErrors() {
  let sent = 0;
  const send = (message, stack) => {
    if (sent >= 5 || !message) return;
    sent += 1;
    fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: String(message).slice(0, 1000), stack: stack ? String(stack).slice(0, 4000) : null, path: location.pathname }),
      keepalive: true,
    }).catch(() => {});
  };
  window.addEventListener('error', (e) => {
    if (e.target && e.target !== window) return; // failed <img>/<script> loads: not code errors
    if (/^ResizeObserver loop/.test(e.message || '')) return; // benign browser notice (charts resizing)
    send(e.message, e.error?.stack || `${e.filename}:${e.lineno}:${e.colno}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    // Handled API failures already showed a toast; only report real bugs.
    if (r?.handled || r instanceof TypeError && /fetch/i.test(r.message)) return;
    if (r instanceof Error && !(r instanceof TypeError || r instanceof ReferenceError || r instanceof SyntaxError || r instanceof RangeError)) return;
    send(r?.message || String(r), r?.stack);
  });
})();

// User Logout
async function handleLogout() {
  try { sessionStorage.removeItem('role'); } catch { /* storage blocked */ }
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
    showToast('Berhasil keluar. Sampai jumpa!', 'success');
    setTimeout(() => {
      window.location.href = '/login';
    }, 800);
  } catch (err) {
    window.location.href = '/login';
  }
}
