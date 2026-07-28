/**
 * BrowserCS visitor & player analytics
 * File-backed store — no DB migration required.
 * Tracks: page visits, registered logins, guest sessions, play sessions.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'analytics.json');
const MAX_EVENTS = 5000;
const MAX_SESSIONS = 2000;
const HEARTBEAT_TTL_MS = 3 * 60 * 1000; // 3 min without heartbeat = offline

const VALID_EVENTS = new Set([
  'visit',
  'login',
  'register',
  'guest_join',
  'play_start',
  'play_end',
  'heartbeat'
]);

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    const empty = { events: [], sessions: {}, version: 1 };
    fs.writeFileSync(STORE_FILE, JSON.stringify(empty));
    return empty;
  }
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch {
    const empty = { events: [], sessions: {}, version: 1 };
    fs.writeFileSync(STORE_FILE, JSON.stringify(empty));
    return empty;
  }
}

let store = ensureStore();
let dirty = false;
let writeTimer = null;

function scheduleSave() {
  dirty = true;
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    if (!dirty) return;
    dirty = false;
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(STORE_FILE, JSON.stringify(store));
    } catch (e) {
      console.error('[Analytics] save failed:', e.message);
    }
  }, 800);
}

function dayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10); // YYYY-MM-DD UTC
}

function sanitizeStr(v, max = 64) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max).replace(/[<>]/g, '');
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim().slice(0, 64);
  return (req.ip || req.socket?.remoteAddress || '').slice(0, 64);
}

/**
 * Record a tracking event from the client.
 * body: { type, visitorId, userId?, username?, nickname?, port?, map?, sessionId? }
 */
function trackEvent(req, body = {}) {
  const type = sanitizeStr(body.type, 32);
  if (!VALID_EVENTS.has(type)) {
    return { success: false, error: 'Geçersiz event tipi' };
  }

  let visitorId = sanitizeStr(body.visitorId, 64);
  if (!visitorId) visitorId = crypto.randomUUID();

  const now = Date.now();
  const ip = clientIp(req);
  const ua = sanitizeStr(req.headers['user-agent'] || '', 180);
  const userId = sanitizeStr(body.userId || '', 64) || null;
  const username = sanitizeStr(body.username || body.nickname || '', 32) || null;
  const nickname = sanitizeStr(body.nickname || body.username || '', 32) || null;
  const port = body.port != null ? parseInt(body.port, 10) || null : null;
  const map = sanitizeStr(body.map || '', 48) || null;
  let sessionId = sanitizeStr(body.sessionId || '', 64) || null;

  const isRegistered = !!userId;
  const playerKey = isRegistered ? `u:${userId}` : `g:${visitorId}`;

  // Upsert live session for play-related events
  if (type === 'play_start' || type === 'heartbeat') {
    if (!sessionId) sessionId = crypto.randomUUID();
    const existing = store.sessions[sessionId];
    store.sessions[sessionId] = {
      sessionId,
      visitorId,
      userId,
      username: username || nickname,
      nickname: nickname || username,
      isRegistered,
      playerKey,
      port: port ?? existing?.port ?? null,
      map: map ?? existing?.map ?? null,
      startedAt: existing?.startedAt || now,
      lastSeenAt: now,
      ip,
      status: 'playing'
    };
  } else if (type === 'play_end' && sessionId && store.sessions[sessionId]) {
    store.sessions[sessionId].lastSeenAt = now;
    store.sessions[sessionId].status = 'ended';
    store.sessions[sessionId].endedAt = now;
  } else if (type === 'login' || type === 'guest_join' || type === 'visit') {
    // Keep a lightweight presence entry keyed by player
    const presenceId = `presence:${playerKey}`;
    store.sessions[presenceId] = {
      sessionId: presenceId,
      visitorId,
      userId,
      username: username || nickname,
      nickname: nickname || username,
      isRegistered,
      playerKey,
      port: null,
      map: null,
      startedAt: store.sessions[presenceId]?.startedAt || now,
      lastSeenAt: now,
      ip,
      status: type === 'visit' ? 'browsing' : 'online',
      event: type
    };
  }

  // Don't flood events with heartbeats — only update session
  if (type !== 'heartbeat') {
    store.events.push({
      id: crypto.randomUUID(),
      type,
      ts: now,
      day: dayKey(now),
      visitorId,
      userId,
      username: username || nickname,
      nickname: nickname || username,
      isRegistered,
      playerKey,
      port,
      map,
      sessionId,
      ip,
      ua
    });
    if (store.events.length > MAX_EVENTS) {
      store.events = store.events.slice(-MAX_EVENTS);
    }
  }

  // Prune stale sessions
  pruneSessions();
  // Cap sessions map size
  const keys = Object.keys(store.sessions);
  if (keys.length > MAX_SESSIONS) {
    keys
      .sort((a, b) => (store.sessions[a].lastSeenAt || 0) - (store.sessions[b].lastSeenAt || 0))
      .slice(0, keys.length - MAX_SESSIONS)
      .forEach((k) => delete store.sessions[k]);
  }

  scheduleSave();
  return { success: true, visitorId, sessionId };
}

function pruneSessions() {
  const cutoff = Date.now() - HEARTBEAT_TTL_MS * 10; // keep ended for a while
  const onlineCutoff = Date.now() - HEARTBEAT_TTL_MS;
  for (const [id, s] of Object.entries(store.sessions)) {
    if (!s) {
      delete store.sessions[id];
      continue;
    }
    if (s.status === 'playing' && s.lastSeenAt < onlineCutoff) {
      s.status = 'stale';
    }
    if ((s.endedAt || s.lastSeenAt || 0) < cutoff && s.status !== 'playing') {
      delete store.sessions[id];
    }
  }
}

