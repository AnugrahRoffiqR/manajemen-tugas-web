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

  const toast = document.createElement('div');
  toast.className = 'toast';

  const icons = {
    success: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    error: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    warning: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  };

  const colors = {
    success: '#22c55e',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#0080ff',
  };

  toast.innerHTML = `
    <span style="display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:50%; background:${colors[type]}22; color:${colors[type]}; font-weight:bold; font-size:12px;">
      ${icons[type] || '•'}
    </span>
    <span style="flex:1; color:var(--text); font-weight:600;">${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-8px) scale(0.96)';
    toast.style.transition = 'transform 160ms cubic-bezier(0.23, 1, 0.32, 1), opacity 160ms cubic-bezier(0.23, 1, 0.32, 1)';
    setTimeout(() => toast.remove(), 160);
  }, 3500);
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
    const data = await response.json();

    if (!response.ok) {
      if (response.status === 401 && !window.location.pathname.includes('/login')) {
        showToast('Sesi Anda telah berakhir. Mengalihkan ke halaman login...', 'warning');
        setTimeout(() => {
          window.location.href = '/login';
        }, 1200);
        return null;
      }
      throw new Error(data.message || 'Terjadi kesalahan sistem.');
    }

    return data;
  } catch (err) {
    showToast(err.message, 'error');
    throw err;
  }
}

// Format Tanggal WIB (Indonesia)
function formatDateWIB(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date) + ' WIB';
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

// Debounce helper
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// User Logout
async function handleLogout() {
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
