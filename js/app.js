// Entry point: screen routing, event wiring, service worker registration.

import { config } from './config.js';
import { store } from './store.js';
import { theme } from './theme.js';
import {
  escapeHtml, filterTasks, sortTasks, renderTaskCard, renderUserBadge,
  showToast, todayStr, formatDateTime,
} from './ui.js';
import { pointsFor, awardPoints, revokePoints, totalPointsFor, weekStartIso } from './points.js';
import { initTimer, openTimerFor, closeTimer } from './timer.js';
import { initDnd } from './dnd.js';
import { sync } from './sync.js';
import { initCalendar, renderCalendar } from './calendar.js';

// ---- State UI has but isn't in the store ----
let ui = {
  currentFilter: { type: 'preset', value: 'all' },
  search: '',
  sort: 'sortOrder',
  editingTaskId: null,
  editingUserId: null,
  view: config.get('view') || 'list', // 'list' | 'calendar'
};
let editingTags = [];

// ---- Boot ----
document.addEventListener('DOMContentLoaded', boot);

async function boot() {
  theme.init();
  wireTopBanners();
  wireSetupScreen();
  wireUserSelectScreen();
  wireAppHeader();
  wireSidebar();
  wireToolbar();
  wireFab();
  wireTaskModal();
  wireUserModal();
  wireSettingsModal();
  initTimer();
  initCalendar({ onDayClick: onCalendarDayClick, onTaskClick: (id) => openTaskModal(id) });

  store.subscribe(() => renderAll());
  store.setSyncCallback(() => sync.push().catch(() => {}));

  sync.attachHandlers({
    onUpdateAvailable: showUpdateBanner,
    onOnlineChange: (online) => toggleOfflineBanner(!online),
  });

  await registerServiceWorker();
  routeInitialScreen();

  // Start first sync in background if configured.
  if (config.isReady()) {
    sync.start();
  }

  toggleOfflineBanner(!navigator.onLine);
  setInterval(() => store.purgeTombstones(), 24 * 3600 * 1000);
}

// ---- Screen routing ----
function routeInitialScreen() {
  if (!config.isReady()) return showScreen('setup');
  if (!config.hasUser() || !store.getUser(config.get('currentUserId'))) return showScreen('user-select');
  showScreen('app');
}

function showScreen(which) {
  const setup = document.getElementById('setup-screen');
  const userSel = document.getElementById('user-select-screen');
  const app = document.getElementById('app');
  setup.classList.toggle('hidden', which !== 'setup');
  userSel.classList.toggle('hidden', which !== 'user-select');
  app.classList.toggle('hidden', which !== 'app');
  if (which === 'user-select') renderUserSelect();
  if (which === 'app') renderAll();
}

// ---- Banners ----
function wireTopBanners() {
  document.getElementById('update-reload-btn').addEventListener('click', async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg?.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    location.reload();
  });
  document.getElementById('update-dismiss-btn').addEventListener('click', () => {
    document.getElementById('update-banner').classList.add('hidden');
    const latest = document.getElementById('update-banner').dataset.version;
    if (latest) config.set('dismissedVersion', latest);
  });
}

function showUpdateBanner(latestVersion) {
  if (!latestVersion) return;
  if (config.get('dismissedVersion') === latestVersion) return;
  const el = document.getElementById('update-banner');
  el.dataset.version = latestVersion;
  el.querySelector('#update-banner-text').textContent = `Neue Version ${latestVersion} verfügbar.`;
  el.classList.remove('hidden');
}

function toggleOfflineBanner(offline) {
  document.getElementById('offline-banner').classList.toggle('hidden', !offline);
}

// ---- Setup screen ----
function wireSetupScreen() {
  const form = document.getElementById('setup-form');
  const errEl = document.getElementById('setup-error');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    errEl.classList.add('hidden');
    const owner = document.getElementById('setup-owner').value.trim();
    const repo = document.getElementById('setup-repo').value.trim();
    const path = document.getElementById('setup-path').value.trim();
    const pat = document.getElementById('setup-pat').value;
    if (!owner || !repo || !path || !pat) {
      errEl.textContent = 'Bitte alle Felder ausfüllen.';
      errEl.classList.remove('hidden');
      return;
    }
    config.setMany({ owner, repo, path, pat });
    const submitBtn = document.getElementById('setup-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Verbinde…';
    try {
      await sync.firstSync();
      submitBtn.disabled = false;
      submitBtn.textContent = 'Verbinden';
      routeInitialScreen();
      sync.start();
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Verbinden';
      errEl.textContent = humanError(err);
      errEl.classList.remove('hidden');
    }
  });

  // Prefill defaults.
  document.getElementById('setup-owner').value = config.get('owner') || '';
  document.getElementById('setup-repo').value = config.get('repo') || '';
  document.getElementById('setup-path').value = config.get('path') || '';
}

