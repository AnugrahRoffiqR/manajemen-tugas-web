initNavigation('reminders');

const CHECK_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';

const formEl = document.getElementById('custom-reminder-form');
const toggleBtn = document.getElementById('toggle-reminder-form');

function setFormOpen(open) {
  formEl.classList.toggle('hidden', !open);
  toggleBtn.setAttribute('aria-expanded', String(open));
  if (open) document.getElementById('rem-title').focus();
}
toggleBtn.addEventListener('click', () => setFormOpen(formEl.classList.contains('hidden')));

async function loadReminders() {
  try {
    const res = await apiFetch('/api/reminders/urgent');
    if (res && res.data) {
      const overdue = res.data.overdue_tasks || [];
      const urgent = res.data.urgent_tasks || [];

      document.getElementById('badge-overdue-count').textContent = overdue.length;
      document.getElementById('badge-urgent-count').textContent = urgent.length;

      document.getElementById('overdue-list').innerHTML = overdue.length
        ? overdue.map(t => createReminderCard(t, 'overdue')).join('')
        : `<div class="note">${CHECK_SVG}<span>Tidak ada tugas yang lewat tenggat.</span></div>`;

      document.getElementById('urgent-list').innerHTML = urgent.length
        ? urgent.map(t => createReminderCard(t, 'urgent')).join('')
        : `<div class="note">${CHECK_SVG}<span>Tidak ada tugas yang jatuh tempo dalam 24 jam.</span></div>`;
    }

    const customRes = await apiFetch('/api/reminders');
    const customContainer = document.getElementById('custom-reminders-list');
    const items = (customRes && customRes.data) || [];
    customContainer.innerHTML = items.length
      ? items.map(r => `
        <div class="card list-row">
          <div class="list-row-main">
            <p class="list-row-title">${escapeHtml(r.title)}</p>
            <p class="list-row-meta font-mono">${formatDateWIB(r.remind_at)}</p>
          </div>
          <button type="button" data-click="deleteCustomReminder" data-args='[${Number(r.id)}]' class="btn-danger btn-sm" aria-label="Hapus pengingat: ${escapeHtml(r.title)}">Hapus</button>
        </div>`).join('')
      : '<div class="empty-state-box compact">Belum ada pengingat mandiri.</div>';
  } catch (err) {
    showLoadError(['#overdue-list .loading-text', '#urgent-list .loading-text', '#custom-reminders-list .loading-text'], 'loadReminders', err);
  }
}

function createReminderCard(task, type) {
  const isOverdue = type === 'overdue';
  const title = escapeHtml(task.title);
  return `
    <div class="card list-row ${isOverdue ? 'tone-overdue' : 'tone-urgent'}">
      <div class="list-row-main">
        <div class="list-row-tags">
          <span class="badge ${isOverdue ? 'badge-overdue' : 'badge-urgent'}">${formatHoursRemaining(task.hours_left)}</span>
          ${categoryBadge(task.category)}
        </div>
        <p class="list-row-title">${title}</p>
        <p class="list-row-meta">Tenggat <span class="font-mono">${formatDateWIB(task.due_date)}</span></p>
      </div>
      <div class="list-row-actions">
        <a href="/tasks" class="btn-secondary btn-sm">Buka di Board</a>
        <button type="button" data-click="completeTaskNow" data-args='[${Number(task.id)}]' class="btn-primary btn-sm" aria-label="Tandai selesai: ${title}">Tandai Selesai</button>
      </div>
    </div>`;
}

async function completeTaskNow(taskId) {
  try {
    await apiFetch(`/api/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'Done' }),
    });
    showToast('Tugas berhasil diselesaikan!', 'success');
    loadReminders();
  } catch (e) {}
}

async function deleteCustomReminder(id) {
  try {
    await apiFetch(`/api/reminders/${id}`, { method: 'DELETE' });
    showToast('Pengingat dihapus.', 'info');
    loadReminders();
  } catch (e) {}
}

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('rem-title').value;
  const remind_at = localInputToISO(document.getElementById('rem-time').value);

  try {
    await apiFetch('/api/reminders', {
      method: 'POST',
      body: JSON.stringify({ title, remind_at }),
    });
    showToast('Pengingat berhasil dijadwalkan!', 'success');
    formEl.reset();
    setDefaultTime();
    setFormOpen(false);
    loadReminders();
  } catch (e) {}
});

// Default: 3 jam dari sekarang
function setDefaultTime() {
  const nowPlus3 = new Date(Date.now() + 3 * 3600000);
  const tzOffset = nowPlus3.getTimezoneOffset() * 60000;
  document.getElementById('rem-time').value = new Date(nowPlus3.getTime() - tzOffset).toISOString().slice(0, 16);
}
setDefaultTime();

loadReminders();
