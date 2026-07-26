/**
 * Master Admin API routes
 * @param {import("express").Express} app
 * @param {object} ctx
 */
function registerAdminRoutes(app, ctx) {
  const {
    ADMIN_PASS,
    ADMIN_TOKEN,
    loginLimiter,
    docker,
    supabaseAdmin,
    queryA2S,
    sendRcon,
    countPlayersBreakdown,
    readPortRconPassword,
    listAllOrders,
    getOrderById,
    updateOrder,
    bankInfoFromEnv,
    provisionRentalForUser,
    listServerAdmins,
    express,
  } = ctx;

  const siteContent = require('../lib/siteContent');
  const fs = require('fs');
  const path = require('path');
  const {
    portFromContainer,
    normalizeServerState,
  } = require('../lib/dockerServers');
const { nickContainsBrowserCS, PLATFORM_ADMIN_NAME } = require('../lib/serverAdmins');
  const {
    isBanActive,
    banRejectMessage,
    ADMIN_USER_COLS,
    ADMIN_USER_COLS_NO_BAN,
    isMissingColumnError,
  } = require('../lib/userModeration');
  const {
    normalizeVipTier,
    isActiveVip,
    daysLeft,
    VIP_LABELS_TR,
    VIP_PRICES_TRY,
    VIP_CLAN_TAG_FIXED,
  } = require('../lib/vipConstants');
  const OFFICIAL_DM_PORT = 27201;
  const ENV_PATH = path.join(__dirname, '..', '.env');

  let _banColsAvailable = true;

  async function selectAdminUsers(q) {
    const cols = _banColsAvailable ? ADMIN_USER_COLS : ADMIN_USER_COLS_NO_BAN;
    let query = supabaseAdmin
      .from('profiles')
      .select(cols)
      .order('created_at', { ascending: false })
      .limit(200);
    if (q) query = query.ilike('username', `%${q}%`);
    const result = await query;
    if (result.error && _banColsAvailable && isMissingColumnError(result.error)) {
      _banColsAvailable = false;
      console.warn('[admin] Ban columns missing — apply migrations/20260721_user_bans.sql');
      return selectAdminUsers(q);
    }
    return result;
  }

  function mapAdminUserRow(u, serverCounts = {}) {
    const now = new Date();
    const tier = normalizeVipTier(u.vip_tier) || 'none';
    const vipActive = isActiveVip(u, now);
    const banned = isBanActive(u, now);
    return {
      id: u.id,
      username: u.username,
      role: u.role || 'user',
      is_premium: !!u.is_premium,
      wallet_balance: u.wallet_balance || 0,
      created_at: u.created_at,
      servers_count: serverCounts[u.id] || 0,
      vip_tier: tier,
      vip_label: VIP_LABELS_TR[vipActive ? tier : 'none'] || 'Yok',
      vip_expires_at: u.vip_expires_at || null,
      vip_active: vipActive,
      vip_days_left: vipActive ? daysLeft(u.vip_expires_at, now) : 0,
      vip_clan_tag: vipActive && tier === 'platinum' ? VIP_CLAN_TAG_FIXED : '',
      vip_notes: u.vip_notes || '',
      admin_notes: u.admin_notes || '',
      is_banned: banned,
      banned_until: u.banned_until || null,
      ban_reason: u.ban_reason || '',
      ban_message: banned ? banRejectMessage(u) : null,
      prices: VIP_PRICES_TRY,
    };
  }

  async function applyVipPatch(userId, body, current) {
    const now = new Date();
    let tier = body.vip_tier !== undefined
      ? normalizeVipTier(body.vip_tier)
      : normalizeVipTier(current?.vip_tier);
    if (body.vip_tier !== undefined && !tier) {
      return { error: 'vip_tier: none|silver|gold|platinum' };
    }
    if (tier == null) tier = 'none';

    const patch = {};
    if (body.vip_tier !== undefined || body.vip_days !== undefined || body.vip_expires_at !== undefined) {
      patch.vip_tier = tier;
      if (tier === 'none') {
        patch.vip_expires_at = null;
        patch.vip_clan_tag = null;
      } else if (body.vip_expires_at != null && body.vip_expires_at !== '') {
        const exp = new Date(body.vip_expires_at);
        if (!Number.isFinite(exp.getTime())) {
          return { error: 'Geçersiz vip_expires_at' };
        }
        patch.vip_expires_at = exp.toISOString();
      } else {
        const days = Math.min(366, Math.max(1, parseInt(body.vip_days, 10) || 30));
        let base = now;
        if (body.vip_extend && isActiveVip(current, now)) {
          const curExp = new Date(current.vip_expires_at);
          if (curExp.getTime() > now.getTime()) base = curExp;
        }
        patch.vip_expires_at = new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
      }
      patch.vip_granted_at = now.toISOString();
      patch.vip_granted_by = 'admin';
      // Clan tag artık admin tarafından seçilmez — Platinum'da her zaman sabit [BCS].
      // Keep role in sync with subscription (never demote admin)
      if (tier !== 'none') {
        if ((current?.role || 'user') !== 'admin') patch.role = 'vip';
      } else if ((current?.role || '') === 'vip') {
        patch.role = 'user';
      }
    }
    if (body.vip_notes !== undefined) {
      patch.vip_notes = body.vip_notes == null ? null : String(body.vip_notes).slice(0, 500);
    }
    return { patch };
  }

  function setOfficialDmEnabled(enabled) {
    try {
      let raw = '';
      try {
        raw = fs.readFileSync(ENV_PATH, 'utf8');
      } catch {
        raw = '';
      }
      const line = `OFFICIAL_DM_ENABLED=${enabled ? '1' : '0'}`;
      if (/^OFFICIAL_DM_ENABLED=.*/m.test(raw)) {
        raw = raw.replace(/^OFFICIAL_DM_ENABLED=.*/m, line);
      } else {
        raw = `${raw.replace(/\s*$/, '')}\n${line}\n`;
      }
      fs.writeFileSync(ENV_PATH, raw, 'utf8');
      process.env.OFFICIAL_DM_ENABLED = enabled ? '1' : '0';
    } catch (e) {
      console.warn('[admin] OFFICIAL_DM_ENABLED update failed:', e.message);
    }
  }

  async function resolveAdminServerTarget(id) {
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    let port = null;
    let rconPassword = 'browsercs';
    let containerId = null;
    let isOfficial = false;
    let state = null;

    if (supabaseAdmin) {
      let dbRow = null;
      if (isUUID) {
        const { data } = await supabaseAdmin.from('purchased_servers').select('*').eq('id', id).maybeSingle();
        dbRow = data;
      } else {
        const { data } = await supabaseAdmin.from('purchased_servers').select('*').eq('container_id', id).maybeSingle();
        dbRow = data;
        if (!dbRow && /^\d+$/.test(String(id))) {
          const { data: byPort } = await supabaseAdmin.from('purchased_servers').select('*').eq('port', parseInt(id, 10)).maybeSingle();
          dbRow = byPort;
        }
      }
      if (dbRow) {
        port = dbRow.port || null;
        if (dbRow.rcon_password) rconPassword = dbRow.rcon_password;
        if (dbRow.container_id) containerId = dbRow.container_id;
      }
    }

    {
      const containers = await docker.listContainers({ all: true, filters: { label: ['cs-web-game=true'] } });
      const match = containers.find((c) => {
        if (containerId && c.Id.startsWith(containerId)) return true;
        if (c.Id === id || c.Id.startsWith(id)) return true;
        const p = portFromContainer(c);
        if (port && p === port) return true;
        if (String(p) === String(id)) return true;
        return (c.Names || []).some((n) => n === `/cs15-${id}` || n.endsWith(`-${id}`));
      });
      if (match) {
        containerId = match.Id;
        const p = portFromContainer(match);
        if (p) port = p;
        isOfficial = match.Labels?.isOfficial === 'true';
        state = match.State || null;
        if (isOfficial) {
          const cfgPw = typeof readPortRconPassword === 'function'
            ? readPortRconPassword(port)
            : null;
          rconPassword = cfgPw || 'admin';
        }
      }
    }

    if (!port) throw new Error('Sunucu portu bulunamadı');
    if (!containerId) throw new Error('Konteyner bulunamadı');
    const cfgPw = typeof readPortRconPassword === 'function'
      ? readPortRconPassword(port)
      : null;
    if (cfgPw) rconPassword = cfgPw;
    return { port, rconPassword, containerId, isOfficial, state };
  }

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (token === ADMIN_TOKEN) {
    next();
  } else {
    res.status(403).json({ success: false, error: 'Yetkisiz erişim' });
  }
}

