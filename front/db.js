/**
 * db.js - IndexedDB manager for Tareas PWA
 * Tablas:
 * - sections (id, name, position)
 * - lists (id, section_id, name, position)
 * - tasks (id, list_id, title, note, done, due_date, due_time, position, updated_at)
 */

const DB_NAME_PREFIX = 'Klip_User_';
const DB_VERSION = 3;

function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

class Database {
  constructor() {
    this.db = null;
    this.userId = null;
  }

  async init(userId) {
    if (!userId) throw new Error('Se requiere una sesión de usuario para abrir la base local.');
    if (this.db && this.userId === userId) return this.db;
    this.close();
    this.userId = userId;
    const dbName = `${DB_NAME_PREFIX}${userId}`;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Add sync metadata to existing records through the versioned store upgrade.
        if (!db.objectStoreNames.contains('sections')) {
          const sectionStore = db.createObjectStore('sections', { keyPath: 'id' });
          sectionStore.createIndex('position', 'position', { unique: false });
        }
        if (event.oldVersion < 2) {
          // Existing rows are normalized lazily by init after the upgrade.
        }

        // lists table
        if (!db.objectStoreNames.contains('lists')) {
          const listStore = db.createObjectStore('lists', { keyPath: 'id' });
          listStore.createIndex('section_id', 'section_id', { unique: false });
          listStore.createIndex('position', 'position', { unique: false });
        }

        // tasks table
        if (!db.objectStoreNames.contains('tasks')) {
          const taskStore = db.createObjectStore('tasks', { keyPath: 'id' });
          taskStore.createIndex('list_id', 'list_id', { unique: false });
          taskStore.createIndex('done', 'done', { unique: false });
          taskStore.createIndex('position', 'position', { unique: false });
          taskStore.createIndex('updated_at', 'updated_at', { unique: false });
          taskStore.createIndex('parent_task_id', 'parent_task_id', { unique: false });
        } else if (!event.target.transaction.objectStore('tasks').indexNames.contains('parent_task_id')) {
          event.target.transaction.objectStore('tasks').createIndex('parent_task_id', 'parent_task_id', { unique: false });
        }
      };

      request.onsuccess = async (event) => {
        this.db = event.target.result;
        try {
          await this.migrateRecords();
          resolve(this.db);
        } catch (err) {
          reject(err);
        }
      };

