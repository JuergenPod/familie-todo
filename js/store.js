// Central state (users, tasks, pointsLog). Single writer to localStorage.
// Emits 'change' events via the exported emitter.

const LS_KEY = 'familieToDo.state.v1';

const EMPTY_STATE = () => ({
  version: 1,
  updatedAt: new Date().toISOString(),
  users: [],
  tasks: [],
  pointsLog: [],
});

let state = null;
const listeners = new Set();
let syncCb = null;
let syncDebounce = null;

function load() {
  if (state) return state;
  try {
    const raw = localStorage.getItem(LS_KEY);
    state = raw ? normalize(JSON.parse(raw)) : EMPTY_STATE();
  } catch {
    state = EMPTY_STATE();
  }
  return state;
}

function normalize(raw) {
  const s = { ...EMPTY_STATE(), ...raw };
  s.users = Array.isArray(s.users) ? s.users.map(normalizeUser) : [];
  s.tasks = Array.isArray(s.tasks) ? s.tasks.map(normalizeTask) : [];
  s.pointsLog = Array.isArray(s.pointsLog) ? s.pointsLog.filter(Boolean) : [];
  return s;
}

function normalizeUser(u) {
  return {
    id: u.id,
    name: u.name || 'Unbekannt',
    role: u.role === 'parent' ? 'parent' : 'kid',
    color: u.color || '#4f46e5',
    emoji: u.emoji || '🧑',
  };
}

function normalizeTask(t) {
  return {
    id: t.id,
    title: t.title || '',
    description: t.description || '',
    category: t.category || '',
    assignedTo: t.assignedTo || null,
    createdBy: t.createdBy || null,
    createdAt: t.createdAt || new Date().toISOString(),
    updatedAt: t.updatedAt || t.createdAt || new Date().toISOString(),
    dueDate: t.dueDate || null,
    estimatedMinutes: Number.isFinite(t.estimatedMinutes) ? t.estimatedMinutes : null,
    actualMinutes: Number.isFinite(t.actualMinutes) ? t.actualMinutes : 0,
    priority: ['low', 'medium', 'high'].includes(t.priority) ? t.priority : 'medium',
    status: t.status === 'done' ? 'done' : 'open',
    completedAt: t.completedAt || null,
    recurrence: t.recurrence || null,
    sortOrder: Number.isFinite(t.sortOrder) ? t.sortOrder : 0,
    points: t.points == null ? null : Number(t.points),
    subtasks: Array.isArray(t.subtasks) ? t.subtasks.map((s) => ({
      id: s.id,
      text: s.text || '',
      done: Boolean(s.done),
      updatedAt: s.updatedAt || new Date().toISOString(),
    })) : [],
    comments: Array.isArray(t.comments) ? t.comments.filter(Boolean) : [],
    deletedAt: t.deletedAt || null,
  };
}

function persist() {
  state.updatedAt = new Date().toISOString();
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* quota */ }
  for (const l of listeners) l();
  scheduleSync();
}

function scheduleSync() {
  if (!syncCb) return;
  clearTimeout(syncDebounce);
  syncDebounce = setTimeout(() => syncCb(), 600);
}

