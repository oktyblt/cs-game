/**
 * VIP subscription API — ticket, prices, admin grant/list/revoke.
 * Payment checkout deferred; Master Admin grant is fulfillment.
 */
const {
  VIP_PRICES_TRY,
  VIP_LABELS_TR,
  VIP_FEATURES,
  VIP_TIERS,
  normalizeVipTier,
  isActiveVip,
  sanitizeClanTag,
  daysLeft,
} = require('../lib/vipConstants');
const { issueVipTicket } = require('../lib/vipSessions');

const VIP_PROFILE_COLS =
  'id, username, vip_tier, vip_expires_at, vip_clan_tag, vip_granted_at, vip_granted_by, vip_notes';

function publicVipStatus(profile) {
  const active = isActiveVip(profile);
  const tier = active ? normalizeVipTier(profile.vip_tier) : 'none';
  return {
    tier: tier || 'none',
    active,
    expiresAt: profile?.vip_expires_at || null,
    clanTag: tier === 'platinum' ? sanitizeClanTag(profile?.vip_clan_tag) : '',
    label: VIP_LABELS_TR[tier || 'none'] || 'Yok',
    daysLeft: active ? daysLeft(profile?.vip_expires_at) : 0,
    pricesTry: VIP_PRICES_TRY,
  };
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
      res.json({ success: true, vip: publicVipStatus(profile) });
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
        clanTag: profile.vip_clan_tag,
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
          clanTag: row.vip_clan_tag || '',
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
   * Body: { userId|username, tier, days?, clanTag?, notes?, action? }
   * action: grant (default) | extend | revoke
   * tier=none or action=revoke → revoke
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
        return res.status(resolved.error.status).json({
          success: false,
          error: resolved.error.message,
        });
      }
      const { userId } = resolved;

      const { data: current, error: curErr } = await supabaseAdmin
        .from('profiles')
        .select(VIP_PROFILE_COLS)
        .eq('id', userId)
        .maybeSingle();
      if (curErr) throw curErr;
      if (!current) {
        return res.status(404).json({ success: false, error: 'Profil yok' });
      }

      const now = new Date();
      const days = Math.min(366, Math.max(1, parseInt(req.body?.days, 10) || 30));
      let tier = normalizeVipTier(req.body?.tier);
      if (action === 'revoke') tier = 'none';
      if (action === 'extend') {
        tier = normalizeVipTier(req.body?.tier) || normalizeVipTier(current.vip_tier);
        if (!tier || tier === 'none') {
          return res.status(400).json({
            success: false,
            error: 'Uzatmak için mevcut veya yeni tier gerekli (silver|gold|platinum)',
          });
        }
      }
      if (!tier) {
        return res.status(400).json({
          success: false,
          error: 'tier: none|silver|gold|platinum',
        });
      }

      let expiresAt = null;
      if (tier !== 'none') {
        let base = now;
        if (action === 'extend' && isActiveVip(current, now)) {
          const curExp = new Date(current.vip_expires_at);
          if (curExp.getTime() > now.getTime()) base = curExp;
        }
        expiresAt = new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
      }

      const clanFromBody = req.body?.clanTag != null ? sanitizeClanTag(req.body.clanTag) : null;
      const patch = {
        vip_tier: tier,
        vip_expires_at: expiresAt,
        vip_clan_tag:
          tier === 'platinum'
            ? clanFromBody || sanitizeClanTag(current.vip_clan_tag) || null
            : null,
        vip_granted_at: now.toISOString(),
        vip_granted_by: 'admin',
        vip_notes:
          req.body?.notes != null
            ? String(req.body.notes).slice(0, 500)
            : current.vip_notes || null,
      };

      const { data: updated, error } = await supabaseAdmin
        .from('profiles')
        .update(patch)
        .eq('id', userId)
        .select(VIP_PROFILE_COLS)
        .maybeSingle();

      if (error) throw error;
      if (!updated) {
        return res.status(404).json({ success: false, error: 'Profil yok' });
      }

      res.json({
        success: true,
        action,
        vip: publicVipStatus(updated),
        profile: {
          id: updated.id,
          username: updated.username,
          vip_tier: updated.vip_tier,
          vip_expires_at: updated.vip_expires_at,
          vip_clan_tag: updated.vip_clan_tag,
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
    req.body = { ...(req.body || {}), tier: 'none', action: 'revoke' };
    // Re-dispatch through grant handler by calling same logic:
    // Express doesn't re-enter easily — inline thin wrapper:
    try {
      if (!supabaseAdmin) {
        return res.status(503).json({ success: false, error: 'Veritabanı yok' });
      }
      const resolved = await resolveUserId(supabaseAdmin, req.body);
      if (resolved.error) {
        return res.status(resolved.error.status).json({
          success: false,
          error: resolved.error.message,
        });
      }
      const now = new Date();
      const patch = {
        vip_tier: 'none',
        vip_expires_at: null,
        vip_clan_tag: null,
        vip_granted_at: now.toISOString(),
        vip_granted_by: 'admin',
        vip_notes:
          req.body?.notes != null ? String(req.body.notes).slice(0, 500) : null,
      };
      if (patch.vip_notes == null) delete patch.vip_notes;

      const { data: updated, error } = await supabaseAdmin
        .from('profiles')
        .update(patch)
        .eq('id', resolved.userId)
        .select(VIP_PROFILE_COLS)
        .maybeSingle();
      if (error) throw error;
      if (!updated) {
        return res.status(404).json({ success: false, error: 'Profil yok' });
      }
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
}

module.exports = { registerVipRoutes, publicVipStatus };
