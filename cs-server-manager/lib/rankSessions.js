/**
 * Account-based rank identity tickets.
 * Browser gets a short-lived random ticket after Supabase JWT auth.
 * AMXX validates ticket from shared snapshot — never trusts client UUID.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SESSION_DIR =
  process.env.RANK_SESSION_DIR ||
  path.dirname(
    process.env.RANK_QUEUE_FILE ||
      '/home/ubuntu/cstrike/addons/amxmodx/data/rank_kills.log'
  );
const SESSION_FILE =
  process.env.RANK_SESSION_FILE ||
  path.join(SESSION_DIR, 'rank_sessions.txt');

/** Ticket TTL — enough for load + connect, short enough to limit reuse */
const TICKET_TTL_MS = Number(process.env.RANK_TICKET_TTL_MS || 5 * 60 * 1000);
const TICKET_BYTES = 12;

/** In-memory map: ticket -> { userId, displayName, port, expiresAt } */
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

/**
 * Atomically write AMXX-readable session snapshot.
 * Format per line: ticket|userId|displayName|port|expiresUnix
 */
function writeSessionSnapshot() {
  purgeExpired();
  ensureDir(SESSION_DIR);
  const lines = [];
  for (const [ticket, row] of sessions.entries()) {
    if (!ticket || !row?.userId) continue;
    lines.push(
      [
        sanitizeTicket(ticket),
        String(row.userId),
        sanitizeDisplayName(row.displayName),
        Number(row.port) || 0,
        Math.floor(row.expiresAt / 1000),
      ].join('|')
    );
  }
  const tmp = `${SESSION_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, lines.length ? `${lines.join('\n')}\n` : '', 'utf8');
  fs.renameSync(tmp, SESSION_FILE);
}

function issueRankTicket({ userId, displayName, port }) {
  const p = parseInt(port, 10);
  if (!isUuid(userId)) throw new Error('Geçersiz kullanıcı');
  if (!Number.isFinite(p) || p < 1) throw new Error('Geçersiz port');

  purgeExpired();

  // Replace any existing ticket for same user+port (reconnect)
  for (const [ticket, row] of sessions.entries()) {
    if (row.userId === userId && row.port === p) sessions.delete(ticket);
  }

  const ticket = crypto.randomBytes(TICKET_BYTES).toString('hex');
  const expiresAt = Date.now() + TICKET_TTL_MS;
  sessions.set(ticket, {
    userId: String(userId).toLowerCase(),
    displayName: sanitizeDisplayName(displayName),
    port: p,
    expiresAt,
  });
  writeSessionSnapshot();
  return {
    ticket,
    expiresAt,
    expiresIn: Math.floor(TICKET_TTL_MS / 1000),
    displayName: sanitizeDisplayName(displayName),
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

function startRankSessionCleanup() {
  ensureDir(SESSION_DIR);
  writeSessionSnapshot();
  return setInterval(() => {
    try {
      const before = sessions.size;
      purgeExpired();
      if (sessions.size !== before) writeSessionSnapshot();
    } catch (e) {
      console.warn('[rank-session] cleanup:', e.message);
    }
  }, 30_000);
}

module.exports = {
  issueRankTicket,
  lookupTicket,
  writeSessionSnapshot,
  startRankSessionCleanup,
  sanitizeDisplayName,
  SESSION_FILE,
  TICKET_TTL_MS,
};
