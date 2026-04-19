// Points calculation and aggregation for the reward system.

import { store } from './store.js';

const DEFAULT_BY_PRIORITY = { low: 5, medium: 10, high: 20 };
const ON_TIME_BONUS = 5;

export function pointsFor(task) {
  const override = task && task.points;
  if (override != null && override !== '' && !Number.isNaN(Number(override))) {
    return Math.max(0, Number(override));
  }
  const base = DEFAULT_BY_PRIORITY[task.priority] ?? 10;
  const onTime = task.estimatedMinutes != null && task.actualMinutes != null &&
                 task.estimatedMinutes > 0 &&
                 task.actualMinutes > 0 &&
                 task.actualMinutes <= task.estimatedMinutes;
  return base + (onTime ? ON_TIME_BONUS : 0);
}

export function awardPoints(task) {
  if (!task || !task.assignedTo) return;
  store.removePointsLogForTask(task.id);
  const points = pointsFor(task);
  store.addPointsLog({
    userId: task.assignedTo,
    taskId: task.id,
    points,
    awardedAt: task.completedAt || new Date().toISOString(),
  });
}

export function revokePoints(taskId) {
  store.removePointsLogForTask(taskId);
}

export function totalPointsFor(userId, sinceIso = null) {
  const log = store.getPointsLog();
  let sum = 0;
  for (const p of log) {
    if (p.userId !== userId) continue;
    if (sinceIso && p.awardedAt < sinceIso) continue;
    sum += Number(p.points) || 0;
  }
  return sum;
}

export function weekStartIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return d.toISOString();
}

export const POINT_RULES = { DEFAULT_BY_PRIORITY, ON_TIME_BONUS };