function humanError(err) {
  if (!err) return 'Unbekannter Fehler.';
  if (err.code === 'AUTH') return 'PAT ungültig oder hat keine Schreibrechte auf das Repo.';
  if (err.code === 'NOT_FOUND') return 'Repository oder Pfad nicht gefunden. Prüfe Owner, Repo und Dateipfad.';
  if (err.code === 'NETWORK') return 'Netzwerkfehler. Bist du online?';
  if (err.code === 'CONFLICT') return 'Konflikt beim Speichern. Versuche es erneut.';
  return err.message || String(err);
}

// ---- User select screen ----
function wireUserSelectScreen() {
  document.getElementById('user-add-btn').addEventListener('click', () => openUserModal(null));
  document.getElementById('open-settings-from-userselect').addEventListener('click', openSettingsModal);
}

function renderUserSelect() {
  const list = document.getElementById('user-list');
  const users = store.getUsers();
  if (!users.length) {
    list.innerHTML = '<p class="muted small">Noch keine Profile. Lege eins an, um loszulegen.</p>';
    return;
  }
  list.innerHTML = users.map((u) => `
    <div class="user-tile-wrap" role="listitem">
      <button class="user-tile" data-user-id="${escapeHtml(u.id)}">
        <span class="user-badge" style="background:${escapeHtml(u.color)}">${escapeHtml(u.emoji || u.name[0] || '?')}</span>
        <span>${escapeHtml(u.name)}</span>
        <span class="role">${u.role === 'parent' ? 'Elternteil' : 'Kind'}</span>
      </button>
      <button class="user-tile-edit" data-edit-user-id="${escapeHtml(u.id)}" aria-label="${escapeHtml(u.name)} bearbeiten">✏</button>
    </div>
  `).join('');
  list.querySelectorAll('.user-tile').forEach((t) => {
    t.addEventListener('click', () => {
      config.set('currentUserId', t.dataset.userId);
      showScreen('app');
    });
  });
  list.querySelectorAll('.user-tile-edit').forEach((b) => {
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openUserModal(b.dataset.editUserId);
    });
  });
}

// ---- App header ----
function wireAppHeader() {
  document.getElementById('menu-toggle').addEventListener('click', () => {
    const sb = document.getElementById('sidebar');
    const bd = document.getElementById('sidebar-backdrop');
    sb.classList.toggle('open');
    bd.classList.toggle('hidden', !sb.classList.contains('open'));
  });
  document.getElementById('sidebar-backdrop').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-backdrop').classList.add('hidden');
  });
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const next = theme.cycle();
    showToast(`Theme: ${next === 'auto' ? 'Automatisch' : next === 'dark' ? 'Dunkel' : 'Hell'}`);
  });
  document.getElementById('sync-btn').addEventListener('click', async () => {
    try {
      await sync.force();
      showToast('Synchronisiert.', 'success');
    } catch (err) {
      showToast(humanError(err), 'error');
    }
  });
  document.getElementById('user-btn').addEventListener('click', () => {
    config.set('currentUserId', null);
    showScreen('user-select');
  });
}

// ---- Sidebar ----
function wireSidebar() {
  document.getElementById('sidebar').addEventListener('click', (ev) => {
    const btn = ev.target.closest('.nav-item');
    if (!btn) return;
    const type = btn.dataset.filterType;
    const value = btn.dataset.filter;
    if (!type) return;
    ui.currentFilter = { type, value };
    closeSidebarOnMobile();
    renderMain();
  });
  document.getElementById('settings-btn').addEventListener('click', openSettingsModal);
}

function closeSidebarOnMobile() {
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-backdrop').classList.add('hidden');
  }
}

// ---- Toolbar ----
function wireToolbar() {
  const search = document.getElementById('search-input');
  search.addEventListener('input', () => { ui.search = search.value; renderMain(); });
  const sortSel = document.getElementById('sort-select');
  sortSel.addEventListener('change', () => { ui.sort = sortSel.value; renderMain(); });
}

