/**
 * Sunucu bazlı admin deposu.
 * 1) Tercih: public.server_admins tablosu (Supabase)
 * 2) Yedek: private Storage bucket "server-admins" / {serverId}.json
 * Şifreler asla public endpoint'te dönmez.
 */
const crypto = require('crypto');

const BUCKET = 'server-admins';
const DEFAULT_FLAGS = 'abcdefghijklmnopqrstu';

/** Platform owner — every cs15 server (official + rented). Name protected via AMXX account flag "a". */
const PLATFORM_ADMIN_NAME = 'BrowserCS';
const PLATFORM_ADMIN = Object.freeze({
  name: PLATFORM_ADMIN_NAME,
  password: 'Browsercsadmin44',
  flags: DEFAULT_FLAGS,
  immunity: 'a'
});

function normalizeName(name) {
  return String(name || '').trim();
}

/** Compact alnum form for brand checks (Browser CS / xBrowserCS123 → browsercs…). */
function compactNick(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function nickContainsBrowserCS(name) {
  return compactNick(name).includes('browsercs');
}

function isPlatformAdminNick(name) {
  const n = String(name || '').trim().toLowerCase();
  return (
    n === PLATFORM_ADMIN_NAME.toLowerCase() ||
    n === 'browsercs admin' ||
    n === 'browsercs' ||
    n === 'oktay'
  );
}

/** Non-platform admins may not use any browsercs* game nick. */
function assertAllowedGameName(name) {
  const nick = normalizeName(name);
  if (!nick) throw new Error('Oyun nicki zorunlu');
  if (nickContainsBrowserCS(nick) && nick !== PLATFORM_ADMIN_NAME) {
    throw new Error('"browsercs" içeren nickler saklıdır. Yalnızca resmi nick BrowserCS kullanılabilir.');
  }
  return nick;
}

/** Ensure PLATFORM_ADMIN is always first; drop duplicate / legacy platform nick rows. */
function ensurePlatformAdmin(admins) {
  const cleaned = (admins || [])
    .map((a) => ({
      ...a,
      name: normalizeName(a.name || a.game_name),
      password: String(a.password ?? a.amx_password ?? ''),
      flags: String(a.flags || DEFAULT_FLAGS),
      immunity: a.immunity || 'a'
    }))
    .filter((a) => a.name && !isPlatformAdminNick(a.name));
  return [
    {
      name: PLATFORM_ADMIN.name,
      password: PLATFORM_ADMIN.password,
      flags: PLATFORM_ADMIN.flags,
      immunity: PLATFORM_ADMIN.immunity
    },
    ...cleaned
  ];
}

function genAmxPassword() {
  return crypto.randomBytes(9).toString('base64url').slice(0, 12);
}

function rowToAdmin(row) {
  if (!row) return null;
  return {
    id: row.id || null,
    userId: row.user_id || row.userId || null,
    username: row.username || null,
    name: normalizeName(row.game_name || row.name),
    password: String(row.amx_password ?? row.password ?? ''),
    flags: String(row.flags || DEFAULT_FLAGS),
    immunity: 'a',
    createdAt: row.created_at || row.createdAt || null
  };
}

async function ensureBucket(supabaseAdmin) {
  try {
    const { data } = await supabaseAdmin.storage.listBuckets();
    if ((data || []).some((b) => b.name === BUCKET)) return;
    await supabaseAdmin.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: 1024 * 1024
    });
  } catch (e) {
    /* ignore race */
  }
}

async function tableAvailable(supabaseAdmin) {
  const { error } = await supabaseAdmin.from('server_admins').select('id').limit(1);
  return !error;
}

async function readFromTable(supabaseAdmin, serverId) {
  const { data, error } = await supabaseAdmin
    .from('server_admins')
    .select('id, server_id, user_id, game_name, amx_password, flags, created_at')
    .eq('server_id', serverId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  const userIds = (data || []).map((r) => r.user_id).filter(Boolean);
  let profileMap = new Map();
  if (userIds.length) {
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, username')
      .in('id', userIds);
    profileMap = new Map((profiles || []).map((p) => [p.id, p.username]));
  }

  return (data || []).map((r) =>
    rowToAdmin({
      ...r,
      username: profileMap.get(r.user_id) || null
    })
  );
}

async function writeToTable(supabaseAdmin, serverId, admins, createdBy) {
  const { error: delErr } = await supabaseAdmin
    .from('server_admins')
    .delete()
    .eq('server_id', serverId);
  if (delErr) throw delErr;

  if (!admins.length) return [];

  const payload = admins.map((a) => ({
    server_id: serverId,
    user_id: a.userId || null,
    game_name: normalizeName(a.name),
    amx_password: String(a.password || genAmxPassword()),
    flags: String(a.flags || DEFAULT_FLAGS),
    created_by: createdBy || null
  }));

  const { data, error } = await supabaseAdmin
    .from('server_admins')
    .insert(payload)
    .select('id, server_id, user_id, game_name, amx_password, flags, created_at');
  if (error) throw error;
  return (data || []).map(rowToAdmin);
}

async function readFromStorage(supabaseAdmin, serverId) {
  await ensureBucket(supabaseAdmin);
  const path = `${serverId}.json`;
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(path);
  if (error) {
    if (/not found|404|Object not found/i.test(error.message || '')) return [];
    throw error;
  }
  const text = await data.text();
  const parsed = JSON.parse(text || '[]');
  return (Array.isArray(parsed) ? parsed : []).map(rowToAdmin).filter((a) => a && a.name);
}

async function writeToStorage(supabaseAdmin, serverId, admins) {
  await ensureBucket(supabaseAdmin);
  const path = `${serverId}.json`;
  const body = JSON.stringify(
    admins.map((a) => ({
      id: a.id || crypto.randomUUID(),
      user_id: a.userId || null,
      username: a.username || null,
      game_name: normalizeName(a.name),
      amx_password: String(a.password || genAmxPassword()),
      flags: String(a.flags || DEFAULT_FLAGS),
      created_at: a.createdAt || new Date().toISOString()
    })),
    null,
    2
  );
  const blob = Buffer.from(body, 'utf8');
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, blob, {
    contentType: 'application/json',
    upsert: true
  });
  if (error) throw error;
  return readFromStorage(supabaseAdmin, serverId);
}

