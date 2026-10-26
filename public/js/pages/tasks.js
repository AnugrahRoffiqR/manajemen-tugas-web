// Cards render differently per role, so wait for the session before the first load.
const navReady = initNavigation('tasks');

let allTasks = [];
let currentView = 'kanban';

const ICON = {
  todo: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
  progress: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="6 4 20 12 6 20 6 4"/></svg>',
  done: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
  edit: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
  trash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
};

const STATUS_BADGE = { 'To Do': 'badge-todo', 'In Progress': 'badge-in-progress', Done: 'badge-done' };

function switchView(view) {
  currentView = view;
  const isKanban = view === 'kanban';
  document.getElementById('kanban-view').style.display = isKanban ? '' : 'none';
  document.getElementById('table-view').style.display = isKanban ? 'none' : 'block';
  document.getElementById('view-kanban-btn').setAttribute('aria-pressed', String(isKanban));
  document.getElementById('view-table-btn').setAttribute('aria-pressed', String(!isKanban));
}

// var (not const) so the delegated handler can reach it via window.
var handleSearch = debounce(() => {
  loadTasks();
}, 250);

function setActiveChip(type) {
  document.querySelectorAll('.filter-chip').forEach(c => {
    const on = c.id === `chip-${type}`;
    c.classList.toggle('active', on);
    c.setAttribute('aria-pressed', String(on));
  });
}

function applyQuickChip(type) {
  setActiveChip(type);
  const presets = { all: 'Semua', todo: 'To Do', inprogress: 'In Progress', done: 'Done' };
  document.getElementById('filter-status').value = presets[type] || presets.all;
  loadTasks();
}

function resetFilters() {
  document.getElementById('filter-search').value = '';
  document.getElementById('filter-status').value = 'Semua';
  setActiveChip('all');
  loadTasks();
}

async function loadTasks() {
  const search = document.getElementById('filter-search').value;
  const status = document.getElementById('filter-status').value;

  const params = new URLSearchParams();
  if (search) params.append('search', search);
  if (status !== 'Semua') params.append('status', status);

  try {
    const res = await apiFetch(`/api/tasks?${params.toString()}`);
    if (res && res.data) {
      allTasks = res.data;
      renderKanban(allTasks);
      renderTable(allTasks);
    }
  } catch (err) {
    showLoadError(['#task-table-rows'], 'loadTasks', err);
  }
}

function renderKanban(tasks) {
  const groups = [
    ['To Do', 'col-todo', 'count-todo', 'Tidak ada tugas di antrean'],
    ['In Progress', 'col-inprogress', 'count-inprogress', 'Tidak ada tugas berjalan'],
    ['Done', 'col-done', 'count-done', 'Belum ada tugas selesai'],
  ];
  groups.forEach(([status, colId, countId, emptyText]) => {
    const items = tasks.filter(t => t.status === status);
    document.getElementById(countId).textContent = items.length;
    document.getElementById(colId).innerHTML = items.length
      ? items.map(createKanbanCard).join('')
      : `<div class="empty-state-box compact">${emptyText}</div>`;
  });
}

// Owner: move/edit/delete. Member: only "Lapor selesai" until someone has reported it.
function taskActions(task, title) {
  const id = Number(task.id);
  if (isOwnerView()) {
    const moveBtn = (status, icon, label, extra = '') =>
      `<button type="button" data-click="updateTaskStatus" data-args='[${id},"${status}"]' class="btn-action-icon${extra}" aria-label="${label}: ${title}" title="${label}">${icon}</button>`;
    return `
      ${task.status !== 'To Do' ? moveBtn('To Do', ICON.todo, 'Pindah ke To Do') : ''}
      ${task.status !== 'In Progress' ? moveBtn('In Progress', ICON.progress, 'Pindah ke In Progress') : ''}
      ${task.status !== 'Done' ? moveBtn('Done', ICON.done, 'Tandai selesai', ' is-done') : ''}
      <button type="button" data-click="openEditTaskModal" data-args='[${id}]' class="btn-action-icon" aria-label="Edit: ${title}" title="Edit">${ICON.edit}</button>
      <button type="button" data-click="deleteTask" data-args='[${id}]' class="btn-action-icon is-danger" aria-label="Hapus: ${title}" title="Hapus">${ICON.trash}</button>`;
  }
  if (task.status === 'Done' || task.done_reported_at) return '';
  return `<button type="button" data-click="reportTaskDone" data-args='[${id}]' class="btn-secondary btn-sm" aria-label="Lapor selesai: ${title}">${ICON.done} Lapor selesai</button>`;
}

