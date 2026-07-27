/**
 * VIP subscription order store (ENPARA havale/EFT) — mirrors lib/rentalOrders.js.
 * 1) Prefer public.vip_orders (Supabase)
 * 2) Fallback: local JSON file data/vip_orders.json
 *
 * Flow: user picks a package on /vip/ -> creates a pending_payment order with
 * a unique code -> transfers the amount via havale/EFT, writing the code in
 * the description -> admin approves in Master Admin (Kullanıcılar) -> tier
 * is granted automatically for 30 days.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { VIP_PRICES_TRY, normalizeVipTier } = require('./vipConstants');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'vip_orders.json');

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
  return `VIP-${part}`;
}

function bankInfoFromEnv() {
  return {
    bankName: process.env.BANK_NAME || 'ENPARA',
    bankHolder: process.env.BANK_HOLDER || 'OKTAY BULUT',
    bankIban: process.env.BANK_IBAN || 'TRXXXXXXXXXXXXXXXXXXXXXXXX',
  };
}

async function probeTable(sb) {
  if (!sb) {
    tableAvailable = false;
    return false;
  }
  if (tableAvailable !== null) return tableAvailable;
  const { error } = await sb.from('vip_orders').select('id').limit(1);
  if (!error) {
    tableAvailable = true;
  } else if (error.code === 'PGRST205' || /Could not find the table|does not exist/i.test(error.message || '')) {
    tableAvailable = false;
  } else {
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
    username: row.username || null,
    tier: row.tier,
    days: Number(row.days) || 30,
    amount_try: Number(row.amount_try),
    status: row.status,
    admin_note: row.admin_note || null,
    paid_at: row.paid_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function createOrder(sb, { ownerId, username, tier }) {
  const normTier = normalizeVipTier(tier);
  if (!normTier || normTier === 'none') {
    throw new Error('Geçersiz paket');
  }
  const now = new Date().toISOString();
  const row = {
    id: crypto.randomUUID(),
    order_code: genOrderCode(),
    owner_id: ownerId,
    username: username || null,
    tier: normTier,
    days: 30,
    amount_try: VIP_PRICES_TRY[normTier],
    status: 'pending_payment',
    admin_note: null,
    paid_at: null,
    created_at: now,
    updated_at: now,
  };

  const useTable = await probeTable(sb);
  if (useTable) {
    for (let i = 0; i < 5; i++) {
      const { data, error } = await sb
        .from('vip_orders')
        .insert([
          {
            order_code: row.order_code,
            owner_id: row.owner_id,
            username: row.username,
            tier: row.tier,
            days: row.days,
            amount_try: row.amount_try,
            status: row.status,
          },
        ])
        .select('*')
        .single();
      if (!error) return normalizeRow(data);
      if (/duplicate|unique/i.test(error.message || '')) {
        row.order_code = genOrderCode();
        continue;
      }
      console.warn('[vipOrders] insert failed, falling back to file:', error.message);
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
  return normalizeRow(row);
}

async function listOrdersByOwner(sb, ownerId) {
  const useTable = await probeTable(sb);
  if (useTable) {
    const { data, error } = await sb
      .from('vip_orders')
      .select('*')
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false });
    if (!error) return (data || []).map(normalizeRow);
    console.warn('[vipOrders] listByOwner:', error.message);
  }
  return readLocal()
    .filter((r) => r.owner_id === ownerId)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map(normalizeRow);
}

async function listAllOrders(sb, { status } = {}) {
  const useTable = await probeTable(sb);
  if (useTable) {
    let q = sb.from('vip_orders').select('*').order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (!error) return (data || []).map(normalizeRow);
    console.warn('[vipOrders] listAll:', error.message);
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
    const { data, error } = await sb.from('vip_orders').select('*').eq('id', id).maybeSingle();
    if (!error && data) return normalizeRow(data);
    if (error) console.warn('[vipOrders] getById:', error.message);
  }
  return normalizeRow(readLocal().find((r) => r.id === id) || null);
}

async function updateOrder(sb, id, patch) {
  const now = new Date().toISOString();
  const body = { ...patch, updated_at: now };
  const useTable = await probeTable(sb);
  if (useTable) {
    const { data, error } = await sb.from('vip_orders').update(body).eq('id', id).select('*').maybeSingle();
    if (!error && data) return normalizeRow(data);
    if (error) console.warn('[vipOrders] update:', error.message);
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
  probeTable,
};
