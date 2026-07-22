/**
 * VIP subscription API — ticket, prices, admin grant/list/revoke.
 * Payment checkout deferred; Master Admin grant is fulfillment.
 */
const {
  VIP_PRICES_TRY,
  VIP_LABELS_TR,
  VIP_FEATURES,
  VIP_TIERS,
  VIP_CLAN_TAG_FIXED,
  normalizeVipTier,
  isActiveVip,
  daysLeft,
} = require('../lib/vipConstants');
const { issueVipTicket } = require('../lib/vipSessions');
const vipOrders = require('../lib/vipOrders');
const {
  QUOTA_PER_MONTH,
  ALLOWED_MAPS,
  usageFor,
  suggestMap,
  listPendingQueue,
} = require('../lib/vipMapSuggest');

const VIP_PROFILE_COLS =
  'id, username, role, vip_tier, vip_expires_at, vip_granted_at, vip_granted_by, vip_notes';

/** Clan tag artık kullanıcıya özel değil — Platinum'da her zaman sabit [BCS]. */
function publicVipStatus(profile) {
  const active = isActiveVip(profile);
  const tier = active ? normalizeVipTier(profile.vip_tier) : 'none';
  return {
    tier: tier || 'none',
    active,
    expiresAt: profile?.vip_expires_at || null,
    clanTag: tier === 'platinum' ? VIP_CLAN_TAG_FIXED : '',
    label: VIP_LABELS_TR[tier || 'none'] || 'Yok',
    daysLeft: active ? daysLeft(profile?.vip_expires_at) : 0,
    pricesTry: VIP_PRICES_TRY,
  };
}

/** Grant/extend/revoke ortak mantığı — hem admin panel hem sipariş onayı bunu kullanır. */
async function applyVipGrant(supabaseAdmin, { userId, tier, days, action, notes, grantedBy }) {
  const { data: current, error: curErr } = await supabaseAdmin
    .from('profiles')
    .select(VIP_PROFILE_COLS)
    .eq('id', userId)
    .maybeSingle();
  if (curErr) throw curErr;
  if (!current) return { error: { status: 404, message: 'Profil yok' } };

  const now = new Date();
  let normTier = normalizeVipTier(tier);
  if (action === 'revoke') normTier = 'none';
  if (action === 'extend' && (!normTier || normTier === 'none')) {
    normTier = normalizeVipTier(current.vip_tier);
  }
  if (action !== 'revoke' && (!normTier || normTier === 'none')) {
    return { error: { status: 400, message: 'tier: silver|gold|platinum gerekli' } };
  }

  let expiresAt = null;
  if (normTier && normTier !== 'none') {
    let base = now;
    if (action === 'extend' && isActiveVip(current, now)) {
      const curExp = new Date(current.vip_expires_at);
      if (curExp.getTime() > now.getTime()) base = curExp;
    }
    const d = Math.min(366, Math.max(1, parseInt(days, 10) || 30));
    expiresAt = new Date(base.getTime() + d * 24 * 60 * 60 * 1000).toISOString();
  }

  const patch = {
    vip_tier: normTier || 'none',
    vip_expires_at: expiresAt,
    vip_granted_at: now.toISOString(),
    vip_granted_by: grantedBy || 'admin',
    vip_notes: notes != null ? String(notes).slice(0, 500) : current.vip_notes || null,
  };
  if (normTier && normTier !== 'none') {
    if ((current.role || 'user') !== 'admin') patch.role = 'vip';
  } else if ((current.role || '') === 'vip') {
    patch.role = 'user';
  }

  const { data: updated, error } = await supabaseAdmin
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select(VIP_PROFILE_COLS + ', role')
    .maybeSingle();
  if (error) throw error;
  if (!updated) return { error: { status: 404, message: 'Profil yok' } };
  return { updated };
}

async function resolveUserId(supabaseAdmin, body) {
  let userId = String(body?.userId || '').trim().toLowerCase();
  const username = String(body?.username || '').trim();

  if (!userId && username) {
    const { data: found, error: findErr } = await supabaseAdmin
      .from('profiles')
      .select('id, username')
      .ilike('username', username)
      .limit(1)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!found?.id) {
      return { error: { status: 404, message: 'Kullanıcı bulunamadı' } };
    }
    userId = found.id;
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    return { error: { status: 400, message: 'userId veya username gerekli' } };
  }
  return { userId };
}