// ---- FAB ----
function wireFab() {
  document.getElementById('new-task-btn').addEventListener('click', () => openTaskModal(null));
}

// ---- Task modal ----
function wireTaskModal() {
  const modal = document.getElementById('task-modal');
  const form = document.getElementById('task-form');
  modal.addEventListener('click', (ev) => {
    if (ev.target === modal) closeModal(modal);
  });
  modal.querySelectorAll('[data-close-modal]').forEach((b) => b.addEventListener('click', () => closeModal(modal)));

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    saveTaskFromForm();
  });

  document.getElementById('task-delete-btn').addEventListener('click', () => {
    if (!ui.editingTaskId) return;
    if (!confirm('Aufgabe wirklich löschen?')) return;
    revokePoints(ui.editingTaskId);
    store.deleteTask(ui.editingTaskId);
    closeModal(modal);
  });

  // Tags
  document.getElementById('task-tag-add').addEventListener('click', addTagFromInput);
  document.getElementById('task-tag-input').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); addTagFromInput(); }
  });
  // iOS datalist selection fires 'change' instead of keydown Enter
  document.getElementById('task-tag-input').addEventListener('change', () => addTagFromInput());

  // Subtasks
  document.getElementById('task-subtask-add').addEventListener('click', addSubtaskFromInput);
  document.getElementById('task-subtask-input').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); addSubtaskFromInput(); }
  });

  // Comments
  document.getElementById('task-comment-add').addEventListener('click', addCommentFromInput);
  document.getElementById('task-comment-input').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); addCommentFromInput(); }
  });
}

