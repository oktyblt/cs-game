/**
 * Account-based VIP identity ticket for the game client.
 * Fetched with Supabase JWT; injected into Xash via setinfo _bcs_vip.
 * Only issued for active subscribers (Silver/Gold/Platinum).
 */
import { API_URL } from '../api.js';
import { getCurrentUser, getSessionToken } from '../auth.js';

const STORAGE_PREFIX = '_csVipTicket_';

export function getStoredVipTicket(port) {
  if (!port || !getCurrentUser()) return '';
  try {
    const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${port}`);
    if (!raw) return '';
    const parsed = JSON.parse(raw);
    if (!parsed?.ticket) return '';
    if (parsed.expiresAt && Date.now() > parsed.expiresAt - 15_000) {
      sessionStorage.removeItem(`${STORAGE_PREFIX}${port}`);
      return '';
    }
    return String(parsed.ticket).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
  } catch {
    return '';
  }
}

export function getStoredVipMeta(port) {
  if (!port || !getCurrentUser()) return null;
  try {
    const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${port}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Aynı tarayıcı oturumunda geçerli bir VIP bileti varken tekrar API/Supabase
 * sorgusu atma. Sunucu, bileti kendi vip_sessions snapshot'ından doğruladığı
 * için istemcideki profil verisine güvenilmez; sadece doğrulanmış kısa ömürlü
 * bilet yeniden kullanılır. Bilet yoksa ya da 15 sn içinde bitecekse yenilenir.
 */
export async function ensureVipTicketForPort(port) {
  const existing = getStoredVipTicket(port);
  if (existing) return getStoredVipMeta(port);
  return prefetchVipTicketForPort(port);
}

export function clearVipTicketCache(port) {
  try {
    if (port) {
      sessionStorage.removeItem(`${STORAGE_PREFIX}${port}`);
      return;
    }
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Issue / refresh a short-lived VIP ticket for this server port.
 * Non-VIP / guests silently skip.
 */
export async function prefetchVipTicketForPort(port) {
  if (!port || !getCurrentUser()) {
    clearVipTicketCache(port);
    return null;
  }
  const token = await getSessionToken();
  if (!token) {
    clearVipTicketCache(port);
    return null;
  }
  try {
    const res = await fetch(`${API_URL}/api/me/vip-ticket`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ port: Number(port) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success || !data.ticket) {
      clearVipTicketCache(port);
      return null;
    }
    const ticket = String(data.ticket).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
    const expiresAt =
      Number(data.expiresAt) || Date.now() + (Number(data.expiresIn) || 300) * 1000;
    const meta = {
      ticket,
      expiresAt,
      displayName: data.displayName || '',
      tier: data.tier || '',
      clanTag: data.clanTag || '',
    };
    sessionStorage.setItem(`${STORAGE_PREFIX}${port}`, JSON.stringify(meta));
    return meta;
  } catch (e) {
    console.warn('[vip-ticket]', e.message || e);
    clearVipTicketCache(port);
    return null;
  }
}

if (typeof window !== 'undefined') {
  window.prefetchVipTicketForPort = prefetchVipTicketForPort;
  window.ensureVipTicketForPort = ensureVipTicketForPort;
  window.getStoredVipTicket = getStoredVipTicket;
  window.clearVipTicketCache = clearVipTicketCache;
}
