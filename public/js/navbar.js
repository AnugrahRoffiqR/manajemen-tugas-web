/**
 * NAVBAR.JS — Universal Shell Navigation, Clean SVG Icons & Session Guard
 * Styles live in /css/style.css (.sidebar, .nav-item, .mobile-topbar, .bottom-nav).
 */

// Crisp SVG Icons (Lucide line style). Decorative: always rendered next to visible text or an aria-label.
const svg = (size, body) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS = {
  dashboard: svg(18, '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>'),
  tasks: svg(18, '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'),
  reminders: svg(18, '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
  reports: svg(18, '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>'),
  users: svg(18, '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  logout: svg(16, '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'),
  check: svg(18, '<polyline points="20 6 9 17 4 12"/>'),
  shield: svg(16, '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
  bell: svg(18, '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'),
  moon: svg(18, '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'),
};

// ------------------------------------------------------------------
// Notifications: bell panel, unread count, polling, browser Notification
// ------------------------------------------------------------------
const NOTIF_POLL_MS = 60000;
let notifItems = [];
let notifUser = null;

function notifHref(n) {
  if (n.type === 'reminder' && !n.task_id) return '/reminders';
  return n.task_id ? `/tasks?task=${Number(n.task_id)}` : '/tasks';
}

function relativeTime(date) {
  const mins = Math.round((Date.now() - new Date(date).getTime()) / 60000);
  if (mins < 1) return 'baru saja';
  if (mins < 60) return `${mins} menit lalu`;
  if (mins < 1440) return `${Math.round(mins / 60)} jam lalu`;
  return formatDateWIB(date);
}

function renderBell(unread) {
  document.querySelectorAll('[data-bell-count]').forEach((el) => {
    el.textContent = unread > 99 ? '99+' : String(unread);
    el.hidden = unread === 0;
  });
  document.querySelectorAll('[data-bell-btn]').forEach((btn) => {
    btn.setAttribute('aria-label', unread ? `Notifikasi, ${unread} belum dibaca` : 'Notifikasi');
  });
  const list = document.getElementById('bell-list');
  if (!list) return;
  list.innerHTML = notifItems.length
    ? notifItems.map((n) => `
        <li class="bell-item${n.read_at ? '' : ' unread'}">
          <a href="${notifHref(n)}" data-notif-id="${Number(n.id)}">
            <span class="dot" aria-hidden="true"></span>
            <span><span class="bell-title">${escapeHtml(n.title)}</span><span class="bell-time">${relativeTime(n.created_at)}${n.read_at ? '' : '<span class="sr-only">, belum dibaca</span>'}</span></span>
          </a>
        </li>`).join('')
    : '<li class="bell-empty">Belum ada notifikasi.</li>';
  const permBtn = document.getElementById('bell-permission');
  if (permBtn) permBtn.hidden = !('Notification' in window) || Notification.permission !== 'default';
}

async function showBrowserNotification(n) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const options = { body: 'Manajemen Tugas', icon: '/icons/icon-192.png', tag: `notif-${n.id}`, data: { url: notifHref(n) } };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return reg.showNotification(n.title, options);
    const note = new Notification(n.title, options);
    note.onclick = () => { window.focus(); window.location.href = notifHref(n); };
  } catch { /* some browsers only allow notifications from a service worker */ }
}

async function pollNotifications({ announce = true } = {}) {
  let res;
  try {
    res = await fetch('/api/notifications');
    if (!res.ok) return;
    res = await res.json();
  } catch { return; }
  notifItems = res.data || [];
  renderBell(res.meta?.unread || 0);

  // Announce only notifications newer than the last one this browser has seen.
  const key = `notif-last-${notifUser?.id}`;
  const maxId = notifItems.reduce((m, n) => Math.max(m, Number(n.id)), 0);
  let lastSeen = 0;
  try { lastSeen = Number(localStorage.getItem(key)) || 0; } catch { /* storage blocked */ }
  if (announce && lastSeen) {
    const fresh = notifItems.filter((n) => Number(n.id) > lastSeen && !n.read_at).reverse();
    fresh.slice(-3).forEach((n) => {
      if (document.hidden) showBrowserNotification(n);
      else showToast(n.title, 'info');
    });
  }
  if (maxId > lastSeen) { try { localStorage.setItem(key, String(maxId)); } catch { /* ignore */ } }
}

function placeBellPanel(panel, anchor) {
  const r = anchor.getBoundingClientRect();
  const w = panel.offsetWidth;
  const h = panel.offsetHeight;
  if (r.left < 320 && window.innerWidth >= 1024) {
    // Desktop sidebar: open to the right of the button.
    panel.style.left = `${Math.round(r.right + 12)}px`;
    panel.style.top = `${Math.round(Math.max(8, Math.min(r.top, window.innerHeight - h - 8)))}px`;
  } else {
    panel.style.top = `${Math.round(r.bottom + 8)}px`;
    panel.style.left = `${Math.round(Math.max(12, Math.min(r.right - w, window.innerWidth - w - 12)))}px`;
  }
}

function toggleBell() {
  const panel = document.getElementById('bell-panel');
  const open = panel.hidden;
  document.querySelectorAll('[data-bell-btn]').forEach((b) => b.setAttribute('aria-expanded', String(open)));
  if (!open) { panel.hidden = true; return; }
  panel.hidden = false;
  placeBellPanel(panel, this);
  panel.dataset.anchor = this.id;
  pollNotifications({ announce: false });
  panel.querySelector('a, button:not([hidden])')?.focus();
}

function closeBell(returnFocus) {
  const panel = document.getElementById('bell-panel');
  if (!panel || panel.hidden) return false;
  panel.hidden = true;
  document.querySelectorAll('[data-bell-btn]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  if (returnFocus) document.getElementById(panel.dataset.anchor)?.focus();
  return true;
}

async function markAllNotificationsRead() {
  try {
    await apiFetch('/api/notifications/read', { method: 'POST', body: '{}' });
    notifItems = notifItems.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() }));
    renderBell(0);
  } catch { /* toast already shown */ }
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  const result = await Notification.requestPermission();
  showToast(result === 'granted' ? 'Notifikasi browser aktif selama tab ini terbuka.' : 'Notifikasi browser tidak diizinkan.', result === 'granted' ? 'success' : 'warning');
  renderBell(notifItems.filter((n) => !n.read_at).length);
}

