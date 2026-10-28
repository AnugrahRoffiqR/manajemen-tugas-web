// Cards render differently per role, so wait for the session before the first load.
const navReady = initNavigation('tasks');

let allTasks = [];
let currentView = 'kanban';
let taskView = 'active'; // active | archived | trash
let tablePage = 1;
let tablePages = 1;
let detailTaskId = null;
const TABLE_LIMIT = 20;

const ICON = {
  todo: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
  progress: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="6 4 20 12 6 20 6 4"/></svg>',
  done: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
  edit: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
  trash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  archive: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><line x1="10" y1="12" x2="14" y2="12"/></svg>',
  restore: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><polyline points="3 3 3 8 8 8"/></svg>',
  users: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>',
  list: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  chat: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  repeat: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
  link: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
};

const STATUS_BADGE = { 'To Do': 'badge-todo', 'In Progress': 'badge-in-progress', Done: 'badge-done' };
const VIEW_NOTES = {
  archived: 'Arsip berisi tugas Done yang sudah disimpan. Tugas di sini tidak tampil di papan aktif.',
  trash: 'Tugas di tempat sampah bisa dipulihkan atau dihapus permanen.',
};

const myId = () => Number(document.body.dataset.userId);
const isDone = (t) => t.status === 'Done';

// Members may only report tasks they are assigned to (or tasks open to everyone).
function canWork(task) {
  if (isOwnerView()) return true;
  const members = task.members || [];
  return !members.length || members.some((m) => Number(m.id) === myId());
}

function switchView(view) {
  currentView = view;
  const isKanban = view === 'kanban';
  document.getElementById('kanban-view').style.display = isKanban ? '' : 'none';
  document.getElementById('table-view').style.display = isKanban ? 'none' : 'block';
  document.getElementById('view-kanban-btn').setAttribute('aria-pressed', String(isKanban));
  document.getElementById('view-table-btn').setAttribute('aria-pressed', String(!isKanban));
  loadTasks();
}

function setTaskView(view) {
  taskView = view;
  ['active', 'archived', 'trash'].forEach((v) => {
    document.getElementById(`tab-${v}`).setAttribute('aria-pressed', String(v === view));
  });
  const note = document.getElementById('view-note');
  note.textContent = VIEW_NOTES[view] || '';
  note.hidden = !VIEW_NOTES[view];
  loadTasks();
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
  ['filter-search', 'filter-member', 'filter-reported', 'filter-due-from', 'filter-due-to'].forEach((id) => {
    document.getElementById(id).value = '';
  });
  document.getElementById('filter-status').value = 'Semua';
  document.getElementById('filter-sort').value = 'due_asc';
  setActiveChip('all');
  loadTasks();
}

// Date inputs are WIB calendar days: from 00:00 to 23:59:59 WIB.
const wibDayStart = (value) => new Date(`${value}T00:00:00+07:00`).toISOString();
const wibDayEnd = (value) => new Date(`${value}T23:59:59.999+07:00`).toISOString();

function buildParams() {
  const params = new URLSearchParams({ view: taskView, sort: document.getElementById('filter-sort').value });
  const search = document.getElementById('filter-search').value.trim();
  const status = document.getElementById('filter-status').value;
  const member = document.getElementById('filter-member').value;
  const reported = document.getElementById('filter-reported').value;
  const from = document.getElementById('filter-due-from').value;
  const to = document.getElementById('filter-due-to').value;
  if (search) params.set('search', search);
  if (status !== 'Semua') params.set('status', status);
  if (member) params.set('member', member);
  if (reported) params.set('reported', reported);
  if (from) params.set('due_from', wibDayStart(from));
  if (to) params.set('due_to', wibDayEnd(to));
  return params;
}

// Called by filter controls (delegated) with no args: any filter change goes back to page 1.
async function loadTasks(keepPage) {
  if (keepPage !== true) tablePage = 1;
  const params = buildParams();
  if (currentView === 'table') {
    params.set('page', String(tablePage));
    params.set('limit', String(TABLE_LIMIT));
  }
  try {
    const res = await apiFetch(`/api/tasks?${params.toString()}`);
    allTasks = res.data || [];
    if (currentView === 'table') {
      tablePages = res.meta?.pages || 1;
      if (tablePage > tablePages) { tablePage = tablePages; return loadTasks(true); }
      renderTable(allTasks, res.meta);
    } else {
      renderKanban(allTasks);
    }
  } catch (err) {
    showLoadError(['#task-table-rows'], 'loadTasks', err);
  }
}

