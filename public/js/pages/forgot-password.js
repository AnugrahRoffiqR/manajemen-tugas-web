const form = document.getElementById('forgot-form');
const submitBtn = document.getElementById('submit-btn');
const errorAlert = document.getElementById('error-alert');
const successAlert = document.getElementById('success-alert');
const emailInput = document.getElementById('email');
const memberResult = document.getElementById('member-result');
const waLink = document.getElementById('wa-owner');
const noContact = document.getElementById('no-contact');
const retryBtn = document.getElementById('retry-btn');
const captcha = mountCaptcha(document.getElementById('captcha-box'), 'forgot');

function show(el, message) {
  errorAlert.classList.add('hidden');
  successAlert.classList.add('hidden');
  el.textContent = message;
  el.classList.remove('hidden');
}

// Prefilled message carries the email so the Owner knows which account to reset.
async function showContactOwner(email) {
  memberResult.classList.remove('hidden');
  let wa = null;
  try {
    wa = (await (await fetch('/api/auth/contact')).json()).data?.whatsapp;
  } catch {}
  if (wa) {
    const text = `Halo, saya minta reset kata sandi Manajemen Tugas untuk akun ${email}.`;
    waLink.href = `https://wa.me/${wa}?text=${encodeURIComponent(text)}`;
    waLink.classList.remove('hidden');
    waLink.focus();
  } else {
    noContact.classList.remove('hidden');
  }
}

function setBusy(busy) {
  submitBtn.disabled = busy;
  submitBtn.setAttribute('aria-busy', String(busy));
  submitBtn.textContent = busy ? 'Memeriksa…' : 'Lanjutkan';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = emailInput.value.trim();
  if (captcha.enabled && !captcha.token()) {
    show(errorAlert, 'Selesaikan verifikasi keamanan terlebih dahulu.');
    return;
  }
  setBusy(true);
  try {
    const response = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, turnstile_token: captcha.token() || undefined }),
    });
    captcha.reset();
    const data = await response.json().catch(() => ({ message: 'Server sedang bermasalah. Coba lagi beberapa saat.' }));
    if (response.ok) {
      show(successAlert, data.message);
      form.classList.add('hidden');
      retryBtn.classList.remove('hidden');
      if (data.data?.account !== 'owner') await showContactOwner(email);
      else retryBtn.focus();
    } else {
      show(errorAlert, data.message || 'Permintaan gagal. Coba lagi.');
      if (data.error === 'EMAIL_NOT_FOUND') emailInput.focus();
    }
  } catch {
    captcha.reset();
    show(errorAlert, 'Gagal terhubung ke server. Periksa koneksi internet Anda.');
  }
  setBusy(false);
});

retryBtn.addEventListener('click', () => {
  [successAlert, errorAlert, memberResult, waLink, noContact, retryBtn].forEach((el) => el.classList.add('hidden'));
  form.classList.remove('hidden');
  emailInput.select();
  emailInput.focus();
});