function registerVipRoutes(app, ctx = {}) {
  const { supabaseAdmin, requireAuth, requireAdmin, express } = ctx;
  const json = express?.json ? express.json() : (_req, _res, next) => next();

  /** Public package prices + feature lists (no secrets) */
  app.get('/api/vip/prices', (_req, res) => {
      res.json({
        success: true,
        currency: 'TRY',
        interval: 'month',
        prices: VIP_PRICES_TRY,
        labels: VIP_LABELS_TR,
        features: VIP_FEATURES,
        tiers: VIP_TIERS.filter((t) => t !== 'none'),
        mapSuggest: {
          quotaPerMonth: QUOTA_PER_MONTH,
          allowedMaps: ALLOWED_MAPS,
          requiresTier: ['platinum'],
        },
        vipRoom: {
          minTier: 'gold',
          note: 'VIP ODA — sadece Gold ve Platinum girebilir',
        },
        paymentNote: 'Online ödeme yakında. Şimdilik abonelik Master Admin tarafından tanımlanır.',
      });
    });

  /** Current user's VIP status */
  app.get('/api/me/vip', requireAuth, async (req, res) => {
    try {
      if (!supabaseAdmin) {
        return res.status(503).json({ success: false, error: 'Veritabanı yok' });
      }
      const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select(VIP_PROFILE_COLS)
        .eq('id', req.user.id)
        .maybeSingle();
      if (error) throw error;
      const vip = publicVipStatus(profile);
      const mapSuggest =
        vip.active && vip.tier === 'platinum'
          ? usageFor(req.user.id)
          : {
              month: null,
              used: 0,
              remaining: 0,
              quota: QUOTA_PER_MONTH,
              items: [],
              locked: true,
            };
      res.json({ success: true, vip, mapSuggest });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /** Platinum — ayda 4 votemap harita önerisi */
  app.get('/api/me/vip/map-suggest', requireAuth, async (req, res) => {
    try {
      if (!supabaseAdmin) {
        return res.status(503).json({ success: false, error: 'Veritabanı yok' });
      }
      const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select(VIP_PROFILE_COLS)
        .eq('id', req.user.id)
        .maybeSingle();
      if (error) throw error;
      if (!isActiveVip(profile) || normalizeVipTier(profile.vip_tier) !== 'platinum') {
        return res.status(403).json({
          success: false,
          error: 'Harita önerisi sadece aktif Platinum VIP için',
          allowedMaps: ALLOWED_MAPS,
          quota: QUOTA_PER_MONTH,
        });
      }
      res.json({
        success: true,
        allowedMaps: ALLOWED_MAPS,
        usage: usageFor(req.user.id),
        pending: listPendingQueue(10),
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/me/vip/map-suggest', requireAuth, json, async (req, res) => {
    try {
      if (!supabaseAdmin) {
        return res.status(503).json({ success: false, error: 'Veritabanı yok' });
      }
      const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select(VIP_PROFILE_COLS)
        .eq('id', req.user.id)
        .maybeSingle();
      if (error) throw error;
      if (!isActiveVip(profile) || normalizeVipTier(profile.vip_tier) !== 'platinum') {
        return res.status(403).json({
          success: false,
          error: 'Harita önerisi sadece aktif Platinum VIP için',
        });
      }
      const result = suggestMap({
        userId: req.user.id,
        map: req.body?.map,
        port: req.body?.port,
      });
      if (!result.ok) {
        return res.status(result.status || 400).json({
          success: false,
          error: result.error,
          usage: result.usage || usageFor(req.user.id),
        });
      }
      res.json({
        success: true,
        map: result.map,
        port: result.port,
        usage: result.usage,
        message:
          `${result.map} sıradaki votemap oylamasına eklendi. Bu ay kalan hak: ${result.usage.remaining}/${result.usage.quota}`,
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /**
   * Açılış kampanyası — 15 Ağustos 2026'ya kadar kayıt olan her hesaba
   * OTOMATİK 30 gün Gold. İstemci girişten hemen sonra çağırır.
   * Daha önce promo ile Silver almış aktif hesaplar Gold'a yükseltilir.
   * Başka VIP tanımı yapılmış hesaba ikinci kez verilmez.
   */
  const PROMO_GOLD_DEADLINE_MS = Date.parse('2026-08-15T23:59:59+03:00');
  const PROMO_GOLD_DAYS = 30;

  app.post('/api/me/vip/promo-claim', requireAuth, async (req, res) => {
    try {
      if (!supabaseAdmin) {
        return res.status(503).json({ success: false, error: 'Veritabanı yok' });
      }

      const createdAtMs = Date.parse(req.user.created_at || '');
      if (!Number.isFinite(createdAtMs) || createdAtMs > PROMO_GOLD_DEADLINE_MS) {
        return res.json({ success: true, claimed: false, reason: 'kampanya-disi' });
      }

      const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select(VIP_PROFILE_COLS)
        .eq('id', req.user.id)
        .maybeSingle();
      if (error) throw error;
      if (!profile) {
        return res.status(404).json({ success: false, error: 'Profil yok' });
      }

      // Kampanya Silver → Gold yükseltme (kalan süre korunur)
      if (
        profile.vip_granted_by === 'promo-aug15' &&
        normalizeVipTier(profile.vip_tier) === 'silver' &&
        isActiveVip(profile)
      ) {
        const left = Math.max(1, daysLeft(profile.vip_expires_at));
        const upgraded = await applyVipGrant(supabaseAdmin, {
          userId: req.user.id,
          tier: 'gold',
          days: left,
          action: 'grant',
          notes: 'Açılış kampanyası — Silver→Gold yükseltme (15 Ağustos 2026)',
          grantedBy: 'promo-aug15',
        });
        if (upgraded.error) {
          return res.status(upgraded.error.status).json({ success: false, error: upgraded.error.message });
        }
        console.log(`[VIP Promo] Silver→Gold yükseltildi: ${profile.username || req.user.id} (${left} gün)`);
        return res.json({
          success: true,
          claimed: true,
          upgraded: true,
          vip: publicVipStatus(upgraded.updated),
        });
      }

      if (profile.vip_granted_at || isActiveVip(profile)) {
        return res.json({
          success: true,
          claimed: false,
          reason: 'zaten-tanimli',
          vip: publicVipStatus(profile),
        });
      }

      const result = await applyVipGrant(supabaseAdmin, {
        userId: req.user.id,
        tier: 'gold',
        days: PROMO_GOLD_DAYS,
        action: 'grant',
        notes: 'Açılış kampanyası — 30 gün Gold hediye (15 Ağustos 2026)',
        grantedBy: 'promo-aug15',
      });
      if (result.error) {
        return res.status(result.error.status).json({ success: false, error: result.error.message });
      }

      console.log(`[VIP Promo] 30 gün Gold tanımlandı: ${profile.username || req.user.id}`);
      res.json({ success: true, claimed: true, vip: publicVipStatus(result.updated) });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /**
   * Short-lived VIP ticket for game connect.
   * Only issued when subscription is active.
   */
  app.post('/api/me/vip-ticket', requireAuth, async (req, res) => {
    try {
      const port = parseInt(req.body?.port ?? req.query.port, 10);
      if (!Number.isFinite(port) || port < 1) {
        return res.status(400).json({ success: false, error: 'port gerekli' });
      }
      if (!supabaseAdmin) {
        return res.status(503).json({ success: false, error: 'Veritabanı yok' });
      }

      const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select(VIP_PROFILE_COLS)
        .eq('id', req.user.id)
        .maybeSingle();
      if (error) throw error;

      if (!isActiveVip(profile)) {
        return res.status(403).json({
          success: false,
          error: 'Aktif VIP aboneliği yok',
          vip: publicVipStatus(profile),
        });
      }

      let displayName =
        profile?.username ||
        req.user.user_metadata?.username ||
        req.user.email?.split('@')[0] ||
        'Oyuncu';

      const issued = issueVipTicket({
        userId: req.user.id,
        displayName,
        port,
        tier: profile.vip_tier,
      });

      res.json({
        success: true,
        ticket: issued.ticket,
        expiresAt: issued.expiresAt,
        expiresIn: issued.expiresIn,
        displayName: issued.displayName,
        tier: issued.tier,
        clanTag: issued.clanTag,
        port: issued.port,
        vip: publicVipStatus(profile),
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /**
   * Admin list — active / recent VIP subscribers + KPI.
   * Query: q, tier (silver|gold|platinum|all), includeExpired=1
   */
  app.get('/api/admin/vip/subscribers', requireAdmin, async (req, res) => {
    try {
      if (!supabaseAdmin) {
        return res.status(503).json({ success: false, error: 'Veritabanı yok' });
      }

      const q = String(req.query.q || '').trim().toLowerCase();
      const tierFilter = String(req.query.tier || 'all').toLowerCase();
      const includeExpired = req.query.includeExpired === '1' || req.query.includeExpired === 'true';
      const now = new Date();
      const soonMs = 7 * 24 * 60 * 60 * 1000;

      const { data: rows, error } = await supabaseAdmin
        .from('profiles')
        .select(VIP_PROFILE_COLS)
        .neq('vip_tier', 'none')
        .order('vip_expires_at', { ascending: true })
        .limit(500);

      if (error) throw error;

      const all = rows || [];
      const stats = {
        silver: 0,
        gold: 0,
        platinum: 0,
        active: 0,
        expired: 0,
        expiringSoon: 0,
      };

      const subscribers = [];
      for (const row of all) {
        const tier = normalizeVipTier(row.vip_tier) || 'none';
        if (tier === 'none') continue;
        const active = isActiveVip(row, now);
        const left = daysLeft(row.vip_expires_at, now);
        const expMs = row.vip_expires_at ? new Date(row.vip_expires_at).getTime() - now.getTime() : 0;
        const expiringSoon = active && expMs > 0 && expMs <= soonMs;

        if (active) {
          stats.active += 1;
          if (tier === 'silver') stats.silver += 1;
          else if (tier === 'gold') stats.gold += 1;
          else if (tier === 'platinum') stats.platinum += 1;
          if (expiringSoon) stats.expiringSoon += 1;
        } else {
          stats.expired += 1;
        }

        if (!includeExpired && !active) continue;
        if (tierFilter !== 'all' && tier !== tierFilter) continue;
        if (q) {
          const hay = `${row.username || ''} ${row.vip_notes || ''} ${row.vip_granted_by || ''}`.toLowerCase();
          if (!hay.includes(q) && !(row.id || '').toLowerCase().includes(q)) continue;
        }

        subscribers.push({
          id: row.id,
          username: row.username,
          tier,
          label: VIP_LABELS_TR[tier] || tier,
          expiresAt: row.vip_expires_at,
          grantedAt: row.vip_granted_at,
          grantedBy: row.vip_granted_by,
          notes: row.vip_notes,
          clanTag: tier === 'platinum' ? VIP_CLAN_TAG_FIXED : '',
          active,
          daysLeft: left,
          expiringSoon,
        });
      }

      res.json({
        success: true,
        stats,
        prices: VIP_PRICES_TRY,
        labels: VIP_LABELS_TR,
        subscribers,
        count: subscribers.length,
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /**
   * Admin grant / extend / change tier / revoke.
   * Body: { userId|username, tier, days?, notes?, action? }
   * action: grant (default) | extend | revoke
   * tier=none or action=revoke → revoke
   * Clan tag artık burada seçilmez — Platinum otomatik sabit [BCS] alır.
   */
  app.post('/api/admin/vip/grant', requireAdmin, json, async (req, res) => {
    try {
      if (!supabaseAdmin) {
        return res.status(503).json({ success: false, error: 'Veritabanı yok' });
      }
      let action = String(req.body?.action || 'grant').toLowerCase().trim();
      if (action === 'revoke' || String(req.body?.tier || '').toLowerCase() === 'none') {
        action = 'revoke';
      }
      const resolved = await resolveUserId(supabaseAdmin, req.body);
      if (resolved.error) {
        return res.status(resolved.error.status).json({ success: false, error: resolved.error.message });
      }
      const result = await applyVipGrant(supabaseAdmin, {
        userId: resolved.userId,
        tier: req.body?.tier,
        days: req.body?.days,
        action,
        notes: req.body?.notes,
        grantedBy: 'admin',
      });
      if (result.error) {
        return res.status(result.error.status).json({ success: false, error: result.error.message });
      }
      const updated = result.updated;
      res.json({
        success: true,
        action,
        vip: publicVipStatus(updated),
        profile: {
          id: updated.id,
          username: updated.username,
          vip_tier: updated.vip_tier,
          vip_expires_at: updated.vip_expires_at,
          vip_granted_by: updated.vip_granted_by,
          vip_notes: updated.vip_notes,
        },
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /** Explicit revoke — same as grant with tier=none */
  app.post('/api/admin/vip/revoke', requireAdmin, json, async (req, res) => {
    try {
      if (!supabaseAdmin) {
        return res.status(503).json({ success: false, error: 'Veritabanı yok' });
      }
      const resolved = await resolveUserId(supabaseAdmin, req.body);
      if (resolved.error) {
        return res.status(resolved.error.status).json({ success: false, error: resolved.error.message });
      }
      const result = await applyVipGrant(supabaseAdmin, {
        userId: resolved.userId,
        action: 'revoke',
        notes: req.body?.notes,
        grantedBy: 'admin',
      });
      if (result.error) {
        return res.status(result.error.status).json({ success: false, error: result.error.message });
      }
      const updated = result.updated;
      res.json({
        success: true,
        action: 'revoke',
        vip: publicVipStatus(updated),
        profile: {
          id: updated.id,
          username: updated.username,
          vip_tier: updated.vip_tier,
          vip_expires_at: updated.vip_expires_at,
        },
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /**
   * VIP satın alma — ENPARA havale/EFT.
   * Kullanıcı paket seçer, sipariş oluşur (pending_payment), banka bilgisi döner.
   * Havale açıklamasına sipariş no yazılır; admin onaylayınca 30 gün otomatik VIP tanımlanır.
   */
  app.get('/api/vip/payment-info', (_req, res) => {
    res.json({ success: true, ...vipOrders.bankInfoFromEnv(), pricesTry: VIP_PRICES_TRY });
  });

  app.post('/api/vip/order', requireAuth, json, async (req, res) => {
    try {
      if (!supabaseAdmin) {
        return res.status(503).json({ success: false, error: 'Veritabanı yok' });
      }
      const tier = normalizeVipTier(req.body?.tier);
      if (!tier || tier === 'none') {
        return res.status(400).json({ success: false, error: 'Paket seçin: silver | gold | platinum' });
      }
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id, username')
        .eq('id', req.user.id)
        .maybeSingle();
      const order = await vipOrders.createOrder(supabaseAdmin, {
        ownerId: req.user.id,
        username: profile?.username || req.user.email?.split('@')[0] || null,
        tier,
      });
      res.json({
        success: true,
        order,
        payment: vipOrders.bankInfoFromEnv(),
        instruction:
          'Havale/EFT açıklamasına mutlaka sipariş numarasını yazın. Ödeme onaylanınca paketiniz 30 gün için otomatik tanımlanır.',
      });
    } catch (e) {
      console.error('[vip-order] create:', e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/vip/orders/mine', requireAuth, async (req, res) => {
    try {
      const orders = await vipOrders.listOrdersByOwner(supabaseAdmin, req.user.id);
      res.json({ success: true, orders });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /** Admin — bekleyen/tüm VIP siparişleri (Kullanıcılar sayfasından yönetilir) */
  app.get('/api/admin/vip-orders', requireAdmin, async (req, res) => {
    try {
      const status = req.query.status || null;
      const orders = await vipOrders.listAllOrders(supabaseAdmin, { status: status || undefined });
      res.json({ success: true, orders, payment: vipOrders.bankInfoFromEnv() });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/admin/vip-orders/:id/approve', requireAdmin, json, async (req, res) => {
    try {
      if (!supabaseAdmin) {
        return res.status(503).json({ success: false, error: 'Veritabanı yok' });
      }
      const order = await vipOrders.getOrderById(supabaseAdmin, req.params.id);
      if (!order) return res.status(404).json({ success: false, error: 'Sipariş bulunamadı' });
      if (order.status === 'active') {
        return res.json({ success: true, order, message: 'Sipariş zaten onaylı' });
      }
      if (!['pending_payment', 'paid', 'failed'].includes(order.status)) {
        return res.status(400).json({ success: false, error: `Bu sipariş onaylanamaz (${order.status})` });
      }

      const result = await applyVipGrant(supabaseAdmin, {
        userId: order.owner_id,
        tier: order.tier,
        days: order.days,
        action: 'grant',
        notes: `Havale/EFT sipariş: ${order.order_code}`,
        grantedBy: 'admin(havale)',
      });
      if (result.error) {
        await vipOrders.updateOrder(supabaseAdmin, order.id, {
          status: 'failed',
          admin_note: result.error.message,
        });
        return res.status(result.error.status).json({ success: false, error: result.error.message });
      }

      const updatedOrder = await vipOrders.updateOrder(supabaseAdmin, order.id, {
        status: 'active',
        paid_at: new Date().toISOString(),
        admin_note: req.body?.note || order.admin_note,
      });

      res.json({ success: true, order: updatedOrder, vip: publicVipStatus(result.updated) });
    } catch (e) {
      console.error('[vip-order] approve:', e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/admin/vip-orders/:id/reject', requireAdmin, json, async (req, res) => {
    try {
      const order = await vipOrders.getOrderById(supabaseAdmin, req.params.id);
      if (!order) return res.status(404).json({ success: false, error: 'Sipariş bulunamadı' });
      if (order.status === 'active') {
        return res.status(400).json({ success: false, error: 'Aktif sipariş reddedilemez' });
      }
      const updated = await vipOrders.updateOrder(supabaseAdmin, order.id, {
        status: 'cancelled',
        admin_note: req.body?.note || 'Reddedildi',
      });
      res.json({ success: true, order: updated });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });
}

module.exports = { registerVipRoutes, publicVipStatus, applyVipGrant };