function changePage(delta) {
  const next = tablePage + Number(delta);
  if (next < 1 || next > tablePages) return;
  tablePage = next;
  loadTasks(true);
}

function renderPager(meta) {
  const total = meta?.total || 0;
  const start = total ? (tablePage - 1) * TABLE_LIMIT + 1 : 0;
  const end = Math.min(total, tablePage * TABLE_LIMIT);
  document.getElementById('pager-info').textContent = total
    ? `${start}–${end} dari ${total} tugas · halaman ${tablePage}/${tablePages}`
    : '';
  document.getElementById('pager-prev').disabled = tablePage <= 1;
  document.getElementById('pager-next').disabled = tablePage >= tablePages;
}

function renderKanban(tasks) {
  const groups = [
    ['To Do', 'col-todo', 'count-todo', 'Tidak ada tugas di antrean'],
    ['In Progress', 'col-inprogress', 'count-inprogress', 'Tidak ada tugas berjalan'],
    ['Done', 'col-done', 'count-done', taskView === 'archived' ? 'Arsip kosong' : 'Belum ada tugas selesai'],
  ];
  groups.forEach(([status, colId, countId, emptyText]) => {
    const items = tasks.filter(t => t.status === status);
    document.getElementById(countId).textContent = items.length;
    document.getElementById(colId).innerHTML = items.length
      ? items.map(createKanbanCard).join('')
      : `<div class="empty-state-box compact">${taskView === 'trash' ? 'Kosong' : emptyText}</div>`;
  });
}

const iconBtn = (click, args, icon, label, title, extra = '') =>
  `<button type="button" data-click="${click}" data-args='${JSON.stringify(args)}' class="btn-action-icon${extra}" aria-label="${label}: ${title}" title="${label}">${icon}</button>`;

// Owner: move/edit/archive/delete. Member: "Lapor selesai" when assigned and not yet reported.
function taskActions(task, title, { compact = false } = {}) {
  const id = Number(task.id);
  if (task.deleted_at) {
    if (!isOwnerView()) return '';
    return iconBtn('restoreTask', [id], ICON.restore, 'Pulihkan', title)
      + iconBtn('purgeTask', [id], ICON.trash, 'Hapus permanen', title, ' is-danger');
  }
  if (isOwnerView()) {
    if (task.archived_at) {
      return iconBtn('unarchiveTask', [id], ICON.restore, 'Kembalikan dari arsip', title)
        + iconBtn('deleteTask', [id], ICON.trash, 'Pindah ke sampah', title, ' is-danger');
    }
    const move = compact ? '' : `
      ${task.status !== 'To Do' ? iconBtn('updateTaskStatus', [id, 'To Do'], ICON.todo, 'Pindah ke To Do', title) : ''}
      ${task.status !== 'In Progress' ? iconBtn('updateTaskStatus', [id, 'In Progress'], ICON.progress, 'Pindah ke In Progress', title) : ''}
      ${!isDone(task) ? iconBtn('updateTaskStatus', [id, 'Done'], ICON.done, 'Tandai selesai', title, ' is-done') : ''}`;
    return `${move}
      ${isDone(task) ? iconBtn('archiveTask', [id], ICON.archive, 'Arsipkan', title) : ''}
      ${iconBtn('openEditTaskModal', [id], ICON.edit, 'Edit', title)}
      ${iconBtn('deleteTask', [id], ICON.trash, 'Pindah ke sampah', title, ' is-danger')}`;
  }
  if (isDone(task) || task.done_reported_at || task.archived_at) return '';
  if (!canWork(task)) {
    return `<span class="chip-meta" title="Tugas ini ditugaskan ke anggota lain">Ditugaskan ke ${escapeHtml(membersLabel(task))}</span>`;
  }
  if (task.status === 'To Do') {
    return `<span class="chip-meta" title="Owner belum memulai tugas ini">Menunggu dimulai Owner</span>`;
  }
  return `<button type="button" data-click="openReportModal" data-args='[${id}]' class="btn-secondary btn-sm" aria-label="Lapor selesai: ${title}">${ICON.done} Lapor selesai</button>`;
}

