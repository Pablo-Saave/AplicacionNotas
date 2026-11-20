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
  isSyncing: false
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
  syncIndicator: document.getElementById('sync-indicator')
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

// ==================== AUTH INTEGRATION ====================
async function cerrarSesion() {
  try {
    await window.SupabaseClient.signOut();
  } catch (e) {
    console.warn('Sign out error:', e);
  }
  window.Auth.renderAuthScreen();
}
window.cerrarSesion = cerrarSesion;

// Called by auth.js after successful login/register
window.__onAuthSuccess = async function () {
  await syncFromSupabase();
  await initAppUI();
};

// ==================== SYNC ENGINE ====================

/**
 * Pull data from Supabase and merge into IndexedDB.
 * Strategy: Supabase is authoritative on first login; afterwards it's local-first.
 */
async function syncFromSupabase() {
  if (!window.SupabaseClient.isLoggedIn()) return;
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

    const localSections = await window.DB.getSections();

    if (localSections.length === 0 && remote.sections.length > 0) {
      // Fresh install with remote data: import everything from Supabase into IndexedDB
      for (const s of remote.sections) {
        await window.DB._put('sections', { id: s.id, name: s.name, position: s.position });
      }
      for (const l of remote.lists) {
        await window.DB._put('lists', { id: l.id, section_id: l.section_id, name: l.name, position: l.position });
      }
      for (const t of remote.tasks) {
        await window.DB._put('tasks', {
          id: t.id, list_id: t.list_id, title: t.title, note: t.note || '',
          done: t.done, due_date: t.due_date || '', due_time: t.due_time || '',
          position: t.position, updated_at: t.updated_at
        });
      }
    } else if (localSections.length > 0 && remote.sections.length === 0) {
      // User has local data but Supabase is empty: push everything up
      await pushLocalToSupabase();
    } else if (localSections.length > 0 && remote.sections.length > 0) {
      // Both have data: merge by updated_at (last write wins per task)
      await mergeData(remote);
    }

    hideSync();
  } catch (err) {
    console.warn('Sync error:', err);
    hideSync();
  }
}

async function mergeData(remote) {
  // Merge tasks by updated_at: whichever is newer wins
  for (const remoteTask of remote.tasks) {
    const localTask = await window.DB._get('tasks', remoteTask.id).catch(() => null);
    if (!localTask) {
      await window.DB._put('tasks', {
        id: remoteTask.id, list_id: remoteTask.list_id, title: remoteTask.title,
        note: remoteTask.note || '', done: remoteTask.done,
        due_date: remoteTask.due_date || '', due_time: remoteTask.due_time || '',
        position: remoteTask.position, updated_at: remoteTask.updated_at
      });
    } else {
      const remoteDate = new Date(remoteTask.updated_at).getTime();
      const localDate = new Date(localTask.updated_at).getTime();
      if (remoteDate > localDate) {
        await window.DB._put('tasks', {
          id: remoteTask.id, list_id: remoteTask.list_id, title: remoteTask.title,
          note: remoteTask.note || '', done: remoteTask.done,
          due_date: remoteTask.due_date || '', due_time: remoteTask.due_time || '',
          position: remoteTask.position, updated_at: remoteTask.updated_at
        });
      }
    }
  }

  // Sections: insert any missing
  for (const s of remote.sections) {
    const localSec = await window.DB._get('sections', s.id).catch(() => null);
    if (!localSec) {
      await window.DB._put('sections', { id: s.id, name: s.name, position: s.position });
    }
  }

  // Lists: insert any missing
  for (const l of remote.lists) {
    const localList = await window.DB._get('lists', l.id).catch(() => null);
    if (!localList) {
      await window.DB._put('lists', { id: l.id, section_id: l.section_id, name: l.name, position: l.position });
    }
  }
}

async function pushLocalToSupabase() {
  if (!window.SupabaseClient.isLoggedIn()) return;
  const userId = window.SupabaseClient.getCurrentUserId();
  if (!userId) return;

  const sections = await window.DB.getSections();
  const allLists = [];
  const allTasks = [];

  for (const sec of sections) {
    const lists = await window.DB.getLists(sec.id);
    for (const list of lists) {
      allLists.push(list);
      const tasks = await window.DB.getTasks(list.id);
      allTasks.push(...tasks);
    }
  }

  await window.SupabaseClient.pushAllData({
    sections,
    lists: allLists,
    tasks: allTasks
  });
}

// Background sync: push a single record change to Supabase without blocking UI
function bgSync(fn) {
  if (!window.SupabaseClient.isLoggedIn()) return;
  fn().catch((err) => console.warn('Background sync error:', err));
}

// ==================== INITIALIZATION ====================
async function initApp() {
  try {
    await window.DB.init();
    registerServiceWorker();

    // Check auth
    if (window.SupabaseClient.isLoggedIn()) {
      // Try silent token refresh
      const session = window.SupabaseClient.getSession();
      if (session) {
        try {
          const payload = JSON.parse(atob(session.access_token.split('.')[1]));
          const expiresIn = payload.exp * 1000 - Date.now();
          if (expiresIn < 300000) { // less than 5 min
            await window.SupabaseClient.refreshToken();
          }
        } catch (e) { /* token expired or invalid */ }
      }

      if (window.SupabaseClient.isLoggedIn()) {
        await syncFromSupabase();
        await initAppUI();
        return;
      }
    }

    // Not logged in — show auth screen
    window.Auth.renderAuthScreen();
  } catch (error) {
    console.error('Error al inicializar:', error);
    // Fallback: try to show UI even without auth
    await initAppUI();
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

  const savedSectionId = localStorage.getItem('last_section_id');
  const foundSec = state.sections.find((s) => s.id === savedSectionId);
  state.currentSectionId = foundSec ? foundSec.id : state.sections[0].id;

  await switchSection(state.currentSectionId, false);
}

// ==================== SECTION MANAGEMENT ====================
async function switchSection(sectionId, autoFocus = true) {
  state.currentSectionId = sectionId;
  localStorage.setItem('last_section_id', sectionId);

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

  const savedListId = localStorage.getItem(`last_list_${sectionId}`);
  const foundList = state.lists.find((l) => l.id === savedListId);
  state.currentListId = foundList ? foundList.id : state.lists[0].id;

  await switchList(state.currentListId, autoFocus);
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
  localStorage.setItem(`last_list_${state.currentSectionId}`, listId);
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

  item.innerHTML = `
    <button class="task-checkbox-btn" aria-label="${task.done ? 'Marcar como pendiente' : 'Marcar como hecha'}">
      <div class="task-circle">${ICONS.check}</div>
    </button>
    <div class="task-content">
      <div class="task-title">${escapeHTML(task.title)}</div>
      ${noteSnippet}
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
          const newTitle = titleInput ? titleInput.value.trim() : '';
          const newNote = noteInput ? noteInput.value.trim() : '';
          if (!newTitle) return;
          const updated = await window.DB.updateTask(task.id, { title: newTitle, note: newNote });
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