function openTaskModal(taskId, presetData = null) {
  ui.editingTaskId = taskId;
  const modal = document.getElementById('task-modal');
  const title = document.getElementById('task-modal-title');
  const users = store.getUsers();
  const assigneeSel = document.getElementById('task-assignee');
  assigneeSel.innerHTML = users.map((u) => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.emoji || '')} ${escapeHtml(u.name)}</option>`).join('');

  const dl = document.getElementById('tags-datalist');
  if (dl) dl.innerHTML = store.getTags().map((t) => `<option value="${escapeHtml(t)}"></option>`).join('');

  let t;
  if (taskId) {
    t = store.getTask(taskId);
    if (!t) return;
    title.textContent = 'Aufgabe bearbeiten';
    document.getElementById('task-delete-btn').classList.remove('hidden');
    document.getElementById('task-comments-section').classList.remove('hidden');
    document.getElementById('task-time-section').classList.remove('hidden');
  } else {
    t = {
      title: '', description: '', tags: [],
      assignedTo: preferredAssignee(users),
      dueDate: presetData?.dueDate || '',
      estimatedMinutes: '', priority: 'medium',
      recurrence: '', points: '',
      subtasks: [], comments: [],
      actualMinutes: 0,
    };
    title.textContent = 'Neue Aufgabe';
    document.getElementById('task-delete-btn').classList.add('hidden');
    document.getElementById('task-comments-section').classList.add('hidden');
    document.getElementById('task-time-section').classList.add('hidden');
  }

  editingTags = Array.isArray(t.tags) ? [...t.tags] : [];
  document.getElementById('task-title').value = t.title || '';
  document.getElementById('task-description').value = t.description || '';
  document.getElementById('task-assignee').value = t.assignedTo || preferredAssignee(users) || '';
  renderTagsInModal();
  document.getElementById('task-due').value = t.dueDate || '';
  document.getElementById('task-estimated').value = t.estimatedMinutes ?? '';
  document.getElementById('task-priority').value = t.priority || 'medium';
  document.getElementById('task-recurrence').value = t.recurrence || '';
  document.getElementById('task-points').value = t.points ?? '';
  document.getElementById('task-actual').value = t.actualMinutes || '';

  renderSubtasksInModal(t);
  renderCommentsInModal(t);

  if (taskId) openTimerFor(taskId);
  modal.showModal();
  setTimeout(() => document.getElementById('task-title').focus(), 50);
}

function preferredAssignee(users) {
  const me = config.get('currentUserId');
  const myUser = users.find((u) => u.id === me);
  if (myUser && myUser.role === 'kid') return me;
  // Parent: default to first kid if any.
  const kid = users.find((u) => u.role === 'kid');
  return (kid && kid.id) || me || users[0]?.id;
}

function saveTaskFromForm() {
  const data = {
    title: document.getElementById('task-title').value.trim(),
    description: document.getElementById('task-description').value.trim(),
    tags: [...editingTags],
    assignedTo: document.getElementById('task-assignee').value,
    dueDate: document.getElementById('task-due').value || null,
    estimatedMinutes: parseIntOrNull(document.getElementById('task-estimated').value),
    priority: document.getElementById('task-priority').value,
    recurrence: document.getElementById('task-recurrence').value || null,
    points: document.getElementById('task-points').value === '' ? null : Number(document.getElementById('task-points').value),
    actualMinutes: parseIntOrNull(document.getElementById('task-actual').value) ?? 0,
  };
  if (!data.title) {
    showToast('Titel fehlt.', 'error');
    return;
  }
  if (ui.editingTaskId) {
    const existing = store.getTask(ui.editingTaskId);
    const wasDone = existing?.status === 'done';
    const updated = store.updateTask(ui.editingTaskId, data);
    if (updated && wasDone) {
      // Re-award if task properties affecting points changed.
      awardPoints(updated);
    }
  } else {
    data.createdBy = config.get('currentUserId');
    store.addTask(data);
  }
  closeModal(document.getElementById('task-modal'));
}

function renderSubtasksInModal(t) {
  const list = document.getElementById('task-subtasks-list');
  const subs = t.subtasks || [];
  list.innerHTML = subs.map((s) => `
    <li class="subtask-item ${s.done ? 'done' : ''}" data-subtask-id="${escapeHtml(s.id || '')}">
      <input type="checkbox" ${s.done ? 'checked' : ''} data-action="toggle-subtask" />
      <span class="subtask-text">${escapeHtml(s.text)}</span>
      <button type="button" class="subtask-delete" data-action="delete-subtask" aria-label="Subtask löschen">✕</button>
    </li>
  `).join('');
  list.querySelectorAll('[data-action="toggle-subtask"]').forEach((cb) => {
    cb.addEventListener('change', (ev) => {
      const id = ev.currentTarget.closest('.subtask-item').dataset.subtaskId;
      if (ui.editingTaskId && id) {
        store.toggleSubtask(ui.editingTaskId, id);
        const fresh = store.getTask(ui.editingTaskId);
        if (fresh) renderSubtasksInModal(fresh);
      }
    });
  });
  list.querySelectorAll('[data-action="delete-subtask"]').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      const id = ev.currentTarget.closest('.subtask-item').dataset.subtaskId;
      if (ui.editingTaskId && id) {
        store.deleteSubtask(ui.editingTaskId, id);
        const fresh = store.getTask(ui.editingTaskId);
        if (fresh) renderSubtasksInModal(fresh);
      }
    });
  });
}

function renderTagsInModal() {
  const display = document.getElementById('task-tags-display');
  if (!display) return;
  display.innerHTML = editingTags.map((tag) => `
    <span class="tag-chip">
      ${escapeHtml(tag)}
      <button type="button" class="tag-chip-remove" data-tag="${escapeHtml(tag)}" aria-label="Tag entfernen">×</button>
    </span>
  `).join('');
  display.querySelectorAll('.tag-chip-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      editingTags = editingTags.filter((t) => t !== btn.dataset.tag);
      renderTagsInModal();
    });
  });
  // Refresh datalist (exclude already-added tags)
  const dl = document.getElementById('tags-datalist');
  if (dl) dl.innerHTML = store.getTags().filter((t) => !editingTags.includes(t)).map((t) => `<option value="${escapeHtml(t)}"></option>`).join('');
}

function addTagFromInput() {
  const input = document.getElementById('task-tag-input');
  const tag = (input?.value || '').trim();
  if (!tag) return;
  if (!editingTags.includes(tag)) {
    editingTags.push(tag);
    renderTagsInModal();
  }
  if (input) input.value = '';
}

function addSubtaskFromInput() {
  const input = document.getElementById('task-subtask-input');
  const text = input.value.trim();
  if (!text) return;
  if (ui.editingTaskId) {
    store.addSubtask(ui.editingTaskId, text);
    const fresh = store.getTask(ui.editingTaskId);
    if (fresh) renderSubtasksInModal(fresh);
  } else {
    // For new tasks: keep subtasks in a "buffer" on the list element.
    const list = document.getElementById('task-subtasks-list');
    const id = 's_new_' + Math.random().toString(36).slice(2, 10);
    const li = document.createElement('li');
    li.className = 'subtask-item';
    li.dataset.subtaskId = id;
    li.dataset.isNew = '1';
    li.innerHTML = `
      <input type="checkbox" />
      <span class="subtask-text">${escapeHtml(text)}</span>
      <button type="button" class="subtask-delete" aria-label="Subtask löschen">✕</button>
    `;
    li.querySelector('.subtask-delete').addEventListener('click', () => li.remove());
    list.appendChild(li);
  }
  input.value = '';
  input.focus();
}

function renderCommentsInModal(t) {
  const list = document.getElementById('task-comments-list');
  const users = store.getUsers();
  const comments = t.comments || [];
  list.innerHTML = comments.map((c) => {
    const u = users.find((x) => x.id === c.by);
    return `
      <div class="comment">
        <div class="comment-header">
          ${renderUserBadge(u, 'sm')}
          <span>${escapeHtml(u?.name || 'Unbekannt')}</span>
          <span>·</span>
          <span>${escapeHtml(formatDateTime(c.at))}</span>
        </div>
        <div class="comment-text">${escapeHtml(c.text)}</div>
      </div>
    `;
  }).join('');
}

function addCommentFromInput() {
  if (!ui.editingTaskId) {
    showToast('Speichere die Aufgabe zuerst, um Kommentare zu hinterlassen.', 'error');
    return;
  }
  const input = document.getElementById('task-comment-input');
  const text = input.value.trim();
  if (!text) return;
  store.addComment(ui.editingTaskId, config.get('currentUserId'), text);
  input.value = '';
  const fresh = store.getTask(ui.editingTaskId);
  if (fresh) renderCommentsInModal(fresh);
}

function parseIntOrNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function closeModal(modal) {
  if (!modal) return;
  if (modal.id === 'task-modal') {
    // Persist any buffered new-subtasks into the created task (if just created).
    const list = document.getElementById('task-subtasks-list');
    const news = list.querySelectorAll('[data-is-new="1"]');
    if (news.length && ui.editingTaskId == null) {
      // This branch shouldn't normally hit because save happens before close.
    }
    closeTimer();
  }
  ui.editingTaskId = null;
  modal.close?.();
}

// Patch addTask to accept subtask buffer from modal (from new-task flow).
const origAddTask = store.addTask.bind(store);
store.addTask = function patchedAddTask(data) {
  const list = document.getElementById('task-subtasks-list');
  const buffered = list ? [...list.querySelectorAll('[data-is-new="1"]')].map((li) => ({
    text: li.querySelector('.subtask-text').textContent,
    done: li.querySelector('input[type="checkbox"]').checked,
  })) : [];
  const merged = { ...data, subtasks: (data.subtasks || []).concat(buffered.map((b) => ({
    id: 's_' + Math.random().toString(36).slice(2, 10),
    text: b.text, done: b.done,
    updatedAt: new Date().toISOString(),
  }))) };
  const t = origAddTask(merged);
  return t;
};

// ---- User modal ----
function wireUserModal() {
  const modal = document.getElementById('user-modal');
  const form = document.getElementById('user-form');
  modal.addEventListener('click', (ev) => { if (ev.target === modal) closeModal(modal); });
  modal.querySelectorAll('[data-close-modal]').forEach((b) => b.addEventListener('click', () => closeModal(modal)));
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const data = {
      name: document.getElementById('user-form-name').value.trim(),
      role: document.getElementById('user-form-role').value,
      color: document.getElementById('user-form-color').value,
      emoji: document.getElementById('user-form-emoji').value.trim() || '🧑',
    };
    if (!data.name) { showToast('Name fehlt.', 'error'); return; }
    if (ui.editingUserId) store.updateUser(ui.editingUserId, data);
    else store.addUser(data);
    renderUserSelect();
    ui.editingUserId = null;
    closeModal(modal);
  });
  document.getElementById('user-delete-btn').addEventListener('click', () => {
    if (!ui.editingUserId) return;
    if (!confirm('Profil löschen? Zugeordnete Aufgaben bleiben unverändert, müssen ggf. neu zugewiesen werden.')) return;
    store.deleteUser(ui.editingUserId);
    if (config.get('currentUserId') === ui.editingUserId) config.set('currentUserId', null);
    renderUserSelect();
    ui.editingUserId = null;
    closeModal(modal);
  });
}

function openUserModal(userId) {
  ui.editingUserId = userId;
  const modal = document.getElementById('user-modal');
  const title = document.getElementById('user-modal-title');
  const deleteBtn = document.getElementById('user-delete-btn');
  const presetColor = userId ? (store.getUser(userId)?.color || '#4f46e5') : randomColor();
  if (userId) {
    const u = store.getUser(userId);
    if (!u) return;
    title.textContent = 'Profil bearbeiten';
    document.getElementById('user-form-name').value = u.name;
    document.getElementById('user-form-role').value = u.role;
    document.getElementById('user-form-color').value = u.color;
    document.getElementById('user-form-emoji').value = u.emoji;
    deleteBtn.classList.remove('hidden');
  } else {
    title.textContent = 'Neues Profil';
    document.getElementById('user-form-name').value = '';
    document.getElementById('user-form-role').value = 'kid';
    document.getElementById('user-form-color').value = presetColor;
    document.getElementById('user-form-emoji').value = '';
    deleteBtn.classList.add('hidden');
  }
  modal.showModal();
  setTimeout(() => document.getElementById('user-form-name').focus(), 50);
}

function randomColor() {
  const palette = ['#4f46e5', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#3498db', '#d63384'];
  return palette[Math.floor(Math.random() * palette.length)];
}

// ---- Settings modal ----
function wireSettingsModal() {
  const modal = document.getElementById('settings-modal');
  const form = document.getElementById('settings-form');
  modal.addEventListener('click', (ev) => { if (ev.target === modal) closeModal(modal); });
  modal.querySelectorAll('[data-close-modal]').forEach((b) => b.addEventListener('click', () => closeModal(modal)));
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const newPat = document.getElementById('settings-pat').value;
    config.setMany({
      owner: document.getElementById('settings-owner').value.trim(),
      repo: document.getElementById('settings-repo').value.trim(),
      path: document.getElementById('settings-path').value.trim(),
      theme: document.getElementById('settings-theme').value,
      ...(newPat ? { pat: newPat } : {}),
    });
    theme.set(document.getElementById('settings-theme').value);
    showToast('Einstellungen gespeichert.', 'success');
    closeModal(modal);
    sync.restart();
  });
  document.getElementById('settings-logout').addEventListener('click', () => {
    if (!confirm('PAT entfernen und neu verbinden?')) return;
    config.set('pat', '');
    closeModal(modal);
    showScreen('setup');
  });
  document.getElementById('settings-add-user-btn').addEventListener('click', () => {
    closeModal(modal);
    openUserModal(null);
  });
  modal.addEventListener('click', (ev) => {
    const editBtn = ev.target.closest('[data-settings-edit-user]');
    if (editBtn) { closeModal(modal); openUserModal(editBtn.dataset.settingsEditUser); }
    const delBtn = ev.target.closest('[data-settings-delete-user]');
    if (delBtn) {
      const u = store.getUser(delBtn.dataset.settingsDeleteUser);
      if (!u) return;
      if (!confirm(`Profil „${u.name}" wirklich löschen?`)) return;
      if (config.get('currentUserId') === u.id) config.set('currentUserId', null);
      store.deleteUser(u.id);
      renderSettingsUserList();
      renderSidebar();
    }
  });
}

