// Month calendar view. Shows tasks per due-date. Click on day opens tasks or creates new.

import { config } from './config.js';
import { escapeHtml, todayStr } from './ui.js';

const MONTH_NAMES_DE = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const WEEKDAY_NAMES_DE = ['Mo','Di','Mi','Do','Fr','Sa','So'];

let cb = { onDayClick: null, onTaskClick: null };
let currentMonth = null;
let mounted = false;

export function initCalendar(callbacks) {
  cb = { ...cb, ...(callbacks || {}) };
  const stored = config.get('calendarMonth');
  currentMonth = stored ? parseMonth(stored) : firstOfThisMonth();
  ensureMounted();
  wireViewToggle();
}

export function renderCalendar(state) {
  if (!mounted) return;
  const host = document.getElementById('calendar-view');
  if (!host) return;
  const activeView = config.get('view') || 'list';
  host.classList.toggle('hidden', activeView !== 'calendar');
  document.querySelector('.board')?.classList.toggle('hidden', activeView === 'calendar');
  if (activeView !== 'calendar') return;

  const { tasks = [], users = [] } = state || {};
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const today = todayStr();

  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startWeekday = (first.getDay() + 6) % 7; // Monday=0
  const daysInMonth = last.getDate();

  // Build 6x7 grid (Mon..Sun).
  const grid = [];
  for (let i = 0; i < startWeekday; i++) grid.push(null);
  for (let d = 1; d <= daysInMonth; d++) grid.push(new Date(year, month, d));
  while (grid.length % 7 !== 0) grid.push(null);
  while (grid.length < 42) grid.push(null);

  const userById = new Map(users.map((u) => [u.id, u]));

  // Group tasks by dueDate.
  const byDate = new Map();
  for (const t of tasks) {
    if (!t.dueDate || t.deletedAt) continue;
    if (!byDate.has(t.dueDate)) byDate.set(t.dueDate, []);
    byDate.get(t.dueDate).push(t);
  }

  const header = `
    <div class="cal-header">
      <button type="button" class="btn-icon" data-cal-nav="-1" aria-label="Vorheriger Monat">‹</button>
      <h2 class="cal-title">${MONTH_NAMES_DE[month]} ${year}</h2>
      <button type="button" class="btn-icon" data-cal-nav="1" aria-label="Nächster Monat">›</button>
      <button type="button" class="btn btn-secondary btn-sm" data-cal-today>Heute</button>
    </div>
    <div class="cal-weekdays">
      ${WEEKDAY_NAMES_DE.map((w) => `<div class="cal-weekday">${w}</div>`).join('')}
    </div>
  `;

  const cells = grid.map((date) => {
    if (!date) return `<div class="cal-cell cal-cell-empty"></div>`;
    const iso = isoDate(date);
    const entries = byDate.get(iso) || [];
    const isToday = iso === today;
    const isOtherMonth = date.getMonth() !== month;
    const chips = entries.slice(0, 4).map((t) => {
      const u = userById.get(t.assignedTo);
      const color = u ? u.color : '#888';
      const border = t.priority === 'high' ? '#dc2626' : t.priority === 'low' ? 'transparent' : color;
      const doneCls = t.status === 'done' ? 'cal-chip-done' : '';
      return `<button type="button" class="cal-chip ${doneCls}" data-task-id="${escapeHtml(t.id)}"
        style="background:${escapeHtml(color)};border-left:3px solid ${escapeHtml(border)}"
        title="${escapeHtml(t.title)}${t.category ? ' · ' + escapeHtml(t.category) : ''}">
        ${escapeHtml(t.title)}
      </button>`;
    }).join('');
    const more = entries.length > 4 ? `<div class="cal-more">+${entries.length - 4} weitere</div>` : '';
    return `
      <div class="cal-cell ${isToday ? 'cal-today' : ''} ${isOtherMonth ? 'cal-other-month' : ''}" data-date="${iso}">
        <div class="cal-day-head">
          <span class="cal-day-num">${date.getDate()}</span>
          ${entries.length ? `<span class="cal-count">${entries.length}</span>` : ''}
        </div>
        <div class="cal-chips">${chips}${more}</div>
      </div>
    `;
  }).join('');

  host.innerHTML = header + `<div class="cal-grid">${cells}</div>`;

  // Wire events.
  host.querySelectorAll('[data-cal-nav]').forEach((b) => {
    b.addEventListener('click', () => {
      const delta = Number(b.dataset.calNav);
      currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + delta, 1);
      config.set('calendarMonth', isoDate(currentMonth));
      renderCalendar(state);
    });
  });
  host.querySelector('[data-cal-today]')?.addEventListener('click', () => {
    currentMonth = firstOfThisMonth();
    config.set('calendarMonth', isoDate(currentMonth));
    renderCalendar(state);
  });
  host.querySelectorAll('.cal-cell[data-date]').forEach((cell) => {
    cell.addEventListener('click', (ev) => {
      // If click was on a task chip, open that task instead.
      const chip = ev.target.closest('.cal-chip');
      if (chip) {
        cb.onTaskClick?.(chip.dataset.taskId);
        ev.stopPropagation();
        return;
      }
      cb.onDayClick?.(cell.dataset.date);
    });
  });
}

