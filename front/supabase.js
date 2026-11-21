/**
 * supabase.js — klip V2
 * Cliente Supabase ultraliviano sin npm ni bundler.
 * Gestiona auth (email+password) y sincronización de datos.
 */

const SUPABASE_URL = 'https://gcmdlpaehqiujymxiysj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_mh8HXeGkqjxJghs6IQ_R-g_byKeBZxQ';

const SESSION_STORAGE_KEY = 'klip_session';
let refreshInFlight = null;

// ==================== HELPER HTTP ====================
async function supaFetch(path, options = {}) {
  const session = getSession();
  const isAuthRequest = path.startsWith('/auth/v1/');
  const headers = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
    // Login/signup/refresh must not inherit an expired user's access token.
    'Authorization': isAuthRequest
      ? `Bearer ${SUPABASE_ANON_KEY}`
      : (session?.access_token ? `Bearer ${session.access_token}` : `Bearer ${SUPABASE_ANON_KEY}`),
    'Prefer': 'return=representation',
    ...options.headers
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), isAuthRequest ? 15000 : 30000);
  let res;
  try {
    const { signal: callerSignal, ...fetchOptions } = options;
    res = await fetch(`${SUPABASE_URL}${path}`, {
      ...fetchOptions,
      signal: callerSignal || controller.signal,
      headers
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(isAuthRequest
        ? 'Supabase no respondió a tiempo. Revisa tu conexión e intenta de nuevo.'
        : 'La sincronización tardó demasiado; tus cambios siguen guardados localmente.');
    }
    throw new Error('No se pudo conectar con Supabase. Revisa tu conexión e intenta de nuevo.');
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    const detail = [err.message, err.msg, err.error_description, err.details, err.hint].filter(Boolean).join(' — ');
    const error = new Error(detail || `Error Supabase (${res.status})`);
    error.status = res.status;
    error.code = err.code || err.error || null;
    throw error;
  }

  // PostgREST returns an empty body for 204 and for successful return=minimal upserts.
  const responseBody = await res.text();
  if (!responseBody.trim()) return null;
  return JSON.parse(responseBody);
}

// ==================== SESSION MANAGEMENT ====================
function saveSession(session) {
  if (session) {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

function getSession() {
  const persistentSession = localStorage.getItem(SESSION_STORAGE_KEY);
  const legacySession = sessionStorage.getItem(SESSION_STORAGE_KEY);
  const storedSession = persistentSession || legacySession;
  if (!storedSession) return null;
  try {
    const session = JSON.parse(storedSession);
    if (!persistentSession) localStorage.setItem(SESSION_STORAGE_KEY, storedSession);
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    return session;
  } catch {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}

function getCurrentUserId() {
  const session = getSession();
  return session?.user?.id || null;
}

function isLoggedIn() {
  const session = getSession();
  if (!session) return false;
  // Verificar expiración del token
  try {
    const payload = JSON.parse(atob(session.access_token.split('.')[1]));
    return Date.now() < payload.exp * 1000;
  } catch {
    return false;
  }
}

// ==================== AUTH ====================
async function signUp(email, password) {
  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const data = await supaFetch(`/auth/v1/signup?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  // Registration is deliberately separate from login. Never persist signup tokens.
  saveSession(null);
  return data;
}

async function signIn(email, password) {
  const data = await supaFetch('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  if (data.access_token) saveSession(data);
  return data;
}

async function signOut() {
  const session = getSession();
  if (session && navigator.onLine) {
    await supaFetch('/auth/v1/logout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}` }
    }).catch(() => {});
  }
  saveSession(null);
}

function refreshToken() {
  if (refreshInFlight) return refreshInFlight;
  const performRefresh = async () => {
    const session = getSession();
    if (!session?.refresh_token) return null;
    try {
      const expiresIn = getAccessTokenExpiresIn(session);
      // Another open tab may already have refreshed the shared localStorage session.
      if (expiresIn > 60000) return session;
      const data = await supaFetch('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: session.refresh_token })
      });
      if (data.access_token) saveSession(data);
      return data;
    } catch (error) {
      // Keep the refresh token across network/server errors; only discard a token Supabase rejected.
      if (error.status === 400 && /refresh token|session/i.test(error.message)) saveSession(null);
      return null;
    }
  };
  const refresh = () => navigator.locks?.request
    ? navigator.locks.request('klip-supabase-session-refresh', performRefresh)
    : performRefresh();
  refreshInFlight = refresh().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

