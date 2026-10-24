/**
 * NAVBAR.JS — Universal Shell Navigation & Session Guard
 */

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

  // 2. Cek Notifikasi Mendesak untuk Badge Counter
  let urgentCount = 0;
  try {
    const remRes = await fetch('/api/reminders/urgent');
    if (remRes.ok) {
      const remData = await remRes.json();
      urgentCount = (remData.data.total_urgent || 0) + (remData.data.total_overdue || 0);
    }
  } catch (e) {}

  // 3. Render Desktop Sidebar (>= 1024px)
  const sidebarContainer = document.getElementById('sidebar-container');
  if (sidebarContainer) {
    sidebarContainer.innerHTML = `
      <aside style="width: 260px; height: 100vh; position: sticky; top: 0; background: var(--surface-shell); border-right: 1px solid var(--border-hairline); display: flex; flex-direction: column; justify-content: space-between; padding: 1.5rem 1rem;">
        <div>
          <!-- Brand Logo -->
          <div style="display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 0.75rem 1.75rem;">
            <div style="width: 38px; height: 38px; border-radius: 10px; background: linear-gradient(135deg, #3b82f6, #1d4ed8); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);">
              <span style="color: #fff; font-weight: 800; font-size: 18px;">✓</span>
            </div>
            <div>
              <h2 style="font-size: 15px; font-weight: 700; color: #f8fafc; line-height: 1.2;">Manajemen Tugas</h2>
              <span style="font-size: 11px; color: #64748b; font-weight: 500;">Workspace Tim</span>
            </div>
          </div>

          <!-- Nav Links -->
          <nav style="display: flex; flex-direction: column; gap: 0.375rem;">
            <a href="/dashboard" class="nav-item ${activeKey === 'dashboard' ? 'active' : ''}">
              <span class="nav-icon">📊</span>
              <span>Dashboard</span>
            </a>
            <a href="/tasks" class="nav-item ${activeKey === 'tasks' ? 'active' : ''}">
              <span class="nav-icon">📋</span>
              <span>Daftar Tugas</span>
            </a>
            <a href="/reminders" class="nav-item ${activeKey === 'reminders' ? 'active' : ''}" style="display: flex; justify-content: space-between; align-items: center;">
              <div style="display: flex; align-items: center; gap: 0.75rem;">
                <span class="nav-icon">⏰</span>
                <span>Pengingat</span>
              </div>
              ${urgentCount > 0 ? `<span style="background: #ef4444; color: #fff; font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 999px;">${urgentCount}</span>` : ''}
            </a>
            <a href="/reports" class="nav-item ${activeKey === 'reports' ? 'active' : ''}">
              <span class="nav-icon">📈</span>
              <span>Laporan Kinerja</span>
            </a>
            ${currentUser.role === 'Owner' ? `
            <a href="/users" class="nav-item ${activeKey === 'users' ? 'active' : ''}">
              <span class="nav-icon">👥</span>
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
          <button onclick="handleLogout()" title="Keluar dari akun" style="background: none; border: none; color: #94a3b8; cursor: pointer; padding: 6px; border-radius: 6px; transition: color 200ms;" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#94a3b8'">
            🚪
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
          <div style="width: 32px; height: 32px; border-radius: 8px; background: #3b82f6; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: bold; font-size: 16px;">
            ✓
          </div>
          <span style="font-weight: 700; font-size: 15px; color: #f8fafc;">Manajemen Tugas</span>
        </div>
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span style="font-size: 12px; color: #94a3b8; font-weight: 600;">${currentUser.name.split(' ')[0]}</span>
          <button onclick="handleLogout()" style="background: none; border: 1px solid var(--border-hairline); color: #94a3b8; border-radius: 8px; padding: 4px 8px; font-size: 12px; cursor: pointer;">
            Keluar
          </button>
        </div>
      </header>
    `;
  }

  // 5. Render Mobile Bottom Navigation (< 768px)
  const mobileBottomNav = document.getElementById('mobile-bottom-nav');
  if (mobileBottomNav) {
    mobileBottomNav.innerHTML = `
      <nav style="position: fixed; bottom: 0; left: 0; right: 0; height: 62px; background: var(--surface-shell); border-top: 1px solid var(--border-hairline); display: flex; align-items: center; justify-content: space-around; z-index: 99; backdrop-filter: blur(12px);">
        <a href="/dashboard" class="mobile-nav-link ${activeKey === 'dashboard' ? 'active' : ''}">
          <span style="font-size: 18px;">📊</span>
          <span style="font-size: 10px; font-weight: 600;">Home</span>
        </a>
        <a href="/tasks" class="mobile-nav-link ${activeKey === 'tasks' ? 'active' : ''}">
          <span style="font-size: 18px;">📋</span>
          <span style="font-size: 10px; font-weight: 600;">Tugas</span>
        </a>
        <a href="/reminders" class="mobile-nav-link ${activeKey === 'reminders' ? 'active' : ''}" style="position: relative;">
          <span style="font-size: 18px;">⏰</span>
          <span style="font-size: 10px; font-weight: 600;">Ingat</span>
          ${urgentCount > 0 ? `<span style="position: absolute; top: 6px; right: 10px; width: 8px; height: 8px; border-radius: 50%; background: #ef4444;"></span>` : ''}
        </a>
        <a href="/reports" class="mobile-nav-link ${activeKey === 'reports' ? 'active' : ''}">
          <span style="font-size: 18px;">📈</span>
          <span style="font-size: 10px; font-weight: 600;">Rekap</span>
        </a>
        ${currentUser.role === 'Owner' ? `
        <a href="/users" class="mobile-nav-link ${activeKey === 'users' ? 'active' : ''}">
          <span style="font-size: 18px;">👥</span>
          <span style="font-size: 10px; font-weight: 600;">Tim</span>
        </a>` : ''}
      </nav>
    `;
  }
}

// Tambahkan CSS khusus untuk Navigation link
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
    background: rgba(59, 130, 246, 0.15);
    color: #60a5fa;
    font-weight: 600;
    border: 1px solid rgba(59, 130, 246, 0.25);
  }
  .mobile-nav-link {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
    text-decoration: none;
    flex: 1;
    height: 100%;
  }
  .mobile-nav-link.active {
    color: #60a5fa;
  }
`;
document.head.appendChild(navStyle);