function ensureMounted() {
  if (document.getElementById('calendar-view')) { mounted = true; return; }
  const main = document.querySelector('.main');
  if (!main) return;
  const host = document.createElement('section');
  host.id = 'calendar-view';
  host.className = 'calendar-view hidden';
  // Insert before the empty-state placeholder.
  const emptyState = document.getElementById('empty-state');
  if (emptyState) main.insertBefore(host, emptyState);
  else main.appendChild(host);

  // Inject calendar-specific styles (keeps styles.css clean of view-specific concerns).
  injectCalendarStyles();
  mounted = true;
}

function wireViewToggle() {
  const toolbar = document.querySelector('.main-toolbar');
  if (!toolbar) return;
  if (document.getElementById('view-toggle')) return;

  const group = document.createElement('div');
  group.className = 'view-toggle';
  group.id = 'view-toggle';
  group.innerHTML = `
    <button type="button" class="view-toggle-btn" data-view="list" aria-pressed="false">Liste</button>
    <button type="button" class="view-toggle-btn" data-view="calendar" aria-pressed="false">Kalender</button>
  `;
  toolbar.appendChild(group);

  const active = config.get('view') || 'list';
  updateToggleActive(active);

  group.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.view-toggle-btn');
    if (!btn) return;
    const next = btn.dataset.view;
    config.set('view', next);
    updateToggleActive(next);
    // Trigger re-render via a synthetic event — main render cycle will handle it.
    document.dispatchEvent(new CustomEvent('request-rerender'));
  });
}

function updateToggleActive(active) {
  const group = document.getElementById('view-toggle');
  if (!group) return;
  group.querySelectorAll('.view-toggle-btn').forEach((b) => {
    const on = b.dataset.view === active;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  // Show/hide board vs calendar immediately if calendar already rendered.
  const cal = document.getElementById('calendar-view');
  const board = document.querySelector('.board');
  if (cal) cal.classList.toggle('hidden', active !== 'calendar');
  if (board) board.classList.toggle('hidden', active === 'calendar');
}

function isoDate(d) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function firstOfThisMonth() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseMonth(iso) {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return firstOfThisMonth();
  d.setDate(1);
  return d;
}

function injectCalendarStyles() {
  if (document.getElementById('calendar-style')) return;
  const style = document.createElement('style');
  style.id = 'calendar-style';
  style.textContent = `
.view-toggle {
  display: inline-flex; border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
  overflow: hidden; background: var(--bg-elev);
}
.view-toggle-btn {
  background: transparent; color: var(--text);
  border: none; padding: 0.4rem 0.85rem; cursor: pointer;
  font-size: 0.88rem; font: inherit;
}
.view-toggle-btn + .view-toggle-btn { border-left: 1px solid var(--border-strong); }
.view-toggle-btn.active { background: var(--primary); color: var(--primary-text); }

.calendar-view {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.8rem;
  display: flex; flex-direction: column; gap: 0.6rem;
}
.cal-header {
  display: flex; align-items: center; gap: 0.5rem;
}
.cal-title {
  font-size: 1.05rem; margin: 0; flex: 1;
}
.cal-weekdays {
  display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px;
  font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em;
  padding: 0 2px;
}
.cal-weekday { text-align: center; padding: 4px 0; }
.cal-grid {
  display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px;
}
.cal-cell {
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 4px;
  min-height: 86px;
  display: flex; flex-direction: column; gap: 4px;
  cursor: pointer;
  transition: border-color var(--transition);
}
.cal-cell:hover { border-color: var(--primary); }
.cal-cell-empty { visibility: hidden; border: none; background: transparent; cursor: default; }
.cal-cell.cal-today { border-color: var(--primary); box-shadow: 0 0 0 1px var(--primary) inset; }
.cal-cell.cal-other-month { opacity: 0.4; }
.cal-day-head {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 0.78rem; color: var(--text-muted);
}
.cal-day-num { font-weight: 600; color: var(--text); }
.cal-count {
  background: var(--primary); color: var(--primary-text);
  padding: 1px 6px; border-radius: 10px; font-size: 0.68rem; font-weight: 600;
}
.cal-chips { display: flex; flex-direction: column; gap: 2px; }
.cal-chip {
  font-size: 0.72rem; color: #fff;
  padding: 2px 6px; border-radius: 4px;
  border: none; cursor: pointer;
  text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font: inherit; font-size: 0.72rem;
  filter: brightness(1);
}
.cal-chip.cal-chip-done { opacity: 0.55; text-decoration: line-through; }
.cal-more { font-size: 0.7rem; color: var(--text-muted); padding-left: 2px; }

@media (max-width: 640px) {
  .cal-cell { min-height: 64px; padding: 2px; }
  .cal-day-num { font-size: 0.75rem; }
  .cal-chip { font-size: 0.65rem; padding: 1px 4px; }
  .cal-count { display: none; }
}
`;
  document.head.appendChild(style);
}