function openSettingsModal() {
  const modal = document.getElementById('settings-modal');
  document.getElementById('settings-owner').value = config.get('owner') || '';
  document.getElementById('settings-repo').value = config.get('repo') || '';
  document.getElementById('settings-path').value = config.get('path') || '';
  document.getElementById('settings-pat').value = '';
  document.getElementById('settings-theme').value = config.get('theme') || 'auto';
  document.getElementById('settings-version').textContent = window.__APP_VERSION__ || 'unbekannt';
  renderSettingsUserList();
  modal.showModal();
}

function renderSettingsUserList() {
  const container = document.getElementById('settings-user-list');
  if (!container) return;
  const users = store.getUsers();
  const me = config.get('currentUserId');
  if (!users.length) {
    container.innerHTML = '<p class="small muted">Noch keine Profile.</p>';
    return;
  }
  container.innerHTML = users.map((u) => `
    <div class="settings-user-item">
      <span class="user-badge" style="background:${escapeHtml(u.color)}">${escapeHtml(u.emoji || u.name[0] || '?')}</span>
      <div class="user-info">
        <div class="user-info-name">${escapeHtml(u.name)}${u.id === me ? ' <span style="color:var(--primary);font-size:0.75rem">(Du)</span>' : ''}</div>
        <div class="user-info-role">${u.role === 'parent' ? 'Elternteil' : 'Kind'}</div>
      </div>
      <div class="user-actions">
        <button type="button" class="btn btn-secondary btn-sm" data-settings-edit-user="${escapeHtml(u.id)}">✏ Bearbeiten</button>
        <button type="button" class="btn btn-danger btn-sm" data-settings-delete-user="${escapeHtml(u.id)}">✕</button>
      </div>
    </div>
  `).join('');
}

