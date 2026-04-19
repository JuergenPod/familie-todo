// Pure rendering helpers. No side effects besides writing to DOM nodes passed in.

import { pointsFor } from './points.js';

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function filterTasks(tasks, { filterType, filterValue, currentUserId, search }) {
  const today = todayStr();
  const needle = (search || '').trim().toLowerCase();
  return tasks.filter((t) => {
    if (t.deletedAt) return false;
    if (needle) {
      const hay = (t.title + ' ' + (t.description || '') + ' ' + (t.category || '')).toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (filterType === 'preset') {
      switch (filterValue) {
        case 'all': return true;
        case 'mine': return t.assignedTo === currentUserId;
        case 'today': return t.dueDate === today;
        case 'overdue': return t.dueDate && t.dueDate < today && t.status === 'open';
        case 'open': return t.status === 'open';
        case 'done': return t.status === 'done';
        default: return true;
      }
    }
    if (filterType === 'user') return t.assignedTo === filterValue;
    if (filterType === 'category') return t.category === filterValue;
    return true;
  });
}

export function sortTasks(tasks, sortKey) {
  const priorityRank = { high: 0, medium: 1, low: 2 };
  const arr = [...tasks];
  switch (sortKey) {
    case 'due':
      arr.sort((a, b) => cmp(a.dueDate || '9999', b.dueDate || '9999') || cmp(a.sortOrder, b.sortOrder));
      break;
    case 'priority':
      arr.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || cmp(a.dueDate || '9999', b.dueDate || '9999'));
      break;
    case 'created':
      arr.sort((a, b) => cmp(b.createdAt, a.createdAt));
      break;
    case 'assignee':
      arr.sort((a, b) => cmp(a.assignedTo || '', b.assignedTo || '') || cmp(a.sortOrder, b.sortOrder));
      break;
    case 'sortOrder':
    default:
      arr.sort((a, b) => cmp(a.sortOrder, b.sortOrder) || cmp(a.createdAt, b.createdAt));
  }
  return arr;
}

function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

export function todayStr() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function formatDueDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  const today = todayStr();
  if (iso === today) return 'heute';
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  if (iso === tomorrow.toISOString().slice(0, 10)) return 'morgen';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: iso.slice(0, 4) === String(new Date().getFullYear()) ? undefined : '2-digit' });
}

export function formatMinutes(mins) {
  if (!Number.isFinite(mins) || mins <= 0) return '0m';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function renderTaskCard(task, users) {
  const assignee = users.find((u) => u.id === task.assignedTo);
  const today = todayStr();
  const isOverdue = task.dueDate && task.dueDate < today && task.status === 'open';
  const isToday = task.dueDate === today;

  const subDone = task.subtasks.filter((s) => s.done).length;
  const subTotal = task.subtasks.length;

  const chips = [];
  if (task.dueDate) {
    const cls = isOverdue ? 'chip-due-overdue' : isToday ? 'chip-due-today' : '';
    chips.push(`<span class="task-chip ${cls}">📅 ${escapeHtml(formatDueDate(task.dueDate))}</span>`);
  }
  if (task.category) chips.push(`<span class="task-chip">${escapeHtml(task.category)}</span>`);
  if (task.estimatedMinutes) chips.push(`<span class="task-chip" title="Geplante Zeit">⏱ ${escapeHtml(formatMinutes(task.estimatedMinutes))}</span>`);
  if (task.actualMinutes) chips.push(`<span class="task-chip" title="Tatsächliche Zeit">✓ ${escapeHtml(formatMinutes(task.actualMinutes))}</span>`);
  if (subTotal) chips.push(`<span class="task-chip" title="Subtasks">☑ ${subDone}/${subTotal}</span>`);
  if (task.comments?.length) chips.push(`<span class="task-chip" title="Kommentare">💬 ${task.comments.length}</span>`);
  if (task.recurrence) chips.push(`<span class="task-chip" title="Wiederholung">🔁</span>`);
  chips.push(`<span class="task-chip chip-points" title="Punkte bei Erledigung">⭐ ${pointsFor(task)}</span>`);

  const assigneeBadge = assignee
    ? `<span class="user-badge" style="background:${escapeHtml(assignee.color)}" title="${escapeHtml(assignee.name)}">${escapeHtml(assignee.emoji || assignee.name[0])}</span>`
    : '';

  const progressBar = subTotal
    ? `<div class="task-progress"><div class="task-progress-bar" style="width:${(subDone / subTotal * 100).toFixed(0)}%"></div></div>`
    : '';

  const cls = [
    'task',
    `priority-${task.priority}`,
    task.status === 'done' ? 'done' : '',
    isOverdue ? 'overdue' : '',
  ].filter(Boolean).join(' ');

  return `
    <div class="${cls}" data-task-id="${escapeHtml(task.id)}" data-status="${task.status}">
      <div class="task-row">
        <input type="checkbox" class="task-check" data-action="toggle-done" ${task.status === 'done' ? 'checked' : ''} aria-label="Erledigt" />
        <div class="task-body">
          <div class="task-title">${escapeHtml(task.title)}</div>
          <div class="task-meta">
            ${assigneeBadge}
            ${chips.join('')}
          </div>
          ${progressBar}
        </div>
      </div>
    </div>
  `;
}

export function renderUserBadge(user, size) {
  if (!user) return '';
  const sz = size === 'sm' ? 'style="width:22px;height:22px;font-size:0.75rem"' : '';
  return `<span class="user-badge" ${sz} style="background:${escapeHtml(user.color)}">${escapeHtml(user.emoji || user.name[0] || '?')}</span>`;
}

export function showToast(message, kind) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ` toast-${kind}` : '');
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 300ms, transform 300ms';
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 320);
  }, 3000);
}