function createKanbanCard(task) {
  const title = escapeHtml(task.title);
  const reported = reportedBadge(task);
  const overdue = !task.completed && new Date(task.due_date) < new Date();
  const actions = taskActions(task, title);

  return `
    <article class="kanban-card${reported ? ' is-reported' : overdue ? ' is-overdue' : ''}">
      ${reported ? `<div class="kanban-card-tags">${reported}</div>` : ''}
      <h3 class="kanban-card-title${task.completed ? ' is-complete' : ''}">${title}</h3>
      ${task.description ? `<p class="kanban-card-desc">${escapeHtml(task.description)}</p>` : ''}
      <div class="kanban-card-due">
        <span class="font-mono">${formatDateWIB(task.due_date)}</span>
        ${task.completed ? '' : deadlineBadge(task.due_date)}
      </div>
      <div class="kanban-card-foot">
        <span class="muted" style="font-size: 0.75rem; font-weight: 600;" title="Penanggung jawab">${escapeHtml(task.assignee_name ? task.assignee_name.split(' ')[0] : '')}</span>
        ${actions ? `<div class="kanban-card-actions">${actions}</div>` : ''}
      </div>
    </article>`;
}

function renderTable(tasks) {
  const tbody = document.getElementById('task-table-rows');
  if (!tasks.length) {
    tbody.innerHTML = `
      <tr><td colspan="${isOwnerView() ? 6 : 5}">
        <div class="empty-state-box">
          <h4>Tidak ada tugas ditemukan</h4>
          <p>Sesuaikan kata kunci pencarian atau reset filter.</p>
          <button type="button" data-click="resetFilters" class="btn-secondary btn-sm">Reset Filter</button>
        </div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = tasks.map(t => {
    const id = Number(t.id);
    const title = escapeHtml(t.title);
    const reported = reportedBadge(t);
    return `
      <tr>
        <td class="center owner-only">
          <input type="checkbox" class="table-check" ${t.completed ? 'checked' : ''} aria-label="Tandai selesai: ${title}" data-change="toggleTaskDone" data-args='[${id}]'>
        </td>
        <td class="cell-title${t.completed ? ' is-complete' : ''}">${title}</td>
        <td>
          <span class="badge ${STATUS_BADGE[t.status] || 'badge-todo'}">${escapeHtml(t.status)}</span>
          ${reported ? `<div style="margin-top: 4px;">${reported}</div>` : ''}
        </td>
        <td class="nowrap">
          <span class="font-mono" style="font-size: 0.8125rem;">${formatDateWIB(t.due_date)}</span>
          ${t.completed ? '' : `<div style="margin-top: 4px;">${deadlineBadge(t.due_date)}</div>`}
        </td>
        <td class="muted">${escapeHtml(t.assignee_name || '–')}</td>
        <td class="right">
          <div class="cell-actions">
            ${isOwnerView()
              ? `<button type="button" data-click="openEditTaskModal" data-args='[${id}]' class="btn-action-icon" aria-label="Edit: ${title}" title="Edit">${ICON.edit}</button>
                 <button type="button" data-click="deleteTask" data-args='[${id}]' class="btn-action-icon is-danger" aria-label="Hapus: ${title}" title="Hapus">${ICON.trash}</button>`
              : taskActions(t, title)}
          </div>
        </td>
      </tr>`;
  }).join('');
}

async function updateTaskStatus(taskId, status) {
  try {
    await apiFetch(`/api/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
    showToast('Status berhasil diubah!', 'success');
    loadTasks();
  } catch (e) {}
}

