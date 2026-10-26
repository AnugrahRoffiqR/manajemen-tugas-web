// Toggle Password Visibility
const pwdInput = document.getElementById('password');
const toggleBtn = document.getElementById('toggle-pwd-btn');
toggleBtn.addEventListener('click', () => {
  const show = pwdInput.type === 'password';
  pwdInput.type = show ? 'text' : 'password';
  toggleBtn.textContent = show ? 'Sembunyikan' : 'Lihat Sandi';
  toggleBtn.setAttribute('aria-pressed', String(show));
});

// Form Submit Listener
const form = document.getElementById('login-form');
const submitBtn = document.getElementById('submit-btn');
const btnText = document.getElementById('btn-text');
const btnSpinner = document.getElementById('btn-spinner');
const errorAlert = document.getElementById('error-alert');
const errorMessage = document.getElementById('error-message');
const twofaForm = document.getElementById('twofa-form');
const twofaCode = document.getElementById('twofa-code');
const twofaBtn = document.getElementById('twofa-btn');
const IDLE_LABEL = 'Masuk ke Sistem';
let challenge = null;

// Toggle the submit button between idle and loading (cold DB start can take several seconds)
function setLoading(loading) {
  submitBtn.disabled = loading;
  submitBtn.setAttribute('aria-busy', String(loading));
  btnSpinner.classList.toggle('hidden', !loading);
  btnText.textContent = loading ? 'Memverifikasi…' : IDLE_LABEL;
}

function showError(message) {
  errorMessage.textContent = message;
  errorAlert.style.display = 'flex';
}

function goToDashboard(message) {
  showToast(message || 'Login berhasil! Mengalihkan...', 'success');
  setTimeout(() => {
    window.location.href = '/dashboard';
  }, 600);
}

function showStep(step) {
  const isCode = step === 'code';
  form.classList.toggle('hidden', isCode);
  twofaForm.classList.toggle('hidden', !isCode);
  document.querySelector('.auth-title').textContent = isCode ? 'Verifikasi Dua Langkah' : 'Masuk';
  document.querySelector('.auth-head .page-sub').textContent = isCode
    ? 'Kata sandi benar. Satu langkah lagi untuk masuk.'
    : 'Masuk untuk mengelola workspace tim Anda.';
  (isCode ? twofaCode : document.getElementById('email')).focus();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // Platform error pages are HTML; don't misreport them as a network failure.
  const data = await response.json().catch(() => ({ message: 'Server sedang bermasalah. Coba lagi beberapa saat.' }));
  return { ok: response.ok, data };
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorAlert.style.display = 'none';
  setLoading(true);

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  try {
    const { ok, data } = await postJson('/api/auth/login', { email, password });
    if (ok && data.twoFactorRequired) {
      challenge = data.challenge;
      setLoading(false);
      showStep('code');
    } else if (ok && data.success) {
      goToDashboard(data.message);
    } else {
      showError(data.message || 'Email atau kata sandi tidak sesuai.');
      setLoading(false);
    }
  } catch (err) {
    showError('Gagal terhubung ke server backend. Periksa koneksi internet Anda.');
    setLoading(false);
  }
});

twofaCode.addEventListener('input', () => {
  twofaCode.value = twofaCode.value.replace(/\D/g, '').slice(0, 6);
});

twofaForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorAlert.style.display = 'none';
  twofaBtn.disabled = true;
  twofaBtn.setAttribute('aria-busy', 'true');
  try {
    const { ok, data } = await postJson('/api/auth/login/2fa', { challenge, code: twofaCode.value });
    if (ok && data.success) {
      goToDashboard(data.message);
      return;
    }
    showError(data.message || 'Kode verifikasi salah.');
    if (data.error === 'CHALLENGE_EXPIRED') {
      challenge = null;
      twofaForm.reset();
      showStep('password');
    } else {
      twofaCode.select();
    }
  } catch (err) {
    showError('Gagal terhubung ke server backend. Periksa koneksi internet Anda.');
  }
  twofaBtn.disabled = false;
  twofaBtn.setAttribute('aria-busy', 'false');
});

document.getElementById('twofa-back').addEventListener('click', () => {
  challenge = null;
  twofaForm.reset();
  errorAlert.style.display = 'none';
  showStep('password');
});
