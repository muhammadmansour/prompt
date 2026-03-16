// ─── Login Page Logic ────────────────────────────────────────

const loginForm = document.getElementById('login-form');
const emailInput = document.getElementById('login-email');
const passwordInput = document.getElementById('login-password');
const submitBtn = document.getElementById('login-submit');
const errorBox = document.getElementById('login-error');
const errorMsg = document.getElementById('login-error-msg');
const togglePw = document.getElementById('toggle-pw');

// If already authenticated, verify token and redirect
(async function checkExistingAuth() {
  const hasCookie = document.cookie.split(';').some(c => c.trim().startsWith('wathba_token='));
  if (!hasCookie) return;
  try {
    const r = await fetch('/api/auth/check');
    const d = await r.json();
    if (d.authenticated) {
      window.location.replace('/admin.html');
    } else {
      // Token invalid (e.g. server restarted) — clear stale cookie
      document.cookie = 'wathba_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    }
  } catch (e) {
    // API unreachable — clear cookie to avoid redirect loop
    document.cookie = 'wathba_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  }
})();

// Toggle password visibility
togglePw.addEventListener('click', () => {
  const isPassword = passwordInput.type === 'password';
  passwordInput.type = isPassword ? 'text' : 'password';
  togglePw.title = isPassword ? 'Hide password' : 'Show password';
});

// Feature carousel
let currentFeature = 0;
const features = document.querySelectorAll('.login-feature-card');
const dots = document.querySelectorAll('.login-dot');

function showFeature(idx) {
  features.forEach((f, i) => f.classList.toggle('active', i === idx));
  dots.forEach((d, i) => d.classList.toggle('active', i === idx));
  currentFeature = idx;
}

dots.forEach(d => d.addEventListener('click', () => showFeature(Number(d.dataset.i))));

setInterval(() => {
  showFeature((currentFeature + 1) % features.length);
}, 4000);

// Submit
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.classList.add('hidden');

  const username = emailInput.value.trim();
  const password = passwordInput.value;

  if (!username || !password) {
    showError('Please enter both username and password.');
    return;
  }

  const btnText = submitBtn.querySelector('.login-submit-text');
  const btnLoading = submitBtn.querySelector('.login-submit-loading');

  try {
    submitBtn.disabled = true;
    btnText.classList.add('hidden');
    btnLoading.classList.remove('hidden');

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Invalid credentials');
    }

    // Set auth cookie (expires in 7 days)
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = `wathba_token=${data.token}; path=/; expires=${expires}; SameSite=Lax`;

    // Redirect to admin dashboard
    window.location.replace('/admin.html');

  } catch (err) {
    showError(err.message || 'Login failed. Please try again.');
  } finally {
    submitBtn.disabled = false;
    btnText.classList.remove('hidden');
    btnLoading.classList.add('hidden');
  }
});

function showError(msg) {
  errorMsg.textContent = msg;
  errorBox.classList.remove('hidden');
  emailInput.focus();
}

// Enter key handling
passwordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loginForm.dispatchEvent(new Event('submit'));
});