function mountBell(user) {
  notifUser = user;
  const panel = document.createElement('div');
  panel.id = 'bell-panel';
  panel.className = 'bell-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', 'bell-heading');
  panel.innerHTML = `
    <div class="bell-head">
      <h2 id="bell-heading">Notifikasi</h2>
      <button type="button" class="btn-ghost btn-sm" data-click="markAllNotificationsRead">Tandai semua dibaca</button>
    </div>
    <ul id="bell-list" class="bell-list"><li class="bell-empty">Memuat…</li></ul>
    <div class="bell-foot"><button type="button" id="bell-permission" class="btn-secondary btn-sm btn-block" data-click="requestNotificationPermission" hidden>Aktifkan notifikasi browser</button></div>`;
  document.body.appendChild(panel);

  // Mark one as read when it is opened (navigation continues normally).
  panel.addEventListener('click', (e) => {
    const link = e.target.closest('[data-notif-id]');
    if (!link) return;
    fetch('/api/notifications/read', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [Number(link.dataset.notifId)] }), keepalive: true,
    }).catch(() => {});
  });
  document.addEventListener('click', (e) => {
    if (panel.hidden || panel.contains(e.target) || e.target.closest('[data-bell-btn]')) return;
    closeBell(false);
  });
  window.addEventListener('resize', () => closeBell(false));

  pollNotifications();
  setInterval(() => { if (!document.hidden) pollNotifications(); }, NOTIF_POLL_MS);
  // Hidden tabs are throttled; poll less often but still announce via browser notification.
  setInterval(() => { if (document.hidden) pollNotifications(); }, NOTIF_POLL_MS * 2);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollNotifications(); });
}