export const store = {
  load,
  getState() { return load(); },
  replaceState(newState) {
    state = normalize(newState);
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* quota */ }
    for (const l of listeners) l();
  },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  setSyncCallback(fn) { syncCb = fn; },
  flushSync() {
    clearTimeout(syncDebounce);
    if (syncCb) syncCb();
  },

  // Users
  getUsers() { return [...load().users]; },
  getUser(id) { return load().users.find((u) => u.id === id) || null; },
  addUser(data) {
    const u = normalizeUser({ id: 'u_' + uid(), ...data });
    load().users.push(u);
    persist();
    return u;
  },
  updateUser(id, patch) {
    const u = load().users.find((x) => x.id === id);
    if (!u) return null;
    Object.assign(u, normalizeUser({ ...u, ...patch, id }));
    persist();
    return u;
  },
  deleteUser(id) {
    const s = load();
    s.users = s.users.filter((u) => u.id !== id);
    persist();
  },

  // Tasks
  getTasks(includeDeleted = false) {
    const list = [...load().tasks];
    return includeDeleted ? list : list.filter((t) => !t.deletedAt);
  },
  getTask(id) { return load().tasks.find((t) => t.id === id) || null; },
  addTask(data) {
    const now = new Date().toISOString();
    const t = normalizeTask({
      id: 't_' + uid(),
      createdAt: now,
      updatedAt: now,
      ...data,
    });
    // Put new tasks at top of sort order.
    const minOrder = Math.min(0, ...load().tasks.map((x) => x.sortOrder));
    t.sortOrder = minOrder - 1;
    load().tasks.push(t);
    persist();
    return t;
  },
  updateTask(id, patch) {
    const t = load().tasks.find((x) => x.id === id);
    if (!t) return null;
    Object.assign(t, patch, { updatedAt: new Date().toISOString() });
    persist();
    return t;
  },
  deleteTask(id) {
    const t = load().tasks.find((x) => x.id === id);
    if (!t) return;
    t.deletedAt = new Date().toISOString();
    t.updatedAt = t.deletedAt;
    persist();
  },
  toggleDone(id) {
    const t = load().tasks.find((x) => x.id === id);
    if (!t) return null;
    const now = new Date().toISOString();
    if (t.status === 'open') {
      t.status = 'done';
      t.completedAt = now;
      t.updatedAt = now;
      // Recurrence: spawn successor.
      if (t.recurrence) {
        const next = spawnRecurrent(t);
        if (next) load().tasks.push(next);
      }
    } else {
      t.status = 'open';
      t.completedAt = null;
      t.updatedAt = now;
    }
    persist();
    return t;
  },
  setSortOrder(id, order) {
    const t = load().tasks.find((x) => x.id === id);
    if (!t) return;
    t.sortOrder = order;
    t.updatedAt = new Date().toISOString();
    persist();
  },
  setStatus(id, status) {
    const t = load().tasks.find((x) => x.id === id);
    if (!t) return;
    if (t.status === status) return;
    const now = new Date().toISOString();
    t.status = status === 'done' ? 'done' : 'open';
    t.completedAt = status === 'done' ? now : null;
    t.updatedAt = now;
    if (status === 'done' && t.recurrence) {
      const next = spawnRecurrent(t);
      if (next) load().tasks.push(next);
    }
    persist();
  },

  // Subtasks
  addSubtask(taskId, text) {
    const t = load().tasks.find((x) => x.id === taskId);
    if (!t || !text.trim()) return null;
    const s = { id: 's_' + uid(), text: text.trim(), done: false, updatedAt: new Date().toISOString() };
    t.subtasks.push(s);
    t.updatedAt = s.updatedAt;
    persist();
    return s;
  },
  toggleSubtask(taskId, subtaskId) {
    const t = load().tasks.find((x) => x.id === taskId);
    if (!t) return;
    const s = t.subtasks.find((x) => x.id === subtaskId);
    if (!s) return;
    s.done = !s.done;
    s.updatedAt = new Date().toISOString();
    t.updatedAt = s.updatedAt;
    persist();
  },
  deleteSubtask(taskId, subtaskId) {
    const t = load().tasks.find((x) => x.id === taskId);
    if (!t) return;
    t.subtasks = t.subtasks.filter((x) => x.id !== subtaskId);
    t.updatedAt = new Date().toISOString();
    persist();
  },

  // Comments
  addComment(taskId, byUserId, text) {
    const t = load().tasks.find((x) => x.id === taskId);
    if (!t || !text.trim()) return null;
    const c = { id: 'c_' + uid(), by: byUserId, at: new Date().toISOString(), text: text.trim() };
    t.comments.push(c);
    t.updatedAt = c.at;
    persist();
    return c;
  },

  // Points log
  getPointsLog() { return [...load().pointsLog]; },
  addPointsLog(entry) {
    load().pointsLog.push({ id: 'p_' + uid(), ...entry });
    persist();
  },
  removePointsLogForTask(taskId) {
    const s = load();
    const before = s.pointsLog.length;
    s.pointsLog = s.pointsLog.filter((p) => p.taskId !== taskId);
    if (s.pointsLog.length !== before) persist();
  },

  // Categories helper
  getCategories() {
    const set = new Set();
    for (const t of load().tasks) {
      if (!t.deletedAt && t.category) set.add(t.category);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'de'));
  },

  // Timer helper: adds minutes to actualMinutes
  addActualMinutes(taskId, minutes) {
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    const t = load().tasks.find((x) => x.id === taskId);
    if (!t) return;
    t.actualMinutes = (t.actualMinutes || 0) + minutes;
    t.updatedAt = new Date().toISOString();
    persist();
  },

  // Purge old tombstones (> 30 days)
  purgeTombstones() {
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    const s = load();
    const before = s.tasks.length;
    s.tasks = s.tasks.filter((t) => !t.deletedAt || Date.parse(t.deletedAt) > cutoff);
    if (s.tasks.length !== before) persist();
  },
};

function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 9)).replace(/-/g, '').slice(0, 16);
}

function spawnRecurrent(t) {
  if (!t.dueDate) return null;
  const base = new Date(t.dueDate + 'T00:00:00');
  if (Number.isNaN(base.getTime())) return null;
  const next = new Date(base);
  switch (t.recurrence) {
    case 'daily': next.setDate(next.getDate() + 1); break;
    case 'weekdays': {
      do { next.setDate(next.getDate() + 1); } while (next.getDay() === 0 || next.getDay() === 6);
      break;
    }
    case 'weekly': next.setDate(next.getDate() + 7); break;
    case 'monthly': next.setMonth(next.getMonth() + 1); break;
    default: return null;
  }
  const dueDate = next.toISOString().slice(0, 10);
  const now = new Date().toISOString();
  return normalizeTask({
    id: 't_' + uid(),
    title: t.title,
    description: t.description,
    category: t.category,
    assignedTo: t.assignedTo,
    createdBy: t.createdBy,
    createdAt: now,
    updatedAt: now,
    dueDate,
    estimatedMinutes: t.estimatedMinutes,
    actualMinutes: 0,
    priority: t.priority,
    status: 'open',
    recurrence: t.recurrence,
    sortOrder: t.sortOrder,
    points: t.points,
    subtasks: t.subtasks.map((s) => ({ id: 's_' + uid(), text: s.text, done: false, updatedAt: now })),
    comments: [],
  });
}
