/**
 * auth.js — klip V2
 * Pantalla de login/registro. Se muestra antes de la app si no hay sesión.
 * Sin frameworks, sin librerías externas.
 */

// ==================== RENDER AUTH SCREEN ====================
function renderAuthScreen() {
  const app = document.getElementById('app');
  app.style.display = 'none';

  const authEl = document.getElementById('auth-screen');
  if (authEl) {
    currentAuthTab = 'login';
    document.querySelectorAll('.auth-tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.tab === 'login');
    });
    const submitBtn = document.getElementById('auth-submit-btn');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Iniciar sesión';
    }
    clearAuthError();
    authEl.style.display = 'flex';
    return;
  }

  const screen = document.createElement('div');
  screen.id = 'auth-screen';
  screen.innerHTML = `
    <div class="auth-card">
      <div class="auth-logo-wrap">
        <img src="./public/logo.svg" alt="klip" class="auth-logo">
      </div>
      <p class="auth-tagline">Tus tareas, en un solo lugar.</p>

      <div class="auth-tabs">
        <button class="auth-tab active" data-tab="login">Iniciar sesión</button>
        <button class="auth-tab" data-tab="register">Crear cuenta</button>
      </div>

      <form id="auth-form" class="auth-form" autocomplete="on" novalidate>
        <div class="form-group">
          <label class="form-label" for="auth-email">Correo electrónico</label>
          <input type="email" id="auth-email" class="form-input" placeholder="tu@correo.com" required autocomplete="email">
        </div>
        <div class="form-group">
          <label class="form-label" for="auth-password">Contraseña</label>
          <input type="password" id="auth-password" class="form-input" placeholder="••••••••" required autocomplete="current-password" minlength="6">
        </div>
        <p id="auth-error" class="auth-error" role="alert" aria-live="polite"></p>
        <button type="submit" id="auth-submit-btn" class="btn btn-primary auth-btn">Iniciar sesión</button>
      </form>
    </div>
  `;

  document.body.appendChild(screen);
  bindAuthEvents();

  // Focus email input
  setTimeout(() => {
    const emailInput = screen.querySelector('#auth-email');
    if (emailInput) emailInput.focus();
  }, 100);
}

function hideAuthScreen() {
  const authEl = document.getElementById('auth-screen');
  if (authEl) authEl.style.display = 'none';
  document.getElementById('app').style.display = '';
}

// ==================== AUTH EVENTS ====================
let currentAuthTab = 'login';

function bindAuthEvents() {
  const form = document.getElementById('auth-form');
  const tabs = document.querySelectorAll('.auth-tab');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      currentAuthTab = tab.dataset.tab;
      tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === currentAuthTab));
      const submitBtn = document.getElementById('auth-submit-btn');
      submitBtn.textContent = currentAuthTab === 'login' ? 'Iniciar sesión' : 'Crear cuenta';
      clearAuthError();
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleAuthSubmit();
  });
}

async function handleAuthSubmit() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const submitBtn = document.getElementById('auth-submit-btn');

  if (!email || !password) {
    showAuthError('Completá todos los campos.');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = currentAuthTab === 'login' ? 'Entrando...' : 'Creando cuenta...';
  clearAuthError();

  try {
    if (currentAuthTab === 'login') {
      await window.SupabaseClient.signIn(email, password);
    } else {
      const result = await window.SupabaseClient.signUp(email, password);
      // Supabase puede pedir confirmación de email según config
      if (result?.user && !result?.access_token) {
        showAuthError('Revisá tu correo para confirmar la cuenta, luego volvé e iniciá sesión.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Crear cuenta';
        return;
      }
    }
    // Si llegamos acá, login fue exitoso
    submitBtn.disabled = false;
    submitBtn.textContent = currentAuthTab === 'login' ? 'Iniciar sesión' : 'Crear cuenta';
    hideAuthScreen();
    await window.__onAuthSuccess();
  } catch (err) {
    const msg = translateAuthError(err.message);
    showAuthError(msg);
    submitBtn.disabled = false;
    submitBtn.textContent = currentAuthTab === 'login' ? 'Iniciar sesión' : 'Crear cuenta';
  }
}

function translateAuthError(message) {
  if (!message) return 'Error desconocido.';
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials') || m.includes('invalid_credentials')) {
    return 'Correo o contraseña incorrectos.';
  }
  if (m.includes('user already registered') || m.includes('already exists')) {
    return 'Ya existe una cuenta con ese correo. Iniciá sesión.';
  }
  if (m.includes('email not confirmed')) {
    return 'Confirmá tu correo antes de iniciar sesión.';
  }
  if (m.includes('password should be at least 6')) {
    return 'La contraseña debe tener al menos 6 caracteres.';
  }
  if (m.includes('unable to validate') || m.includes('token')) {
    return 'Sesión expirada. Volvé a iniciar sesión.';
  }
  return message;
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  if (el) el.textContent = msg;
}

function clearAuthError() {
  const el = document.getElementById('auth-error');
  if (el) el.textContent = '';
}

// ==================== EXPORTAR ====================
window.Auth = {
  renderAuthScreen,
  hideAuthScreen,
  showAuthError,
  translateAuthError
};
