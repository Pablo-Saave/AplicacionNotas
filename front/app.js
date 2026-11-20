/**
 * app.js - klip Tasks PWA — V2
 * Vanilla JS + IndexedDB (offline) + Supabase (sync cuando hay internet y usuario logueado).
 * Estrategia: local-first. Cada escritura va a IndexedDB primero, y se sincroniza con
 * Supabase en segundo plano sin bloquear la UI.
 */

// ==================== STATE ====================
const state = {
  sections: [],
  currentSectionId: null,
  lists: [],
  currentListId: null,
  tasks: [],
  isCompletedExpanded: false,
  isSyncing: false,
  viewMode: 'tasks',
  calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
};

// ==================== DOM ====================
const DOM = {
  sidebar: document.getElementById('sidebar'),
  sidebarBackdrop: document.getElementById('sidebar-backdrop'),
  btnMenu: document.getElementById('btn-menu'),
  btnCloseSidebar: document.getElementById('btn-close-sidebar'),
  sectionsList: document.getElementById('sections-list'),
  mobileSectionsList: document.getElementById('mobile-sections-list'),
  btnNewSection: document.getElementById('btn-new-section'),
  btnNewSectionMobile: document.getElementById('btn-new-section-mobile'),
  btnRenameCurrentSection: document.getElementById('btn-rename-current-section'),
  btnDeleteCurrentSection: document.getElementById('btn-delete-current-section'),
  currentSectionTitle: document.getElementById('current-section-title'),
  mainSectionTitle: document.getElementById('main-section-title'),
  tasksCounterBadge: document.getElementById('tasks-counter-badge'),
  listsTabs: document.getElementById('lists-tabs'),
  btnAddList: document.getElementById('btn-add-list'),
  tasksScrollContainer: document.getElementById('tasks-scroll-container'),
  activeTasksList: document.getElementById('active-tasks-list'),
  completedSection: document.getElementById('completed-section'),
  completedToggleBtn: document.getElementById('completed-toggle-btn'),
  completedCountLabel: document.getElementById('completed-count-label'),
  completedTasksList: document.getElementById('completed-tasks-list'),
  emptyState: document.getElementById('empty-state'),
  addTaskForm: document.getElementById('add-task-form'),
  taskInput: document.getElementById('task-input'),
  modalContainer: document.getElementById('modal-container'),
  modalTitle: document.getElementById('modal-title'),
  modalBody: document.getElementById('modal-body'),
  modalFooter: document.getElementById('modal-footer'),
  btnModalClose: document.getElementById('btn-modal-close'),
  syncIndicator: document.getElementById('sync-indicator'),
  btnLogout: document.getElementById('btn-logout'),
  btnLogoutMobile: document.getElementById('btn-logout-mobile'),
  tasksView: document.getElementById('tasks-view'),
  calendarView: document.getElementById('calendar-view'),
  calendarGrid: document.getElementById('calendar-grid'),
  calendarMonthLabel: document.getElementById('calendar-month-label'),
  bottomDock: document.querySelector('.bottom-dock'),
  btnViewTasks: document.getElementById('btn-view-tasks'),
  btnViewCalendar: document.getElementById('btn-view-calendar'),
  btnCalendarPrev: document.getElementById('btn-calendar-prev'),
  btnCalendarNext: document.getElementById('btn-calendar-next'),
  btnExportCalendar: document.getElementById('btn-export-calendar')
};

