/**
 * NAVBAR.JS — Universal Shell Navigation, Clean SVG Icons & Session Guard
 * Adheres to: antislop-ui, antislop-human (WCAG AA), high-end-visual-design
 */

// Crisp SVG Icons (Clean Phosphor/Lucide Line Style)
const ICONS = {
  dashboard: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>`,
  tasks: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
  reminders: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  reports: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
  users: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  logout: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
  check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
};

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

  // 3. Render Desktop Sidebar (>= 1024px)
  const sidebarContainer = document.getElementById('sidebar-container');
  if (sidebarContainer) {
    sidebarContainer.innerHTML = `
      <aside style="width: 260px; height: 100vh; position: sticky; top: 0; background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(16px); border-right: 1px solid rgba(0, 128, 255, 0.12); display: flex; flex-direction: column; justify-content: space-between; padding: 1.5rem 1rem;">
        <div>
          <!-- Brand Logo & Live Pulse Pill (UUPM SaaS Demo Standard) -->
          <div style="padding: 0.5rem 0.5rem 1.25rem;">
            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.875rem;">
              <div style="width: 40px; height: 40px; border-radius: 12px; background: linear-gradient(135deg, #0080ff, #8b00ff); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(0, 128, 255, 0.35); flex-shrink: 0;">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
              </div>
              <div>
                <h2 style="font-size: 16px; font-weight: 700; font-family: 'Poppins', sans-serif; line-height: 1.2;">
                  <span class="gradient-text">DataPulse</span>
                </h2>
                <span style="font-size: 11px; color: #64748b; font-weight: 500;">Manajemen Tugas</span>
              </div>
            </div>

            <!-- Workspace Status Pill with Pulse Ring -->
            <div style="display: inline-flex; align-items: center; gap: 8px; padding: 4px 10px; border-radius: 999px; background: rgba(0, 128, 255, 0.06); border: 1px solid rgba(0, 128, 255, 0.15); font-size: 11px; color: #334155; width: 100%;">
              <span style="position: relative; display: flex; width: 8px; height: 8px;">
                <span class="pulse-ring" style="position: absolute; display: inline-flex; width: 100%; height: 100%; border-radius: 50%; background: #22c55e; opacity: 0.75;"></span>
                <span style="position: relative; display: inline-flex; border-radius: 50%; width: 8px; height: 8px; background: #22c55e;"></span>
              </span>
              <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600;">Real-time Cloud Sync</span>
            </div>
          </div>

          <!-- Nav Links with Keyboard Shortcuts -->
          <nav style="display: flex; flex-direction: column; gap: 0.375rem;">
            <a href="/dashboard" class="nav-item ${activeKey === 'dashboard' ? 'active' : ''}">
              <div style="display: flex; align-items: center; gap: 0.75rem;">
                <span class="nav-icon">${ICONS.dashboard}</span>
                <span>Dashboard</span>
              </div>
              <kbd class="nav-kbd">1</kbd>
            </a>
            <a href="/tasks" class="nav-item ${activeKey === 'tasks' ? 'active' : ''}">
              <div style="display: flex; align-items: center; gap: 0.75rem;">
                <span class="nav-icon">${ICONS.tasks}</span>
                <span>Daftar Tugas</span>
              </div>
              <kbd class="nav-kbd">2</kbd>
            </a>
            <a href="/reminders" class="nav-item ${activeKey === 'reminders' ? 'active' : ''}" style="display: flex; justify-content: space-between; align-items: center;">
              <div style="display: flex; align-items: center; gap: 0.75rem;">
                <span class="nav-icon">${ICONS.reminders}</span>
                <span>Pengingat</span>
              </div>
              <div style="display: flex; align-items: center; gap: 6px;">
                ${urgentCount > 0 ? `<span style="background: #ef4444; color: #fff; font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 999px;">${urgentCount}</span>` : ''}
                <kbd class="nav-kbd">3</kbd>
              </div>
            </a>
            <a href="/reports" class="nav-item ${activeKey === 'reports' ? 'active' : ''}">
              <div style="display: flex; align-items: center; gap: 0.75rem;">
                <span class="nav-icon">${ICONS.reports}</span>
                <span>Laporan Kinerja</span>
              </div>
              <kbd class="nav-kbd">4</kbd>
            </a>
            ${currentUser.role === 'Owner' ? `
            <a href="/users" class="nav-item ${activeKey === 'users' ? 'active' : ''}">
              <div style="display: flex; align-items: center; gap: 0.75rem;">
                <span class="nav-icon">${ICONS.users}</span>
                <span>Kelola Tim</span>
              </div>
              <kbd class="nav-kbd">5</kbd>
            </a>` : ''}
          </nav>
        </div>

        <!-- User Profile Card in Sidebar -->
        <div style="background: #ffffff; border: 1px solid var(--border); border-radius: 1rem; padding: 0.875rem; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 2px 8px rgba(0, 128, 255, 0.05);">
          <div style="display: flex; align-items: center; gap: 0.625rem; overflow: hidden;">
            <div style="width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, #0080ff, #8b00ff); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; color: #fff; flex-shrink: 0; box-shadow: 0 2px 8px rgba(0, 128, 255, 0.3);">
              ${currentUser.name.charAt(0).toUpperCase()}
            </div>
            <div style="overflow: hidden;">
              <p style="font-size: 13px; font-weight: 700; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${currentUser.name}</p>
              <span style="font-size: 11px; color: ${currentUser.role === 'Owner' ? '#0080ff' : '#64748b'}; font-weight: 600;">${currentUser.role}</span>
            </div>
          </div>
          <button onclick="handleLogout()" title="Keluar dari akun" aria-label="Keluar dari akun" class="btn-action-icon" style="flex-shrink: 0; width: 34px; height: 34px;">
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
      <header style="display: flex; align-items: center; justify-content: space-between; padding: 0.875rem 1rem; background: rgba(255, 255, 255, 0.9); backdrop-filter: blur(12px); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 100;">
        <div style="display: flex; align-items: center; gap: 0.625rem;">
          <div style="width: 34px; height: 34px; border-radius: 10px; background: linear-gradient(135deg, #0080ff, #8b00ff); display: flex; align-items: center; justify-content: center; color: #fff; font-weight: bold; box-shadow: 0 2px 8px rgba(0, 128, 255, 0.3);">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
          </div>
          <span style="font-weight: 700; font-size: 15px; font-family: 'Poppins', sans-serif;" class="gradient-text">DataPulse</span>
        </div>
        <div style="display: flex; align-items: center; gap: 0.625rem;">
          <span style="font-size: 12px; color: #475569; font-weight: 600;">${currentUser.name.split(' ')[0]}</span>
          <button onclick="handleLogout()" class="btn-action-icon" title="Keluar dari akun" aria-label="Keluar dari akun" style="width: 34px; height: 34px;">
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
      <nav aria-label="Navigasi Utama Mobile" style="position: fixed; bottom: 0; left: 0; right: 0; height: calc(60px + env(safe-area-inset-bottom, 0px)); padding-bottom: env(safe-area-inset-bottom, 0px); background: rgba(255, 255, 255, 0.95); border-top: 1px solid var(--border); display: flex; align-items: center; justify-content: space-around; z-index: 99; backdrop-filter: blur(16px); box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.05);">
        <a href="/dashboard" class="mobile-nav-link ${activeKey === 'dashboard' ? 'active' : ''}" aria-label="Halaman Utama Dashboard">
          <span class="mobile-nav-icon">${ICONS.dashboard}</span>
          <span class="mobile-nav-label">Home</span>
        </a>
        <a href="/tasks" class="mobile-nav-link ${activeKey === 'tasks' ? 'active' : ''}" aria-label="Halaman Daftar Tugas">
          <span class="mobile-nav-icon">${ICONS.tasks}</span>
          <span class="mobile-nav-label">Tugas</span>
        </a>
        <a href="/reminders" class="mobile-nav-link ${activeKey === 'reminders' ? 'active' : ''}" aria-label="Halaman Pengingat Deadline" style="position: relative;">
          <span class="mobile-nav-icon">${ICONS.reminders}</span>
          <span class="mobile-nav-label">Ingat</span>
          ${urgentCount > 0 ? `<span style="position: absolute; top: 8px; right: 25%; width: 8px; height: 8px; border-radius: 50%; background: #ef4444; box-shadow: 0 0 6px #ef4444;"></span>` : ''}
        </a>
        <a href="/reports" class="mobile-nav-link ${activeKey === 'reports' ? 'active' : ''}" aria-label="Halaman Laporan Kinerja">
          <span class="mobile-nav-icon">${ICONS.reports}</span>
          <span class="mobile-nav-label">Rekap</span>
        </a>
        ${currentUser.role === 'Owner' ? `
        <a href="/users" class="mobile-nav-link ${activeKey === 'users' ? 'active' : ''}" aria-label="Halaman Kelola Tim">
          <span class="mobile-nav-icon">${ICONS.users}</span>
          <span class="mobile-nav-label">Tim</span>
        </a>` : ''}
      </nav>
    `;
  }

  // 6. Global Shortcuts & Modal Escape (web-design-guidelines & baseline-ui)
  document.addEventListener('keydown', (e) => {
    // Tutup Modal via Escape
    if (e.key === 'Escape') {
      const activeModal = document.querySelector('.modal-overlay.active');
      if (activeModal) {
        activeModal.classList.remove('active');
        document.body.classList.remove('modal-open');
      }
    }

    // Shortcut 'n' untuk buat tugas baru (kecuali sedang mengetik di input/textarea)
    const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (!isTyping) {
      if (e.key === 'n' || e.key === 'N') {
        const openModalFn = window.openTaskModal || window.openCreateTaskModal;
        if (typeof openModalFn === 'function') {
          e.preventDefault();
          openModalFn();
        }
      }
      // Quick Number Keys (1-5) for Page Navigation
      if (e.key === '1') window.location.href = '/dashboard';
      if (e.key === '2') window.location.href = '/tasks';
      if (e.key === '3') window.location.href = '/reminders';
      if (e.key === '4') window.location.href = '/reports';
      if (e.key === '5' && currentUser?.role === 'Owner') window.location.href = '/users';
    }
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

// Injeksi CSS Navigasi & Micro-Animations
const navStyle = document.createElement('style');
navStyle.textContent = `
  .nav-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.625rem 0.875rem;
    border-radius: 0.75rem;
    color: #475569;
    text-decoration: none;
    font-size: 0.875rem;
    font-weight: 500;
    border: 1px solid transparent;
    transition: all 140ms var(--ease-out);
  }
  .nav-item:hover {
    background: #f1f5f9;
    color: #0080ff;
  }
  .nav-item:active {
    transform: scale(0.97);
  }
  .nav-item.active {
    background: rgba(0, 128, 255, 0.08);
    color: #0080ff;
    font-weight: 700;
    border: 1px solid rgba(0, 128, 255, 0.2);
    border-left: 3px solid #0080ff;
  }
  .nav-kbd {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    font-weight: 600;
    color: #64748b;
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    padding: 1px 5px;
    border-radius: 4px;
  }
  .nav-item:hover .nav-kbd {
    color: #0080ff;
    background: #e2e8f0;
  }
  .nav-item.active .nav-kbd {
    color: #0080ff;
    border-color: rgba(0, 128, 255, 0.3);
    background: rgba(0, 128, 255, 0.12);
  }
  .nav-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
  }
  .mobile-nav-link {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #64748b;
    text-decoration: none;
    flex: 1;
    height: 100%;
    gap: 2px;
    transition: color 150ms ease;
  }
  .mobile-nav-link:hover, .mobile-nav-link.active {
    color: #0080ff;
  }
  .mobile-nav-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .mobile-nav-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
`;
document.head.appendChild(navStyle);
