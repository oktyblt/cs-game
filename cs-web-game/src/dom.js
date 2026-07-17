export const $ = (id) => document.getElementById(id);
export function notify(msg, type = 'info') {
  const notifContainer = document.getElementById('notifications');
  if (!notifContainer) { console.log(`[notify:${type}]`, msg); return; }
  const el = document.createElement('div');
  el.className = `notif ${type === 'error' ? 'error' : type === 'success' ? 'success' : ''}`;
  el.textContent = msg;
  notifContainer.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}
