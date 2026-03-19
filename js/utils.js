/**
 * Shared utilities
 */

const logEl = document.getElementById('log');

export function log(message, level = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;
  const ts = new Date().toLocaleTimeString();
  entry.textContent = `[${ts}] ${message}`;
  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](message);
}

export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(i > 1 ? 2 : 0) + ' ' + sizes[i];
}

export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function show(el) {
  el.hidden = false;
}

export function hide(el) {
  el.hidden = true;
}

export function setProgress(barEl, pct) {
  barEl.style.width = `${Math.min(100, Math.max(0, pct))}%`;
}
