/**
 * Account-based rank identity ticket for the game client.
 * Fetched with Supabase JWT; injected into Xash via setinfo _bcs_rank.
 */
import { API_URL } from '../api.js';
import { getCurrentUser, getSessionToken } from '../auth.js';

const STORAGE_PREFIX = '_csRankTicket_';

export function getStoredRankTicket(port) {
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

export function clearRankTicketCache(port) {
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
 * Issue / refresh a short-lived rank ticket for this server port.
 * Guests silently skip (no rank).
 */
export async function prefetchRankTicketForPort(port) {
  if (!port || !getCurrentUser()) {
    clearRankTicketCache(port);
    return null;
  }
  const token = await getSessionToken();
  if (!token) {
    clearRankTicketCache(port);
    return null;
  }
  try {
    const res = await fetch(`${API_URL}/api/me/rank-ticket`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ port: Number(port) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success || !data.ticket) {
      clearRankTicketCache(port);
      return null;
    }
    const ticket = String(data.ticket).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
    const expiresAt =
      Number(data.expiresAt) || Date.now() + (Number(data.expiresIn) || 300) * 1000;
    sessionStorage.setItem(
      `${STORAGE_PREFIX}${port}`,
      JSON.stringify({ ticket, expiresAt, displayName: data.displayName || '' })
    );
    return { ticket, expiresAt, displayName: data.displayName || '' };
  } catch (e) {
    console.warn('[rank-ticket]', e.message || e);
    clearRankTicketCache(port);
    return null;
  }
}

if (typeof window !== 'undefined') {
  window.prefetchRankTicketForPort = prefetchRankTicketForPort;
  window.getStoredRankTicket = getStoredRankTicket;
  window.clearRankTicketCache = clearRankTicketCache;
}
