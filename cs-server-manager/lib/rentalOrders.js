/**
 * Rental order store (ENPARA havale).
 * 1) Prefer public.rental_orders (Supabase)
 * 2) Fallback: local JSON file data/rental_orders.json
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'rental_orders.json');

let tableAvailable = null; // null unknown, true/false

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');
}

function readLocal() {
  ensureDataFile();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8') || '[]');
  } catch {
    return [];
  }
}

function writeLocal(rows) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(rows, null, 2), 'utf8');
}

function genOrderCode() {
  const part = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `BCS-${part}`;
}

function bankInfoFromEnv(maxPlayers, vipOpts) {
  try {
    const commerce = require('./commerce');
    return commerce.getBankInfo(maxPlayers, vipOpts || {});
  } catch (_) {
    return {
      bankName: process.env.BANK_NAME || 'ENPARA',
      bankHolder: process.env.BANK_HOLDER || 'OKTAY BULUT',
      bankIban: process.env.BANK_IBAN || 'TRXXXXXXXXXXXXXXXXXXXXXXXX',
      amountTry: Number(process.env.BANK_AMOUNT_TRY || 350),
    };
  }
}

async function probeTable(sb) {
  if (!sb) {
    tableAvailable = false;
    return false;
  }
  if (tableAvailable !== null) return tableAvailable;
  const { error } = await sb.from('rental_orders').select('id').limit(1);
  if (!error) {
    tableAvailable = true;
  } else if (error.code === 'PGRST205' || /Could not find the table|does not exist/i.test(error.message || '')) {
    tableAvailable = false;
  } else {
    // other errors (RLS etc.) — assume table exists
    tableAvailable = true;
  }
  return tableAvailable;
}

function normalizeRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    order_code: row.order_code,
    owner_id: row.owner_id,
    server_name: row.server_name,
    map: row.map,
    max_players: row.max_players,
    amount_try: Number(row.amount_try),
    status: row.status,
    purchased_server_id: row.purchased_server_id || null,
    admin_note: row.admin_note || null,
    paid_at: row.paid_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function createOrder(sb, { ownerId, serverName, map, maxPlayers }) {
  const commerce = require('./commerce');
  const { isActiveVip, normalizeVipTier } = require('./vipConstants');

  let vipOpts = {};
  if (sb && ownerId) {
    try {
      const { data: prof } = await sb
        .from('profiles')
        .select('vip_tier, vip_expires_at')
        .eq('id', ownerId)
        .maybeSingle();
      if (prof && isActiveVip(prof) && normalizeVipTier(prof.vip_tier) === 'platinum') {
        vipOpts = { profile: prof };
      }
    } catch (e) {
      console.warn('[rentalOrders] vip lookup:', e.message);
    }
  }

  const resolved = commerce.resolveRentalTier(maxPlayers, vipOpts);
  if (!resolved.ok) {
    const err = new Error(resolved.error);
    err.status = 400;
    throw err;
  }
  const bank = bankInfoFromEnv(resolved.maxPlayers, vipOpts);
  const now = new Date().toISOString();
  const adminNote = resolved.vipDiscount
    ? `Platinum VIP %${resolved.discountPct} indirim (liste ${resolved.listPriceTry}₺ → ${resolved.amountTry}₺)`
    : null;
  const row = {
    id: crypto.randomUUID(),
    order_code: genOrderCode(),
    owner_id: ownerId,
    server_name: String(serverName || 'CS 1.5 Özel Sunucu').slice(0, 64),
    map: String(map || 'de_dust2').slice(0, 64),
    max_players: resolved.maxPlayers,
    amount_try: resolved.amountTry,
    status: 'pending_payment',
    purchased_server_id: null,
    admin_note: adminNote,
    paid_at: null,
    created_at: now,
    updated_at: now
  };

  const pricing = {
    amountTry: resolved.amountTry,
    listPriceTry: resolved.listPriceTry,
    discountPct: resolved.discountPct,
    discountTry: resolved.discountTry,
    vipDiscount: resolved.vipDiscount,
    vipTier: resolved.vipTier,
  };

  const useTable = await probeTable(sb);
  if (useTable) {
    for (let i = 0; i < 5; i++) {
      const insertPayload = {
        order_code: row.order_code,
        owner_id: row.owner_id,
        server_name: row.server_name,
        map: row.map,
        max_players: row.max_players,
        amount_try: row.amount_try,
        status: row.status,
      };
      if (adminNote) insertPayload.admin_note = adminNote;
      const { data, error } = await sb
        .from('rental_orders')
        .insert([insertPayload])
        .select('*')
        .single();
      if (!error) {
        const normalized = normalizeRow(data);
        normalized._pricing = pricing;
        normalized._bank = bank;
        return normalized;
      }
      if (/duplicate|unique/i.test(error.message || '')) {
        row.order_code = genOrderCode();
        continue;
      }
      console.warn('[rentalOrders] insert failed, falling back to file:', error.message);
      tableAvailable = false;
      break;
    }
  }

  const local = readLocal();
  while (local.some((r) => r.order_code === row.order_code)) {
    row.order_code = genOrderCode();
  }
  local.push(row);
  writeLocal(local);
  const normalized = normalizeRow(row);
  normalized._pricing = pricing;
  normalized._bank = bank;
  return normalized;
}

async function listOrdersByOwner(sb, ownerId) {
  const useTable = await probeTable(sb);
  if (useTable) {
    const { data, error } = await sb
      .from('rental_orders')
      .select('*')
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false });
    if (!error) return (data || []).map(normalizeRow);
    console.warn('[rentalOrders] listByOwner:', error.message);
  }
  return readLocal()
    .filter((r) => r.owner_id === ownerId)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map(normalizeRow);
}

async function listAllOrders(sb, { status } = {}) {
  const useTable = await probeTable(sb);
  if (useTable) {
    let q = sb.from('rental_orders').select('*').order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (!error) return (data || []).map(normalizeRow);
    console.warn('[rentalOrders] listAll:', error.message);
  }
  let rows = readLocal();
  if (status) rows = rows.filter((r) => r.status === status);
  return rows
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map(normalizeRow);
}

async function getOrderById(sb, id) {
  const useTable = await probeTable(sb);
  if (useTable) {
    const { data, error } = await sb.from('rental_orders').select('*').eq('id', id).maybeSingle();
    if (!error && data) return normalizeRow(data);
    if (error) console.warn('[rentalOrders] getById:', error.message);
  }
  return normalizeRow(readLocal().find((r) => r.id === id) || null);
}

async function updateOrder(sb, id, patch) {
  const now = new Date().toISOString();
  const body = { ...patch, updated_at: now };
  const useTable = await probeTable(sb);
  if (useTable) {
    const { data, error } = await sb
      .from('rental_orders')
      .update(body)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (!error && data) return normalizeRow(data);
    if (error) console.warn('[rentalOrders] update:', error.message);
  }
  const local = readLocal();
  const idx = local.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  local[idx] = { ...local[idx], ...body };
  writeLocal(local);
  return normalizeRow(local[idx]);
}

module.exports = {
  bankInfoFromEnv,
  genOrderCode,
  createOrder,
  listOrdersByOwner,
  listAllOrders,
  getOrderById,
  updateOrder,
  probeTable
};
