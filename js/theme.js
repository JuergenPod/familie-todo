// Manages light/dark/auto theme. Sets data-theme on <html>.

import { config } from './config.js';

const VALID = new Set(['auto', 'light', 'dark']);

function apply(theme) {
  const root = document.documentElement;
  if (theme === 'auto') {
    root.removeAttribute('data-theme');
    root.setAttribute('data-theme-setting', 'auto');
    updateThemeColor();
    return;
  }
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-theme-setting', theme);
  updateThemeColor();
}

function updateThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const isDark = effectiveTheme() === 'dark';
  meta.setAttribute('content', isDark ? '#1a1d27' : '#4f46e5');
}

function effectiveTheme() {
  const setting = config.get('theme') || 'auto';
  if (setting !== 'auto') return setting;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export const theme = {
  init() {
    apply(config.get('theme') || 'auto');
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', () => {
      if ((config.get('theme') || 'auto') === 'auto') apply('auto');
    });
  },
  set(value) {
    if (!VALID.has(value)) return;
    config.set('theme', value);
    apply(value);
  },
  get() {
    return config.get('theme') || 'auto';
  },
  cycle() {
    const order = ['auto', 'light', 'dark'];
    const current = this.get();
    const next = order[(order.indexOf(current) + 1) % order.length];
    this.set(next);
    return next;
  },
  effective: effectiveTheme,
};
