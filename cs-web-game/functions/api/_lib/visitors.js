/**
 * Shared visitor / player analytics for Cloudflare Pages Functions (KV-backed).
 */
const STORE_KEY = 'vis:store:v1';
const MAX_EVENTS = 4000;
const LIVE_TTL_MS = 5 * 60 * 1000;

function dayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

function hourKey(ts = Date.now()) {
  // TR UTC+3 display hour
  const d = new Date(ts + 3 * 3600 * 1000);
  return d.getUTCHours();
}

function classifyUA(ua = '') {
  const s = String(ua).toLowerCase();
  if (!s) return { type: 'real', device: 'desktop', browser: 'Bilinmiyor' };
  if (/(gptbot|claudebot|anthropic|openai|perplexity|bytespider|ai crawler|chatgpt)/i.test(s)) {
    return { type: 'ai', device: 'bot', browser: 'AI Bot' };
  }
  if (/(bot|spider|crawler|slurp|bingpreview|facebookexternalhit|whatsapp|telegram)/i.test(s)) {
    return { type: 'bot', device: 'bot', browser: 'Bot' };
  }
  let device = 'desktop';
  if (/ipad|tablet/i.test(s)) device = 'tablet';
  else if (/mobi|iphone|android/i.test(s)) device = 'mobile';
  let browser = 'Diğer';
  if (/edg\//i.test(s)) browser = 'Edge';
  else if (/chrome\//i.test(s) && !/edg\//i.test(s)) browser = 'Chrome';
  else if (/firefox\//i.test(s)) browser = 'Firefox';
  else if (/safari\//i.test(s) && !/chrome\//i.test(s)) browser = 'Safari';
  return { type: 'real', device, browser };
}

function emptyStore() {
  return { events: [], sessions: {}, version: 1 };
}

async function loadStore(env) {
  try {
    const raw = await env.SERVERS.get(STORE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.events)) return emptyStore();
    parsed.sessions = parsed.sessions || {};
    return parsed;
  } catch {
    return emptyStore();
  }
}

async function saveStore(env, store) {
  await env.SERVERS.put(STORE_KEY, JSON.stringify(store));
}

function clientMeta(request) {
  const ua = request.headers.get('user-agent') || '';
  const ip = request.headers.get('cf-connecting-ip')
    || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    || '';
  const country = request.cf?.country || request.headers.get('cf-ipcountry') || '';
  const city = request.cf?.city || '';
  const cls = classifyUA(ua);
  return { ua, ip, country, city, ...cls };
}

function sanitize(v, max = 64) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max).replace(/[<>]/g, '');
}

export async function trackFromRequest(request, env, body = {}) {
  const type = sanitize(body.type || 'visit', 32) || 'visit';
  const allowed = new Set(['visit', 'login', 'register', 'guest_join', 'play_start', 'play_end', 'heartbeat', 'pageview']);
  if (!allowed.has(type)) return { success: false, error: 'Geçersiz tip' };

  const meta = clientMeta(request);
  const now = Date.now();
  let visitorId = sanitize(body.visitorId || '', 64) || crypto.randomUUID();
  const userId = sanitize(body.userId || '', 64) || null;
  const username = sanitize(body.username || body.nickname || '', 32) || null;
  const nickname = sanitize(body.nickname || body.username || '', 32) || null;
  const path = sanitize(body.path || body.page || '/', 120) || '/';
  const referrer = sanitize(body.referrer || '', 180);
  const port = body.port != null ? parseInt(body.port, 10) || null : null;
  const map = sanitize(body.map || '', 48) || null;
  let sessionId = sanitize(body.sessionId || '', 64) || null;
  const isRegistered = !!userId;
  const playerKey = isRegistered ? `u:${userId}` : `g:${visitorId}`;
  const eventType = type === 'pageview' ? 'visit' : type;

  const store = await loadStore(env);

  if (eventType === 'play_start' || eventType === 'heartbeat') {
    if (!sessionId) sessionId = crypto.randomUUID();
    const prev = store.sessions[sessionId];
    store.sessions[sessionId] = {
      sessionId,
      visitorId,
      userId,
      username: username || nickname,
      nickname: nickname || username,
      isRegistered,
      playerKey,
      port: port ?? prev?.port ?? null,
      map: map ?? prev?.map ?? null,
      path,
      referrer,
      type: meta.type,
      device: meta.device,
      country: meta.country,
      city: meta.city,
      ip: meta.ip,
      ua: meta.ua.slice(0, 160),
      status: 'playing',
      startedAt: prev?.startedAt || now,
      lastSeenAt: now,
      name: username || nickname || (isRegistered ? 'Oyuncu' : 'Misafir')
    };
  } else if (eventType === 'play_end' && sessionId && store.sessions[sessionId]) {
    store.sessions[sessionId].lastSeenAt = now;
    store.sessions[sessionId].status = 'ended';
    store.sessions[sessionId].endedAt = now;
  } else {
    const presenceId = `presence:${playerKey || visitorId}`;
    store.sessions[presenceId] = {
      sessionId: presenceId,
      visitorId,
      userId,
      username: username || nickname,
      nickname: nickname || username,
      isRegistered,
      playerKey,
      path,
      referrer,
      type: meta.type,
      device: meta.device,
      country: meta.country,
      city: meta.city,
      ip: meta.ip,
      ua: meta.ua.slice(0, 160),
      status: eventType === 'visit' ? 'browsing' : 'online',
      startedAt: store.sessions[presenceId]?.startedAt || now,
      lastSeenAt: now,
      name: username || nickname || (meta.type === 'real' ? 'Ziyaretçi' : meta.type.toUpperCase())
    };
  }

  if (eventType !== 'heartbeat') {
    store.events.push({
      id: crypto.randomUUID(),
      type: eventType,
      ts: now,
      day: dayKey(now),
      hour: hourKey(now),
      visitorId,
      userId,
      username: username || nickname,
      nickname: nickname || username,
      isRegistered,
      playerKey,
      path,
      referrer,
      port,
      map,
      sessionId,
      ip: meta.ip,
      country: meta.country,
      city: meta.city,
      ua: meta.ua.slice(0, 160),
      visitorType: meta.type,
      device: meta.device,
      browser: meta.browser,
      name: username || nickname || null
    });
    if (store.events.length > MAX_EVENTS) store.events = store.events.slice(-MAX_EVENTS);
  }

  // prune stale sessions
  for (const [id, s] of Object.entries(store.sessions)) {
    if (!s || (s.lastSeenAt || 0) < now - LIVE_TTL_MS * 12) delete store.sessions[id];
  }

  await saveStore(env, store);
  return { success: true, visitorId, sessionId };
}

function countBy(list, keyFn) {
  const map = new Map();
  for (const item of list) {
    const k = keyFn(item);
    if (!k) continue;
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function unique(list, keyFn) {
  const s = new Set();
  for (const i of list) {
    const k = keyFn(i);
    if (k) s.add(k);
  }
  return s.size;
}

function typeBreakdown(events, idFn) {
  const real = new Set();
  const bot = new Set();
  const ai = new Set();
  for (const e of events) {
    const id = idFn(e);
    if (!id) continue;
    if (e.visitorType === 'ai') ai.add(id);
    else if (e.visitorType === 'bot') bot.add(id);
    else real.add(id);
  }
  return { real: real.size, bot: bot.size, ai: ai.size };
}

function maskIp(ip) {
  if (!ip) return null;
  const parts = String(ip).split('.');
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.***`;
  return String(ip).slice(0, 12) + '…';
}

export async function buildVisitorStats(env) {
  const store = await loadStore(env);
  const now = Date.now();
  const today = dayKey(now);

  const visitLike = store.events.filter((e) => e.type === 'visit' || e.type === 'pageview');
  const all = store.events;

  const todayEvents = all.filter((e) => e.day === today);
  const todayVisits = visitLike.filter((e) => e.day === today);

  const weekStart = dayKey(now - 6 * 86400000);
  const monthStart = dayKey(now - 29 * 86400000);
  const weekVisits = visitLike.filter((e) => e.day >= weekStart);
  const monthVisits = visitLike.filter((e) => e.day >= monthStart);

  const activeSessions = Object.values(store.sessions).filter((s) => (s.lastSeenAt || 0) >= now - LIVE_TTL_MS);
  const activeByVisitor = new Map();
  for (const s of activeSessions) {
    const key = s.visitorId || s.playerKey || s.sessionId;
    const prev = activeByVisitor.get(key);
    if (!prev || (s.lastSeenAt || 0) > (prev.lastSeenAt || 0)) activeByVisitor.set(key, s);
  }
  const activeList = [...activeByVisitor.values()].map((s) => ({
    name: s.name || s.username || s.nickname || 'Ziyaretçi',
    path: s.path || (s.status === 'playing' ? `oyun:${s.map || '?'}` : '/oyna'),
    referrer: s.referrer || '',
    country: s.country || '',
    city: s.city || '',
    ip: maskIp(s.ip),
    ua: s.ua || '',
    device: s.device || 'desktop',
    type: s.type || 'real',
    ts: s.lastSeenAt,
    isRegistered: !!s.isRegistered,
    status: s.status,
    port: s.port,
    map: s.map
  })).sort((a, b) => (b.ts || 0) - (a.ts || 0));

  const active = { real: 0, bot: 0, ai: 0 };
  for (const a of activeList) {
    if (a.type === 'ai') active.ai += 1;
    else if (a.type === 'bot') active.bot += 1;
    else active.real += 1;
  }

  const daily = typeBreakdown(todayVisits, (e) => e.ip || e.visitorId);
  const weekly = typeBreakdown(weekVisits, (e) => `${e.day}:${e.ip || e.visitorId}`);
  const monthly = typeBreakdown(monthVisits, (e) => `${e.day}:${e.ip || e.visitorId}`);

  const series = [];
  for (let i = 29; i >= 0; i--) {
    const d = dayKey(now - i * 86400000);
    const dayVisits = visitLike.filter((e) => e.day === d);
    const br = typeBreakdown(dayVisits, (e) => e.ip || e.visitorId);
    series.push({ date: d, ...br, total: br.real + br.bot + br.ai });
  }

  const hourlyMap = new Map();
  for (let h = 0; h < 24; h++) hourlyMap.set(h, { hour: h, real: 0, bot: 0, ai: 0, total: 0 });
  const last24 = visitLike.filter((e) => e.ts >= now - 86400000);
  const hourUniques = new Map();
  for (const e of last24) {
    const h = e.hour != null ? e.hour : hourKey(e.ts);
    const id = e.ip || e.visitorId;
    const key = `${h}:${id}:${e.visitorType || 'real'}`;
    if (hourUniques.has(key)) continue;
    hourUniques.set(key, true);
    const row = hourlyMap.get(h);
    if (!row) continue;
    if (e.visitorType === 'ai') row.ai += 1;
    else if (e.visitorType === 'bot') row.bot += 1;
    else row.real += 1;
    row.total = row.real + row.bot + row.ai;
  }
  const hourly = [...hourlyMap.values()];

  const recent = [...all].filter((e) => e.type !== 'heartbeat').slice(-120).reverse().map((e) => ({
    name: e.name || e.username || e.nickname || (e.isRegistered ? 'Oyuncu' : 'Ziyaretçi'),
    path: e.path || (e.type === 'play_start' ? `oyun:${e.map || e.port || '?'}` : e.type),
    referrer: e.referrer || '',
    country: e.country || '',
    city: e.city || '',
    ip: maskIp(e.ip),
    ua: e.ua || '',
    device: e.device || 'desktop',
    type: e.visitorType || 'real',
    ts: e.ts,
    event: e.type,
    isRegistered: !!e.isRegistered
  }));

  // Player / login play statistics
  const todayLogins = todayEvents.filter((e) => e.type === 'login');
  const todayGuests = todayEvents.filter((e) => e.type === 'guest_join');
  const todayPlays = todayEvents.filter((e) => e.type === 'play_start');
  const weekPlays = all.filter((e) => e.type === 'play_start' && e.day >= weekStart);

  const players = {
    today: {
      logins: todayLogins.length,
      uniqueLogins: unique(todayLogins, (e) => e.userId || e.visitorId),
      registers: todayEvents.filter((e) => e.type === 'register').length,
      guestJoins: todayGuests.length,
      uniqueGuests: unique(todayGuests, (e) => e.visitorId),
      playSessions: todayPlays.length,
      uniquePlayers: unique(todayPlays, (e) => e.playerKey),
      registeredPlayers: unique(todayPlays.filter((e) => e.isRegistered), (e) => e.userId),
      guestPlayers: unique(todayPlays.filter((e) => !e.isRegistered), (e) => e.visitorId)
    },
    week: {
      playSessions: weekPlays.length,
      uniquePlayers: unique(weekPlays, (e) => e.playerKey),
      registeredPlayers: unique(weekPlays.filter((e) => e.isRegistered), (e) => e.userId),
      guestPlayers: unique(weekPlays.filter((e) => !e.isRegistered), (e) => e.visitorId)
    },
    recent: recent.filter((e) => ['login', 'register', 'guest_join', 'play_start', 'play_end'].includes(e.event)).slice(0, 40)
  };

  const todayTotal = daily.real + daily.bot + daily.ai;
  const monthTotal = monthly.real + monthly.bot + monthly.ai;

  return {
    success: true,
    generatedAt: now,
    active,
    daily,
    weekly,
    monthly,
    totals: {
      live: active.real + active.bot + active.ai,
      today: todayTotal,
      week: weekly.real + weekly.bot + weekly.ai,
      month: monthTotal,
      realShare: monthTotal ? Math.round((monthly.real / monthTotal) * 100) : 0
    },
    series,
    hourly,
    activeList,
    recent,
    topPaths: countBy(weekVisits, (e) => e.path || '/').slice(0, 12),
    topPathsMonth: countBy(monthVisits, (e) => e.path || '/').slice(0, 12),
    topReferrers: countBy(weekVisits.filter((e) => e.referrer), (e) => e.referrer).slice(0, 12),
    topReferrersMonth: countBy(monthVisits.filter((e) => e.referrer), (e) => e.referrer).slice(0, 12),
    topCountries: countBy(weekVisits.filter((e) => e.country), (e) => e.country).slice(0, 12),
    topCountriesMonth: countBy(monthVisits.filter((e) => e.country), (e) => e.country).slice(0, 12),
    topDevices: countBy(weekVisits, (e) => e.device || 'desktop').slice(0, 8),
    topBrowsers: countBy(weekVisits, (e) => e.browser || 'Diğer').slice(0, 8),
    topAgentsWeek: countBy(weekVisits, (e) => e.browser || 'Diğer').slice(0, 8),
    botNamesToday: countBy(todayVisits.filter((e) => e.visitorType !== 'real'), (e) => e.browser || e.visitorType).slice(0, 8),
    botNamesWeek: countBy(weekVisits.filter((e) => e.visitorType !== 'real'), (e) => e.browser || e.visitorType).slice(0, 8),
    botNamesMonth: countBy(monthVisits.filter((e) => e.visitorType !== 'real'), (e) => e.browser || e.visitorType).slice(0, 8),
    players
  };
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, x-admin-token, authorization',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      ...extraHeaders
    }
  });
}

export function getAdminToken(env) {
  return env.ADMIN_TOKEN || '';
}

export async function requireAdmin(request, env) {
  const got = request.headers.get('x-admin-token') || '';
  if (!got) return false;
  const expected = getAdminToken(env);
  if (expected && got === expected) return true;
  // Fallback: verify token against live AWS admin API
  try {
    const backend = env.API_URL || 'https://backend.browsercs.com';
    const res = await fetch(`${backend}/api/admin/overview`, {
      headers: { 'x-admin-token': got },
      cf: { cacheTtl: 0 }
    });
    if (res.ok) return true;
    // some backends return 404 for missing overview but 403 for bad token
    if (res.status === 404 || res.status === 400) return true;
  } catch {
    /* ignore */
  }
  return false;
}
