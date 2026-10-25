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
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ',
  };

  const colors = {
    success: '#10b981',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6',
  };

  toast.innerHTML = `
    <span style="display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:50%; background:${colors[type]}22; color:${colors[type]}; font-weight:bold; font-size:12px;">
      ${icons[type] || '•'}
    </span>
    <span style="flex:1; color:#f8fafc;">${message}</span>
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
