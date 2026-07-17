/**
 * AMXX admin _pw — sadece sessionStorage, üye oturumu gerekir.
 * Lazy serverSettings'e bağlı olmamalı (engine/reconnect join path'te kullanır).
 */
import { getCurrentUser } from '../auth.js';

export function getStoredAmxPassword(port) {
  if (!port) return '';
  if (!getCurrentUser()) return '';
  try {
    return sessionStorage.getItem(`_csAmxPw_${port}`) || '';
  } catch {
    return '';
  }
}

export function clearAmxPasswordCache() {
  try {
    const keys = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith('_csAmxPw_')) keys.push(k);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
  } catch (e) { /* ignore */ }
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('_csAmxPw_')) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch (e) { /* ignore */ }
}

window.clearAmxPasswordCache = clearAmxPasswordCache;
window.getStoredAmxPassword = getStoredAmxPassword;
