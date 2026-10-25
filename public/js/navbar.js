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
      <aside style="width: 260px; height: 100vh; position: sticky; top: 0; background: var(--surface-shell); border-right: 1px solid var(--border-hairline); display: flex; flex-direction: column; justify-content: space-between; padding: 1.5rem 1rem;">
        <div>
          <!-- Brand Logo -->
          <div style="display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 0.5rem 1.75rem;">
            <div style="width: 38px; height: 38px; border-radius: 10px; background: linear-gradient(135deg, #3b82f6, #1d4ed8); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4); flex-shrink: 0;">
              <span style="color: #fff; font-weight: 800; font-size: 18px;">${ICONS.check}</span>
            </div>
            <div>
              <h2 style="font-size: 15px; font-weight: 700; color: #f8fafc; line-height: 1.2;">Manajemen Tugas</h2>
              <span style="font-size: 11px; color: #94a3b8; font-weight: 500;">Workspace Tim</span>
            </div>
          </div>

          <!-- Nav Links -->
          <nav style="display: flex; flex-direction: column; gap: 0.375rem;">
            <a href="/dashboard" class="nav-item ${activeKey === 'dashboard' ? 'active' : ''}">
              <span class="nav-icon">${ICONS.dashboard}</span>
              <span>Dashboard</span>
            </a>
            <a href="/tasks" class="nav-item ${activeKey === 'tasks' ? 'active' : ''}">
              <span class="nav-icon">${ICONS.tasks}</span>
              <span>Daftar Tugas</span>
            </a>
            <a href="/reminders" class="nav-item ${activeKey === 'reminders' ? 'active' : ''}" style="display: flex; justify-content: space-between; align-items: center;">
              <div style="display: flex; align-items: center; gap: 0.75rem;">
                <span class="nav-icon">${ICONS.reminders}</span>
                <span>Pengingat</span>
              </div>
              ${urgentCount > 0 ? `<span style="background: #ef4444; color: #fff; font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 999px;">${urgentCount}</span>` : ''}
            </a>
            <a href="/reports" class="nav-item ${activeKey === 'reports' ? 'active' : ''}">
              <span class="nav-icon">${ICONS.reports}</span>
              <span>Laporan Kinerja</span>
            </a>
            ${currentUser.role === 'Owner' ? `
            <a href="/users" class="nav-item ${activeKey === 'users' ? 'active' : ''}">
              <span class="nav-icon">${ICONS.users}</span>
              <span>Kelola Tim</span>
            </a>` : ''}
          </nav>
        </div>

        <!-- User Profile Card in Sidebar -->
        <div style="background: var(--surface-core); border: 1px solid var(--border-hairline); border-radius: 1rem; padding: 0.875rem; display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 0.625rem; overflow: hidden;">
            <div style="width: 34px; height: 34px; border-radius: 50%; background: #3b82f6; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; color: #fff; flex-shrink: 0;">
              ${currentUser.name.charAt(0).toUpperCase()}
            </div>
            <div style="overflow: hidden;">
              <p style="font-size: 13px; font-weight: 600; color: #f8fafc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${currentUser.name}</p>
              <span style="font-size: 11px; color: ${currentUser.role === 'Owner' ? '#60a5fa' : '#94a3b8'}; font-weight: 600;">${currentUser.role}</span>
            </div>
          </div>
          <button onclick="handleLogout()" title="Keluar dari akun" class="btn-action-icon" style="flex-shrink: 0; width: 32px; height: 32px;">
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
      <header style="display: flex; align-items: center; justify-content: space-between; padding: 0.875rem 1rem; background: var(--surface-shell); border-bottom: 1px solid var(--border-hairline); position: sticky; top: 0; z-index: 100;">
        <div style="display: flex; align-items: center; gap: 0.625rem;">
          <div style="width: 32px; height: 32px; border-radius: 8px; background: #3b82f6; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: bold;">
            ${ICONS.check}
          </div>
          <span style="font-weight: 700; font-size: 15px; color: #f8fafc;">Manajemen Tugas</span>
        </div>
        <div style="display: flex; align-items: center; gap: 0.625rem;">
          <span style="font-size: 12px; color: #cbd5e1; font-weight: 600;">${currentUser.name.split(' ')[0]}</span>
          <button onclick="handleLogout()" class="btn-action-icon" title="Keluar" style="width: 34px; height: 34px;">
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
      <nav style="position: fixed; bottom: 0; left: 0; right: 0; height: 60px; background: rgba(15, 23, 42, 0.95); border-top: 1px solid var(--border-hairline); display: flex; align-items: center; justify-content: space-around; z-index: 99; backdrop-filter: blur(16px);">
        <a href="/dashboard" class="mobile-nav-link ${activeKey === 'dashboard' ? 'active' : ''}">
          <span class="mobile-nav-icon">${ICONS.dashboard}</span>
          <span class="mobile-nav-label">Home</span>
        </a>
        <a href="/tasks" class="mobile-nav-link ${activeKey === 'tasks' ? 'active' : ''}">
          <span class="mobile-nav-icon">${ICONS.tasks}</span>
          <span class="mobile-nav-label">Tugas</span>
        </a>
        <a href="/reminders" class="mobile-nav-link ${activeKey === 'reminders' ? 'active' : ''}" style="position: relative;">
          <span class="mobile-nav-icon">${ICONS.reminders}</span>
          <span class="mobile-nav-label">Ingat</span>
          ${urgentCount > 0 ? `<span style="position: absolute; top: 8px; right: 25%; width: 8px; height: 8px; border-radius: 50%; background: #ef4444; box-shadow: 0 0 6px #ef4444;"></span>` : ''}
        </a>
        <a href="/reports" class="mobile-nav-link ${activeKey === 'reports' ? 'active' : ''}">
          <span class="mobile-nav-icon">${ICONS.reports}</span>
          <span class="mobile-nav-label">Rekap</span>
        </a>
        ${currentUser.role === 'Owner' ? `
        <a href="/users" class="mobile-nav-link ${activeKey === 'users' ? 'active' : ''}">
          <span class="mobile-nav-icon">${ICONS.users}</span>
          <span class="mobile-nav-label">Tim</span>
        </a>` : ''}
      </nav>
    `;
  }

  // 6. Global Modal Backdrop & Escape Key Listener
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const activeModal = document.querySelector('.modal-overlay.active');
      if (activeModal) {
        activeModal.classList.remove('active');
        document.body.classList.remove('modal-open');
      }
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
    gap: 0.75rem;
    padding: 0.625rem 0.875rem;
    border-radius: 0.75rem;
    color: var(--text-secondary);
    text-decoration: none;
    font-size: 0.875rem;
    font-weight: 500;
    transition: all 200ms ease;
  }
  .nav-item:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
  .nav-item.active {
    background: rgba(59, 130, 246, 0.16);
    color: #60a5fa;
    font-weight: 600;
    border: 1px solid rgba(59, 130, 246, 0.3);
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
    color: var(--text-tertiary);
    text-decoration: none;
    flex: 1;
    height: 100%;
    gap: 2px;
    transition: color 150ms ease;
  }
  .mobile-nav-link:hover, .mobile-nav-link.active {
    color: #60a5fa;
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
