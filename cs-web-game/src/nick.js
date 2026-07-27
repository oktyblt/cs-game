/**
 * Public nickname rules (must match live Cloudflare bundle).
 * Platform admin may use the reserved "BrowserCS" name.
 */
const PLATFORM_NICK = 'BrowserCS';
const PLATFORM_ADMIN_USER_ID = 'd4722d7f-d60a-45ba-951f-167a03ee3e03';
const RESERVED_MSG =
  '"browsercs" içeren kullanıcı adları saklıdır. Lütfen başka bir isim seçin.';

function compactNick(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function nickContainsBrowserCS(name) {
  return compactNick(name).includes('browsercs');
}

function isPlatformAdminNick(name) {
  return String(name || '').trim() === PLATFORM_NICK;
}

/**
 * @param {string} name
 * @param {{ userId?: string|null }} [opts]
 * @returns {string|null} error message, or null if valid
 */
export function validatePublicNickname(name, opts = {}) {
  const n = String(name || '').trim();
  if (!n) return 'Kullanıcı adı zorunludur.';
  if (n.length < 3) return 'Kullanıcı adı en az 3 karakter olmalı.';
  if (n.length > 24) return 'Kullanıcı adı en fazla 24 karakter olabilir.';
  if (!/^[A-Za-z0-9_\-.]+(?: [A-Za-z0-9_\-.]+)*$/.test(n)) {
    return 'Kullanıcı adı yalnızca harf, rakam, boşluk, _ . - içerebilir.';
  }
  if (!nickContainsBrowserCS(n)) return null;
  if ((opts.userId || null) === PLATFORM_ADMIN_USER_ID && isPlatformAdminNick(n)) {
    return null;
  }
  return RESERVED_MSG;
}