// ---- Calendar day click ----
function onCalendarDayClick(iso) {
  openTaskModal(null, { dueDate: iso });
}

// ---- Render ----
function renderAll() {
  // User pill
  const me = store.getUser(config.get('currentUserId'));
  if (me) {
    const badge = document.getElementById('user-badge');
    badge.style.background = me.color;
    badge.textContent = me.emoji || me.name[0] || '?';
    document.getElementById('user-name').textContent = me.name;
  }
  renderSidebar();
  renderMain();
}

function renderSidebar() {
  // Preset filter counts
  const tasks = store.getTasks();
  const me = config.get('currentUserId');
  const today = todayStr();
  const counts = {
    all: tasks.length,
    mine: tasks.filter((t) => t.assignedTo === me).length,
    today: tasks.filter((t) => t.dueDate === today).length,
    overdue: tasks.filter((t) => t.dueDate && t.dueDate < today && t.status === 'open').length,
    open: tasks.filter((t) => t.status === 'open').length,
    done: tasks.filter((t) => t.status === 'done').length,
  };
  document.querySelectorAll('.nav-item[data-filter-type="preset"]').forEach((btn) => {
    const key = btn.dataset.filter;
    let cnt = btn.querySelector('.count');
    if (!cnt) {
      cnt = document.createElement('span');
      cnt.className = 'count';
      btn.appendChild(cnt);
    }
    cnt.textContent = counts[key] ?? '';
    btn.classList.toggle('active', ui.currentFilter.type === 'preset' && ui.currentFilter.value === key);
  });

  // Users
  const users = store.getUsers();
  const userNav = document.getElementById('sidebar-users');
  userNav.innerHTML = users.map((u) => {
    const cnt = tasks.filter((t) => t.assignedTo === u.id && t.status === 'open').length;
    const active = ui.currentFilter.type === 'user' && ui.currentFilter.value === u.id;
    return `<button class="nav-item ${active ? 'active' : ''}" data-filter-type="user" data-filter="${escapeHtml(u.id)}">
      <span class="user-badge" style="background:${escapeHtml(u.color)};width:22px;height:22px;font-size:0.75rem">${escapeHtml(u.emoji || u.name[0] || '?')}</span>
      <span>${escapeHtml(u.name)}</span>
      <span class="count">${cnt}</span>
    </button>`;
  }).join('');

  // Tags
  const tags = store.getTags();
  const tagNav = document.getElementById('sidebar-tags');
  tagNav.innerHTML = tags.length ? tags.map((tag) => {
    const cnt = tasks.filter((t) => (t.tags || []).includes(tag) && t.status === 'open').length;
    const active = ui.currentFilter.type === 'tag' && ui.currentFilter.value === tag;
    return `<button class="nav-item ${active ? 'active' : ''}" data-filter-type="tag" data-filter="${escapeHtml(tag)}">
      <span>${escapeHtml(tag)}</span><span class="count">${cnt}</span>
    </button>`;
  }).join('') : '<p class="small muted" style="padding:0.2rem 0.4rem">Noch keine.</p>';

  // Points standing
  const sinceWeek = weekStartIso();
  const ptsEl = document.getElementById('sidebar-points');
  const kids = users.filter((u) => u.role === 'kid');
  if (!kids.length) {
    ptsEl.innerHTML = '<p class="small muted" style="padding:0.2rem 0.4rem">Keine Kinder angelegt.</p>';
  } else {
    ptsEl.innerHTML = kids.map((u) => {
      const total = totalPointsFor(u.id);
      const week = totalPointsFor(u.id, sinceWeek);
      return `<div class="points-row">
        <span class="user-badge" style="background:${escapeHtml(u.color)}">${escapeHtml(u.emoji || u.name[0] || '?')}</span>
        <span>${escapeHtml(u.name)}</span>
        <span class="points-value" title="Diese Woche: ${week}">${total}</span>
      </div>`;
    }).join('');
  }

  // Last sync
  const lastSyncEl = document.getElementById('last-sync');
  const last = config.get('lastSyncAt');
  lastSyncEl.textContent = last ? `Zuletzt: ${formatDateTime(last)}` : 'Noch nicht synchronisiert';
}