async function listServerAdmins(supabaseAdmin, serverId) {
  if (!serverId) return [];
  if (await tableAvailable(supabaseAdmin)) {
    return readFromTable(supabaseAdmin, serverId);
  }
  return readFromStorage(supabaseAdmin, serverId);
}

async function saveServerAdmins(supabaseAdmin, serverId, admins, createdBy) {
  const cleaned = (admins || [])
    .map((a) => ({
      id: a.id || null,
      userId: a.userId || a.user_id || null,
      username: a.username || null,
      name: assertAllowedGameName(a.name || a.game_name),
      password: String(a.password ?? a.amx_password ?? ''),
      flags: String(a.flags || DEFAULT_FLAGS),
      createdAt: a.createdAt || null
    }))
    .filter((a) => a.name);

  // Aynı nick / user tekrarını temizle
  const byKey = new Map();
  for (const a of cleaned) {
    const key = a.userId ? `u:${a.userId}` : `n:${a.name.toLowerCase()}`;
    if (!a.password) a.password = genAmxPassword();
    byKey.set(key, a);
  }
  const unique = [...byKey.values()];

  if (await tableAvailable(supabaseAdmin)) {
    return writeToTable(supabaseAdmin, serverId, unique, createdBy);
  }
  return writeToStorage(supabaseAdmin, serverId, unique);
}

async function addRegisteredUserAdmin(supabaseAdmin, serverId, userId, createdBy, opts = {}) {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('id, username')
    .eq('id', userId)
    .single();
  if (error || !profile) {
    throw new Error('Kayıtlı kullanıcı bulunamadı.');
  }

  const gameName = assertAllowedGameName(opts.gameName || profile.username);

  const current = await listServerAdmins(supabaseAdmin, serverId);
  const existing = current.find((a) => a.userId === userId);
  const password =
    opts.password ||
    (opts.rotatePassword ? genAmxPassword() : null) ||
    existing?.password ||
    genAmxPassword();

  const next = current.filter(
    (a) =>
      a.userId !== userId &&
      a.name.toLowerCase() !== gameName.toLowerCase()
  );
  next.unshift({
    userId: profile.id,
    username: profile.username,
    name: gameName,
    password,
    flags: opts.flags || existing?.flags || DEFAULT_FLAGS
  });
  const admins = await saveServerAdmins(supabaseAdmin, serverId, next, createdBy);
  const added =
    admins.find((a) => a.userId === userId) ||
    admins.find((a) => a.name.toLowerCase() === gameName.toLowerCase()) ||
    null;
  return { admins, added };
}

async function findMyAdminForPort(supabaseAdmin, userId, port) {
  if (!userId || !port) return null;

  const { data: server, error } = await supabaseAdmin
    .from('purchased_servers')
    .select('id, port')
    .eq('port', Number(port))
    .maybeSingle();
  if (error || !server) return null;

  const admins = await listServerAdmins(supabaseAdmin, server.id);
  const mine = admins.find((a) => a.userId === userId);
  if (!mine) return null;
  return {
    serverId: server.id,
    port: server.port,
    gameName: mine.name,
    password: mine.password,
    flags: mine.flags
  };
}

async function searchProfiles(supabaseAdmin, query, limit = 20) {
  const q = String(query || '').trim();
  if (q.length < 1) return [];
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, username, role, created_at')
    .ilike('username', `%${q}%`)
    .order('username', { ascending: true })
    .limit(Math.min(limit, 50));
  if (error) throw error;
  return data || [];
}

function adminsToUsersIni(admins) {
  const list = ensurePlatformAdmin(admins);
  return (
    list
      .filter((a) => a && a.name)
      .map((a) => {
        const name = String(a.name).replace(/"/g, '');
        const password = String(a.password || '').replace(/"/g, '');
        const flags = String(a.flags || DEFAULT_FLAGS).replace(/"/g, '');
        // "a" = geçersiz şifrede düşür — nick rezervasyonu + şifresiz admin yok
        return `"${name}" "${password}" "${flags}" "a"`;
      })
      .join('\n') + (list.length ? '\n' : '')
  );
}

module.exports = {
  DEFAULT_FLAGS,
  PLATFORM_ADMIN,
  PLATFORM_ADMIN_NAME,
  nickContainsBrowserCS,
  assertAllowedGameName,
  ensurePlatformAdmin,
  genAmxPassword,
  listServerAdmins,
  saveServerAdmins,
  addRegisteredUserAdmin,
  findMyAdminForPort,
  searchProfiles,
  adminsToUsersIni,
  tableAvailable
};
