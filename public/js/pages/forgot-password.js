const form = document.getElementById('forgot-form');
const submitBtn = document.getElementById('submit-btn');
const errorAlert = document.getElementById('error-alert');
const successAlert = document.getElementById('success-alert');

function show(el, message) {
  errorAlert.classList.add('hidden');
  successAlert.classList.add('hidden');
  el.textContent = message;
  el.classList.remove('hidden');
}

const waLink = document.getElementById('wa-owner');
const emailInput = document.getElementById('email');
let waNumber = null;

// Prefilled message carries the typed email so the Owner knows which account to reset.
function updateWaLink() {
  if (!waNumber) return;
  const email = emailInput.value.trim();
  const text = `Halo, saya minta reset kata sandi Manajemen Tugas${email ? ` untuk akun ${email}` : ''}.`;
  waLink.href = `https://wa.me/${waNumber}?text=${encodeURIComponent(text)}`;
}

fetch('/api/auth/contact')
  .then((r) => r.json())
  .then(({ data }) => {
    if (!data?.whatsapp) return;
    waNumber = data.whatsapp;
    updateWaLink();
    waLink.classList.remove('hidden');
  })
  .catch(() => {});
emailInput.addEventListener('input', updateWaLink);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  submitBtn.disabled = true;
  submitBtn.setAttribute('aria-busy', 'true');
  submitBtn.textContent = 'Mengirim…';
  try {
    const response = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: document.getElementById('email').value.trim() }),
    });
    const data = await response.json().catch(() => ({ message: 'Server sedang bermasalah. Coba lagi beberapa saat.' }));
    if (response.ok) {
      show(successAlert, data.message);
      form.classList.add('hidden');
      return;
    }
    show(errorAlert, data.message || 'Permintaan gagal. Coba lagi.');
  } catch {
    show(errorAlert, 'Gagal terhubung ke server. Periksa koneksi internet Anda.');
  }
  submitBtn.disabled = false;
  submitBtn.setAttribute('aria-busy', 'false');
  submitBtn.textContent = 'Kirim tautan reset';
});
