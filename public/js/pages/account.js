initNavigation('account');

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

loadTwoFactorStatus();
