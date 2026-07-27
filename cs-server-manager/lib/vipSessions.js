/**
 * Account-based VIP identity tickets.
 * Browser gets a short-lived random ticket after Supabase JWT auth.
 * AMXX validates ticket from shared snapshot — never trusts client UUID/tier.
 *
 * Snapshot line: ticket|userId|displayName|tier|port|expiresUnix|clanTag
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  normalizeVipTier,
  VIP_CLAN_TAG_FIXED,
} = require('./vipConstants');

const SESSION_DIR =
  process.env.VIP_SESSION_DIR ||
  process.env.RANK_SESSION_DIR ||
  path.dirname(
    process.env.RANK_QUEUE_FILE ||
      '/home/ubuntu/cstrike/addons/amxmodx/data/rank_kills.log'
  );
const SESSION_FILE =
  process.env.VIP_SESSION_FILE ||
  path.join(SESSION_DIR, 'vip_sessions.txt');

/** Legacy 27200 mounts a separate amxmodx tree; absolute symlinks break inside the container. */
const SESSION_MIRROR_FILES = String(
  process.env.VIP_SESSION_MIRROR_FILES ||
    '/home/ubuntu/browsercs-live-addons-20260715_103444/amxx182-root/addons/amxmodx/data/vip_sessions.txt'
)
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);

const TICKET_TTL_MS = Number(process.env.VIP_TICKET_TTL_MS || 5 * 60 * 1000);
const TICKET_BYTES = 12;

/** ticket -> { userId, displayName, tier, port, clanTag, expiresAt } */
const sessions = new Map();

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sanitizeDisplayName(name) {
  return String(name || '')
    .replace(/[\x00-\x1f|<>&"]/g, '_')
    .trim()
    .slice(0, 32) || 'Oyuncu';
}

function sanitizeTicket(ticket) {
  return String(ticket || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 32);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(value || '')
  );
}

function purgeExpired(now = Date.now()) {
  for (const [ticket, row] of sessions.entries()) {
    if (!row || row.expiresAt <= now) sessions.delete(ticket);
  }
}

function writeAtomicSessionFile(file, body) {
  ensureDir(path.dirname(file));
  try {
    if (fs.lstatSync(file).isSymbolicLink()) fs.unlinkSync(file);
  } catch {
    /* missing is fine */
  }
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, body, 'utf8');
  fs.renameSync(tmp, file);
}

function writeSessionSnapshot() {
  purgeExpired();
  ensureDir(SESSION_DIR);
  const lines = [];
  for (const [ticket, row] of sessions.entries()) {
    if (!ticket || !row?.userId) continue;
    const tier = normalizeVipTier(row.tier) || 'silver';
    if (tier === 'none') continue;
    lines.push(
      [
        sanitizeTicket(ticket),
        String(row.userId),
        sanitizeDisplayName(row.displayName),
        tier,
        Number(row.port) || 0,
        Math.floor(row.expiresAt / 1000),
        tier === 'platinum' ? VIP_CLAN_TAG_FIXED : '',
      ].join('|')
    );
  }
  const body = lines.length ? `${lines.join('\n')}\n` : '';
  writeAtomicSessionFile(SESSION_FILE, body);
  for (const mirror of SESSION_MIRROR_FILES) {
    if (!mirror || path.resolve(mirror) === path.resolve(SESSION_FILE)) continue;
    try {
      writeAtomicSessionFile(mirror, body);
    } catch (e) {
      console.warn('[vip-session] mirror write failed:', mirror, e.message);
    }
  }
}

function issueVipTicket({ userId, displayName, port, tier }) {
  const p = parseInt(port, 10);
  const t = normalizeVipTier(tier);
  if (!isUuid(userId)) throw new Error('Geçersiz kullanıcı');
  if (!Number.isFinite(p) || p < 1) throw new Error('Geçersiz port');
  if (!t || t === 'none') throw new Error('Aktif VIP yok');

  purgeExpired();

  for (const [ticket, row] of sessions.entries()) {
    if (row.userId === userId && row.port === p) sessions.delete(ticket);
  }

  const ticket = crypto.randomBytes(TICKET_BYTES).toString('hex');
  const expiresAt = Date.now() + TICKET_TTL_MS;
  sessions.set(ticket, {
    userId: String(userId).toLowerCase(),
    displayName: sanitizeDisplayName(displayName),
    tier: t,
    port: p,
    expiresAt,
  });
  writeSessionSnapshot();
  return {
    ticket,
    expiresAt,
    expiresIn: Math.floor(TICKET_TTL_MS / 1000),
    displayName: sanitizeDisplayName(displayName),
    tier: t,
    clanTag: t === 'platinum' ? VIP_CLAN_TAG_FIXED : '',
    port: p,
  };
}

function lookupTicket(ticket, port) {
  purgeExpired();
  const key = sanitizeTicket(ticket);
  const row = sessions.get(key);
  if (!row) return null;
  if (port != null && Number(row.port) !== Number(port)) return null;
  if (row.expiresAt <= Date.now()) {
    sessions.delete(key);
    writeSessionSnapshot();
    return null;
  }
  return { ...row, ticket: key };
}

function startVipSessionCleanup() {
  ensureDir(SESSION_DIR);
  writeSessionSnapshot();
  return setInterval(() => {
    try {
      const before = sessions.size;
      purgeExpired();
      if (sessions.size !== before) writeSessionSnapshot();
    } catch (e) {
      console.warn('[vip-session] cleanup:', e.message);
    }
  }, 30_000);
}

module.exports = {
  issueVipTicket,
  lookupTicket,
  writeSessionSnapshot,
  startVipSessionCleanup,
  sanitizeDisplayName,
  SESSION_FILE,
  TICKET_TTL_MS,
};