async function reportTaskDone(taskId) {
  this.disabled = true;
  try {
    const res = await apiFetch(`/api/tasks/${taskId}/report-done`, { method: 'POST' });
    showToast(res.message || 'Laporan terkirim ke Owner.', 'success');
    loadTasks();
  } catch (e) {
    this.disabled = false;
  }
}

// Delegated change handler: `this` is the checkbox.
function toggleTaskDone(taskId) {
  updateTaskStatus(taskId, this.checked ? 'Done' : 'In Progress');
}

async function deleteTask(taskId) {
  if (!confirm('Apakah Anda yakin ingin menghapus tugas ini secara permanen?')) return;
  try {
    await apiFetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
    showToast('Tugas berhasil dihapus!', 'info');
    loadTasks();
  } catch (e) {}
}

function toLocalInputValue(date) {
  const tzOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
}

function showModal() {
  document.body.classList.add('modal-open');
  document.getElementById('task-modal').classList.add('active');
  document.getElementById('task-title').focus();
}

// Modal Create / Edit
async function openTaskModal(defaultStatus = 'To Do') {
  if (!isOwnerView()) return;
  try {
    await fillAssigneeSelect(document.getElementById('task-assignee'));
  } catch { return; }
  document.getElementById('task-form').reset();
  document.getElementById('task-assignee').value = document.body.dataset.userId;
  document.getElementById('edit-task-id').value = '';
  document.getElementById('modal-title').textContent = 'Tambah Tugas Baru';
  document.getElementById('save-task-btn-text').textContent = 'Simpan Tugas';
  document.getElementById('task-status').value = defaultStatus;

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(17, 0, 0, 0);
  document.getElementById('task-due-date').value = toLocalInputValue(tomorrow);

  showModal();
}
window.openTaskModal = openTaskModal;

async function openEditTaskModal(id) {
  const task = allTasks.find(t => t.id === id);
  if (!task || !isOwnerView()) return;
  try {
    await fillAssigneeSelect(document.getElementById('task-assignee'), task.user_id);
  } catch { return; }

  document.getElementById('edit-task-id').value = task.id;
  document.getElementById('task-title').value = task.title;
  document.getElementById('task-desc').value = task.description || '';
  document.getElementById('task-status').value = task.status;
  document.getElementById('task-due-date').value = toLocalInputValue(task.due_date ? new Date(task.due_date) : new Date());

  document.getElementById('modal-title').textContent = 'Edit Tugas';
  document.getElementById('save-task-btn-text').textContent = 'Simpan Perubahan';

  showModal();
}

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
    openTaskModal();
  }
});

document.getElementById('task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const saveBtn = document.getElementById('save-task-btn');
  saveBtn.disabled = true;

  const editId = document.getElementById('edit-task-id').value;
  const payload = {
    title: document.getElementById('task-title').value,
    description: document.getElementById('task-desc').value,
    status: document.getElementById('task-status').value,
    due_date: localInputToISO(document.getElementById('task-due-date').value),
    user_id: Number(document.getElementById('task-assignee').value),
  };

  try {
    if (editId) {
      await apiFetch(`/api/tasks/${editId}`, { method: 'PUT', body: JSON.stringify(payload) });
      showToast('Data tugas berhasil diperbarui!', 'success');
    } else {
      await apiFetch('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
      showToast('Tugas baru berhasil disimpan!', 'success');
    }
    closeTaskModal();
    loadTasks();
  } catch (err) {
  } finally {
    saveBtn.disabled = false;
  }
});

navReady.then((user) => { if (user) loadTasks(); });
