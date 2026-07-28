/**
 * Client-side visitor / player analytics for BrowserCS.
 * Sends visit, login, register, guest_join, play_start/end, heartbeat events.
 */
const API_BASE = import.meta.env.VITE_API_URL || 'https://backend.browsercs.com';

const VISITOR_KEY = 'cs_visitor_id';
const SESSION_KEY = 'cs_play_session_id';

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'v-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function getVisitorId() {
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = uuid();
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return uuid();
  }
}

function getPlaySessionId() {
  try {
    return sessionStorage.getItem(SESSION_KEY) || null;
  } catch {
    return null;
  }
}

function setPlaySessionId(id) {
  try {
    if (id) sessionStorage.setItem(SESSION_KEY, id);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch { /* ignore */ }
}

let heartbeatTimer = null;
let lastPayload = null;

export async function track(type, extra = {}) {
  const payload = {
    type,
    visitorId: getVisitorId(),
    sessionId: extra.sessionId || getPlaySessionId() || undefined,
    userId: extra.userId || undefined,
    username: extra.username || undefined,
    nickname: extra.nickname || undefined,
    port: extra.port != null ? extra.port : undefined,
    map: extra.map || undefined
  };

  lastPayload = { ...payload, type: undefined };

  try {
    const res = await fetch(`${API_BASE}/api/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: type === 'play_end' || type === 'visit'
    });
    const data = await res.json().catch(() => ({}));
    if (data.visitorId) {
      try { localStorage.setItem(VISITOR_KEY, data.visitorId); } catch { /* ignore */ }
    }
    if (data.sessionId && (type === 'play_start' || type === 'heartbeat')) {
      setPlaySessionId(data.sessionId);
    }
    if (type === 'play_end') setPlaySessionId(null);
    return data;
  } catch (e) {
    console.warn('[analytics]', type, e.message);
    return { success: false };
  }
}

export function trackVisit() {
  // Once per browser tab session
  try {
    if (sessionStorage.getItem('cs_visit_sent')) return;
    sessionStorage.setItem('cs_visit_sent', '1');
  } catch { /* continue */ }
  return track('visit');
}

export function trackLogin(user) {
  if (!user) return;
  return track('login', {
    userId: user.id,
    username: user.username || user.user_metadata?.username || user.email?.split('@')[0]
  });
}

export function trackRegister(username) {
  return track('register', { username, nickname: username });
}

export function trackGuestJoin(nickname) {
  return track('guest_join', { nickname });
}

export function trackPlayStart({ userId, username, nickname, port, map } = {}) {
  setPlaySessionId(uuid());
  const p = track('play_start', {
    userId,
    username,
    nickname,
    port,
    map,
    sessionId: getPlaySessionId()
  });
  startHeartbeat({ userId, username, nickname, port, map });
  return p;
}

export function trackPlayEnd() {
  stopHeartbeat();
  const sessionId = getPlaySessionId();
  return track('play_end', {
    ...(lastPayload || {}),
    sessionId: sessionId || undefined
  });
}

function startHeartbeat(base = {}) {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    track('heartbeat', {
      userId: base.userId,
      username: base.username,
      nickname: base.nickname,
      port: base.port,
      map: base.map,
      sessionId: getPlaySessionId() || undefined
    });
  }, 45000);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// Best-effort flush on tab close while playing
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (!getPlaySessionId()) return;
    try {
      const body = JSON.stringify({
        ...(lastPayload || {}),
        type: 'play_end',
        visitorId: getVisitorId(),
        sessionId: getPlaySessionId()
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(`${API_BASE}/api/track`, new Blob([body], { type: 'application/json' }));
      }
    } catch { /* ignore */ }
    stopHeartbeat();
  });
}
