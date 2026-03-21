/**
 * Shared utilities
 */

const logEl = document.getElementById('log');

const MAX_LOG_ENTRIES = 500;

export function log(message, level = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;
  const ts = new Date().toLocaleTimeString();
  entry.textContent = `[${ts}] ${message}`;
  logEl.appendChild(entry);
  while (logEl.children.length > MAX_LOG_ENTRIES) {
    logEl.removeChild(logEl.firstChild);
  }
  logEl.scrollTop = logEl.scrollHeight;
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](message);
}

export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return (bytes / Math.pow(k, i)).toFixed(i > 1 ? 2 : 0) + ' ' + sizes[i];
}

export function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
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
