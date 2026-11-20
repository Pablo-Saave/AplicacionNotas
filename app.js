/**
 * app.js - Controller for klip Tasks PWA
 * Fast, lightweight, pure vanilla JS with Playfair Display & Arial/Arimo typography.
 */

// Application State
const state = {
  sections: [],
  currentSectionId: null,
  lists: [],
  currentListId: null,
  tasks: [],
  isCompletedExpanded: false
};

// DOM References
const DOM = {
  sidebar: document.getElementById('sidebar'),
  sidebarBackdrop: document.getElementById('sidebar-backdrop'),
  btnMenu: document.getElementById('btn-menu'),
  btnCloseSidebar: document.getElementById('btn-close-sidebar'),
  sectionsList: document.getElementById('sections-list'),
  mobileSectionsList: document.getElementById('mobile-sections-list'),
  btnNewSection: document.getElementById('btn-new-section'),
  btnNewSectionMobile: document.getElementById('btn-new-section-mobile'),
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
  btnModalClose: document.getElementById('btn-modal-close')
};

// SVG Icons
const ICONS = {
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
  dots: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>`
};

// ==================== CERRAR SESIÓN (HOOK) ====================
function cerrarSesion() {
  console.log('cerrarSesion() llamada. Lista para conectar autenticación más adelante.');
}
window.cerrarSesion = cerrarSesion;

// ==================== INITIALIZATION ====================
async function initApp() {
  try {
    await window.DB.init();
    await loadInitialData();
    bindEvents();
    registerServiceWorker();
    focusTaskInput();
  } catch (error) {
    console.error('Error al inicializar la aplicación:', error);
  }
}

async function loadInitialData() {
  state.sections = await window.DB.getSections();
  if (state.sections.length === 0) {
    const sec = await window.DB.addSection('Personal');
    state.sections = [sec];
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

  // Load lists (apartados)
  state.lists = await window.DB.getLists(sectionId);
  if (state.lists.length === 0) {
    const defaultList = await window.DB.addList(sectionId, 'General');
    state.lists = [defaultList];
  }

  const savedListId = localStorage.getItem(`last_list_${sectionId}`);
  const foundList = state.lists.find((l) => l.id === savedListId);
  state.currentListId = foundList ? foundList.id : state.lists[0].id;

  await switchList(state.currentListId, autoFocus);
  closeSidebar();
}

function renderSections() {
  // 1. Render Desktop Sections (Centered horizontal bar with dot & emerald active underline)
  if (DOM.sectionsList) {
    DOM.sectionsList.innerHTML = '';
    state.sections.forEach((section) => {
      const isActive = section.id === state.currentSectionId;
      const item = document.createElement('div');
      item.className = `section-item-desktop ${isActive ? 'active' : ''}`;
      item.innerHTML = `
        <span class="sec-dot"></span>
        <span class="sec-name">${escapeHTML(section.name)}</span>
        <div class="section-actions">
          <button class="btn-section-action" title="Renombrar sección" data-rename-sec="${section.id}">
            ${ICONS.edit}
          </button>
          <button class="btn-section-action" title="Eliminar sección" data-delete-sec="${section.id}">
            ${ICONS.trash}
          </button>
        </div>
      `;

      item.addEventListener('click', (e) => {
        if (e.target.closest('.btn-section-action')) return;
        switchSection(section.id);
      });

      const btnRename = item.querySelector(`[data-rename-sec="${section.id}"]`);
      if (btnRename) {
        btnRename.addEventListener('click', (e) => {
          e.stopPropagation();
          openRenameSectionModal(section);
        });
      }

      const btnDelete = item.querySelector(`[data-delete-sec="${section.id}"]`);
      if (btnDelete) {
        btnDelete.addEventListener('click', (e) => {
          e.stopPropagation();
          openDeleteSectionModal(section);
        });
      }

      DOM.sectionsList.appendChild(item);
    });
  }

  // 2. Render Mobile Sections Panel (Full touch target, instant switch)
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
        <div class="section-actions" style="opacity: 0.85;">
          <button class="btn-section-action" title="Renombrar" data-rename-mobile="${section.id}">
            ${ICONS.edit}
          </button>
          <button class="btn-section-action" title="Eliminar" data-delete-mobile="${section.id}">
            ${ICONS.trash}
          </button>
        </div>
      `;

      item.addEventListener('click', (e) => {
        if (e.target.closest('.btn-section-action')) return;
        switchSection(section.id);
        closeSidebar();
      });

      const btnRename = item.querySelector(`[data-rename-mobile="${section.id}"]`);
      if (btnRename) {
        btnRename.addEventListener('click', (e) => {
          e.stopPropagation();
          closeSidebar();
          openRenameSectionModal(section);
        });
      }

      const btnDelete = item.querySelector(`[data-delete-mobile="${section.id}"]`);
      if (btnDelete) {
        btnDelete.addEventListener('click', (e) => {
          e.stopPropagation();
          closeSidebar();
          openDeleteSectionModal(section);
        });
      }

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
          await switchSection(newSec.id);
        }
      }
    ]
  });
}

function openRenameSectionModal(section) {
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
        }
      }
    ]
  });
}

function openDeleteSectionModal(section) {
  if (state.sections.length <= 1) {
    openModal({
      title: 'No se puede eliminar',
      bodyHTML: `<p style="font-family: var(--font-body); font-size: 14px; color: var(--text-main);">Debes tener al menos una sección en la aplicación.</p>`,
      footerButtons: [
        { label: 'Entendido', className: 'btn-primary', onClick: closeModal }
      ]
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
          await window.DB.deleteSection(section.id);
          state.sections = await window.DB.getSections();
          closeModal();
          const nextSec = state.sections[0];
          await switchSection(nextSec.id);
        }
      }
    ]
  });
}

