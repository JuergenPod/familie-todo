// Sync orchestration: pull, merge-by-ID with Last-Write-Wins, push, poll.

import { store } from './store.js';
import { config } from './config.js';
import { github } from './github.js';
import { showToast } from './ui.js';

let remoteSha = null;
let pollHandle = null;
let inFlight = null;
let handlers = {};

const POLL_INTERVAL_MS = 60_000;

export const sync = {
  attachHandlers(h) { handlers = { ...handlers, ...h }; },

  async firstSync() {
    try {
      const { json, sha } = await github.getFile();
      remoteSha = sha || null;
      const merged = mergeState(store.getState(), normalizeRemote(json));
      store.replaceState(merged);
      await this.push(true);
      config.set('lastSyncAt', new Date().toISOString());
    } catch (err) {
      if (err.code === 'NOT_FOUND') {
        remoteSha = null;
        await this.push(true);
        config.set('lastSyncAt', new Date().toISOString());
      } else {
        throw err;
      }
    }
  },

  start() {
    this.stop();
    this.pull().catch(() => {});
    pollHandle = setInterval(() => { this.pull().catch(() => {}); }, POLL_INTERVAL_MS);
  },

  stop() {
    if (pollHandle) clearInterval(pollHandle);
    pollHandle = null;
  },

  restart() {
    remoteSha = null;
    this.start();
  },

  async pull() {
    if (!config.isReady()) return;
    if (!navigator.onLine) return;
    try {
      const { json, sha } = await github.getFile();
      const merged = mergeState(store.getState(), normalizeRemote(json));
      remoteSha = sha || null;
      // Only replace if something actually changed to avoid unnecessary re-render.
      if (hasChanged(store.getState(), merged)) {
        store.replaceState(merged);
      }
      config.set('lastSyncAt', new Date().toISOString());
    } catch (err) {
      if (err.code === 'NOT_FOUND') {
        // Nothing remote yet; push our state.
        await this.push(true);
      } else {
        handleError(err);
      }
    }
  },

  async push(silent = false) {
    if (!config.isReady()) return;
    if (!navigator.onLine) return;
    if (inFlight) return inFlight;

    inFlight = (async () => {
      try {
        await pushLoop();
        config.set('lastSyncAt', new Date().toISOString());
      } catch (err) {
        if (!silent) handleError(err);
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  },

  async force() {
    await this.pull();
    await this.push(false);
  },

  onReconnect() {
    this.push().catch(() => {});
  },
};

async function pushLoop() {
  for (let attempt = 0; attempt < 4; attempt++) {
    const toPush = store.getState();
    try {
      const { sha } = await github.putFile(toPush, remoteSha);
      remoteSha = sha || remoteSha;
      return;
    } catch (err) {
      if (err.code !== 'CONFLICT') throw err;
      // Pull fresh remote, merge, then retry.
      const { json, sha } = await github.getFile();
      remoteSha = sha || null;
      const merged = mergeState(store.getState(), normalizeRemote(json));
      store.replaceState(merged);
    }
  }
  throw Object.assign(new Error('Zu viele Konflikte beim Synchronisieren.'), { code: 'CONFLICT' });
}

function handleError(err) {
  if (!err) return;
  if (err.code === 'AUTH') {
    showToast('Sync: PAT ungültig. Bitte in Einstellungen prüfen.', 'error');
  } else if (err.code === 'NETWORK') {
    // Silent: banner signals offline.
  } else if (err.code === 'CONFLICT') {
    showToast('Sync-Konflikt – erneut versuchen.', 'error');
  } else if (err.code === 'NOT_FOUND') {
    showToast('Sync: Pfad nicht gefunden.', 'error');
  } else {
    showToast(err.message || 'Sync-Fehler.', 'error');
  }
}

function normalizeRemote(json) {
  if (!json || typeof json !== 'object') return { users: [], tasks: [], pointsLog: [], version: 1, updatedAt: null };
  return {
    version: json.version || 1,
    updatedAt: json.updatedAt || null,
    users: Array.isArray(json.users) ? json.users : [],
    tasks: Array.isArray(json.tasks) ? json.tasks : [],
    pointsLog: Array.isArray(json.pointsLog) ? json.pointsLog : [],
  };
}

function mergeState(local, remote) {
  return {
    version: Math.max(local.version || 1, remote.version || 1),
    updatedAt: new Date().toISOString(),
    users: mergeEntities(local.users, remote.users, mergeUser),
    tasks: mergeEntities(local.tasks, remote.tasks, mergeTask),
    pointsLog: mergeAppendOnly(local.pointsLog, remote.pointsLog),
  };
}

function mergeEntities(localArr, remoteArr, mergeOne) {
  const byId = new Map();
  for (const e of localArr) if (e && e.id) byId.set(e.id, { local: e });
  for (const e of remoteArr) if (e && e.id) {
    const slot = byId.get(e.id) || {};
    slot.remote = e;
    byId.set(e.id, slot);
  }
  const result = [];
  for (const [, slot] of byId) {
    if (slot.local && !slot.remote) result.push(slot.local);
    else if (slot.remote && !slot.local) result.push(slot.remote);
    else result.push(mergeOne(slot.local, slot.remote));
  }
  return result;
}

function mergeUser(a, b) {
  const aT = Date.parse(a.updatedAt || a.createdAt || 0) || 0;
  const bT = Date.parse(b.updatedAt || b.createdAt || 0) || 0;
  return bT > aT ? b : a;
}

function mergeTask(a, b) {
  // If one is a tombstone (deleted) and newer, prefer it.
  const aT = Date.parse(a.updatedAt || a.createdAt || 0) || 0;
  const bT = Date.parse(b.updatedAt || b.createdAt || 0) || 0;
  const newer = bT > aT ? b : a;
  const older = newer === a ? b : a;

  // Subtask merge by id + updatedAt.
  const subtasks = mergeEntities(a.subtasks || [], b.subtasks || [], (x, y) => {
    const xT = Date.parse(x.updatedAt || 0) || 0;
    const yT = Date.parse(y.updatedAt || 0) || 0;
    return yT > xT ? y : x;
  });

  // Comments and pointsLog-like: append-only by id.
  const comments = mergeAppendOnly(a.comments || [], b.comments || []);

  return { ...older, ...newer, subtasks, comments };
}

function mergeAppendOnly(a, b) {
  const seen = new Map();
  for (const e of (a || [])) if (e && e.id) seen.set(e.id, e);
  for (const e of (b || [])) if (e && e.id && !seen.has(e.id)) seen.set(e.id, e);
  return [...seen.values()];
}

function hasChanged(a, b) {
  // Shallow check: array lengths + updatedAt.
  if ((a.tasks?.length || 0) !== (b.tasks?.length || 0)) return true;
  if ((a.users?.length || 0) !== (b.users?.length || 0)) return true;
  if ((a.pointsLog?.length || 0) !== (b.pointsLog?.length || 0)) return true;
  // Compare per-task updatedAt.
  const am = new Map((a.tasks || []).map((t) => [t.id, t.updatedAt]));
  for (const t of (b.tasks || [])) if (am.get(t.id) !== t.updatedAt) return true;
  return false;
}