function getAccessTokenExpiresIn(session) {
  try {
    const payload = JSON.parse(atob(session.access_token.split('.')[1]));
    return payload.exp * 1000 - Date.now();
  } catch {
    return 0;
  }
}

// ==================== SYNC: UPSERT (local → Supabase) ====================
async function upsertSection(section) {
  const userId = getCurrentUserId();
  if (!userId) return;
  await supaFetch('/rest/v1/sections', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ ...section, user_id: userId })
  });
}

async function deleteSection(id) {
  await supaFetch(`/rest/v1/sections?id=eq.${id}`, { method: 'DELETE' });
}

async function upsertList(list) {
  const userId = getCurrentUserId();
  if (!userId) return;
  await supaFetch('/rest/v1/lists', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ ...list, user_id: userId })
  });
}

async function deleteList(id) {
  await supaFetch(`/rest/v1/lists?id=eq.${id}`, { method: 'DELETE' });
}

async function upsertTask(task) {
  const userId = getCurrentUserId();
  if (!userId) return;
  await supaFetch('/rest/v1/tasks', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ ...task, due_date: task.due_date || null, due_time: task.due_time ? task.due_time.slice(0, 5) : null, user_id: userId })
  });
}

async function deleteTask(id) {
  await supaFetch(`/rest/v1/tasks?id=eq.${id}`, { method: 'DELETE' });
}

// ==================== PULL: Supabase → local ====================
async function pullAllData() {
  const userId = getCurrentUserId();
  if (!userId) return null;

  const [sections, lists, tasks] = await Promise.all([
    supaFetch(`/rest/v1/sections?user_id=eq.${userId}&order=position.asc`),
    supaFetch(`/rest/v1/lists?user_id=eq.${userId}&order=position.asc`),
    supaFetch(`/rest/v1/tasks?user_id=eq.${userId}&order=position.asc`)
  ]);

  return { sections, lists, tasks };
}

// ==================== FULL PUSH: local → Supabase ====================
async function pushAllData(localData) {
  const userId = getCurrentUserId();
  if (!userId) return;

  const sectionsWithUser = localData.sections.map(s => ({ ...s, user_id: userId }));
  const listsWithUser = localData.lists.map(l => ({ ...l, user_id: userId }));
  const tasksWithUser = localData.tasks.map(t => ({ ...t, parent_task_id: t.parent_task_id || null, due_date: t.due_date || null, due_time: t.due_time ? t.due_time.slice(0, 5) : null, user_id: userId }));

  // Upsert in order (sections first, then lists, then tasks)
  if (sectionsWithUser.length > 0) {
    await supaFetch('/rest/v1/sections', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(sectionsWithUser)
    });
  }
  if (listsWithUser.length > 0) {
    await supaFetch('/rest/v1/lists', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(listsWithUser)
    });
  }
  const rootTasks = tasksWithUser.filter((task) => !task.parent_task_id);
  const subtasks = tasksWithUser.filter((task) => task.parent_task_id);
  if (rootTasks.length > 0) {
    await supaFetch('/rest/v1/tasks', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rootTasks)
    });
  }
  if (subtasks.length > 0) {
    await supaFetch('/rest/v1/tasks', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(subtasks)
    });
  }
}

// ==================== EXPORTAR ====================
window.SupabaseClient = {
  signUp,
  signIn,
  signOut,
  refreshToken,
  isLoggedIn,
  getSession,
  clearSession: () => saveSession(null),
  getCurrentUserId,
  // Sections
  upsertSection,
  deleteSection,
  // Lists
  upsertList,
  deleteList,
  // Tasks
  upsertTask,
  deleteTask,
  // Bulk sync
  pullAllData,
  pushAllData
};