// ==================== LISTS (APARTADOS) MANAGEMENT ====================
async function switchList(listId, autoFocus = true) {
  state.currentListId = listId;
  localStorage.setItem(`last_list_${state.currentSectionId}`, listId);

  renderListsTabs();
  await loadTasks();

  if (autoFocus) {
    focusTaskInput();
  }
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
            await window.DB.deleteList(list.id);
            state.lists = await window.DB.getLists(state.currentSectionId);
            closeModal();
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
        }
      }
    ]
  });
}

// ==================== TASKS MANAGEMENT ====================
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

  // Update tasks counter badge ("1 pendiente · 2 completadas")
  if (DOM.tasksCounterBadge) {
    const pCount = activeTasks.length;
    const cCount = completedTasks.length;
    const pText = `${pCount} ${pCount === 1 ? 'pendiente' : 'pendientes'}`;
    const cText = `${cCount} ${cCount === 1 ? 'completada' : 'completadas'}`;
    DOM.tasksCounterBadge.textContent = `${pText} · ${cText}`;
  }

  // Render Active Tasks
  DOM.activeTasksList.innerHTML = '';
  if (activeTasks.length === 0 && completedTasks.length === 0) {
    DOM.emptyState.classList.add('visible');
  } else {
    DOM.emptyState.classList.remove('visible');
  }

  activeTasks.forEach((task) => {
    DOM.activeTasksList.appendChild(createTaskElement(task));
  });

  // Render Completed Tasks
  DOM.completedTasksList.innerHTML = '';
  if (completedTasks.length > 0) {
    DOM.completedSection.classList.add('visible');
    DOM.completedCountLabel.textContent = `COMPLETADAS (${completedTasks.length})`;
    completedTasks.forEach((task) => {
      DOM.completedTasksList.appendChild(createTaskElement(task));
    });
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
      <div class="task-circle">
        ${ICONS.check}
      </div>
    </button>
    <div class="task-content">
      <div class="task-title">${escapeHTML(task.title)}</div>
      ${noteSnippet}
    </div>
    <div class="task-actions">
      <button class="btn-task-action" title="Editar tarea">
        ${ICONS.edit}
      </button>
    </div>
  `;

  // Checkbox toggle
  const chkBtn = item.querySelector('.task-checkbox-btn');
  chkBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleTaskDone(task);
  });

  // Click on card opens edit modal
  item.addEventListener('click', () => {
    openEditTaskModal(task);
  });

  return item;
}

async function toggleTaskDone(task) {
  const newDoneStatus = !task.done;
  await window.DB.updateTask(task.id, { done: newDoneStatus });
  await loadTasks();
}

async function handleAddTask(e) {
  e.preventDefault();
  const title = DOM.taskInput.value.trim();
  if (!title) return;

  await window.DB.addTask(state.currentListId, title, '');

  DOM.taskInput.value = '';
  await loadTasks();
  focusTaskInput();

  DOM.tasksScrollContainer.scrollTop = 0;
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
            await window.DB.deleteTask(task.id);
            closeModal();
            await loadTasks();
            focusTaskInput();
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

          await window.DB.updateTask(task.id, {
            title: newTitle,
            note: newNote
          });

          closeModal();
          await loadTasks();
          focusTaskInput();
        }
      }
    ]
  });
}

// ==================== UI HELPERS ====================
function focusTaskInput() {
  setTimeout(() => {
    if (DOM.taskInput) {
      DOM.taskInput.focus();
    }
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

// ==================== MODAL SYSTEM ====================
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
  if (firstInput) {
    setTimeout(() => firstInput.focus(), 60);
  }
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

// ==================== EVENT BINDINGS ====================
function bindEvents() {
  // Mobile panel toggles
  if (DOM.btnMenu) DOM.btnMenu.addEventListener('click', () => toggleSidebar(true));
  if (DOM.btnCloseSidebar) DOM.btnCloseSidebar.addEventListener('click', () => toggleSidebar(false));
  if (DOM.sidebarBackdrop) DOM.sidebarBackdrop.addEventListener('click', () => toggleSidebar(false));

  // Sections
  if (DOM.btnNewSection) DOM.btnNewSection.addEventListener('click', openNewSectionModal);
  if (DOM.btnNewSectionMobile) {
    DOM.btnNewSectionMobile.addEventListener('click', () => {
      closeSidebar();
      openNewSectionModal();
    });
  }

  // Lists (apartados)
  if (DOM.btnAddList) DOM.btnAddList.addEventListener('click', openNewListModal);

  // Completed toggle accordion
  if (DOM.completedToggleBtn) DOM.completedToggleBtn.addEventListener('click', toggleCompletedAccordion);

  // Add Task
  if (DOM.addTaskForm) DOM.addTaskForm.addEventListener('submit', handleAddTask);

  // Modal close
  if (DOM.btnModalClose) DOM.btnModalClose.addEventListener('click', closeModal);
  if (DOM.modalContainer) {
    DOM.modalContainer.addEventListener('click', (e) => {
      if (e.target === DOM.modalContainer) closeModal();
    });
  }

  // Keyboard shortcut: Escape closes modal or sidebar
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (DOM.modalContainer && DOM.modalContainer.classList.contains('open')) {
        closeModal();
      } else if (DOM.sidebar && DOM.sidebar.classList.contains('open')) {
        closeSidebar();
      }
    }
  });
}

// ==================== PWA SERVICE WORKER ====================
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./sw.js', { scope: './' })
        .then((reg) => {
          console.log('ServiceWorker registrado en scope:', reg.scope);
        })
        .catch((err) => {
          console.warn('Registro de ServiceWorker falló:', err);
        });
    });
  }
}

// Start app
document.addEventListener('DOMContentLoaded', initApp);