// ==================== SVG ICONS ====================
const ICONS = {
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
  dots: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>`
};

// ==================== HELPERS ====================
function getCurrentSection() {
  return state.sections.find((s) => s.id === state.currentSectionId) || state.sections[0];
}

function showSync(msg) {
  if (!DOM.syncIndicator) return;
  DOM.syncIndicator.textContent = msg;
  DOM.syncIndicator.classList.add('visible');
}

function hideSync() {
  if (!DOM.syncIndicator) return;
  DOM.syncIndicator.classList.remove('visible');
}

function accountStorageKey(key) {
  const userId = window.SupabaseClient.getCurrentUserId();
  return `klip:${userId || 'guest'}:${key}`;
}

// ==================== AUTH INTEGRATION ====================
async function cerrarSesion() {
  try {
    await window.SupabaseClient.signOut();
  } catch (e) {
    console.warn('Sign out error:', e);
  }
  window.DB.close();
  window.Auth.renderAuthScreen();
}
window.cerrarSesion = cerrarSesion;

// Called by auth.js after successful login/register
window.__onAuthSuccess = async function () {
  const userId = window.SupabaseClient.getCurrentUserId();
  if (!userId) throw new Error('Supabase no devolvió el ID del usuario.');
  await window.DB.init(userId);
  await syncFromSupabase();
  await initAppUI();
};

// ==================== SYNC ENGINE ====================

/**
 * Pull data from Supabase and merge into IndexedDB.
 * Strategy: Supabase is authoritative on first login; afterwards it's local-first.
 */
async function syncFromSupabase() {
  if (!window.SupabaseClient.getSession()) return;
  showSync('Sincronizando...');
  try {
    // Try to refresh token silently
    const session = window.SupabaseClient.getSession();
    const payload = JSON.parse(atob(session.access_token.split('.')[1]));
    const expiresIn = payload.exp * 1000 - Date.now();
    if (expiresIn < 60000) {
      await window.SupabaseClient.refreshToken();
    }

    const remote = await window.SupabaseClient.pullAllData();
    if (!remote) { hideSync(); return; }

    await mergeData(remote);
    await pushLocalToSupabase();
    localStorage.removeItem(accountStorageKey('sync_pending'));

    hideSync();
  } catch (err) {
    console.warn('Sync error:', err);
    localStorage.setItem(accountStorageKey('sync_pending'), '1');
    showSync(`Error al sincronizar: ${err.message}`);
  }
}

async function mergeData(remote) {
  const normalize = (row, table) => {
    const value = { ...row, updated_at: row.updated_at || new Date(0).toISOString(), deleted: !!row.deleted };
    if (table === 'tasks') {
      value.note = value.note || '';
      value.due_date = value.due_date || null;
      value.due_time = value.due_time ? value.due_time.slice(0, 5) : null;
    }
    delete value.user_id;
    return value;
  };
  for (const [table, rows] of [['sections', remote.sections], ['lists', remote.lists], ['tasks', remote.tasks]]) {
    for (const row of rows) {
      const incoming = normalize(row, table);
      const local = await window.DB._get(table, row.id).catch(() => null);
      if (!local || Date.parse(incoming.updated_at) > Date.parse(local.updated_at || 0)) {
        await window.DB._put(table, incoming);
      }
    }
  }
}

async function pushLocalToSupabase() {
  if (!window.SupabaseClient.isLoggedIn()) return;
  const userId = window.SupabaseClient.getCurrentUserId();
  if (!userId) return;

  const [sections, allLists, allTasks] = await Promise.all([
    window.DB._getAll('sections'), window.DB._getAll('lists'), window.DB._getAll('tasks')
  ]);

  await window.SupabaseClient.pushAllData({
    sections,
    lists: allLists,
    tasks: allTasks
  });
}

// Background sync: push a single record change to Supabase without blocking UI
function bgSync(fn) {
  localStorage.setItem(accountStorageKey('sync_pending'), '1');
  if (!navigator.onLine) {
    showSync('Guardado sin conexión; pendiente de sincronizar');
    return;
  }
  if (!window.SupabaseClient.getSession()) return;
  (async () => {
    if (!window.SupabaseClient.isLoggedIn()) await window.SupabaseClient.refreshToken();
    if (!window.SupabaseClient.isLoggedIn()) throw new Error('La sesión expiró. Inicia sesión de nuevo.');
    await pushLocalToSupabase();
    localStorage.removeItem(accountStorageKey('sync_pending'));
    showSync('Sincronizado');
    setTimeout(hideSync, 2200);
  })().catch((err) => {
    console.warn('Background sync queued:', err);
    showSync(`Guardado localmente; error de sincronización: ${err.message}`);
  });
}

window.addEventListener('online', () => {
  if (localStorage.getItem(accountStorageKey('sync_pending')) === '1') syncFromSupabase();
});
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && navigator.onLine && localStorage.getItem(accountStorageKey('sync_pending')) === '1') {
    syncFromSupabase();
  }
});
setInterval(() => {
  if (navigator.onLine && localStorage.getItem(accountStorageKey('sync_pending')) === '1' && window.SupabaseClient.getSession()) {
    syncFromSupabase();
  }
}, 30000);

// ==================== INITIALIZATION ====================
async function initApp() {
  try {
    registerServiceWorker();

    // Refresh a stored session before opening that user's isolated local database.
    let session = window.SupabaseClient.getSession();
    if (session) {
      let needsRefresh = !window.SupabaseClient.isLoggedIn();
      try {
        const payload = JSON.parse(atob(session.access_token.split('.')[1]));
        needsRefresh ||= payload.exp * 1000 - Date.now() < 300000;
      } catch {
        needsRefresh = true;
      }
      if (needsRefresh) await window.SupabaseClient.refreshToken();
      session = window.SupabaseClient.getSession();
      const userId = window.SupabaseClient.getCurrentUserId();
      if (window.SupabaseClient.isLoggedIn() && userId) {
        await window.DB.init(userId);
        await syncFromSupabase();
        await initAppUI();
        return;
      }
    }

    // Not logged in — show auth screen
    window.Auth.renderAuthScreen();
  } catch (error) {
    console.error('Error al inicializar:', error);
    window.Auth.renderAuthScreen();
    window.Auth.showAuthError(`No se pudo abrir la cuenta: ${error.message}`);
  }
}

async function initAppUI() {
  await loadInitialData();
  bindEvents();
  focusTaskInput();
}

async function loadInitialData() {
  state.sections = await window.DB.getSections();
  if (state.sections.length === 0) {
    const sec = await window.DB.addSection('Personal');
    state.sections = [sec];
    bgSync(() => window.SupabaseClient.upsertSection(sec));
  }

  const savedSectionId = localStorage.getItem(accountStorageKey('last_section_id'));
  const foundSec = state.sections.find((s) => s.id === savedSectionId);
  state.currentSectionId = foundSec ? foundSec.id : state.sections[0].id;

  await switchSection(state.currentSectionId, false);
}

// ==================== SECTION MANAGEMENT ====================
async function switchSection(sectionId, autoFocus = true) {
  state.currentSectionId = sectionId;
  localStorage.setItem(accountStorageKey('last_section_id'), sectionId);

  const currentSection = state.sections.find((s) => s.id === sectionId);
  if (currentSection) {
    if (DOM.currentSectionTitle) DOM.currentSectionTitle.textContent = currentSection.name;
    if (DOM.mainSectionTitle) DOM.mainSectionTitle.textContent = currentSection.name;
  }

  renderSections();

  state.lists = await window.DB.getLists(sectionId);
  if (state.lists.length === 0) {
    const defaultList = await window.DB.addList(sectionId, 'General');
    state.lists = [defaultList];
    bgSync(() => window.SupabaseClient.upsertList(defaultList));
  }

  const savedListId = localStorage.getItem(accountStorageKey(`last_list_${sectionId}`));
  const foundList = state.lists.find((l) => l.id === savedListId);
  state.currentListId = foundList ? foundList.id : state.lists[0].id;

  await switchList(state.currentListId, autoFocus);
  if (state.viewMode === 'calendar') await renderCalendar();
  closeSidebar();
}

function renderSections() {
  if (DOM.sectionsList) {
    DOM.sectionsList.innerHTML = '';
    state.sections.forEach((section) => {
      const isActive = section.id === state.currentSectionId;
      const item = document.createElement('div');
      item.className = `section-item-desktop ${isActive ? 'active' : ''}`;
      item.innerHTML = `
        <span class="sec-dot"></span>
        <span class="sec-name">${escapeHTML(section.name)}</span>
      `;
      item.addEventListener('click', () => switchSection(section.id));
      DOM.sectionsList.appendChild(item);
    });
  }

  if (DOM.mobileSectionsList) {
    DOM.mobileSectionsList.innerHTML = '';
    state.sections.forEach((section) => {
      const isActive = section.id === state.currentSectionId;
      const item = document.createElement('div');
      item.className = `section-item-mobile ${isActive ? 'active' : ''}`;
      item.innerHTML = `
        <div class="mobile-item-title">
          <span class="sec-dot" style="${isActive ? 'background-color: var(--accent-emerald);' : ''}"></span>
          <span>${escapeHTML(section.name)}</span>
        </div>
      `;
      item.addEventListener('click', () => {
        switchSection(section.id);
        closeSidebar();
      });
      DOM.mobileSectionsList.appendChild(item);
    });
  }
}

function openNewSectionModal() {
  openModal({
    title: 'Nueva Sección',
    bodyHTML: `
      <div class="form-group">
        <label class="form-label">Nombre de la sección</label>
        <input type="text" id="modal-input-name" class="form-input" placeholder="Ej. Proyectos, Clases..." required autofocus>
      </div>
    `,
    footerButtons: [
      { label: 'Cancelar', className: 'btn-secondary', onClick: closeModal },
      {
        label: 'Crear',
        className: 'btn-primary',
        onClick: async () => {
          const input = document.getElementById('modal-input-name');
          const name = input ? input.value.trim() : '';
          if (!name) return;
          const newSec = await window.DB.addSection(name);
          state.sections = await window.DB.getSections();
          closeModal();
          bgSync(() => window.SupabaseClient.upsertSection(newSec));
          await switchSection(newSec.id);
        }
      }
    ]
  });
}

function openRenameSectionModal(section) {
  if (!section) section = getCurrentSection();
  openModal({
    title: 'Renombrar Sección',
    bodyHTML: `
      <div class="form-group">
        <label class="form-label">Nuevo nombre</label>
        <input type="text" id="modal-input-name" class="form-input" value="${escapeHTML(section.name)}" required autofocus>
      </div>
    `,
    footerButtons: [
      { label: 'Cancelar', className: 'btn-secondary', onClick: closeModal },
      {
        label: 'Guardar',
        className: 'btn-primary',
        onClick: async () => {
          const input = document.getElementById('modal-input-name');
          const name = input ? input.value.trim() : '';
          if (!name) return;
          await window.DB.updateSection(section.id, { name });
          state.sections = await window.DB.getSections();
          if (state.currentSectionId === section.id) {
            if (DOM.currentSectionTitle) DOM.currentSectionTitle.textContent = name;
            if (DOM.mainSectionTitle) DOM.mainSectionTitle.textContent = name;
          }
          renderSections();
          closeModal();
          bgSync(() => window.SupabaseClient.upsertSection({ ...section, name }));
        }
      }
    ]
  });
}

function openDeleteSectionModal(section) {
  if (!section) section = getCurrentSection();
  if (state.sections.length <= 1) {
    openModal({
      title: 'No se puede eliminar',
      bodyHTML: `<p style="font-family: var(--font-body); font-size: 14px; color: var(--text-main);">Debes tener al menos una sección en la aplicación.</p>`,
      footerButtons: [{ label: 'Entendido', className: 'btn-primary', onClick: closeModal }]
    });
    return;
  }

  openModal({
    title: 'Eliminar Sección',
    bodyHTML: `
      <p style="font-family: var(--font-body); font-size: 14px; color: var(--text-main);">
        ¿Seguro que deseas eliminar <strong>${escapeHTML(section.name)}</strong>?
      </p>
      <p style="font-family: var(--font-body); font-size: 13px; color: var(--text-muted); margin-top: 6px;">
        Se eliminarán todos sus apartados y las tareas asociadas.
      </p>
    `,
    footerButtons: [
      { label: 'Cancelar', className: 'btn-secondary', onClick: closeModal },
      {
        label: 'Eliminar',
        className: 'btn-danger',
        onClick: async () => {
          const sectionId = section.id;
          await window.DB.deleteSection(sectionId);
          state.sections = await window.DB.getSections();
          closeModal();
          bgSync(() => window.SupabaseClient.deleteSection(sectionId));
          const nextSec = state.sections[0];
          await switchSection(nextSec.id);
        }
      }
    ]
  });
}

// ==================== LISTS (APARTADOS) ====================
async function switchList(listId, autoFocus = true) {
  state.currentListId = listId;
  localStorage.setItem(accountStorageKey(`last_list_${state.currentSectionId}`), listId);
  renderListsTabs();
  await loadTasks();
  if (autoFocus) focusTaskInput();
}

function renderListsTabs() {
  DOM.listsTabs.innerHTML = '';
  state.lists.forEach((list) => {
    const tab = document.createElement('button');
    tab.className = `tab-btn ${list.id === state.currentListId ? 'active' : ''}`;
    tab.type = 'button';
    tab.innerHTML = `
      <span>${escapeHTML(list.name)}</span>
      <span class="tab-btn-options" title="Opciones" data-list-options="${list.id}">
        ${ICONS.dots}
      </span>
    `;
    tab.addEventListener('click', (e) => {
      if (e.target.closest('.tab-btn-options')) return;
      switchList(list.id);
    });
    const btnOptions = tab.querySelector(`[data-list-options="${list.id}"]`);
    btnOptions.addEventListener('click', (e) => {
      e.stopPropagation();
      openListOptionsModal(list);
    });
    DOM.listsTabs.appendChild(tab);
  });
}

function openNewListModal() {
  openModal({
    title: 'Nuevo Apartado',
    bodyHTML: `
      <div class="form-group">
        <label class="form-label">Nombre del apartado (lista)</label>
        <input type="text" id="modal-input-name" class="form-input" placeholder="Ej. Pendientes, Urgentes..." required autofocus>
      </div>
    `,
    footerButtons: [
      { label: 'Cancelar', className: 'btn-secondary', onClick: closeModal },
      {
        label: 'Crear',
        className: 'btn-primary',
        onClick: async () => {
          const input = document.getElementById('modal-input-name');
          const name = input ? input.value.trim() : '';
          if (!name) return;
          const newList = await window.DB.addList(state.currentSectionId, name);
          state.lists = await window.DB.getLists(state.currentSectionId);
          closeModal();
          bgSync(() => window.SupabaseClient.upsertList(newList));
          await switchList(newList.id);
        }
      }
    ]
  });
}

function openListOptionsModal(list) {
  openModal({
    title: `Apartado: ${list.name}`,
    bodyHTML: `
      <div class="form-group">
        <label class="form-label">Renombrar apartado</label>
        <input type="text" id="modal-list-rename" class="form-input" value="${escapeHTML(list.name)}" autofocus>
      </div>
    `,
    footerButtons: [
      {
        label: 'Eliminar',
        className: 'btn-danger',
        onClick: async () => {
          if (state.lists.length <= 1) {
            alert('Debes tener al menos un apartado en la sección.');
            return;
          }
          if (confirm(`¿Eliminar el apartado "${list.name}" y todas sus tareas?`)) {
            const listId = list.id;
            await window.DB.deleteList(listId);
            state.lists = await window.DB.getLists(state.currentSectionId);
            closeModal();
            bgSync(() => window.SupabaseClient.deleteList(listId));
            await switchList(state.lists[0].id);
          }
        }
      },
      { label: 'Cancelar', className: 'btn-secondary', onClick: closeModal },
      {
        label: 'Guardar',
        className: 'btn-primary',
        onClick: async () => {
          const input = document.getElementById('modal-list-rename');
          const name = input ? input.value.trim() : '';
          if (!name) return;
          await window.DB.updateList(list.id, { name });
          state.lists = await window.DB.getLists(state.currentSectionId);
          renderListsTabs();
          closeModal();
          bgSync(() => window.SupabaseClient.upsertList({ ...list, name }));
        }
      }
    ]
  });
}

// ==================== TASKS ====================
async function loadTasks() {
  if (!state.currentListId) {
    state.tasks = [];
    renderTasks();
    return;
  }
  state.tasks = await window.DB.getTasks(state.currentListId);
  renderTasks();
  if (state.viewMode === 'calendar') await renderCalendar();
}

function setViewMode(mode) {
  state.viewMode = mode;
  const calendarActive = mode === 'calendar';
  DOM.tasksView.hidden = calendarActive;
  DOM.calendarView.hidden = !calendarActive;
  DOM.bottomDock.hidden = calendarActive;
  DOM.btnViewTasks.classList.toggle('active', !calendarActive);
  DOM.btnViewCalendar.classList.toggle('active', calendarActive);
  if (calendarActive) renderCalendar();
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function renderCalendar() {
  if (!DOM.calendarGrid || !state.currentSectionId) return;
  const sectionId = state.currentSectionId;
  const year = state.calendarMonth.getFullYear();
  const month = state.calendarMonth.getMonth();
  DOM.calendarMonthLabel.textContent = new Intl.DateTimeFormat('es-CL', {
    month: 'long', year: 'numeric'
  }).format(state.calendarMonth);

  const lists = await window.DB.getLists(sectionId);
  const tasksByDate = new Map();
  for (const list of lists) {
    for (const task of await window.DB.getTasks(list.id)) {
      if (!task.due_date) continue;
      if (!tasksByDate.has(task.due_date)) tasksByDate.set(task.due_date, []);
      tasksByDate.get(task.due_date).push({ ...task, calendarListName: list.name });
    }
  }

  if (sectionId !== state.currentSectionId || year !== state.calendarMonth.getFullYear() || month !== state.calendarMonth.getMonth()) return;

  const firstDayOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = localDateKey(new Date());
  DOM.calendarGrid.innerHTML = '';

  for (let cell = 0; cell < 42; cell++) {
    const day = cell - firstDayOffset + 1;
    const inMonth = day >= 1 && day <= daysInMonth;
    const cellDate = inMonth ? new Date(year, month, day) : null;
    const dateKey = cellDate ? localDateKey(cellDate) : '';
    const dayEl = document.createElement('div');
    dayEl.className = `calendar-day${inMonth ? '' : ' outside-month'}${dateKey === today ? ' today' : ''}`;
    if (!inMonth) {
      dayEl.setAttribute('aria-hidden', 'true');
    } else {
      const number = document.createElement('span');
      number.className = 'calendar-day-number';
      number.textContent = String(day);
      dayEl.appendChild(number);

      const dayTasks = (tasksByDate.get(dateKey) || []).sort((a, b) =>
        (a.due_time || '99:99').localeCompare(b.due_time || '99:99'));
      for (const task of dayTasks) {
        const taskButton = document.createElement('button');
        taskButton.type = 'button';
        taskButton.className = `calendar-task${task.done ? ' done' : ''}`;
        taskButton.textContent = `${task.due_time ? `${task.due_time.slice(0, 5)} ` : ''}${task.title}`;
        taskButton.title = `${task.title} — ${task.calendarListName}`;
        taskButton.addEventListener('click', () => openEditTaskModal(task));
        dayEl.appendChild(taskButton);
      }
    }
    DOM.calendarGrid.appendChild(dayEl);
  }
}

function formatTaskDue(task) {
  const parts = [];
  if (task.due_date) {
    const [year, month, day] = task.due_date.split('-').map(Number);
    parts.push(new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short' })
      .format(new Date(year, month - 1, day)));
  }
  if (task.due_time) parts.push(task.due_time.slice(0, 5));
  return parts.join(' · ');
}

function downloadFile(filename, contents, mimeType) {
  const url = URL.createObjectURL(new Blob([contents], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportCalendarICS() {
  const [sections, lists, tasks] = await Promise.all([
    window.DB._getAll('sections'), window.DB._getAll('lists'), window.DB._getAll('tasks')
  ]);
  const sectionById = new Map(sections.filter((row) => !row.deleted).map((row) => [row.id, row]));
  const listById = new Map(lists.filter((row) => !row.deleted).map((row) => [row.id, row]));
  const datedTasks = tasks.filter((task) => {
    const list = listById.get(task.list_id);
    return !task.deleted && task.due_date && list && sectionById.has(list.section_id);
  });
  if (!datedTasks.length) {
    showSync('No hay tareas con fecha para exportar.');
    setTimeout(hideSync, 3000);
    return;
  }

  const dtstamp = toICalendarUtc(new Date());
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//klip//Calendario de tareas//ES',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:klip'
  ];

  for (const task of datedTasks) {
    const list = listById.get(task.list_id);
    const section = sectionById.get(list.section_id);
    lines.push('BEGIN:VEVENT', `UID:${task.id}@klip`, `DTSTAMP:${dtstamp}`, 'SEQUENCE:0');

    if (task.due_time) {
      const [year, month, day] = task.due_date.split('-').map(Number);
      const [hour, minute] = task.due_time.split(':').map(Number);
      const start = new Date(year, month - 1, day, hour, minute, 0);
      const end = new Date(start.getTime() + 30 * 60 * 1000);
      lines.push(`DTSTART:${toICalendarUtc(start)}`, `DTEND:${toICalendarUtc(end)}`);
    } else {
      const date = task.due_date.replace(/-/g, '');
      const [year, month, day] = task.due_date.split('-').map(Number);
      const nextDate = localDateKey(new Date(year, month - 1, day + 1)).replace(/-/g, '');
      lines.push(`DTSTART;VALUE=DATE:${date}`, `DTEND;VALUE=DATE:${nextDate}`);
    }

    const summary = task.done ? `✓ ${task.title}` : task.title;
    const description = [
      `Sección: ${section.name}`,
      `Lista: ${list.name}`,
      `Estado: ${task.done ? 'Completada' : 'Pendiente'}`,
      task.note || ''
    ].filter(Boolean).join('\n');
    lines.push(
      `SUMMARY:${escapeICalendarText(summary)}`,
      `DESCRIPTION:${escapeICalendarText(description)}`,
      'STATUS:CONFIRMED',
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  const ics = lines.map(foldICalendarLine).join('\r\n') + '\r\n';
  downloadFile(`klip-calendario-${localDateKey(new Date())}.ics`, ics, 'text/calendar;charset=utf-8');
}

function escapeICalendarText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function toICalendarUtc(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function foldICalendarLine(line) {
  const encoder = new TextEncoder();
  let folded = '';
  let bytes = 0;
  for (const character of line) {
    const characterBytes = encoder.encode(character).length;
    if (bytes + characterBytes > 75) {
      folded += '\r\n ';
      bytes = 1;
    }
    folded += character;
    bytes += characterBytes;
  }
  return folded;
}

function renderTasks() {
  const activeTasks = state.tasks.filter((t) => !t.done);
  const completedTasks = state.tasks.filter((t) => t.done);

  if (DOM.tasksCounterBadge) {
    const pCount = activeTasks.length;
    const cCount = completedTasks.length;
    DOM.tasksCounterBadge.textContent = `${pCount} ${pCount === 1 ? 'pendiente' : 'pendientes'} · ${cCount} ${cCount === 1 ? 'completada' : 'completadas'}`;
  }

  DOM.activeTasksList.innerHTML = '';
  if (activeTasks.length === 0 && completedTasks.length === 0) {
    DOM.emptyState.classList.add('visible');
  } else {
    DOM.emptyState.classList.remove('visible');
  }

  activeTasks.forEach((task) => DOM.activeTasksList.appendChild(createTaskElement(task)));

  DOM.completedTasksList.innerHTML = '';
  if (completedTasks.length > 0) {
    DOM.completedSection.classList.add('visible');
    DOM.completedCountLabel.textContent = `COMPLETADAS (${completedTasks.length})`;
    completedTasks.forEach((task) => DOM.completedTasksList.appendChild(createTaskElement(task)));
  } else {
    DOM.completedSection.classList.remove('visible');
  }
}

function createTaskElement(task) {
  const item = document.createElement('div');
  item.className = `task-item ${task.done ? 'done' : ''}`;
  item.dataset.taskId = task.id;

  const noteSnippet = task.note
    ? `<div class="task-note-snippet">${escapeHTML(task.note)}</div>`
    : '';
  const dueLabel = formatTaskDue(task);
  const dueSnippet = dueLabel
    ? `<div class="task-due-label">${escapeHTML(dueLabel)}</div>`
    : '';

  item.innerHTML = `
    <button class="task-checkbox-btn" aria-label="${task.done ? 'Marcar como pendiente' : 'Marcar como hecha'}">
      <div class="task-circle">${ICONS.check}</div>
    </button>
    <div class="task-content">
      <div class="task-title">${escapeHTML(task.title)}</div>
      ${noteSnippet}
      ${dueSnippet}
    </div>
    <div class="task-actions">
      <button class="btn-task-action" title="Editar tarea">${ICONS.edit}</button>
    </div>
  `;

  const chkBtn = item.querySelector('.task-checkbox-btn');
  chkBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleTaskDone(task);
  });

  item.addEventListener('click', () => openEditTaskModal(task));
  return item;
}

async function toggleTaskDone(task) {
  const updated = await window.DB.updateTask(task.id, { done: !task.done });
  await loadTasks();
  bgSync(() => window.SupabaseClient.upsertTask(updated));
}

async function handleAddTask(e) {
  e.preventDefault();
  const title = DOM.taskInput.value.trim();
  if (!title) return;

  const newTask = await window.DB.addTask(state.currentListId, title, '');
  DOM.taskInput.value = '';
  await loadTasks();
  focusTaskInput();
  DOM.tasksScrollContainer.scrollTop = 0;
  bgSync(() => window.SupabaseClient.upsertTask(newTask));
}

function openEditTaskModal(task) {
  openModal({
    title: 'Editar Tarea',
    bodyHTML: `
      <div class="form-group">
        <label class="form-label">Título</label>
        <input type="text" id="modal-task-title" class="form-input" value="${escapeHTML(task.title)}" required autofocus>
      </div>
      <div class="form-group">
        <label class="form-label">Nota o detalles</label>
        <textarea id="modal-task-note" class="form-textarea" placeholder="Escribe detalles opcionales...">${escapeHTML(task.note || '')}</textarea>
      </div>
      <div class="task-date-fields">
        <div class="form-group">
          <label class="form-label" for="modal-task-date">Fecha</label>
          <input type="date" id="modal-task-date" class="form-input" value="${escapeHTML(task.due_date || '')}">
        </div>
        <div class="form-group">
          <label class="form-label" for="modal-task-time">Hora</label>
          <input type="time" id="modal-task-time" class="form-input" value="${escapeHTML(task.due_time ? task.due_time.slice(0, 5) : '')}">
        </div>
      </div>
    `,
    footerButtons: [
      {
        label: 'Eliminar',
        className: 'btn-danger',
        onClick: async () => {
          if (confirm('¿Eliminar esta tarea?')) {
            const taskId = task.id;
            await window.DB.deleteTask(taskId);
            closeModal();
            await loadTasks();
            focusTaskInput();
            bgSync(() => window.SupabaseClient.deleteTask(taskId));
          }
        }
      },
      { label: 'Cancelar', className: 'btn-secondary', onClick: closeModal },
      {
        label: 'Guardar',
        className: 'btn-primary',
        onClick: async () => {
          const titleInput = document.getElementById('modal-task-title');
          const noteInput = document.getElementById('modal-task-note');
          const dateInput = document.getElementById('modal-task-date');
          const timeInput = document.getElementById('modal-task-time');
          const newTitle = titleInput ? titleInput.value.trim() : '';
          const newNote = noteInput ? noteInput.value.trim() : '';
          if (!newTitle) return;
          const updated = await window.DB.updateTask(task.id, {
            title: newTitle,
            note: newNote,
            due_date: dateInput?.value || null,
            due_time: timeInput?.value || null
          });
          closeModal();
          await loadTasks();
          focusTaskInput();
          bgSync(() => window.SupabaseClient.upsertTask(updated));
        }
      }
    ]
  });
}

// ==================== UI HELPERS ====================
function focusTaskInput() {
  setTimeout(() => {
    if (DOM.taskInput) DOM.taskInput.focus();
  }, 50);
}

function toggleSidebar(open) {
  const shouldOpen = typeof open === 'boolean' ? open : !DOM.sidebar.classList.contains('open');
  if (shouldOpen) {
    DOM.sidebar.classList.add('open');
    DOM.sidebarBackdrop.classList.add('visible');
  } else {
    DOM.sidebar.classList.remove('open');
    DOM.sidebarBackdrop.classList.remove('visible');
  }
}

function closeSidebar() {
  toggleSidebar(false);
}

function toggleCompletedAccordion() {
  state.isCompletedExpanded = !state.isCompletedExpanded;
  DOM.completedSection.classList.toggle('expanded', state.isCompletedExpanded);
  DOM.completedToggleBtn.setAttribute('aria-expanded', state.isCompletedExpanded);
}

// ==================== MODAL ====================
function openModal({ title, bodyHTML, footerButtons }) {
  DOM.modalTitle.textContent = title;
  DOM.modalBody.innerHTML = bodyHTML;
  DOM.modalFooter.innerHTML = '';

  footerButtons.forEach((btnConfig) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn ${btnConfig.className || 'btn-secondary'}`;
    btn.textContent = btnConfig.label;
    btn.addEventListener('click', btnConfig.onClick);
    DOM.modalFooter.appendChild(btn);
  });

  DOM.modalContainer.classList.add('open');

  const firstInput = DOM.modalBody.querySelector('input, textarea');
  if (firstInput) setTimeout(() => firstInput.focus(), 60);
}

