/**
 * Rank Takip — per-server monthly kill leaderboard (account-based).
 * Primary key: Supabase user_id (UUID). Display name is cosmetic only.
 * Primary store: JSON on disk. Optional dual-write to Supabase.
 */
const fs = require('fs');
const path = require('path');

const RANK_ROOT = process.env.RANK_DATA_DIR || '/home/ubuntu/rankings';
const QUEUE_FILE =
  process.env.RANK_QUEUE_FILE ||
  '/home/ubuntu/cstrike/addons/amxmodx/data/rank_kills.log';
const RANK_SNAPSHOT_DIR =
  process.env.RANK_SNAPSHOT_DIR || path.dirname(QUEUE_FILE);

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

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(value || '')
  );
}

function normalizeUserId(userId) {
  const id = String(userId || '').trim().toLowerCase();
  return isUuid(id) ? id : '';
}

function displayName(name) {
  return (
    String(name || '')
      .replace(/[\x00-\x1f|<>&"]/g, '_')
      .trim()
      .slice(0, 32) || 'Oyuncu'
  );
}

/** @deprecated nickname keys — kept only for migration helpers */
function normalizeKey(name) {
  return String(name || '')
    .replace(/[\x00-\x1f]/g, '')
    .trim()
    .toLowerCase()
    .slice(0, 32);
}

function monthFile(port, month) {
  return path.join(RANK_ROOT, String(port), `${month}.json`);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readMonth(port, month) {
  const file = monthFile(port, month);
  try {
    if (!fs.existsSync(file)) return { port, month, players: {}, version: 2 };
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data.players) data.players = {};
    data.version = 2;
    return data;
  } catch {
    return { port, month, players: {}, version: 2 };
  }
}

function writeMonth(data) {
  const dir = path.join(RANK_ROOT, String(data.port));
  ensureDir(dir);
  data.version = 2;
  const tmp = monthFile(data.port, data.month) + '.tmp';
  const final = monthFile(data.port, data.month);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 0), 'utf8');
  fs.renameSync(tmp, final);
}

function sortedPlayers(port, month = istanbulMonth()) {
  const data = readMonth(port, month);
  const list = Object.entries(data.players || {})
    .filter(([key]) => isUuid(key))
    .map(([key, p]) => ({
      user_id: key,
      player_key: key,
      name: displayName(p.display_name),
      kills: p.kills | 0,
      deaths: p.deaths | 0,
      kd:
        (p.deaths | 0) > 0
          ? Math.round(((p.kills | 0) / (p.deaths | 0)) * 100) / 100
          : p.kills | 0,
    }));
  list.sort(
    (a, b) => b.kills - a.kills || b.kd - a.kd || a.name.localeCompare(b.name)
  );
  return { data, list };
}

