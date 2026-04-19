// Per-device configuration (localStorage).
// The PAT lives only on this device.

const KEY = 'familieToDo.config.v1';

const DEFAULTS = {
  owner: 'JuergenPod',
  repo: 'VocabularyCheck-Saves',
  path: 'familie/todo.json',
  pat: '',
  currentUserId: null,
  theme: 'auto',
  installedVersion: null,
  dismissedVersion: null,
  lastSyncAt: null,
  view: 'list',
  calendarMonth: null,
};

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* ignore quota */
  }
}

export const config = {
  get(key) { return load()[key]; },
  getAll() { return { ...load() }; },
  set(key, value) {
    load();
    cache[key] = value;
    save();
  },
  setMany(patch) {
    load();
    cache = { ...cache, ...patch };
    save();
  },
  isReady() {
    const c = load();
    return Boolean(c.pat && c.owner && c.repo && c.path);
  },
  hasUser() {
    return Boolean(load().currentUserId);
  },
  reset() {
    cache = { ...DEFAULTS };
    save();
  },
};