      request.onerror = (event) => {
        console.error('IndexedDB open error:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  close() {
    if (this.db) this.db.close();
    this.db = null;
    this.userId = null;
  }

  async migrateRecords() {
    // Legacy sections/lists had no timestamp; let existing server records win their first merge.
    const stamp = new Date(0).toISOString();
    for (const name of ['sections', 'lists', 'tasks']) {
      for (const row of await this._getAll(name)) {
        const patch = { ...row, updated_at: row.updated_at || stamp, deleted: !!row.deleted };
        if (name === 'tasks') {
          if (patch.due_date === '') patch.due_date = null;
          if (patch.due_time === '') patch.due_time = null;
          if (patch.parent_task_id === undefined) patch.parent_task_id = null;
        }
        await this._put(name, patch);
      }
    }
  }

  // Seed default 4 sections if database is fresh
  async seedDefaultData() {
    const sections = await this.getSections();
    if (sections.length > 0) return;

    const defaultSections = [
      {
        name: 'Personal',
        listName: 'General',
        tasks: [
          { title: 'Bienvenido a Tareas', note: 'Diseño minimalista y rápido estilo Google Tasks', done: false },
          { title: 'Toca el círculo para marcar como hecha', note: 'Las tareas completadas van a la sección inferior', done: false },
          { title: 'Ejemplo de tarea completada', note: 'Puedes desmarcarla en cualquier momento', done: true }
        ]
      },
      {
        name: 'Trabajo',
        listName: 'General',
        tasks: [
          { title: 'Revisar objetivos del proyecto', note: 'Definir prioridades del equipo', done: false }
        ]
      },
      {
        name: 'Estudio',
        listName: 'General',
        tasks: [
          { title: 'Repasar temas de la semana', note: 'Preparar apuntes resumidos', done: false }
        ]
      },
      {
        name: 'Proyectos',
        listName: 'General',
        tasks: [
          { title: 'Diseñar interfaz minimalista PWA', note: 'Paleta rosa niebla, azul tinta y esmeralda', done: false }
        ]
      }
    ];

    const now = new Date().toISOString();

    for (let i = 0; i < defaultSections.length; i++) {
      const secData = defaultSections[i];
      const sectionId = generateUUID();

      await this._put('sections', {
        id: sectionId,
        name: secData.name,
        position: i
      });

      const listId = generateUUID();
      await this._put('lists', {
        id: listId,
        section_id: sectionId,
        name: secData.listName,
        position: 0
      });

      for (let t = 0; t < secData.tasks.length; t++) {
        const taskData = secData.tasks[t];
        await this._put('tasks', {
          id: generateUUID(),
          list_id: listId,
          title: taskData.title,
          note: taskData.note,
          done: taskData.done,
          due_date: '',
          due_time: '',
          position: t,
          updated_at: now
        });
      }
    }
  }

  // Generic helpers
  _transaction(storeNames, mode = 'readonly') {
    return this.db.transaction(storeNames, mode);
  }

  _get(storeName, id) {
    return new Promise((resolve, reject) => {
      const tx = this._transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  _getAll(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this._transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  _put(storeName, item) {
    return new Promise((resolve, reject) => {
      const tx = this._transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(item);
      req.onsuccess = () => resolve(item);
      req.onerror = () => reject(req.error);
    });
  }

  _delete(storeName, id) {
    return new Promise((resolve, reject) => {
      const tx = this._transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  // --- SECTIONS ---
  async getSections() {
    const list = await this._getAll('sections');
    return list.filter((row) => !row.deleted).sort((a, b) => a.position - b.position);
  }

  async addSection(name) {
    const sections = await this.getSections();
    const position = sections.length > 0 ? Math.max(...sections.map((s) => s.position)) + 1 : 0;
    const newSection = {
      id: generateUUID(),
      name: name.trim(),
      position,
      updated_at: new Date().toISOString(),
      deleted: false
    };
    await this._put('sections', newSection);
    // Automatically create a default list for the section
    await this.addList(newSection.id, 'General');
    return newSection;
  }

  async updateSection(id, updates) {
    const section = await this._get('sections', id);
    if (!section) throw new Error('Sección no encontrada');
    const updated = { ...section, ...updates, updated_at: new Date().toISOString() };
    await this._put('sections', updated);
    return updated;
  }

  async deleteSection(id) {
    // Cascading delete: lists and their tasks
    const lists = (await this._getAll('lists')).filter((list) => list.section_id === id && !list.deleted);
    for (const list of lists) {
      await this.deleteList(list.id);
    }
    const section = await this._get('sections', id);
    await this._put('sections', { ...section, deleted: true, updated_at: new Date().toISOString() });
    return true;
  }

  // --- LISTS (Apartados) ---
  async getLists(sectionId) {
    return new Promise((resolve, reject) => {
      const tx = this._transaction('lists', 'readonly');
      const store = tx.objectStore('lists');
      const index = store.index('section_id');
      const req = index.getAll(sectionId);
      req.onsuccess = () => {
        const lists = (req.result || []).filter((row) => !row.deleted);
        lists.sort((a, b) => a.position - b.position);
        resolve(lists);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async addList(sectionId, name) {
    const lists = await this.getLists(sectionId);
    const position = lists.length > 0 ? Math.max(...lists.map((l) => l.position)) + 1 : 0;
    const newList = {
      id: generateUUID(),
      section_id: sectionId,
      name: name.trim(),
      position,
      updated_at: new Date().toISOString(),
      deleted: false
    };
    await this._put('lists', newList);
    return newList;
  }

  async updateList(id, updates) {
    const list = await this._get('lists', id);
    if (!list) throw new Error('Apartado no encontrado');
    const updated = { ...list, ...updates, updated_at: new Date().toISOString() };
    await this._put('lists', updated);
    return updated;
  }

  async deleteList(id) {
    // Cascading delete tasks belonging to this list
    const tasks = (await this._getAll('tasks')).filter((task) => task.list_id === id && !task.deleted);
    for (const task of tasks) {
      await this.deleteTask(task.id);
    }
    const list = await this._get('lists', id);
    await this._put('lists', { ...list, deleted: true, updated_at: new Date().toISOString() });
    return true;
  }

  // --- TASKS ---
  async getTasks(listId) {
    return new Promise((resolve, reject) => {
      const tx = this._transaction('tasks', 'readonly');
      const store = tx.objectStore('tasks');
      const index = store.index('list_id');
      const req = index.getAll(listId);
      req.onsuccess = () => {
        const tasks = (req.result || []).filter((row) => !row.deleted && !row.parent_task_id);
        tasks.sort((a, b) => a.position - b.position);
        resolve(tasks);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async getSubtasks(parentTaskId) {
    return new Promise((resolve, reject) => {
      const store = this._transaction('tasks', 'readonly').objectStore('tasks');
      const req = store.index('parent_task_id').getAll(parentTaskId);
      req.onsuccess = () => {
        const rows = (req.result || []).filter((row) => !row.deleted);
        rows.sort((a, b) => a.position - b.position);
        resolve(rows);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async addTask(listId, title, note = '') {
    const tasks = await this.getTasks(listId);
    const position = tasks.length > 0 ? Math.max(...tasks.map((t) => t.position)) + 1 : 0;
    const newTask = {
      id: generateUUID(),
      list_id: listId,
      title: title.trim(),
      note: (note || '').trim(),
      done: false,
      due_date: null,
      due_time: null,
      parent_task_id: null,
      position,
      updated_at: new Date().toISOString(), deleted: false
    };
    await this._put('tasks', newTask);
    return newTask;
  }

  async addSubtask(parentTaskId, title) {
    const parent = await this._get('tasks', parentTaskId);
    if (!parent || parent.deleted) throw new Error('Tarea principal no encontrada');
    const siblings = await this.getSubtasks(parentTaskId);
    const subtask = {
      id: generateUUID(), list_id: parent.list_id, parent_task_id: parentTaskId,
      title: title.trim(), note: '', done: false, due_date: null, due_time: null,
      position: siblings.length ? Math.max(...siblings.map((row) => row.position)) + 1 : 0,
      updated_at: new Date().toISOString(), deleted: false
    };
    await this._put('tasks', subtask);
    return subtask;
  }

  async updateTask(id, updates) {
    const task = await this._get('tasks', id);
    if (!task) throw new Error('Tarea no encontrada');
    const updated = {
      ...task,
      ...updates,
      updated_at: new Date().toISOString()
    };
    await this._put('tasks', updated);
    return updated;
  }

  async deleteTask(id) {
    const task = await this._get('tasks', id);
    if (!task) return true;
    for (const child of await this.getSubtasks(id)) await this.deleteTask(child.id);
    await this._put('tasks', { ...task, deleted: true, updated_at: new Date().toISOString() });
    return true;
  }
}

// Global instance
window.DB = new Database();