function snapshotField(value) {
  return String(value || '')
    .replace(/[\x00-\x1f|<>&"]/g, '_')
    .slice(0, 36);
}

/**
 * AMXX snapshot for in-game rank / top20.
 * Format: rank|userId|displayName|kills|deaths
 */
function writeGameSnapshot(port, month = istanbulMonth()) {
  const { list } = sortedPlayers(port, month);
  ensureDir(RANK_SNAPSHOT_DIR);
  const final = path.join(RANK_SNAPSHOT_DIR, `rank_snapshot_${Number(port)}.txt`);
  const tmp = `${final}.tmp`;
  const rows = list.map(
    (player, index) =>
      `${index + 1}|${snapshotField(player.user_id)}|${snapshotField(player.name)}|${player.kills}|${player.deaths}`
  );
  fs.writeFileSync(tmp, rows.length ? `${rows.join('\n')}\n` : '', 'utf8');
  fs.renameSync(tmp, final);
}

/**
 * Apply kill/death for authenticated accounts only.
 * Killer guest → no kill credit. Victim guest → no death row created.
 * Logged-in killer vs guest victim → killer kills +1.
 * Logged-in victim vs guest killer → victim deaths +1.
 * @param {number} port
 * @param {string} killerUserId
 * @param {string} victimUserId
 * @param {{ killerName?: string, victimName?: string, month?: string }} opts
 */
function applyKill(port, killerUserId, victimUserId, opts = {}) {
  const month = opts.month || istanbulMonth();
  const kId = normalizeUserId(killerUserId);
  const vId = normalizeUserId(victimUserId);
  if (!port || (!kId && !vId)) return null;
  if (kId && vId && kId === vId) return null;

  const data = readMonth(port, month);
  let changed = false;

  if (kId) {
    if (!data.players[kId]) {
      data.players[kId] = {
        display_name: displayName(opts.killerName),
        kills: 0,
        deaths: 0,
        user_id: kId,
      };
    }
    data.players[kId].kills += 1;
    if (opts.killerName) {
      data.players[kId].display_name = displayName(opts.killerName);
    }
    data.players[kId].user_id = kId;
    changed = true;
  }

  if (vId) {
    if (!data.players[vId]) {
      data.players[vId] = {
        display_name: displayName(opts.victimName),
        kills: 0,
        deaths: 0,
        user_id: vId,
      };
    }
    data.players[vId].deaths += 1;
    if (opts.victimName) {
      data.players[vId].display_name = displayName(opts.victimName);
    }
    data.players[vId].user_id = vId;
    changed = true;
  }

  if (!changed) return null;

  data.updated_at = new Date().toISOString();
  writeMonth(data);
  try {
    writeGameSnapshot(port, month);
  } catch (e) {
    console.warn(`[rank] game snapshot ${port}:`, e.message);
  }
  return data;
}

function topForPort(port, limit = 20, month = istanbulMonth()) {
  const { data, list } = sortedPlayers(port, month);
  return {
    port: Number(port),
    month,
    updated_at: data.updated_at || null,
    top: list.slice(0, limit).map(({ user_id, name, kills, deaths, kd }) => ({
      user_id,
      name,
      kills,
      deaths,
      kd,
    })),
  };
}

function listKnownPorts() {
  if (!fs.existsSync(RANK_ROOT)) return [];
  return fs
    .readdirSync(RANK_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d+$/.test(d.name))
    .map((d) => parseInt(d.name, 10));
}

/**
 * List archived / active months for a port from on-disk JSON.
 * Returns { months: ['2026-07',...], years: { '2026': ['2026-07',...] }, current: 'YYYY-MM' }
 */
function listMonthsForPort(port) {
  const current = istanbulMonth();
  const dir = path.join(RANK_ROOT, String(port));
  const months = new Set();
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      const m = name.match(/^(\d{4}-\d{2})\.json$/);
      if (!m) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
        const players = data?.players || {};
        const hasAccount = Object.keys(players).some((k) => isUuid(k));
        if (hasAccount || m[1] === current) months.add(m[1]);
      } catch {
        /* skip corrupt */
      }
    }
  }
  // Always include current month so UI can show empty live season
  months.add(current);
  const sorted = [...months].sort((a, b) => b.localeCompare(a));
  const years = {};
  for (const month of sorted) {
    const year = month.slice(0, 4);
    if (!years[year]) years[year] = [];
    years[year].push(month);
  }
  return {
    port: Number(port),
    current,
    months: sorted,
    years,
  };
}

/**
 * Parse AMXX queue lines.
 * v2 (account): unix|port|killerUserId|victimUserId|killerName|victimName
 * Guest side may be "-" (no UUID). Legacy v1 nickname lines are ignored.
 */
function ingestQueueFile() {
  if (!fs.existsSync(QUEUE_FILE)) return 0;
  const processingFile = `${QUEUE_FILE}.${process.pid}.${Date.now()}.processing`;
  try {
    fs.renameSync(QUEUE_FILE, processingFile);
  } catch {
    return 0;
  }

  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);

  let raw;
  try {
    raw = fs.readFileSync(processingFile, 'utf8');
  } catch {
    return 0;
  } finally {
    try {
      if (!fs.existsSync(QUEUE_FILE)) fs.writeFileSync(QUEUE_FILE, '', 'utf8');
    } catch {
      /* AMXX append will recreate */
    }
  }
  if (!raw.trim()) {
    try {
      fs.unlinkSync(processingFile);
    } catch {
      /* ignore */
    }
    return 0;
  }

  let n = 0;
  try {
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const parts = t.split('|');
      if (parts.length < 4) continue;
      const port = parseInt(parts[1], 10);
      const killerId = parts[2];
      const victimId = parts[3];
      // Need at least one account UUID; skip nickname-era lines
      if (!isUuid(killerId) && !isUuid(victimId)) continue;
      const killerName = parts[4] || '';
      const victimName = parts[5] || '';
      if (!port) continue;
      try {
        if (
          applyKill(port, killerId, victimId, {
            killerName,
            victimName,
          })
        ) {
          n += 1;
        }
      } catch (e) {
        try {
          fs.appendFileSync(QUEUE_FILE, `${t}\n`, 'utf8');
        } catch {
          /* next restart */
        }
        console.warn('[rank] kill retry queued:', e.message);
      }
    }
  } finally {
    try {
      fs.unlinkSync(processingFile);
    } catch {
      /* ignore */
    }
  }
  return n;
}

