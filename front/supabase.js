/**
 * supabase.js — klip V2
 * Cliente Supabase ultraliviano sin npm ni bundler.
 * Gestiona auth (email+password) y sincronización de datos.
 */

const SUPABASE_URL = 'https://gcmdlpaehqiujymxiysj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_mh8HXeGkqjxJghs6IQ_R-g_byKeBZxQ';

// Remove the long-lived token written by older versions; require a fresh login.
localStorage.removeItem('klip_session');

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
    throw new Error(detail || `Error Supabase (${res.status})`);
  }

  // PostgREST returns an empty body for 204 and for successful return=minimal upserts.
  const responseBody = await res.text();
  if (!responseBody.trim()) return null;
  return JSON.parse(responseBody);
}

// ==================== SESSION MANAGEMENT ====================
function saveSession(session) {
  if (session) {
    sessionStorage.setItem('klip_session', JSON.stringify(session));
  } else {
    sessionStorage.removeItem('klip_session');
  }
  // Remove the legacy persistent token written by earlier app versions.
  localStorage.removeItem('klip_session');
}

function getSession() {
  try {
    return JSON.parse(sessionStorage.getItem('klip_session'));
  } catch {
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
  const data = await supaFetch('/auth/v1/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  if (data.access_token) saveSession(data);
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
  if (session) {
    await supaFetch('/auth/v1/logout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}` }
    }).catch(() => {});
  }
  saveSession(null);
}

async function refreshToken() {
  const session = getSession();
  if (!session?.refresh_token) return null;
  try {
    const data = await supaFetch('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    if (data.access_token) saveSession(data);
    return data;
  } catch {
    saveSession(null);
    return null;
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