const accountLink = (activeKey) => `
  <a href="/account" class="btn-action-icon${activeKey === 'account' ? ' active" aria-current="page' : ''}" title="Akun saya" aria-label="Akun saya">${ICONS.shield}</a>`;

// id must be unique per page: the sidebar and the mobile header both render a set.
const shellTools = (suffix) => `
  <button type="button" id="bell-btn-${suffix}" class="btn-action-icon bell-btn" data-bell-btn data-click="toggleBell" aria-haspopup="dialog" aria-expanded="false" aria-controls="bell-panel" aria-label="Notifikasi" title="Notifikasi">
    ${ICONS.bell}<span class="bell-count" data-bell-count hidden>0</span>
  </button>
  <button type="button" class="btn-action-icon" data-theme-toggle data-click="toggleTheme" aria-pressed="false" aria-label="Ganti tema">${ICONS.moon}</button>`;

const BRAND_HTML = `
  <div class="brand-mark">${ICONS.check}</div>
  <div>
    <div class="brand-name">Manajemen Tugas</div>
    <div class="brand-sub">Workspace Tim</div>
  </div>`;

async function initNavigation(activeKey = '') {
  // 1. Validasi Sesi Pengguna
  let currentUser = null;
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) {
      window.location.href = '/login';
      return;
    }
    const data = await res.json();
    currentUser = data.data;
  } catch (err) {
    window.location.href = '/login';
    return;
  }

  // CSS hides .owner-only / .member-only controls by role; the API enforces the same rules.
  document.body.dataset.role = currentUser.role;
  document.documentElement.dataset.role = currentUser.role;
  document.body.dataset.userId = currentUser.id;
  try { sessionStorage.setItem('role', currentUser.role); } catch { /* storage blocked */ }

  // 2. Cek Notifikasi Mendesak untuk Counter Badge
  let urgentCount = 0;
  try {
    const remRes = await fetch('/api/reminders/urgent');
    if (remRes.ok) {
      const remData = await remRes.json();
      urgentCount = (remData.data?.total_urgent || 0) + (remData.data?.total_overdue || 0);
    }
  } catch (e) {}

  const isOwner = currentUser.role === 'Owner';
  if (activeKey === 'reports' && !isOwner) {
    window.location.replace('/dashboard');
    return null;
  }
  const safeName = escapeHtml(currentUser.name);
  const initial = escapeHtml(currentUser.name.charAt(0).toUpperCase());
  const current = (key) => (activeKey === key ? ' active" aria-current="page' : '');

  const links = [
    { key: 'dashboard', href: '/dashboard', label: 'Dashboard', short: 'Home', shortcut: '1' },
    { key: 'tasks', href: '/tasks', label: 'Daftar Tugas', short: 'Tugas', shortcut: '2' },
    { key: 'reminders', href: '/reminders', label: 'Pengingat', short: 'Ingat', shortcut: '3' },
    ...(isOwner ? [
      { key: 'reports', href: '/reports', label: 'Laporan Kinerja', short: 'Rekap', shortcut: '4' },
      { key: 'users', href: '/users', label: 'Kelola Tim', short: 'Tim', shortcut: '5' },
    ] : []),
  ];

  // 3. Render Desktop Sidebar (>= 1024px)
  const sidebarContainer = document.getElementById('sidebar-container');
  if (sidebarContainer) {
    sidebarContainer.innerHTML = `
      <aside class="sidebar">
        <div>
          <div class="brand">${BRAND_HTML}</div>
          <div class="sidebar-tools">${shellTools('side')}</div>
          <nav class="nav-list" aria-label="Navigasi utama">
            ${links.map((l) => `
              <a href="${l.href}" class="nav-item${current(l.key)}" aria-keyshortcuts="${l.shortcut}">
                <span class="nav-icon">${ICONS[l.key]}</span>
                <span>${l.label}</span>
                ${l.key === 'reminders' && urgentCount > 0 ? `<span class="nav-count" aria-label="${urgentCount} tugas mendesak">${urgentCount}</span>` : ''}
              </a>`).join('')}
          </nav>
        </div>

        <div class="profile">
          <div class="avatar" aria-hidden="true">${initial}</div>
          <div class="profile-meta">
            <p class="profile-name">${safeName}</p>
            <span class="profile-role">${isOwner ? 'Owner' : 'User'}</span>
          </div>
          ${accountLink(activeKey)}
          <button type="button" data-click="handleLogout" title="Keluar dari akun" aria-label="Keluar dari akun" class="btn-action-icon">
            ${ICONS.logout}
          </button>
        </div>
      </aside>
    `;
  }

  // 4. Render Mobile Header Bar (< 1024px)
  const mobileHeader = document.getElementById('mobile-header');
  if (mobileHeader) {
    mobileHeader.innerHTML = `
      <header class="mobile-topbar">
        <div class="brand">${BRAND_HTML}</div>
        <div class="mobile-user">
          <span class="mobile-user-name">${escapeHtml(currentUser.name.split(' ')[0])}</span>
          ${shellTools('top')}
          ${accountLink(activeKey)}
          <button type="button" data-click="handleLogout" class="btn-action-icon" title="Keluar dari akun" aria-label="Keluar dari akun">
            ${ICONS.logout}
          </button>
        </div>
      </header>
    `;
  }

  // 5. Render Mobile Bottom Navigation (< 1024px)
  const mobileBottomNav = document.getElementById('mobile-bottom-nav');
  if (mobileBottomNav) {
    mobileBottomNav.innerHTML = `
      <nav class="bottom-nav" aria-label="Navigasi utama">
        ${links.map((l) => `
          <a href="${l.href}" class="mobile-nav-link${current(l.key)}">
            ${ICONS[l.key]}
            <span>${l.short}</span>
            ${l.key === 'reminders' && urgentCount > 0 ? `<span class="mobile-nav-dot"></span><span class="sr-only">${urgentCount} tugas mendesak</span>` : ''}
          </a>`).join('')}
      </nav>
    `;
  }

  window.syncThemeToggles?.();
  mountBell(currentUser);

  // 6. Global Shortcuts & Modal Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && closeBell(true)) return;
    // Tutup Modal via Escape
    if (e.key === 'Escape') {
      const activeModal = document.querySelector('.modal-overlay.active');
      if (activeModal) {
        activeModal.classList.remove('active');
        document.body.classList.remove('modal-open');
      }
    }

    // Shortcut hanya saat tidak mengetik dan tanpa modifier
    const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (isTyping || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.modal-overlay.active')) return;

    const target = links.find((l) => l.shortcut === e.key);
    if (target) window.location.href = target.href;
  });

  // Pages focus the first modal field synchronously on open, so remember the last focus outside any modal.
  let lastOutsideFocus = null;
  document.addEventListener('focusin', (e) => {
    if (!e.target.closest('.modal-overlay')) lastOutsideFocus = e.target;
  });
  // focusin is skipped when the window itself lacks focus, so also record the clicked control.
  document.addEventListener('click', (e) => {
    const control = e.target.closest?.('button, a, [tabindex]');
    if (control && !control.closest('.modal-overlay')) lastOutsideFocus = control;
  }, true);

  document.querySelectorAll('.modal-overlay').forEach((modal) => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('active');
        document.body.classList.remove('modal-open');
      }
    });

    // Return focus to whatever opened the modal, however it was closed (button, Escape, backdrop).
    let wasOpen = modal.classList.contains('active');
    new MutationObserver(() => {
      const isOpen = modal.classList.contains('active');
      if (wasOpen && !isOpen && lastOutsideFocus && document.contains(lastOutsideFocus)) {
        lastOutsideFocus.focus();
      }
      wasOpen = isOpen;
    }).observe(modal, { attributes: true, attributeFilter: ['class'] });
  });

  // Keep Tab cycling inside an open modal.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const modal = document.querySelector('.modal-overlay.active');
    if (!modal) return;
    const focusables = [...modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.disabled && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!modal.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  return currentUser;
}