function renderMain() {
  const tasks = store.getTasks();
  const users = store.getUsers();
  const filtered = filterTasks(tasks, {
    filterType: ui.currentFilter.type,
    filterValue: ui.currentFilter.value,
    currentUserId: config.get('currentUserId'),
    search: ui.search,
  });
  const sorted = sortTasks(filtered, ui.sort);

  const openList = document.getElementById('task-list-open');
  const doneList = document.getElementById('task-list-done');
  const openTasks = sorted.filter((t) => t.status === 'open');
  const doneTasks = sorted.filter((t) => t.status === 'done').slice(0, 50);

  openList.innerHTML = openTasks.map((t) => renderTaskCard(t, users)).join('');
  doneList.innerHTML = doneTasks.map((t) => renderTaskCard(t, users)).join('');

  document.getElementById('count-open').textContent = openTasks.length;
  document.getElementById('count-done').textContent = doneTasks.length;

  const stats = document.getElementById('task-stats');
  const totalOpen = tasks.filter((t) => t.status === 'open').length;
  const totalDone = tasks.filter((t) => t.status === 'done').length;
  stats.textContent = `${filtered.length} gefiltert · ${totalOpen} offen · ${totalDone} erledigt`;

  const inCalendarView = (config.get('view') || 'list') === 'calendar';
  document.getElementById('empty-state').classList.toggle('hidden', filtered.length > 0 || inCalendarView);

  wireTaskCardEvents();
  initDnd({
    onReorder: (taskId, orderMap, status) => {
      for (const [id, order] of Object.entries(orderMap)) store.setSortOrder(id, order);
      if (status) store.setStatus(taskId, status);
    },
    onStatusChange: (taskId, status) => {
      const wasDone = store.getTask(taskId)?.status === 'done';
      store.setStatus(taskId, status);
      const fresh = store.getTask(taskId);
      if (fresh?.status === 'done' && !wasDone) awardPoints(fresh);
      else if (fresh?.status === 'open' && wasDone) revokePoints(taskId);
    },
  });

  // Calendar render if active.
  renderCalendar({
    tasks: store.getTasks(),
    users: store.getUsers(),
    currentUserId: config.get('currentUserId'),
  });
}

