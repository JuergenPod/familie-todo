// Task timer: start/stop accumulates minutes into task.actualMinutes.

import { store } from './store.js';

let running = false;
let startedAt = 0;
let tickHandle = null;
let currentTaskId = null;

export function initTimer() {
  const btn = document.getElementById('task-timer-toggle');
  if (!btn) return;
  btn.addEventListener('click', toggle);
}

export function openTimerFor(taskId) {
  currentTaskId = taskId;
  stop(false);
  updateDisplay(0);
  setBtnLabel('Start');
}

export function closeTimer() {
  if (running) stop(true);
  currentTaskId = null;
}

function toggle() {
  if (!currentTaskId) return;
  if (running) stop(true);
  else start();
}

function start() {
  running = true;
  startedAt = Date.now();
  setBtnLabel('Stop');
  tick();
  tickHandle = setInterval(tick, 1000);
}

function stop(save) {
  if (!running) return;
  running = false;
  clearInterval(tickHandle);
  tickHandle = null;
  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
  const mins = Math.round(elapsedSec / 60);
  updateDisplay(0);
  setBtnLabel('Start');
  if (save && mins > 0 && currentTaskId) {
    store.addActualMinutes(currentTaskId, mins);
    const t = store.getTask(currentTaskId);
    if (t) {
      const input = document.getElementById('task-actual');
      if (input) input.value = t.actualMinutes;
    }
  }
}

function tick() {
  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
  updateDisplay(elapsedSec);
}

function updateDisplay(sec) {
  const el = document.getElementById('task-timer-display');
  if (!el) return;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  el.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function setBtnLabel(label) {
  const btn = document.getElementById('task-timer-toggle');
  if (btn) btn.textContent = label;
}