app.post('/api/admin/login', loginLimiter, express.json(), (req, res) => {
  if (req.body.password === ADMIN_PASS) {
    res.json({ success: true, token: ADMIN_TOKEN });
  } else {
    res.status(401).json({ success: false, error: 'Hatalı şifre' });
  }
});

app.delete('/api/admin/rentals/purge', requireAdmin, async (req, res) => {
  try {
    const containers = await docker.listContainers({ all: true, filters: { label: ['cs-web-game=true'] } });
    let removed = 0;
    for (const c of containers) {
      if (c.Labels?.isOfficial === 'true') continue;
      try {
        await docker.getContainer(c.Id).remove({ force: true });
        removed++;
      } catch (e) { /* ignore */ }
    }

    if (supabaseAdmin) {
      const { error } = await supabaseAdmin
        .from('purchased_servers')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');
      if (error) {
        return res.status(500).json({ success: false, error: 'DB temizliği başarısız: ' + error.message, removedContainers: removed });
      }
    }

    res.json({ success: true, removedContainers: removed, message: 'Tüm kiralık sunucular silindi.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/admin/servers/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    let dbRow = null;
    let containerId = id;

    if (supabaseAdmin) {
      if (isUUID) {
        const { data } = await supabaseAdmin.from('purchased_servers').select('*').eq('id', id).maybeSingle();
        dbRow = data;
        if (dbRow?.container_id) containerId = dbRow.container_id;
      } else {
        const { data } = await supabaseAdmin.from('purchased_servers').select('*').eq('container_id', id).maybeSingle();
        dbRow = data;
      }
    }

    try {
      await docker.getContainer(containerId).remove({ force: true });
    } catch (e) {
      if (!dbRow) throw e;
    }

    if (supabaseAdmin && dbRow) {
      try { await supabaseAdmin.from('server_admins').delete().eq('server_id', dbRow.id); } catch (_) {}
      await supabaseAdmin.from('purchased_servers').delete().eq('id', dbRow.id);
    }

    res.json({ success: true, deletedDb: !!dbRow });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/admin/rental-orders', requireAdmin, async (req, res) => {
  try {
    const status = req.query.status || null;
    const orders = await listAllOrders(supabaseAdmin, { status: status || undefined });
    res.json({ success: true, orders, payment: bankInfoFromEnv() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/admin/rental-orders/:id/approve', requireAdmin, express.json(), async (req, res) => {
  try {
    const order = await getOrderById(supabaseAdmin, req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Sipariş bulunamadı' });
    if (order.status === 'active') {
      return res.json({ success: true, order, message: 'Sipariş zaten aktif' });
    }
    if (!['pending_payment', 'paid', 'failed'].includes(order.status)) {
      return res.status(400).json({ success: false, error: `Bu sipariş onaylanamaz (${order.status})` });
    }

    await updateOrder(supabaseAdmin, order.id, {
      status: 'paid',
      paid_at: new Date().toISOString(),
      admin_note: req.body?.note || order.admin_note
    });
    await updateOrder(supabaseAdmin, order.id, { status: 'provisioning' });

    const result = await provisionRentalForUser(order.owner_id, {
      name: order.server_name,
      map: order.map,
      maxplayers: order.max_players
    });

    if (!result.success) {
      await updateOrder(supabaseAdmin, order.id, {
        status: 'failed',
        admin_note: result.error || 'Provision failed'
      });
      return res.status(result.status || 500).json({ success: false, error: result.error });
    }

    const updated = await updateOrder(supabaseAdmin, order.id, {
      status: 'active',
      purchased_server_id: result.serverId || null,
      paid_at: new Date().toISOString()
    });

    res.json({
      success: true,
      order: updated,
      provision: result
    });
  } catch (e) {
    console.error('[rental-orders] approve:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/admin/rental-orders/:id/reject', requireAdmin, express.json(), async (req, res) => {
  try {
    const order = await getOrderById(supabaseAdmin, req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Sipariş bulunamadı' });
    if (order.status === 'active') {
      return res.status(400).json({ success: false, error: 'Aktif sipariş reddedilemez' });
    }
    const updated = await updateOrder(supabaseAdmin, order.id, {
      status: 'cancelled',
      admin_note: req.body?.note || 'Reddedildi'
    });
    res.json({ success: true, order: updated });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/admin/stripe', requireAdmin, (req, res) => {
  res.status(410).json({
    success: false,
    error: 'Stripe kaldırıldı. Ödeme ENPARA havale/EFT ile yapılıyor.'
  });
});

app.get('/api/admin/overview', requireAdmin, async (req, res) => {
  try {
    const containers = await docker.listContainers({ all: true, filters: { label: ['cs-web-game=true'] } });
    const running = containers.filter(c => c.State === 'running');
    let totalPlayers = 0;
    let realPlayers = 0;
    let botPlayers = 0;

    const breakdowns = await Promise.all(running.map(async (c) => {
      const portData = c.Ports?.find(p => p.PrivatePort === 27015 && p.Type === 'udp');
      const port = portData?.PublicPort;
      if (!port) return null;
      if (typeof countPlayersBreakdown === 'function') {
        return countPlayersBreakdown(port);
      }
      const a2s = await queryA2S('127.0.0.1', port).catch(() => null);
      return a2s
        ? { players: a2s.players || 0, realPlayers: 0, botPlayers: a2s.players || 0 }
        : null;
    }));

    for (const b of breakdowns) {
      if (!b) continue;
      totalPlayers += b.players || 0;
      realPlayers += b.realPlayers || 0;
      botPlayers += b.botPlayers || 0;
    }

    let usersCount = 0;
    let dbServersCount = 0;
    let pendingOrders = 0;
    let adminProfiles = 0;
    if (supabaseAdmin) {
      const safeCount = async (builder) => {
        try {
          const { count, error } = await builder;
          if (error) return 0;
          return count || 0;
        } catch (_) { return 0; }
      };
      [usersCount, dbServersCount, pendingOrders, adminProfiles] = await Promise.all([
        safeCount(supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true })),
        safeCount(supabaseAdmin.from('purchased_servers').select('id', { count: 'exact', head: true })),
        safeCount(supabaseAdmin.from('rental_orders').select('id', { count: 'exact', head: true }).eq('status', 'pending_payment')),
        safeCount(supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin'))
      ]);
    }

    res.json({
      success: true,
      overview: {
        activeServers: running.length,
        totalContainers: containers.length,
        totalPlayers,
        realPlayers,
        botPlayers,
        usersCount,
        dbServersCount,
        pendingOrders,
        adminProfiles
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/admin/servers', requireAdmin, async (req, res) => {
  try {
    // Reuse live list then enrich with owner usernames from DB
    const containers = await docker.listContainers({ all: true, filters: { label: ['cs-web-game=true'] } });
    let dbServers = [];
    if (supabaseAdmin) {
      const { data, error } = await supabaseAdmin.from('purchased_servers').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      dbServers = data || [];
    }

    const ownerIds = [...new Set(dbServers.map(r => r.owner_id).filter(Boolean))];
    let profileMap = new Map();
    if (supabaseAdmin && ownerIds.length) {
      const { data: profiles } = await supabaseAdmin.from('profiles').select('id, username, role, is_premium').in('id', ownerIds);
      profileMap = new Map((profiles || []).map(p => [p.id, p]));
    }

    const portToDb = new Map();
    dbServers.forEach(row => { if (row.port) portToDb.set(row.port, row); });
    const seenPorts = new Set();

    const servers = await Promise.all(containers.map(async (c) => {
      const port = portFromContainer(c);
      const dbRow = port ? portToDb.get(port) : (dbServers.find(r => r.container_id && c.Id.startsWith(r.container_id)) || null);
      if (port) seenPorts.add(port);

      let currentMap = c.Labels?.mapName || dbRow?.map || 'de_dust2';
      let currentPlayers = 0;
      let realPlayers = 0;
      let botPlayers = 0;
      if (c.State === 'running' && port) {
        if (typeof countPlayersBreakdown === 'function') {
          const br = await countPlayersBreakdown(port, dbRow?.rcon_password || null);
          currentMap = br.map || currentMap;
          currentPlayers = br.players || 0;
          realPlayers = br.realPlayers || 0;
          botPlayers = br.botPlayers || 0;
        } else {
          const a2s = await queryA2S('127.0.0.1', port);
          if (a2s?.map) { currentMap = a2s.map; currentPlayers = a2s.players || 0; }
        }
      }
      const owner = dbRow?.owner_id ? profileMap.get(dbRow.owner_id) : null;
      return {
        id: dbRow?.id || c.Id,
        serverId: dbRow?.id || null,
        containerId: c.Id,
        name: c.Labels?.serverName || dbRow?.name || 'CS Server',
        map: currentMap,
        players: currentPlayers,
        realPlayers,
        botPlayers,
        maxplayers: parseInt(c.Labels?.maxPlayers, 10) || dbRow?.max_players || 16,
        port,
        isOfficial: c.Labels?.isOfficial === 'true',
        owner_id: c.Labels?.owner_id || dbRow?.owner_id || null,
        owner_username: owner?.username || null,
        owner_role: owner?.role || null,
        state: normalizeServerState(c.State),
        status: normalizeServerState(c.State),
        created_at: dbRow?.created_at || null,
        expires_at: dbRow?.expires_at || null,
        rcon_password: dbRow?.rcon_password || null,
        admin_name: dbRow?.admin_name || null,
        start_money: dbRow?.start_money ?? null,
        gravity: dbRow?.gravity ?? null,
        round_time: dbRow?.round_time ?? null
      };
    }));

    for (const dbRow of dbServers) {
      if (dbRow.port && seenPorts.has(dbRow.port)) continue;
      const owner = dbRow.owner_id ? profileMap.get(dbRow.owner_id) : null;
      servers.push({
        id: dbRow.id,
        serverId: dbRow.id,
        containerId: dbRow.container_id || null,
        name: dbRow.name,
        map: dbRow.map || 'de_dust2',
        players: 0,
        realPlayers: 0,
        botPlayers: 0,
        maxplayers: dbRow.max_players || 16,
        port: dbRow.port,
        isOfficial: false,
        owner_id: dbRow.owner_id,
        owner_username: owner?.username || null,
        owner_role: owner?.role || null,
        state: 'stopped',
        status: 'stopped',
        created_at: dbRow.created_at || null,
        expires_at: dbRow.expires_at || null,
        rcon_password: dbRow.rcon_password || null,
        admin_name: dbRow.admin_name || null,
        start_money: dbRow.start_money ?? null,
        gravity: dbRow.gravity ?? null,
        round_time: dbRow.round_time ?? null
      });
    }

    res.json({ success: true, servers });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.patch('/api/admin/servers/:id', requireAdmin, express.json(), async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(500).json({ success: false, error: 'Supabase yok' });
    const { id } = req.params;
    const allowed = ['name', 'map', 'max_players', 'status', 'expires_at', 'rcon_password', 'admin_name', 'admin_password', 'start_money', 'gravity', 'round_time', 'port'];
    const patch = {};
    for (const key of allowed) {
      if (req.body?.[key] !== undefined) patch[key] = req.body[key];
    }
    if (!Object.keys(patch).length) {
      return res.status(400).json({ success: false, error: 'Güncellenecek alan yok' });
    }
    const { data, error } = await supabaseAdmin
      .from('purchased_servers')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    res.json({ success: true, server: data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(500).json({ success: false, error: 'Supabase yok' });
    const q = String(req.query.q || '').trim();
    const { data, error } = await selectAdminUsers(q);
    if (error) throw error;

    const userIds = (data || []).map(u => u.id);
    const serverCounts = {};
    if (userIds.length) {
      const { data: servers } = await supabaseAdmin
        .from('purchased_servers')
        .select('owner_id')
        .in('owner_id', userIds);
      for (const s of servers || []) {
        serverCounts[s.owner_id] = (serverCounts[s.owner_id] || 0) + 1;
      }
    }

    res.json({
      success: true,
      banColumns: _banColsAvailable,
      prices: VIP_PRICES_TRY,
      users: (data || []).map(u => mapAdminUserRow(u, serverCounts)),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.patch('/api/admin/users/:id', requireAdmin, express.json(), async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(500).json({ success: false, error: 'Supabase yok' });
    const { id } = req.params;
    const cols = _banColsAvailable ? ADMIN_USER_COLS : ADMIN_USER_COLS_NO_BAN;
    const { data: current, error: curErr } = await supabaseAdmin
      .from('profiles')
      .select(cols)
      .eq('id', id)
      .maybeSingle();
    if (curErr) throw curErr;
    if (!current) return res.status(404).json({ success: false, error: 'Kullanıcı yok' });

    const patch = {};
    if (req.body?.username !== undefined) {
      const uname = String(req.body.username || '').trim();
      const RESERVED_ID = 'd4722d7f-d60a-45ba-951f-167a03ee3e03';
      if (nickContainsBrowserCS(uname)) {
        const nickOk = id === RESERVED_ID && uname === PLATFORM_ADMIN_NAME;
        if (!nickOk) {
          return res.status(400).json({
            success: false,
            error: '"browsercs" içeren kullanıcı adları saklıdır. Yalnızca resmi hesap BrowserCS olabilir.',
          });
        }
      }
      if (!uname) return res.status(400).json({ success: false, error: 'Kullanıcı adı boş olamaz' });
      patch.username = uname;
    }
    if (req.body?.role !== undefined) {
      if (!['user', 'vip', 'admin'].includes(req.body.role)) {
        return res.status(400).json({ success: false, error: 'Geçersiz rol (user|vip|admin)' });
      }
      patch.role = req.body.role;
    }
    if (req.body?.is_premium !== undefined) patch.is_premium = !!req.body.is_premium;
    if (req.body?.wallet_balance !== undefined) {
      patch.wallet_balance = Math.max(0, Number(req.body.wallet_balance) || 0);
    }
    if (req.body?.admin_notes !== undefined) {
      if (!_banColsAvailable) {
        return res.status(503).json({
          success: false,
          error: 'admin_notes için migrations/20260721_user_bans.sql uygulanmalı',
        });
      }
      patch.admin_notes = req.body.admin_notes == null
        ? null
        : String(req.body.admin_notes).slice(0, 1000);
    }

    const vipResult = await applyVipPatch(id, req.body || {}, current);
    if (vipResult.error) {
      return res.status(400).json({ success: false, error: vipResult.error });
    }
    Object.assign(patch, vipResult.patch || {});

    if (!Object.keys(patch).length) {
      return res.status(400).json({ success: false, error: 'Güncellenecek alan yok' });
    }

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update(patch)
      .eq('id', id)
      .select(cols)
      .single();
    if (error) throw error;
    res.json({ success: true, user: mapAdminUserRow(data) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/admin/users/:id/ban', requireAdmin, express.json(), async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(500).json({ success: false, error: 'Supabase yok' });
    if (!_banColsAvailable) {
      return res.status(503).json({
        success: false,
        error: 'Ban alanları yok — Supabase SQL Editor’da migrations/20260721_user_bans.sql uygulayın',
      });
    }
    const { id } = req.params;
    const reason = String(req.body?.reason || req.body?.ban_reason || '').trim().slice(0, 500);
    const permanent = req.body?.permanent === true || req.body?.permanent === '1';
    let bannedUntil = null;
    if (!permanent) {
      if (req.body?.banned_until) {
        const d = new Date(req.body.banned_until);
        if (!Number.isFinite(d.getTime())) {
          return res.status(400).json({ success: false, error: 'Geçersiz banned_until' });
        }
        bannedUntil = d.toISOString();
      } else {
        const days = Math.min(3650, Math.max(1, parseInt(req.body?.days, 10) || 7));
        bannedUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      }
    }
    const patch = {
      is_banned: true,
      banned_until: bannedUntil,
      ban_reason: reason || 'Yönetici tarafından yasaklandı',
    };
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update(patch)
      .eq('id', id)
      .select(ADMIN_USER_COLS)
      .maybeSingle();
    if (error) {
      if (isMissingColumnError(error)) {
        _banColsAvailable = false;
        return res.status(503).json({
          success: false,
          error: 'Ban alanları yok — migrations/20260721_user_bans.sql uygulayın',
        });
      }
      throw error;
    }
    if (!data) return res.status(404).json({ success: false, error: 'Kullanıcı yok' });
    res.json({ success: true, user: mapAdminUserRow(data), message: banRejectMessage(data) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/admin/users/:id/unban', requireAdmin, express.json(), async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(500).json({ success: false, error: 'Supabase yok' });
    if (!_banColsAvailable) {
      return res.status(503).json({
        success: false,
        error: 'Ban alanları yok — migrations/20260721_user_bans.sql uygulayın',
      });
    }
    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update({ is_banned: false, banned_until: null, ban_reason: null })
      .eq('id', id)
      .select(ADMIN_USER_COLS)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Kullanıcı yok' });
    res.json({ success: true, user: mapAdminUserRow(data) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * Soft-delete / deactivate: permanent ban + note.
 * hard=1 also deletes auth.users (cascades profile if FK ON DELETE CASCADE).
 */
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(500).json({ success: false, error: 'Supabase yok' });
    const { id } = req.params;
    const hard = req.query.hard === '1' || req.query.hard === 'true';
    const RESERVED_ID = 'd4722d7f-d60a-45ba-951f-167a03ee3e03';
    if (id === RESERVED_ID) {
      return res.status(400).json({ success: false, error: 'Platform hesabı silinemez' });
    }

    const { data: current, error: curErr } = await supabaseAdmin
      .from('profiles')
      .select(_banColsAvailable ? ADMIN_USER_COLS : ADMIN_USER_COLS_NO_BAN)
      .eq('id', id)
      .maybeSingle();
    if (curErr) throw curErr;
    if (!current) return res.status(404).json({ success: false, error: 'Kullanıcı yok' });
    if ((current.role || '') === 'admin') {
      return res.status(400).json({ success: false, error: 'Admin hesabı silinemez — önce rolü düşürün' });
    }

    if (hard) {
      const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(id);
      if (delErr) throw delErr;
      // Profile may remain if no cascade — remove explicitly
      await supabaseAdmin.from('profiles').delete().eq('id', id);
      return res.json({ success: true, action: 'hard_deleted', id });
    }

    if (!_banColsAvailable) {
      return res.status(503).json({
        success: false,
        error: 'Pasifleştirme için ban alanları gerekli — migrations/20260721_user_bans.sql uygulayın (veya ?hard=1)',
      });
    }

    const note = String(req.query.reason || 'Hesap admin tarafından kapatıldı').slice(0, 500);
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update({
        is_banned: true,
        banned_until: null,
        ban_reason: note,
        admin_notes: [current.admin_notes, `[silindi] ${new Date().toISOString()} ${note}`]
          .filter(Boolean)
          .join('\n')
          .slice(0, 1000),
        vip_tier: 'none',
        vip_expires_at: null,
        vip_clan_tag: null,
      })
      .eq('id', id)
      .select(ADMIN_USER_COLS)
      .maybeSingle();
    if (error) throw error;
    res.json({ success: true, action: 'deactivated', user: mapAdminUserRow(data) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/admin/server-admins', requireAdmin, async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(500).json({ success: false, error: 'Supabase yok' });
    const serverId = req.query.server_id || null;

    // Prefer table; fallback: walk purchased_servers and listServerAdmins
    const { data: tableProbe, error: probeErr } = await supabaseAdmin.from('server_admins').select('id').limit(1);
    const tableOk = !probeErr;

    if (tableOk) {
      let q = supabaseAdmin
        .from('server_admins')
        .select('id, server_id, user_id, game_name, amx_password, flags, created_at, created_by')
        .order('created_at', { ascending: false })
        .limit(500);
      if (serverId) q = q.eq('server_id', serverId);
      const { data, error } = await q;
      if (error) throw error;

      const userIds = [...new Set((data || []).flatMap(r => [r.user_id, r.created_by].filter(Boolean)))];
      const serverIds = [...new Set((data || []).map(r => r.server_id).filter(Boolean))];
      let profiles = new Map();
      let servers = new Map();
      if (userIds.length) {
        const { data: p } = await supabaseAdmin.from('profiles').select('id, username').in('id', userIds);
        profiles = new Map((p || []).map(x => [x.id, x.username]));
      }
      if (serverIds.length) {
        const { data: s } = await supabaseAdmin.from('purchased_servers').select('id, name, port').in('id', serverIds);
        servers = new Map((s || []).map(x => [x.id, x]));
      }

      return res.json({
        success: true,
        admins: (data || []).map(r => ({
          id: r.id,
          server_id: r.server_id,
          server_name: servers.get(r.server_id)?.name || null,
          port: servers.get(r.server_id)?.port || null,
          user_id: r.user_id,
          username: profiles.get(r.user_id) || null,
          game_name: r.game_name,
          amx_password: r.amx_password,
          flags: r.flags,
          created_at: r.created_at,
          created_by: r.created_by,
          created_by_username: profiles.get(r.created_by) || null
        }))
      });
    }

    // Storage fallback
    const { data: allServers } = await supabaseAdmin.from('purchased_servers').select('id, name, port').limit(200);
    const admins = [];
    for (const s of allServers || []) {
      if (serverId && s.id !== serverId) continue;
      const list = await listServerAdmins(supabaseAdmin, s.id);
      for (const a of list) {
        admins.push({
          id: a.id,
          server_id: s.id,
          server_name: s.name,
          port: s.port,
          user_id: a.userId || null,
          username: a.username || null,
          game_name: a.name,
          amx_password: a.password,
          flags: a.flags,
          created_at: a.createdAt || null,
          created_by: null,
          created_by_username: null
        });
      }
    }
    res.json({ success: true, admins });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/admin/server-admins/:id', requireAdmin, async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(500).json({ success: false, error: 'Supabase yok' });
    const { error } = await supabaseAdmin.from('server_admins').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** Master admin: tek sunucuyu Docker restart */
app.post('/api/admin/servers/:id/restart', requireAdmin, async (req, res) => {
  try {
    const target = await resolveAdminServerTarget(req.params.id);
    if (!target.containerId) {
      return res.status(404).json({ success: false, error: 'Konteyner bulunamadı' });
    }
    await docker.getContainer(target.containerId).restart();
    res.json({
      success: true,
      port: target.port,
      containerId: target.containerId,
      isOfficial: !!target.isOfficial
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** Master admin: sunucuyu kapat (docker stop) */
app.post('/api/admin/servers/:id/stop', requireAdmin, async (req, res) => {
  try {
    const target = await resolveAdminServerTarget(req.params.id);
    if (!target.containerId) {
      return res.status(404).json({ success: false, error: 'Konteyner bulunamadı' });
    }
    const container = docker.getContainer(target.containerId);
    const info = await container.inspect().catch(() => null);
    if (info?.State?.Running) {
      await container.stop({ t: 5 });
    }
    if (Number(target.port) === OFFICIAL_DM_PORT) {
      setOfficialDmEnabled(false);
    }
    res.json({
      success: true,
      action: 'stop',
      port: target.port,
      containerId: target.containerId,
      isOfficial: !!target.isOfficial,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** Master admin: sunucuyu aç (docker start) */
app.post('/api/admin/servers/:id/start', requireAdmin, async (req, res) => {
  try {
    const target = await resolveAdminServerTarget(req.params.id);
    if (!target.containerId) {
      return res.status(404).json({ success: false, error: 'Konteyner bulunamadı' });
    }
    if (Number(target.port) === OFFICIAL_DM_PORT) {
      setOfficialDmEnabled(true);
    }
    const container = docker.getContainer(target.containerId);
    const info = await container.inspect().catch(() => null);
    if (!info?.State?.Running) {
      await container.start();
    }
    res.json({
      success: true,
      action: 'start',
      port: target.port,
      containerId: target.containerId,
      isOfficial: !!target.isOfficial,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** Master admin: tüm cs-web-game sunucularını yeniden başlat */
app.post('/api/admin/servers/restart-all', requireAdmin, async (req, res) => {
  try {
    const containers = await docker.listContainers({
      all: true,
      filters: { label: ['cs-web-game=true'] }
    });
    const results = [];
    for (const c of containers) {
      const name = (c.Names && c.Names[0]) ? c.Names[0].replace(/^\//, '') : c.Id.slice(0, 12);
      const port = c.Ports?.find((p) => p.PrivatePort === 27015)?.PublicPort || null;
      try {
        await docker.getContainer(c.Id).restart();
        results.push({ name, port, ok: true });
      } catch (err) {
        results.push({ name, port, ok: false, error: err.message });
      }
    }
    const ok = results.filter((r) => r.ok).length;
    res.json({
      success: true,
      restarted: ok,
      failed: results.length - ok,
      total: results.length,
      results
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** Master admin: sunucu başına YaPB bot ekle / çıkar */
app.post('/api/admin/servers/:id/bots', requireAdmin, express.json(), async (req, res) => {
  try {
    if (typeof sendRcon !== 'function') {
      return res.status(500).json({ success: false, error: 'RCON servisi yok' });
    }
    const action = String(req.body?.action || '').toLowerCase();
    if (!['add', 'remove', 'kickall'].includes(action)) {
      return res.status(400).json({ success: false, error: 'action: add | remove | kickall' });
    }

    const target = await resolveAdminServerTarget(req.params.id);
    const cmd =
      action === 'add' ? 'yb add' :
      action === 'kickall' ? 'yb kickall instant' :
      'yb kick';

    // Quota ile kalıcı tut: add/remove sonrası yb_quota da ayarla (best-effort)
    const response = await sendRcon('127.0.0.1', target.port, target.rconPassword, cmd);

    if (action === 'add' || action === 'remove') {
      try {
        const cfgPath = `/home/ubuntu/server_configs/${target.port}/server.cfg`;
        const fs = require('fs');
        if (fs.existsSync(cfgPath)) {
          let cfg = fs.readFileSync(cfgPath, 'utf8');
          const m = cfg.match(/^yb_quota\s+(\d+)/m);
          let q = m ? parseInt(m[1], 10) : 0;
          if (!Number.isFinite(q)) q = 0;
          q = action === 'add' ? Math.min(32, q + 1) : Math.max(0, q - 1);
          if (/^yb_quota\s+/m.test(cfg)) {
            cfg = cfg.replace(/^yb_quota\s+\d+/m, `yb_quota ${q}`);
          } else {
            cfg += `\nyb_quota_mode "normal"\nyb_quota ${q}\n`;
          }
          fs.writeFileSync(cfgPath, cfg);
          await sendRcon('127.0.0.1', target.port, target.rconPassword, `yb_quota ${q}`);
        }
      } catch (_) { /* ignore quota persist */ }
    }

    res.json({
      success: true,
      port: target.port,
      action,
      command: cmd,
      response: response || ''
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

  // ── Site CMS ──────────────────────────────────────────────────────────
  app.get('/api/admin/site-content', requireAdmin, (req, res) => {
    try {
      const content = siteContent.readContent();
      res.json({ success: true, content });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.put('/api/admin/site-settings', requireAdmin, express.json(), (req, res) => {
    try {
      const content = siteContent.readContent();
      const patch = req.body || {};
      content.settings = { ...content.settings, ...patch };
      if (Array.isArray(req.body?.staticPages)) {
        content.staticPages = req.body.staticPages;
      }
      const saved = siteContent.writeContent(content);
      res.json({ success: true, settings: saved.settings, staticPages: saved.staticPages, updatedAt: saved.updatedAt });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/admin/maps', requireAdmin, (req, res) => {
    try {
      const content = siteContent.readContent();
      res.json({ success: true, maps: content.maps, updatedAt: content.updatedAt });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.put('/api/admin/maps', requireAdmin, express.json(), (req, res) => {
    try {
      const content = siteContent.readContent();
      const list = Array.isArray(req.body?.maps) ? req.body.maps : null;
      if (!list) return res.status(400).json({ success: false, error: 'maps dizisi gerekli' });
      content.maps = list.map((m) => siteContent.normalizeMap(m));
      const saved = siteContent.writeContent(content);
      res.json({ success: true, maps: saved.maps, updatedAt: saved.updatedAt });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/admin/maps', requireAdmin, express.json(), (req, res) => {
    try {
      const content = siteContent.readContent();
      const map = siteContent.normalizeMap(req.body || {});
      if (content.maps.some((m) => m.name === map.name || m.slug === map.slug)) {
        return res.status(409).json({ success: false, error: 'Bu harita zaten var' });
      }
      content.maps.push(map);
      const saved = siteContent.writeContent(content);
      res.json({ success: true, map, maps: saved.maps });
    } catch (e) {
      res.status(400).json({ success: false, error: e.message });
    }
  });

  app.patch('/api/admin/maps/:name', requireAdmin, express.json(), (req, res) => {
    try {
      const content = siteContent.readContent();
      const key = decodeURIComponent(req.params.name);
      const idx = content.maps.findIndex((m) => m.name === key || m.slug === key);
      if (idx < 0) return res.status(404).json({ success: false, error: 'Harita bulunamadı' });
      content.maps[idx] = siteContent.normalizeMap(req.body || {}, content.maps[idx]);
      const saved = siteContent.writeContent(content);
      res.json({ success: true, map: saved.maps[idx], maps: saved.maps });
    } catch (e) {
      res.status(400).json({ success: false, error: e.message });
    }
  });

  app.delete('/api/admin/maps/:name', requireAdmin, (req, res) => {
    try {
      const content = siteContent.readContent();
      const key = decodeURIComponent(req.params.name);
      const before = content.maps.length;
      content.maps = content.maps.filter((m) => m.name !== key && m.slug !== key);
      if (content.maps.length === before) {
        return res.status(404).json({ success: false, error: 'Harita bulunamadı' });
      }
      const saved = siteContent.writeContent(content);
      res.json({ success: true, maps: saved.maps });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/admin/sitemap.xml', requireAdmin, (req, res) => {
    try {
      const xml = siteContent.buildSitemapXml();
      res.type('application/xml').send(xml);
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/admin/sitemap/regenerate', requireAdmin, (req, res) => {
    try {
      const content = siteContent.readContent();
      content.updatedAt = new Date().toISOString();
      siteContent.writeContent(content);
      const xml = siteContent.buildSitemapXml(content);
      res.json({
        success: true,
        xml,
        urlCount: (xml.match(/<url>/g) || []).length,
        updatedAt: content.updatedAt,
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return { requireAdmin };
}

module.exports = { registerAdminRoutes };