function wireTaskCardEvents() {
  document.querySelectorAll('.task').forEach((card) => {
    const id = card.dataset.taskId;
    const check = card.querySelector('.task-check');
    check?.addEventListener('click', (ev) => {
      ev.stopPropagation();
    });
    check?.addEventListener('change', (ev) => {
      ev.stopPropagation();
      const before = store.getTask(id);
      const wasDone = before?.status === 'done';
      store.toggleDone(id);
      const after = store.getTask(id);
      if (after?.status === 'done' && !wasDone) awardPoints(after);
      else if (after?.status === 'open' && wasDone) revokePoints(id);
    });
    card.addEventListener('click', (ev) => {
      if (ev.target.closest('.task-check')) return;
      openTaskModal(id);
    });
  });
}

// ---- Service worker registration ----
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    // Fetch version on start to both show updated label and trigger banner if newer.
    try {
      const res = await fetch('./version.json?t=' + Date.now(), { cache: 'no-store' });
      if (res.ok) {
        const { version } = await res.json();
        window.__APP_VERSION__ = version;
        const installed = config.get('installedVersion');
        if (!installed) {
          config.set('installedVersion', version);
        } else if (compareVersions(version, installed) > 0) {
          config.set('installedVersion', version);
          showUpdateBanner(version);
        }
      }
    } catch { /* offline: skip */ }

    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateBanner(window.__APP_VERSION__ || 'neu');
        }
      });
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // Next reload uses new SW.
    });
  } catch (err) {
    console.warn('SW registration failed', err);
  }
}

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

// Online/offline listeners
window.addEventListener('online', () => {
  toggleOfflineBanner(false);
  sync.onReconnect?.();
});
window.addEventListener('offline', () => toggleOfflineBanner(true));

// View toggle dispatched by calendar.js
document.addEventListener('request-rerender', () => renderMain());