function closeModal() {
  DOM.modalContainer.classList.remove('open');
  DOM.modalBody.innerHTML = '';
  DOM.modalFooter.innerHTML = '';
  focusTaskInput();
}

function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/\x3c/g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ==================== EVENTS ====================
function bindEvents() {
  [DOM.btnLogout, DOM.btnLogoutMobile].forEach((button) => {
    if (button) button.addEventListener('click', cerrarSesion);
  });
  if (DOM.btnMenu) DOM.btnMenu.addEventListener('click', () => toggleSidebar(true));
  if (DOM.btnCloseSidebar) DOM.btnCloseSidebar.addEventListener('click', () => toggleSidebar(false));
  if (DOM.sidebarBackdrop) DOM.sidebarBackdrop.addEventListener('click', () => toggleSidebar(false));

  if (DOM.btnNewSection) DOM.btnNewSection.addEventListener('click', openNewSectionModal);
  if (DOM.btnNewSectionMobile) {
    DOM.btnNewSectionMobile.addEventListener('click', () => {
      closeSidebar();
      openNewSectionModal();
    });
  }

  if (DOM.btnRenameCurrentSection) {
    DOM.btnRenameCurrentSection.addEventListener('click', () => openRenameSectionModal(getCurrentSection()));
  }
  if (DOM.btnDeleteCurrentSection) {
    DOM.btnDeleteCurrentSection.addEventListener('click', () => openDeleteSectionModal(getCurrentSection()));
  }

  if (DOM.btnAddList) DOM.btnAddList.addEventListener('click', openNewListModal);
  if (DOM.completedToggleBtn) DOM.completedToggleBtn.addEventListener('click', toggleCompletedAccordion);
  if (DOM.addTaskForm) DOM.addTaskForm.addEventListener('submit', handleAddTask);

  if (DOM.btnModalClose) DOM.btnModalClose.addEventListener('click', closeModal);
  if (DOM.btnViewTasks) DOM.btnViewTasks.addEventListener('click', () => setViewMode('tasks'));
  if (DOM.btnViewCalendar) DOM.btnViewCalendar.addEventListener('click', () => setViewMode('calendar'));
  if (DOM.btnCalendarPrev) DOM.btnCalendarPrev.addEventListener('click', () => {
    state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() - 1, 1);
    renderCalendar();
  });
  if (DOM.btnCalendarNext) DOM.btnCalendarNext.addEventListener('click', () => {
    state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1, 1);
    renderCalendar();
  });
  if (DOM.btnExportCalendar) DOM.btnExportCalendar.addEventListener('click', exportCalendarICS);
  if (DOM.modalContainer) {
    DOM.modalContainer.addEventListener('click', (e) => {
      if (e.target === DOM.modalContainer) closeModal();
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (DOM.modalContainer && DOM.modalContainer.classList.contains('open')) closeModal();
      else if (DOM.sidebar && DOM.sidebar.classList.contains('open')) closeSidebar();
    }
  });
}

// ==================== SERVICE WORKER ====================
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./sw.js', { scope: './' })
        .then((reg) => console.log('SW registrado:', reg.scope))
        .catch((err) => console.warn('SW falló:', err));
    });
  }
}

// ==================== BOOT ====================
document.addEventListener('DOMContentLoaded', initApp);
