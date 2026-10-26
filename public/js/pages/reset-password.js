const form = document.getElementById('reset-form');
const submitBtn = document.getElementById('submit-btn');
const errorAlert = document.getElementById('error-alert');
const successAlert = document.getElementById('success-alert');
const pwd = document.getElementById('password');
const confirmPwd = document.getElementById('password-confirm');

// The token arrives in the URL fragment; remove it from the address bar and history right away.
const token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
history.replaceState(null, '', location.pathname);

function show(el, message) {
  errorAlert.classList.add('hidden');
  successAlert.classList.add('hidden');
  el.textContent = message;
  el.classList.remove('hidden');
}

function linkInvalid(message) {
  show(errorAlert, message);
  form.classList.add('hidden');
  const link = document.getElementById('login-link');
  link.href = '/forgot-password';
  link.textContent = 'Minta tautan reset baru';
}

if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
  linkInvalid('Tautan reset tidak lengkap atau sudah tidak berlaku. Minta tautan baru.');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (pwd.value !== confirmPwd.value) {
    show(errorAlert, 'Kedua kata sandi tidak sama.');
    confirmPwd.focus();
    return;
  }
  submitBtn.disabled = true;
  submitBtn.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: pwd.value }),
    });
    const data = await response.json().catch(() => ({ message: 'Server sedang bermasalah. Coba lagi beberapa saat.' }));
    if (response.ok) {
      show(successAlert, data.message);
      form.classList.add('hidden');
      document.getElementById('login-link').textContent = 'Masuk sekarang';
      return;
    }
    if (data.error === 'INVALID_RESET_TOKEN') {
      linkInvalid(data.message);
      return;
    }
    show(errorAlert, data.message || 'Gagal menyimpan kata sandi.');
  } catch {
    show(errorAlert, 'Gagal terhubung ke server. Periksa koneksi internet Anda.');
  }
  submitBtn.disabled = false;
  submitBtn.setAttribute('aria-busy', 'false');
});
