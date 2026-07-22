/**
 * Platinum VIP — aylık harita oylaması (votemap) öneri kotası.
 * Dosya tabanlı; Supabase migration gerekmez.
 *
 * Quota: 4 / İstanbul ayı
 * Queue: shared AMXX file → browsercs_maprotate oylamaya pinler
 */
const fs = require('fs');
const path = require('path');

const QUOTA_PER_MONTH = 4;
const DATA_ROOT =
  process.env.VIP_MAP_SUGGEST_DIR ||
  path.join(__dirname, '..', 'data', 'vip_map_suggest');
const QUEUE_FILE =
  process.env.VIP_MAP_QUEUE_FILE ||
  '/home/ubuntu/cstrike/addons/amxmodx/data/vip_map_queue.txt';

/** browsercs_maprotate ile aynı havuz */
const ALLOWED_MAPS = Object.freeze([
  'de_dust2',
  'de_inferno',
  'de_aztec',
  'de_dust',
  'fy_iceworld',
  'de_nuke',
  'cs_assault',
  'cs_office',
  'de_train',
  'de_cbble',
]);

function istanbulMonth(d = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
  });
  const parts = fmt.formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  return `${y}-${m}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function monthFile(month = istanbulMonth()) {
  return path.join(DATA_ROOT, `${month}.json`);
}

function readMonth(month = istanbulMonth()) {
  const file = monthFile(month);
  try {
    if (!fs.existsSync(file)) return { month, users: {} };
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data.users) data.users = {};
    data.month = month;
    return data;
  } catch {
    return { month, users: {} };
  }
}

function writeMonth(data) {
  ensureDir(DATA_ROOT);
  const file = monthFile(data.month);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 0), 'utf8');
  fs.renameSync(tmp, file);
}

function usageFor(userId, month = istanbulMonth()) {
  const data = readMonth(month);
  const row = data.users[userId] || { count: 0, items: [] };
  return {
    month,
    used: row.count | 0,
    remaining: Math.max(0, QUOTA_PER_MONTH - (row.count | 0)),
    quota: QUOTA_PER_MONTH,
    items: row.items || [],
  };
}

function normalizeMap(map) {
  const m = String(map || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
  return ALLOWED_MAPS.includes(m) ? m : null;
}

function appendQueue({ map, port, userId }) {
  ensureDir(path.dirname(QUEUE_FILE));
  const line = `${map}|${port | 0}|${userId}|${Math.floor(Date.now() / 1000)}\n`;
  fs.appendFileSync(QUEUE_FILE, line, 'utf8');
}

/**
 * @returns {{ ok: true, usage } | { ok: false, error: string, status?: number, usage? }}
 */
function suggestMap({ userId, map, port = 0 }) {
  if (!userId) return { ok: false, error: 'userId gerekli', status: 400 };
  const cleanMap = normalizeMap(map);
  if (!cleanMap) {
    return {
      ok: false,
      error: `Geçersiz harita. İzinli: ${ALLOWED_MAPS.join(', ')}`,
      status: 400,
    };
  }
  const p = parseInt(port, 10);
  const targetPort = Number.isFinite(p) && p > 0 ? p : 0;

  const month = istanbulMonth();
  const data = readMonth(month);
  if (!data.users[userId]) data.users[userId] = { count: 0, items: [] };
  const row = data.users[userId];
  if ((row.count | 0) >= QUOTA_PER_MONTH) {
    return {
      ok: false,
      error: `Bu ay kotan doldu (${QUOTA_PER_MONTH}/${QUOTA_PER_MONTH}).`,
      status: 429,
      usage: usageFor(userId, month),
    };
  }

  row.count = (row.count | 0) + 1;
  row.items.push({
    map: cleanMap,
    port: targetPort,
    at: new Date().toISOString(),
  });
  writeMonth(data);
  appendQueue({ map: cleanMap, port: targetPort, userId });

  return {
    ok: true,
    map: cleanMap,
    port: targetPort,
    usage: usageFor(userId, month),
  };
}

function listPendingQueue(limit = 20) {
  try {
    if (!fs.existsSync(QUEUE_FILE)) return [];
    const lines = fs
      .readFileSync(QUEUE_FILE, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    return lines.slice(0, limit).map((line) => {
      const [map, port, userId, ts] = line.split('|');
      return {
        map,
        port: parseInt(port, 10) || 0,
        userId: userId || '',
        at: ts ? Number(ts) : null,
      };
    });
  } catch {
    return [];
  }
}

module.exports = {
  QUOTA_PER_MONTH,
  ALLOWED_MAPS,
  istanbulMonth,
  usageFor,
  suggestMap,
  listPendingQueue,
  normalizeMap,
};