function cardMeta(task) {
  const parts = [`<span class="chip-meta" title="Anggota">${ICON.users}${escapeHtml(membersLabel(task))}</span>`];
  if (task.checklist_total) {
    parts.push(`<span class="chip-meta" title="Subtugas selesai">${ICON.list}${task.checklist_done}/${task.checklist_total}</span>`);
  }
  if (task.comment_count) {
    parts.push(`<span class="chip-meta" title="Komentar">${ICON.chat}${task.comment_count}<span class="sr-only"> komentar</span></span>`);
  }
  if (task.recurrence) {
    parts.push(`<span class="chip-meta" title="Tugas berulang">${ICON.repeat}${RECURRENCE_LABEL[task.recurrence] || ''}</span>`);
  }
  return `<div class="kanban-card-meta">${parts.join('')}</div>`;
}

function createKanbanCard(task) {
  const title = escapeHtml(task.title);
  const reported = reportedBadge(task);
  const overdue = !isDone(task) && new Date(task.due_date) < new Date();
  const actions = taskActions(task, title);

  return `
    <article class="kanban-card${reported ? ' is-reported' : overdue ? ' is-overdue' : ''}">
      ${reported ? `<div class="kanban-card-tags">${reported}</div>` : ''}
      <h3 class="kanban-card-title${isDone(task) ? ' is-complete' : ''}">
        <button type="button" class="card-open" data-click="openTaskDetail" data-args='[${Number(task.id)}]'>${title}</button>
      </h3>
      ${task.description ? `<p class="kanban-card-desc">${escapeHtml(task.description)}</p>` : ''}
      <div class="kanban-card-due">
        <span class="font-mono">${formatDateWIB(task.due_date)}</span>
        ${isDone(task) ? '' : deadlineBadge(task.due_date)}
      </div>
      ${cardMeta(task)}
      <div class="kanban-card-foot">
        <span class="muted" style="font-size: 0.75rem; font-weight: 600;" title="Penanggung jawab">${escapeHtml(task.assignee_name ? task.assignee_name.split(' ')[0] : '')}</span>
        ${actions ? `<div class="kanban-card-actions">${actions}</div>` : ''}
      </div>
    </article>`;
}

function renderTable(tasks, meta) {
  const tbody = document.getElementById('task-table-rows');
  renderPager(meta);
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

  const canToggle = taskView === 'active';
  tbody.innerHTML = tasks.map(t => {
    const id = Number(t.id);
    const title = escapeHtml(t.title);
    const reported = reportedBadge(t);
    return `
      <tr>
        <td class="center owner-only">
          ${canToggle ? `<input type="checkbox" class="table-check" ${isDone(t) ? 'checked' : ''} aria-label="Tandai selesai: ${title}" data-change="toggleTaskDone" data-args='[${id}]'>` : ''}
        </td>
        <td class="cell-title${isDone(t) ? ' is-complete' : ''}">
          <button type="button" class="link-title" data-click="openTaskDetail" data-args='[${id}]'>${title}</button>
          ${t.recurrence ? `<div class="chip-meta">${ICON.repeat}${RECURRENCE_LABEL[t.recurrence] || ''}</div>` : ''}
        </td>
        <td>
          <span class="badge ${STATUS_BADGE[t.status] || 'badge-todo'}">${escapeHtml(t.status)}</span>
          ${reported ? `<div style="margin-top: 4px;">${reported}</div>` : ''}
        </td>
        <td class="nowrap">
          <span class="font-mono" style="font-size: 0.8125rem;">${formatDateWIB(t.due_date)}</span>
          ${isDone(t) ? '' : `<div style="margin-top: 4px;">${deadlineBadge(t.due_date)}</div>`}
        </td>
        <td class="muted">${escapeHtml(membersLabel(t))}</td>
        <td class="right">
          <div class="cell-actions">${taskActions(t, title, { compact: true })}</div>
        </td>
      </tr>`;
  }).join('');
}

// Refresh the board, and the detail panel when it shows the same task.
function refreshAfterChange(taskId) {
  loadTasks(true);
  if (detailTaskId && Number(detailTaskId) === Number(taskId) && isModalOpen('detail-modal')) loadTaskDetail(taskId);
}