function isOnlineSession(s, now = Date.now()) {
  if (!s) return false;
  if (s.status === 'ended' || s.status === 'stale') return false;
  return (s.lastSeenAt || 0) >= now - HEARTBEAT_TTL_MS;
}

function uniqueCount(items, keyFn) {
  const set = new Set();
  for (const item of items) {
    const k = keyFn(item);
    if (k) set.add(k);
  }
  return set.size;
}

function buildDailySeries(days = 14) {
  const series = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    const d = dayKey(now - i * 86400000);
    const dayEvents = store.events.filter((e) => e.day === d);
    const visits = dayEvents.filter((e) => e.type === 'visit');
    const logins = dayEvents.filter((e) => e.type === 'login');
    const registers = dayEvents.filter((e) => e.type === 'register');
    const guests = dayEvents.filter((e) => e.type === 'guest_join');
    const plays = dayEvents.filter((e) => e.type === 'play_start');
    const registeredPlays = plays.filter((e) => e.isRegistered);
    const guestPlays = plays.filter((e) => !e.isRegistered);

    series.push({
      date: d,
      visits: visits.length,
      uniqueVisitors: uniqueCount(visits, (e) => e.visitorId),
      logins: logins.length,
      uniqueLogins: uniqueCount(logins, (e) => e.userId || e.visitorId),
      registers: registers.length,
      guestJoins: guests.length,
      uniqueGuests: uniqueCount(guests, (e) => e.visitorId),
      playSessions: plays.length,
      uniquePlayers: uniqueCount(plays, (e) => e.playerKey),
      registeredPlayers: uniqueCount(registeredPlays, (e) => e.userId),
      guestPlayers: uniqueCount(guestPlays, (e) => e.visitorId)
    });
  }
  return series;
}

function getAdminStats({ days = 14, recentLimit = 80 } = {}) {
  pruneSessions();
  const now = Date.now();
  const today = dayKey(now);
  const todayEvents = store.events.filter((e) => e.day === today);

  const onlineSessions = Object.values(store.sessions).filter((s) => isOnlineSession(s, now));
  const playingNow = onlineSessions.filter((s) => s.status === 'playing');
  const browsingNow = onlineSessions.filter((s) => s.status === 'browsing' || s.status === 'online');

  // Deduplicate presence by playerKey
  const onlinePlayersMap = new Map();
  for (const s of onlineSessions) {
    const prev = onlinePlayersMap.get(s.playerKey);
    if (!prev || (s.lastSeenAt || 0) > (prev.lastSeenAt || 0)) {
      onlinePlayersMap.set(s.playerKey, s);
    }
  }
  const onlinePlayers = [...onlinePlayersMap.values()].sort(
    (a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0)
  );

  const recentEvents = [...store.events]
    .filter((e) => e.type !== 'heartbeat')
    .slice(-recentLimit)
    .reverse()
    .map((e) => ({
      id: e.id,
      type: e.type,
      ts: e.ts,
      day: e.day,
      visitorId: e.visitorId,
      userId: e.userId,
      username: e.username,
      nickname: e.nickname,
      isRegistered: e.isRegistered,
      port: e.port,
      map: e.map,
      ip: e.ip ? e.ip.replace(/\d+$/, '***') : null // soft-mask last octet for display
    }));

  const todayPlays = todayEvents.filter((e) => e.type === 'play_start');
  const todayLogins = todayEvents.filter((e) => e.type === 'login');
  const todayGuests = todayEvents.filter((e) => e.type === 'guest_join');
  const todayVisits = todayEvents.filter((e) => e.type === 'visit');

  return {
    success: true,
    generatedAt: now,
    today: {
      date: today,
      visits: todayVisits.length,
      uniqueVisitors: uniqueCount(todayVisits, (e) => e.visitorId),
      logins: todayLogins.length,
      uniqueLogins: uniqueCount(todayLogins, (e) => e.userId || e.visitorId),
      registers: todayEvents.filter((e) => e.type === 'register').length,
      guestJoins: todayGuests.length,
      uniqueGuests: uniqueCount(todayGuests, (e) => e.visitorId),
      playSessions: todayPlays.length,
      uniquePlayers: uniqueCount(todayPlays, (e) => e.playerKey),
      registeredPlayers: uniqueCount(
        todayPlays.filter((e) => e.isRegistered),
        (e) => e.userId
      ),
      guestPlayers: uniqueCount(
        todayPlays.filter((e) => !e.isRegistered),
        (e) => e.visitorId
      )
    },
    live: {
      onlineCount: onlinePlayers.length,
      playingCount: playingNow.length,
      browsingCount: browsingNow.length,
      registeredOnline: onlinePlayers.filter((p) => p.isRegistered).length,
      guestOnline: onlinePlayers.filter((p) => !p.isRegistered).length,
      players: onlinePlayers.slice(0, 100).map((p) => ({
        playerKey: p.playerKey,
        username: p.username || p.nickname || (p.isRegistered ? 'Oyuncu' : 'Misafir'),
        isRegistered: !!p.isRegistered,
        status: p.status,
        port: p.port,
        map: p.map,
        lastSeenAt: p.lastSeenAt,
        startedAt: p.startedAt
      }))
    },
    daily: buildDailySeries(Math.min(Math.max(days, 1), 90)),
    recent: recentEvents,
    totals: {
      eventsStored: store.events.length,
      sessionsTracked: Object.keys(store.sessions).length
    }
  };
}

module.exports = {
  trackEvent,
  getAdminStats,
  VALID_EVENTS
};