async function dualWriteSupabase(supabaseAdmin, port, month) {
  if (!supabaseAdmin) return;
  const data = readMonth(port, month);
  const rows = Object.entries(data.players || {})
    .filter(([key]) => isUuid(key))
    .map(([key, p]) => ({
      port: Number(port),
      month,
      player_key: key,
      user_id: key,
      display_name: displayName(p.display_name),
      kills: p.kills | 0,
      deaths: p.deaths | 0,
      updated_at: new Date().toISOString(),
    }));
  if (!rows.length) return;
  try {
    let { error } = await supabaseAdmin
      .from('server_monthly_ranks')
      .upsert(rows, { onConflict: 'port,month,user_id' });
    // Fallback for DBs still on nickname-era unique (port,month,player_key)
    if (
      error &&
      /unique|constraint|onConflict|conflict/i.test(error.message || '')
    ) {
      ({ error } = await supabaseAdmin
        .from('server_monthly_ranks')
        .upsert(rows, { onConflict: 'port,month,player_key' }));
    }
    if (
      error &&
      !/relation|does not exist|Could not find the table|PGRST|schema cache|unique|constraint/i.test(
        error.message || ''
      )
    ) {
      console.warn('[rank] supabase upsert:', error.message);
    } else if (error && /Could not find the table|schema cache|does not exist/i.test(error.message || '')) {
      // Migration henüz uygulanmadı — bir kez uyar, spam yapma
      if (!dualWriteSupabase._missingTableLogged) {
        dualWriteSupabase._missingTableLogged = true;
        console.warn('[rank] server_monthly_ranks yok — disk JSON kullanılıyor (Supabase migration gerekli)');
      }
    }
  } catch (e) {
    /* table may not exist yet */
  }
}

/**
 * Wipe nickname-era monthly JSON so the account season starts clean.
 * Called once at manager boot when RANK_RESET_NICK_SEASON=1 (default on first deploy).
 */
function resetNicknameSeasonFiles() {
  if (!fs.existsSync(RANK_ROOT)) return 0;
  let n = 0;
  for (const port of listKnownPorts()) {
    const dir = path.join(RANK_ROOT, String(port));
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(dir, name);
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        // v2 already account-based — keep
        if (data.version === 2) continue;
        const archive = file + '.nick-era.bak';
        if (!fs.existsSync(archive)) fs.renameSync(file, archive);
        else fs.unlinkSync(file);
        n += 1;
      } catch {
        /* ignore corrupt */
      }
    }
    try {
      writeGameSnapshot(port, istanbulMonth());
    } catch {
      /* ignore */
    }
  }
  return n;
}

function startRankIngestLoop(supabaseAdmin) {
  ensureDir(RANK_ROOT);
  ensureDir(path.dirname(QUEUE_FILE));
  if (!fs.existsSync(QUEUE_FILE)) {
    try {
      fs.writeFileSync(QUEUE_FILE, '', 'utf8');
    } catch (_) {
      /* ignore */
    }
  }

  if (process.env.RANK_RESET_NICK_SEASON !== '0') {
    try {
      const wiped = resetNicknameSeasonFiles();
      if (wiped > 0) {
        console.log(`[rank] archived ${wiped} nickname-era month file(s)`);
      }
    } catch (e) {
      console.warn('[rank] season reset:', e.message);
    }
  }

  for (const port of listKnownPorts()) {
    try {
      writeGameSnapshot(port, istanbulMonth());
    } catch (e) {
      console.warn(`[rank] snapshot ${port}:`, e.message);
    }
  }

  const tick = async () => {
    try {
      const n = ingestQueueFile();
      if (n > 0) {
        console.log(`[rank] ingested ${n} kill(s) from queue`);
        const month = istanbulMonth();
        for (const port of listKnownPorts()) {
          await dualWriteSupabase(supabaseAdmin, port, month);
        }
      }
    } catch (e) {
      console.warn('[rank] ingest error:', e.message);
    }
  };

  tick();
  return setInterval(tick, 2000);
}

module.exports = {
  istanbulMonth,
  normalizeKey,
  normalizeUserId,
  applyKill,
  sortedPlayers,
  topForPort,
  listKnownPorts,
  listMonthsForPort,
  ingestQueueFile,
  writeGameSnapshot,
  resetNicknameSeasonFiles,
  startRankIngestLoop,
  RANK_ROOT,
  QUEUE_FILE,
  RANK_SNAPSHOT_DIR,
};
