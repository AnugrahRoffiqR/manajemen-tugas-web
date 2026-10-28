const navReady = initNavigation('account');

const panels = ['twofa-off', 'twofa-setup', 'twofa-on'];

function showPanel(id) {
  panels.forEach((p) => document.getElementById(p).classList.toggle('hidden', p !== id));
  const badge = document.getElementById('twofa-badge');
  const on = id === 'twofa-on';
  badge.textContent = on ? 'Aktif' : 'Nonaktif';
  badge.className = `badge ${on ? 'badge-done' : 'badge-todo'}`;
}

async function loadTwoFactorStatus() {
  try {
    const res = await apiFetch('/api/auth/me');
    showPanel(res.data.totp_enabled ? 'twofa-on' : 'twofa-off');
    document.getElementById('profile-name').value = res.data.name || '';
    document.getElementById('profile-email').value = res.data.email || '';
    document.getElementById('profile-email-notif').checked = res.data.email_notifications !== false;
  } catch (err) {
    if (!err.handled) document.getElementById('twofa-badge').textContent = 'Gagal memuat';
  }
}

async function startTwoFactorSetup() {
  const btn = document.getElementById('start-setup-btn');
  btn.disabled = true;
  try {
    const res = await apiFetch('/api/auth/2fa/setup', { method: 'POST' });
    // Groups of 4 are easier to type into an authenticator app.
    document.getElementById('twofa-secret').textContent = res.data.secret.match(/.{1,4}/g).join(' ');
    document.getElementById('twofa-link').href = res.data.otpauthUri;
    showPanel('twofa-setup');
    document.getElementById('enable-code').focus();
  } catch (err) {
    // apiFetch already showed the error toast
  } finally {
    btn.disabled = false;
  }
}

function cancelTwoFactorSetup() {
  document.getElementById('enable-form').reset();
  showPanel('twofa-off');
}

async function copySecret() {
  const text = document.getElementById('twofa-secret').textContent.replace(/\s/g, '');
  try {
    await navigator.clipboard.writeText(text);
    showToast('Kunci disalin.', 'success');
  } catch {
    showToast('Tidak bisa menyalin otomatis. Ketik kunci secara manual.', 'warning');
  }
}

document.getElementById('enable-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('enable-btn');
  btn.disabled = true;
  try {
    const res = await apiFetch('/api/auth/2fa/enable', {
      method: 'POST',
      body: JSON.stringify({ code: document.getElementById('enable-code').value.trim() }),
    });
    showToast(res.message, 'success');
    e.target.reset();
    showPanel('twofa-on');
  } catch (err) {
    document.getElementById('enable-code').select();
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('disable-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('disable-btn');
  btn.disabled = true;
  try {
    const res = await apiFetch('/api/auth/2fa/disable', {
      method: 'POST',
      body: JSON.stringify({
        password: document.getElementById('disable-password').value,
        code: document.getElementById('disable-code').value.trim(),
      }),
    });
    showToast(res.message, 'success');
    e.target.reset();
    showPanel('twofa-off');
  } catch (err) {
    // apiFetch already showed the error toast
  } finally {
    btn.disabled = false;
  }
});

// Keep only digits in the code fields (paste from apps often adds spaces).
document.querySelectorAll('.code-input').forEach((input) => {
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, 6);
  });
});

document.getElementById('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('profile-btn');
  btn.disabled = true;
  try {
    const res = await apiFetch('/api/auth/profile', {
      method: 'PUT',
      body: JSON.stringify({
        name: document.getElementById('profile-name').value,
        email_notifications: document.getElementById('profile-email-notif').checked,
      }),
    });
    showToast(res.message || 'Profil disimpan.', 'success');
    // Sidebar/topbar show the name from the session; refresh so they pick up the change.
    document.querySelectorAll('.profile-name').forEach((el) => { el.textContent = res.data.name; });
  } catch (err) {
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const next = document.getElementById('pw-new');
  const confirmInput = document.getElementById('pw-confirm');
  if (next.value !== confirmInput.value) {
    showToast('Konfirmasi kata sandi tidak sama.', 'error');
    confirmInput.focus();
    return;
  }
  const btn = document.getElementById('password-btn');
  btn.disabled = true;
  try {
    const res = await apiFetch('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password: document.getElementById('pw-current').value, new_password: next.value }),
    });
    showToast(res.message, 'success');
    e.target.reset();
  } catch (err) {
  } finally {
    btn.disabled = false;
  }
});

async function loadErrorLogs() {
  const list = document.getElementById('error-log-list');
  try {
    const res = await apiFetch('/api/error-logs');
    const logs = res.data || [];
    document.getElementById('clear-errors-btn').disabled = !logs.length;
    list.innerHTML = logs.length
      ? logs.map((l) => `
        <div class="log-item">
          <div class="thread-head">
            <span><span class="badge ${l.source === 'client' ? 'badge-in-progress' : 'badge-overdue'}">${l.source === 'client' ? 'Browser' : 'Server'}</span>
              <strong>${escapeHtml(l.tag || '')}</strong></span>
            <span class="font-mono">${formatDateWIB(l.created_at)}</span>
          </div>
          <p class="thread-body">${escapeHtml(l.message)}</p>
          <p class="field-hint">${escapeHtml(l.path || '')}${l.user_name ? ` · ${escapeHtml(l.user_name)}` : ''}</p>
          ${l.stack ? `<details><summary>Stack trace</summary><pre>${escapeHtml(l.stack)}</pre></details>` : ''}
        </div>`).join('')
      : '<p class="field-hint">Tidak ada error tercatat.</p>';
  } catch (err) {
    showLoadError(['#error-log-list'], 'loadErrorLogs', err);
  }
}

async function clearErrorLogs() {
  if (!confirm('Hapus semua log error?')) return;
  try {
    const res = await apiFetch('/api/error-logs', { method: 'DELETE' });
    showToast(res.message, 'success');
    loadErrorLogs();
  } catch (err) {}
}

loadTwoFactorStatus();
navReady.then((user) => { if (user?.role === 'Owner') loadErrorLogs(); });
