// ui/toast.js — Módulo de notificaciones toast

const ICONS = {
  success: '✅',
  error: '❌',
  info: 'ℹ️',
  warning: '⚠️',
};

const ANIMATION_OUT_MS = 200;

/**
 * Muestra una notificación toast.
 * @param {string} message  — Texto a mostrar.
 * @param {'success'|'error'|'info'|'warning'} type — Tipo de toast.
 * @param {number} duration — Milisegundos antes de iniciar la animación de salida.
 */
export function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icon = ICONS[type] ?? ICONS.info;

  const toast = document.createElement('div');
  toast.classList.add('toast', type);
  toast.innerHTML = `${icon} ${message}`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), ANIMATION_OUT_MS);
  }, duration);
}

/* ── Atajos ── */

export function showSuccess(msg) {
  showToast(msg, 'success');
}

export function showError(msg) {
  showToast(msg, 'error');
}

export function showInfo(msg) {
  showToast(msg, 'info');
}

export function showWarning(msg) {
  showToast(msg, 'warning');
}
