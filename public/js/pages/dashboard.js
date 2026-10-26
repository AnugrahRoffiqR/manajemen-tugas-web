// Rows render differently per role, so wait for the session before the first load.
const navReady = initNavigation('dashboard');

const STATUS_BADGE = { 'To Do': 'badge-todo', 'In Progress': 'badge-in-progress', Done: 'badge-done' };
const STATUS_SEGMENTS = [
  { key: 'todo_tasks', label: 'To Do', color: 'var(--status-todo)' },
  { key: 'in_progress_tasks', label: 'In Progress', color: 'var(--status-in-progress)' },
  { key: 'completed_tasks', label: 'Done', color: 'var(--status-done)' },
];
let trendTasks = [];
let trendRange = 14;

// Same formulas as /api/reports/analytics (period=all).
function computeMetrics(tasks) {
  const count = (fn) => tasks.filter(fn).length;
  const now = Date.now();
  const completed = count(t => t.status === 'Done');
  const onTime = count(t => t.status === 'Done' && t.completed_at && new Date(t.completed_at) <= new Date(t.due_date));
  return {
    total_tasks: tasks.length,
    completed_tasks: completed,
    in_progress_tasks: count(t => t.status === 'In Progress'),
    todo_tasks: count(t => t.status === 'To Do'),
    overdue_tasks: count(t => t.status !== 'Done' && new Date(t.due_date).getTime() < now),
    on_time_tasks: onTime,
    completion_rate: tasks.length ? Math.round((completed / tasks.length) * 1000) / 10 : 0,
    on_time_rate: completed ? Math.round((onTime / completed) * 1000) / 10 : 100,
  };
}

async function loadDashboardData() {
  try {
    document.getElementById('dashboard-date').textContent = new Intl.DateTimeFormat('id-ID', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    }).format(new Date());

    // Ambil Profil User untuk Greeting Personal
    try {
      const meRes = await fetch('/api/auth/me');
      if (meRes.ok) {
        const meData = await meRes.json();
        if (meData?.data?.name) {
          document.getElementById('user-greeting-name').textContent = meData.data.name.split(' ')[0];
        }
      }
    } catch (e) {}

    // Metrics come from /api/tasks (already scoped per role) because /api/reports is Owner-only.
    const tasksRes = await apiFetch('/api/tasks?status=Semua');
    const allTasks = (tasksRes && tasksRes.data) || [];
    {
      const m = computeMetrics(allTasks);
      document.getElementById('stat-total').textContent = m.total_tasks;
      document.getElementById('stat-in-progress').textContent = m.in_progress_tasks;
      document.getElementById('stat-done').textContent = m.completed_tasks;
      document.getElementById('stat-overdue').textContent = m.overdue_tasks;

      document.getElementById('progress-ratio-label').textContent = `${m.completed_tasks} dari ${m.total_tasks} tugas selesai`;
      document.getElementById('ontime-label').textContent = m.completed_tasks > 0
        ? `${m.on_time_tasks} dari ${m.completed_tasks} tugas selesai tepat waktu (${m.on_time_rate}%).`
        : '';

      ChartKit.donut(document.getElementById('status-chart'), {
        segments: STATUS_SEGMENTS.map(s => ({ label: s.label, value: m[s.key], color: s.color })),
        centerValue: `${Math.round(m.completion_rate || 0)}%`,
        centerLabel: 'selesai',
        ariaLabel: 'Komposisi status tugas',
        emptyText: 'Belum ada tugas.',
      });
      renderReported(allTasks);
    }

    // Ambil Notifikasi Kritis
    const remRes = await apiFetch('/api/reminders/urgent');
    if (remRes && remRes.data) {
      const urgentBanner = document.getElementById('urgent-alert-banner');
      const { total_urgent = 0, total_overdue = 0 } = remRes.data;
      if (total_urgent + total_overdue > 0) {
        urgentBanner.style.display = 'flex';
        document.getElementById('urgent-banner-title').textContent = `${total_urgent + total_overdue} tugas perlu perhatian`;
        document.getElementById('urgent-banner-desc').textContent = `${total_overdue} lewat tenggat, ${total_urgent} jatuh tempo dalam 24 jam.`;
      } else {
        urgentBanner.style.display = 'none';
      }
    }

    // Tugas aktif terdekat (API sudah mengurutkan due_date ASC)
    const rowsContainer = document.getElementById('priority-task-rows');
    trendTasks = allTasks;
    renderTrend();
    const activeTasks = allTasks.filter(t => !t.completed).slice(0, 5);

    if (!activeTasks.length) {
      const hasAny = allTasks.length > 0;
      rowsContainer.innerHTML = `
        <tr><td colspan="4">
          <div class="empty-state-box">
            <h4>${hasAny ? 'Semua tugas sudah selesai' : 'Belum ada tugas'}</h4>
            <p>${hasAny ? 'Tidak ada tugas aktif saat ini.' : 'Tugas yang dibuat Owner akan muncul di sini.'}</p>
            <button type="button" data-click="openCreateTaskModal" class="btn-primary owner-only">Buat Tugas</button>
          </div>
        </td></tr>`;
      return;
    }

    rowsContainer.innerHTML = activeTasks.map(task => `
      <tr>
        <td class="cell-title">
          ${escapeHtml(task.title)}
          ${task.description ? `<p class="cell-sub">${escapeHtml(task.description)}</p>` : ''}
        </td>
        <td>
          <span class="badge ${STATUS_BADGE[task.status] || 'badge-todo'}">${escapeHtml(task.status)}</span>
          ${reportedBadge(task) ? `<div style="margin-top: 4px;">${reportedBadge(task)}</div>` : ''}
        </td>
        <td class="nowrap">
          <span class="font-mono" style="font-size: 0.8125rem;">${formatDateWIB(task.due_date)}</span>
          <div style="margin-top: 4px;">${deadlineBadge(task.due_date)}</div>
        </td>
        <td class="right">${taskActionButton(task)}</td>
      </tr>`).join('');
  } catch (err) {
    console.error(err);
    showLoadError(['#status-chart', '#reported-list', '#trend-chart', '#priority-task-rows'], 'loadDashboardData', err);
  }
}