async function updateTaskStatus(taskId, status) {
  try {
    const res = await apiFetch(`/api/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
    showToast(res.next_task ? 'Selesai. Tugas berulang berikutnya sudah dibuat.' : 'Status berhasil diubah!', 'success');
    refreshAfterChange(taskId);
  } catch (e) {}
}

// Delegated change handler: `this` is the checkbox.
function toggleTaskDone(taskId) {
  updateTaskStatus(taskId, this.checked ? 'Done' : 'In Progress');
}

async function simpleTaskAction(url, method, okMessage) {
  try {
    const res = await apiFetch(url, { method });
    showToast(res.message || okMessage, 'success');
    if (isModalOpen('detail-modal')) closeDetailModal();
    loadTasks(true);
  } catch (e) {}
}

function deleteTask(taskId) {
  if (!confirm('Pindahkan tugas ini ke tempat sampah? Anda masih bisa memulihkannya dari tab Sampah.')) return;
  simpleTaskAction(`/api/tasks/${taskId}`, 'DELETE', 'Tugas dipindahkan ke sampah.');
}
function restoreTask(taskId) {
  simpleTaskAction(`/api/tasks/${taskId}/restore`, 'POST', 'Tugas dipulihkan.');
}
function purgeTask(taskId) {
  if (!confirm('Hapus tugas ini secara permanen? Komentar, subtugas, dan riwayatnya ikut terhapus dan tidak bisa dikembalikan.')) return;
  simpleTaskAction(`/api/tasks/${taskId}/purge`, 'DELETE', 'Tugas dihapus permanen.');
}
function archiveTask(taskId) {
  simpleTaskAction(`/api/tasks/${taskId}/archive`, 'POST', 'Tugas diarsipkan.');
}
function unarchiveTask(taskId) {
  simpleTaskAction(`/api/tasks/${taskId}/unarchive`, 'POST', 'Tugas dikembalikan dari arsip.');
}

function toLocalInputValue(date) {
  const tzOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
}

// ------------------------------------------------------------------
// Modals
// ------------------------------------------------------------------
const isModalOpen = (id) => document.getElementById(id).classList.contains('active');

function openModal(id, focusSelector) {
  document.body.classList.add('modal-open');
  document.getElementById(id).classList.add('active');
  document.querySelector(focusSelector)?.focus();
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
  if (!document.querySelector('.modal-overlay.active')) document.body.classList.remove('modal-open');
}

// Modal Create / Edit
async function openTaskModal(defaultStatus = 'To Do') {
  if (!isOwnerView()) return;
  try {
    await Promise.all([
      fillAssigneeSelect(document.getElementById('task-assignee')),
      fillMemberPicker(document.getElementById('task-members'), []),
    ]);
  } catch { return; }
  document.getElementById('task-form').reset();
  document.getElementById('task-assignee').value = document.body.dataset.userId;
  document.getElementById('edit-task-id').value = '';
  document.getElementById('modal-title').textContent = 'Tambah Tugas Baru';
  document.getElementById('save-task-btn-text').textContent = 'Simpan Tugas';
  document.getElementById('task-status').value = typeof defaultStatus === 'string' ? defaultStatus : 'To Do';
  document.getElementById('task-recurrence').value = '';

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(17, 0, 0, 0);
  document.getElementById('task-due-date').value = toLocalInputValue(tomorrow);

  openModal('task-modal', '#task-title');
}
window.openTaskModal = openTaskModal;

async function findTask(id) {
  const cached = allTasks.find(t => Number(t.id) === Number(id));
  if (cached) return cached;
  const res = await apiFetch(`/api/tasks/${id}/detail`);
  return res.data.task;
}

async function openEditTaskModal(id) {
  if (!isOwnerView()) return;
  let task;
  try {
    task = await findTask(id);
    await Promise.all([
      fillAssigneeSelect(document.getElementById('task-assignee'), task.user_id),
      fillMemberPicker(document.getElementById('task-members'), (task.members || []).map((m) => m.id)),
    ]);
  } catch { return; }
  if (isModalOpen('detail-modal')) closeModal('detail-modal');

  document.getElementById('edit-task-id').value = task.id;
  document.getElementById('task-title').value = task.title;
  document.getElementById('task-desc').value = task.description || '';
  document.getElementById('task-status').value = task.status;
  document.getElementById('task-recurrence').value = task.recurrence || '';
  document.getElementById('task-due-date').value = toLocalInputValue(task.due_date ? new Date(task.due_date) : new Date());

  document.getElementById('modal-title').textContent = 'Edit Tugas';
  document.getElementById('save-task-btn-text').textContent = 'Simpan Perubahan';

  openModal('task-modal', '#task-title');
}

function closeTaskModal() { closeModal('task-modal'); }

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
    recurrence: document.getElementById('task-recurrence').value || null,
    member_ids: pickedMemberIds(document.getElementById('task-members')),
  };

  try {
    if (editId) {
      const res = await apiFetch(`/api/tasks/${editId}`, { method: 'PUT', body: JSON.stringify(payload) });
      showToast(res.next_task ? 'Disimpan. Tugas berulang berikutnya sudah dibuat.' : 'Data tugas berhasil diperbarui!', 'success');
    } else {
      await apiFetch('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
      showToast('Tugas baru berhasil disimpan!', 'success');
    }
    closeTaskModal();
    loadTasks(true);
  } catch (err) {
  } finally {
    saveBtn.disabled = false;
  }
});

// ------------------------------------------------------------------
// Lapor selesai (member) + tolak laporan (Owner)
// ------------------------------------------------------------------
async function openReportModal(taskId) {
  let task;
  try { task = await findTask(taskId); } catch { return; }
  if (isModalOpen('detail-modal')) closeModal('detail-modal');
  document.getElementById('report-form').reset();
  document.getElementById('report-task-id').value = taskId;
  document.getElementById('report-task-name').textContent = task.title;
  openModal('report-modal', '#report-note');
}
function closeReportModal() { closeModal('report-modal'); }

document.getElementById('report-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('report-submit');
  const taskId = document.getElementById('report-task-id').value;
  btn.disabled = true;
  try {
    const res = await apiFetch(`/api/tasks/${taskId}/report-done`, {
      method: 'POST',
      body: JSON.stringify({
        note: document.getElementById('report-note').value,
        link: document.getElementById('report-link').value.trim(),
      }),
    });
    showToast(res.message || 'Laporan terkirim ke Owner.', 'success');
    closeReportModal();
    loadTasks(true);
  } catch (err) {
  } finally {
    btn.disabled = false;
  }
});

function openRejectModal(taskId) {
  if (isModalOpen('detail-modal')) closeModal('detail-modal');
  document.getElementById('reject-form').reset();
  document.getElementById('reject-task-id').value = taskId;
  openModal('reject-modal', '#reject-reason');
}
function closeRejectModal() { closeModal('reject-modal'); }

document.getElementById('reject-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('reject-submit');
  const taskId = document.getElementById('reject-task-id').value;
  btn.disabled = true;
  try {
    const res = await apiFetch(`/api/tasks/${taskId}/reject-report`, {
      method: 'POST',
      body: JSON.stringify({ reason: document.getElementById('reject-reason').value }),
    });
    showToast(res.message || 'Laporan ditolak.', 'success');
    closeRejectModal();
    loadTasks(true);
  } catch (err) {
  } finally {
    btn.disabled = false;
  }
});

// ------------------------------------------------------------------
// Detail panel: meta, checklist, comments, activity
// ------------------------------------------------------------------
const ACTIVITY_LABEL = {
  created: 'membuat tugas', updated: 'mengubah tugas', status: 'mengubah status', assigned: 'mengubah anggota',
  deleted: 'memindahkan ke sampah', restored: 'memulihkan tugas', archived: 'mengarsipkan', unarchived: 'mengembalikan dari arsip',
  reported: 'melapor selesai', rejected: 'menolak laporan', commented: 'berkomentar', checklist: 'subtugas',
};
const KIND_LABEL = { report: 'Laporan selesai', reject: 'Laporan ditolak' };

function linkHtml(url) {
  if (!url) return '';
  const safe = escapeHtml(url);
  return `<a class="thread-link" href="${safe}" target="_blank" rel="noopener noreferrer nofollow">${ICON.link}<span>${safe}</span></a>`;
}

async function openTaskDetail(taskId) {
  detailTaskId = Number(taskId);
  document.getElementById('detail-title').textContent = 'Detail Tugas';
  document.getElementById('detail-body').innerHTML = '<p class="loading-text">Memuat detail…</p>';
  openModal('detail-modal', '#detail-modal .modal-head .btn-action-icon');
  await loadTaskDetail(taskId);
}

function closeDetailModal() {
  closeModal('detail-modal');
  detailTaskId = null;
  // Drop ?task= so a reload does not reopen the panel.
  if (new URLSearchParams(location.search).has('task')) history.replaceState(null, '', location.pathname);
}

async function loadTaskDetail(taskId) {
  const body = document.getElementById('detail-body');
  let data;
  try {
    data = (await apiFetch(`/api/tasks/${taskId}/detail`)).data;
  } catch (err) {
    if (!err.handled) body.innerHTML = '<p class="loading-text">Tugas tidak ditemukan atau sudah dihapus.</p>';
    return;
  }
  if (Number(detailTaskId) !== Number(taskId)) return; // panel moved on to another task
  const { task, checklist, comments, activity, can_work: canWorkHere } = data;
  const owner = isOwnerView();
  const live = !task.deleted_at;
  const title = escapeHtml(task.title);
  document.getElementById('detail-title').textContent = task.title;

  const doneCount = checklist.filter((c) => c.done).length;
  const pct = checklist.length ? Math.round((doneCount / checklist.length) * 100) : 0;
  const waiting = !owner && task.status === 'To Do';
  const canTick = live && canWorkHere && !task.archived_at && !waiting;

  const ownerButtons = owner ? `
    <div class="form-actions" style="justify-content: flex-start; margin-top: 1rem;">
      ${live && !task.archived_at ? `<button type="button" class="btn-secondary btn-sm" data-click="openEditTaskModal" data-args='[${task.id}]'>${ICON.edit} Edit</button>` : ''}
      ${live && task.done_reported_at && !isDone(task) ? `<button type="button" class="btn-primary btn-sm" data-click="updateTaskStatus" data-args='[${task.id},"Done"]'>${ICON.done} Terima &amp; tandai Done</button>
        <button type="button" class="btn-danger btn-sm" data-click="openRejectModal" data-args='[${task.id}]'>Tolak laporan</button>` : ''}
      ${live && isDone(task) && !task.archived_at ? `<button type="button" class="btn-secondary btn-sm" data-click="archiveTask" data-args='[${task.id}]'>${ICON.archive} Arsipkan</button>` : ''}
      ${live && task.archived_at ? `<button type="button" class="btn-secondary btn-sm" data-click="unarchiveTask" data-args='[${task.id}]'>${ICON.restore} Kembalikan dari arsip</button>` : ''}
      ${live ? `<button type="button" class="btn-danger btn-sm" data-click="deleteTask" data-args='[${task.id}]'>${ICON.trash} Pindah ke sampah</button>` : `
        <button type="button" class="btn-secondary btn-sm" data-click="restoreTask" data-args='[${task.id}]'>${ICON.restore} Pulihkan</button>
        <button type="button" class="btn-danger btn-sm" data-click="purgeTask" data-args='[${task.id}]'>Hapus permanen</button>`}
    </div>` : '';

  const memberButton = !owner && live && !task.archived_at && canWorkHere && waiting
    ? `<p class="field-hint" style="margin-top: 0.75rem;">Tugas belum dimulai. Anda bisa mengerjakannya setelah Owner memindahkannya ke In Progress.</p>`
    : !owner && live && !task.archived_at && !isDone(task) && !task.done_reported_at && canWorkHere
    ? `<div class="form-actions" style="justify-content: flex-start; margin-top: 1rem;">
         <button type="button" class="btn-primary btn-sm" data-click="openReportModal" data-args='[${task.id}]'>${ICON.done} Lapor selesai</button>
       </div>` : '';

  body.innerHTML = `
    <section class="detail-section" aria-label="Ringkasan">
      <div class="kanban-card-tags">
        <span class="badge ${STATUS_BADGE[task.status] || 'badge-todo'}">${escapeHtml(task.status)}</span>
        ${reportedBadge(task)}
        ${isDone(task) ? '' : deadlineBadge(task.due_date)}
        ${task.archived_at ? '<span class="badge badge-todo">Diarsipkan</span>' : ''}
        ${task.deleted_at ? '<span class="badge badge-overdue">Di tempat sampah</span>' : ''}
      </div>
      <dl class="detail-meta" style="margin-top: 0.75rem;">
        <div><dt>Tenggat</dt><dd class="font-mono">${formatDateWIB(task.due_date)}</dd></div>
        <div><dt>Penanggung jawab</dt><dd>${escapeHtml(task.assignee_name || '–')}</dd></div>
        <div><dt>Anggota</dt><dd>${task.members?.length
          ? `<span class="member-pills">${task.members.map((m) => `<span class="member-pill">${escapeHtml(m.name)}</span>`).join('')}</span>`
          : 'Semua anggota'}</dd></div>
        <div><dt>Pengulangan</dt><dd>${task.recurrence ? RECURRENCE_LABEL[task.recurrence] : 'Tidak berulang'}</dd></div>
        ${task.completed_at ? `<div><dt>Selesai</dt><dd class="font-mono">${formatDateWIB(task.completed_at)}</dd></div>` : ''}
      </dl>
      ${task.description ? `<p class="detail-desc" style="margin-top: 0.75rem;">${escapeHtml(task.description)}</p>` : ''}
      ${!owner && !canWorkHere ? `<p class="field-hint" style="margin-top: 0.75rem;">Tugas ini ditugaskan ke anggota lain. Anda tetap bisa melihat dan berkomentar.</p>` : ''}
      ${ownerButtons}${memberButton}
    </section>

    <section class="detail-section" aria-labelledby="checklist-heading">
      <h3 id="checklist-heading" class="detail-title"><span>Subtugas</span>${checklist.length ? `<span class="chip-meta">${doneCount}/${checklist.length}</span>` : ''}</h3>
      ${checklist.length ? `<div class="progress-mini" role="progressbar" aria-label="Kemajuan subtugas" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width: ${pct}%"></span></div>` : ''}
      ${checklist.length ? `<ul class="checklist">${checklist.map((c) => `
        <li class="${c.done ? 'is-done' : ''}">
          <label class="check-row">
            <input type="checkbox" ${c.done ? 'checked' : ''} ${canTick ? '' : 'disabled'} data-change="toggleChecklistItem" data-args='[${task.id},${Number(c.id)}]'>
            <span>${escapeHtml(c.text)}${c.done && c.done_by_name ? ` <span class="chip-meta">· ${escapeHtml(c.done_by_name.split(' ')[0])}</span>` : ''}</span>
          </label>
          ${owner && live ? iconBtn('deleteChecklistItem', [task.id, Number(c.id)], ICON.trash, 'Hapus subtugas', escapeHtml(c.text), ' is-danger') : ''}
        </li>`).join('')}</ul>` : '<p class="field-hint">Belum ada subtugas.</p>'}
      ${owner && live ? `
        <form class="add-row" data-form="checklist" data-task="${task.id}" style="margin-top: 0.625rem;">
          <label for="checklist-new" class="sr-only">Subtugas baru</label>
          <input type="text" id="checklist-new" name="text" class="form-input" maxlength="200" placeholder="Tambah subtugas…" required autocomplete="off">
          <button type="submit" class="btn-secondary">Tambah</button>
        </form>` : ''}
    </section>

    <section class="detail-section" aria-labelledby="thread-heading">
      <h3 id="thread-heading" class="detail-title">Komentar &amp; laporan</h3>
      ${comments.length ? `<ul class="thread">${comments.map((m) => `
        <li class="thread-item kind-${escapeHtml(m.kind)}">
          <div class="thread-head">
            <span><strong>${escapeHtml(m.user_name || 'Pengguna dihapus')}</strong>${KIND_LABEL[m.kind] ? ` · ${KIND_LABEL[m.kind]}` : ''}</span>
            <span>
              <span class="font-mono">${formatDateWIB(m.created_at)}</span>
              ${m.kind === 'comment' && live && (owner || Number(m.user_id) === myId())
                ? `<button type="button" class="btn-ghost btn-sm" data-click="deleteComment" data-args='[${task.id},${Number(m.id)}]' aria-label="Hapus komentar">Hapus</button>` : ''}
            </span>
          </div>
          <p class="thread-body">${escapeHtml(m.body)}</p>
          ${linkHtml(m.link_url)}
        </li>`).join('')}</ul>` : '<p class="field-hint">Belum ada komentar.</p>'}
      ${live ? `
        <form data-form="comment" data-task="${task.id}" style="margin-top: 0.75rem;">
          <div class="field">
            <label for="comment-body" class="field-label">Tulis komentar</label>
            <textarea id="comment-body" name="body" class="form-textarea" rows="2" maxlength="2000" required></textarea>
          </div>
          <div class="field">
            <label for="comment-link" class="field-label">Tautan (opsional)</label>
            <input type="url" id="comment-link" name="link" class="form-input" maxlength="500" placeholder="https://…" inputmode="url" autocomplete="off">
          </div>
          <div class="form-actions"><button type="submit" class="btn-primary btn-sm">Kirim komentar</button></div>
        </form>` : ''}
    </section>

    <section class="detail-section" aria-labelledby="activity-heading">
      <h3 id="activity-heading" class="detail-title">Riwayat</h3>
      ${activity.length ? `<ul class="activity-list">${activity.map((a) => `
        <li><strong>${escapeHtml(a.user_name || 'Sistem')}</strong> ${ACTIVITY_LABEL[a.action] || escapeHtml(a.action)}${a.detail ? `: ${escapeHtml(a.detail)}` : ''}
          <span class="font-mono"> · ${formatDateWIB(a.created_at)}</span></li>`).join('')}</ul>` : '<p class="field-hint">Belum ada riwayat.</p>'}
    </section>`;
}

async function toggleChecklistItem(taskId, itemId) {
  const box = this;
  box.disabled = true;
  try {
    await apiFetch(`/api/tasks/${taskId}/checklist/${itemId}`, { method: 'PUT', body: JSON.stringify({ done: box.checked }) });
    refreshAfterChange(taskId);
  } catch (err) {
    box.checked = !box.checked;
    box.disabled = false;
  }
}

async function deleteChecklistItem(taskId, itemId) {
  if (!confirm('Hapus subtugas ini?')) return;
  try {
    await apiFetch(`/api/tasks/${taskId}/checklist/${itemId}`, { method: 'DELETE' });
    refreshAfterChange(taskId);
  } catch (err) {}
}

async function deleteComment(taskId, itemId) {
  if (!confirm('Hapus komentar ini?')) return;
  try {
    await apiFetch(`/api/tasks/${taskId}/comments/${itemId}`, { method: 'DELETE' });
    refreshAfterChange(taskId);
  } catch (err) {}
}

// Forms inside the detail panel are re-rendered, so handle their submit by delegation.
document.getElementById('detail-body').addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const taskId = Number(form.dataset.task);
  const btn = form.querySelector('[type="submit"]');
  btn.disabled = true;
  try {
    if (form.dataset.form === 'checklist') {
      await apiFetch(`/api/tasks/${taskId}/checklist`, { method: 'POST', body: JSON.stringify({ text: form.elements.text.value }) });
    } else {
      await apiFetch(`/api/tasks/${taskId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: form.elements.body.value, link: form.elements.link.value.trim() }),
      });
      showToast('Komentar terkirim.', 'success');
    }
    const focusId = form.dataset.form === 'checklist' ? 'checklist-new' : 'comment-body';
    loadTasks(true);
    await loadTaskDetail(taskId);
    document.getElementById(focusId)?.focus();
  } catch (err) {
    btn.disabled = false;
  }
});

// Member filter: Owner picks any member; members get "Tugas saya".
async function fillMemberFilter() {
  const select = document.getElementById('filter-member');
  if (!isOwnerView()) {
    select.innerHTML = '<option value="">Semua tugas</option><option value="me">Tugas saya</option>';
    return;
  }
  try {
    const res = await apiFetch('/api/users');
    select.innerHTML = '<option value="">Semua anggota</option>' + (res.data || [])
      .filter((u) => u.role === 'User' && u.status === 'Active')
      .map((u) => `<option value="${Number(u.id)}">${escapeHtml(u.name)}</option>`).join('');
  } catch { /* filter stays at "Semua anggota" */ }
}

navReady.then(async (user) => {
  if (!user) return;
  await fillMemberFilter();
  loadTasks();
  const fromUrl = new URLSearchParams(location.search).get('task');
  if (fromUrl && /^\d+$/.test(fromUrl)) openTaskDetail(Number(fromUrl));
});
