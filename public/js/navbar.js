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
};

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
  const safeName = escapeHtml(currentUser.name);
  const initial = escapeHtml(currentUser.name.charAt(0).toUpperCase());
  const current = (key) => (activeKey === key ? ' active" aria-current="page' : '');

  const links = [
    { key: 'dashboard', href: '/dashboard', label: 'Dashboard', short: 'Home', shortcut: '1' },
    { key: 'tasks', href: '/tasks', label: 'Daftar Tugas', short: 'Tugas', shortcut: '2' },
    { key: 'reminders', href: '/reminders', label: 'Pengingat', short: 'Ingat', shortcut: '3' },
    { key: 'reports', href: '/reports', label: 'Laporan Kinerja', short: 'Rekap', shortcut: '4' },
    ...(isOwner ? [{ key: 'users', href: '/users', label: 'Kelola Tim', short: 'Tim', shortcut: '5' }] : []),
  ];

  // 3. Render Desktop Sidebar (>= 1024px)
  const sidebarContainer = document.getElementById('sidebar-container');
  if (sidebarContainer) {
    sidebarContainer.innerHTML = `
      <aside class="sidebar">
        <div>
          <div class="brand">${BRAND_HTML}</div>
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
          <button type="button" onclick="handleLogout()" title="Keluar dari akun" aria-label="Keluar dari akun" class="btn-action-icon">
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
          <span>${escapeHtml(currentUser.name.split(' ')[0])}</span>
          <button type="button" onclick="handleLogout()" class="btn-action-icon" title="Keluar dari akun" aria-label="Keluar dari akun">
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

  // 6. Global Shortcuts & Modal Escape
  document.addEventListener('keydown', (e) => {
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

  document.querySelectorAll('.modal-overlay').forEach((modal) => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('active');
        document.body.classList.remove('modal-open');
      }
    });
  });
}