// Owner closes the task; a member can only report it (once).
function taskActionButton(task) {
  const id = Number(task.id);
  const title = escapeHtml(task.title);
  if (isOwnerView()) {
    return `<button type="button" data-click="toggleTaskStatus" data-args='[${id},"Done"]' class="btn-secondary btn-sm" aria-label="Tandai selesai: ${title}">Selesaikan</button>`;
  }
  if (task.done_reported_at) return '';
  return `<button type="button" data-click="reportTaskDone" data-args='[${id}]' class="btn-secondary btn-sm" aria-label="Lapor selesai: ${title}">Lapor selesai</button>`;
}

function renderReported(tasks) {
  const list = document.getElementById('reported-list');
  const reported = tasks.filter(t => t.done_reported_at && t.status !== 'Done')
    .sort((a, b) => new Date(a.done_reported_at) - new Date(b.done_reported_at));
  document.getElementById('reported-count').textContent = reported.length;
  if (!reported.length) {
    list.innerHTML = `<li class="chart-empty">${isOwnerView() ? 'Belum ada laporan dari anggota.' : 'Belum ada tugas yang dilaporkan selesai.'}</li>`;
    return;
  }
  list.innerHTML = reported.slice(0, 6).map(t => `
    <li class="reported-item">
      <div style="min-width: 0;">
        <p class="cell-title">${escapeHtml(t.title)}</p>
        <p class="cell-sub">${escapeHtml(t.done_reported_by_name || 'Anggota')} · <span class="font-mono">${formatDateWIB(t.done_reported_at)}</span></p>
      </div>
      ${isOwnerView() ? `<button type="button" data-click="toggleTaskStatus" data-args='[${Number(t.id)},"Done"]' class="btn-primary btn-sm" aria-label="Tandai Done: ${escapeHtml(t.title)}">Tandai Done</button>` : ''}
    </li>`).join('');
}

async function reportTaskDone(taskId) {
  this.disabled = true;
  try {
    const res = await apiFetch(`/api/tasks/${taskId}/report-done`, { method: 'POST' });
    showToast(res.message || 'Laporan terkirim ke Owner.', 'success');
    loadDashboardData();
  } catch (err) {
    this.disabled = false;
  }
}

function renderTrend() {
  const to = new Date();
  const from = new Date(to);
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - (trendRange - 1));
  const totals = ChartKit.trend(document.getElementById('trend-chart'), {
    tasks: trendTasks,
    from,
    to,
    unit: 'day',
    ariaLabel: `Aktivitas tugas ${trendRange} hari terakhir`,
    emptyText: `Belum ada tugas dibuat atau diselesaikan dalam ${trendRange} hari terakhir.`,
  });
  document.getElementById('trend-created').textContent = totals.created;
  document.getElementById('trend-completed').textContent = totals.completed;
}

function setTrendRange(days) {
  trendRange = days;
  document.querySelectorAll('[data-range]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.range) === days)));
  renderTrend();
}

async function toggleTaskStatus(taskId, newStatus) {
  try {
    await apiFetch(`/api/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify({ status: newStatus }),
    });
    showToast('Status tugas berhasil diperbarui!', 'success');
    loadDashboardData();
  } catch (err) {}
}

// Modal Handlers
async function openCreateTaskModal() {
  if (!isOwnerView()) return;
  try {
    await fillAssigneeSelect(document.getElementById('task-assignee'), document.body.dataset.userId);
  } catch { return; }
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(17, 0, 0, 0);
  const tzOffset = tomorrow.getTimezoneOffset() * 60000;
  document.getElementById('task-due-date').value = new Date(tomorrow.getTime() - tzOffset).toISOString().slice(0, 16);

  document.body.classList.add('modal-open');
  document.getElementById('task-modal').classList.add('active');
  document.getElementById('task-title').focus();
}
window.openCreateTaskModal = openCreateTaskModal;

function closeTaskModal() {
  document.body.classList.remove('modal-open');
  document.getElementById('task-modal').classList.remove('active');
}

// Keyboard shortcut 'N' for new task (Escape is handled globally in navbar.js)
window.addEventListener('keydown', (e) => {
  if ((e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey && !e.altKey
    && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)
    && !document.querySelector('.modal-overlay.active')) {
    e.preventDefault();
    openCreateTaskModal();
  }
});

document.getElementById('create-task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const saveBtn = document.getElementById('save-task-btn');
  saveBtn.disabled = true;

  const title = document.getElementById('task-title').value;
  const description = document.getElementById('task-desc').value;
  const due_date = localInputToISO(document.getElementById('task-due-date').value);

  try {
    await apiFetch('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title, description, due_date, user_id: Number(document.getElementById('task-assignee').value) }),
    });
    showToast('Tugas baru berhasil disimpan!', 'success');
    closeTaskModal();
    document.getElementById('create-task-form').reset();
    loadDashboardData();
  } catch (err) {
  } finally {
    saveBtn.disabled = false;
  }
});

navReady.then((user) => { if (user) loadDashboardData(); });
