/**
 * supabase.js — klip V2
 * Cliente Supabase ultraliviano sin npm ni bundler.
 * Gestiona auth (email+password) y sincronización de datos.
 */

const SUPABASE_URL = 'https://gcmdlpaehqiujymxiysj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_mh8HXeGkqjxJghs6IQ_R-g_byKeBZxQ';

// ==================== HELPER HTTP ====================
async function supaFetch(path, options = {}) {
  const session = getSession();
  const headers = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': session ? `Bearer ${session.access_token}` : `Bearer ${SUPABASE_ANON_KEY}`,
    'Prefer': 'return=representation',
    ...options.headers
  };

  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || err.error_description || 'Error Supabase');
  }

  // 204 No Content (DELETE, PATCH sin return)
  if (res.status === 204) return null;
  return res.json();
}

// ==================== SESSION MANAGEMENT ====================
function saveSession(session) {
  if (session) {
    localStorage.setItem('klip_session', JSON.stringify(session));
  } else {
    localStorage.removeItem('klip_session');
  }
}

function getSession() {
  try {
    return JSON.parse(localStorage.getItem('klip_session'));
  } catch {
    return null;
  }
}

function getCurrentUserId() {
  const session = getSession();
  return session ? session.user.id : null;
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
    body: JSON.stringify({ ...task, user_id: userId })
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
  const tasksWithUser = localData.tasks.map(t => ({ ...t, user_id: userId }));

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
  if (tasksWithUser.length > 0) {
    await supaFetch('/rest/v1/tasks', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(tasksWithUser)
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
