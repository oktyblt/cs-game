const {
  istanbulMonth,
  applyKill,
  topForPort,
  listKnownPorts,
  listMonthsForPort,
} = require('../lib/rankings');
const { rewardsInfo } = require('../lib/rankVipRewards');
const { isActiveVip, normalizeVipTier } = require('../lib/vipConstants');

/**
 * Attach active VIP tier to rank rows (by user_id), then strip UUIDs from public payload.
 */
async function withPublicVip(supabaseAdmin, top) {
  const rows = Array.isArray(top) ? top : [];
  if (!rows.length) return [];

  const vipById = new Map();
  if (supabaseAdmin) {
    const ids = [...new Set(rows.map((p) => p.user_id).filter(Boolean))];
    if (ids.length) {
      try {
        const { data, error } = await supabaseAdmin
          .from('profiles')
          .select('id, vip_tier, vip_expires_at')
          .in('id', ids);
        if (!error && Array.isArray(data)) {
          const now = new Date();
          for (const row of data) {
            if (!isActiveVip(row, now)) continue;
            const tier = normalizeVipTier(row.vip_tier);
            if (tier && tier !== 'none') vipById.set(row.id, tier);
          }
        }
      } catch (_) {
        /* public rank still works without vip */
      }
    }
  }

  return rows.map(({ user_id, name, kills, deaths, kd }) => ({
    name,
    kills,
    deaths,
    kd,
    vip: vipById.get(user_id) || null,
  }));
}

function registerRankingsRoutes(app, ctx = {}) {
  const { supabaseAdmin } = ctx;
  const ingestSecret = process.env.RANK_INGEST_SECRET || 'browsercs-rank-ingest';

  /** GET /api/rankings/rewards — public Top 10 VIP hediye kuralları */
  app.get('/api/rankings/rewards', (_req, res) => {
    res.json({ success: true, ...rewardsInfo() });
  });

  /**
   * GET /api/rankings/:port/months — available history months (year → months)
   * Must be registered BEFORE /:port so Express does not treat "months" as port.
   */
  app.get('/api/rankings/:port/months', async (req, res) => {
    try {
      const port = parseInt(req.params.port, 10);
      if (!port || port < 1) {
        return res.status(400).json({ success: false, error: 'Geçersiz port' });
      }
      const disk = listMonthsForPort(port);

      // Merge Supabase history months when available (past seasons dual-written)
      if (supabaseAdmin) {
        try {
          const { data, error } = await supabaseAdmin
            .from('server_monthly_ranks')
            .select('month')
            .eq('port', port)
            .not('user_id', 'is', null);
          if (!error && Array.isArray(data)) {
            const set = new Set(disk.months);
            for (const row of data) {
              if (/^\d{4}-\d{2}$/.test(row.month || '')) set.add(row.month);
            }
            disk.months = [...set].sort((a, b) => b.localeCompare(a));
            disk.years = {};
            for (const month of disk.months) {
              const year = month.slice(0, 4);
              if (!disk.years[year]) disk.years[year] = [];
              disk.years[year].push(month);
            }
          }
        } catch (_) {
          /* disk-only fallback */
        }
      }

      res.json({ success: true, ...disk });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /** GET /api/rankings/:port — Top N for one server + optional ?month=YYYY-MM */
  app.get('/api/rankings/:port', async (req, res) => {
    try {
      const port = parseInt(req.params.port, 10);
      if (!port || port < 1) {
        return res.status(400).json({ success: false, error: 'Geçersiz port' });
      }
      const month = String(req.query.month || istanbulMonth()).slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ success: false, error: 'Geçersiz month (YYYY-MM)' });
      }
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
      let data = topForPort(port, limit, month);

      // If disk empty for a past month, try Supabase archive
      if (
        (!data.top || data.top.length === 0) &&
        month !== istanbulMonth() &&
        supabaseAdmin
      ) {
        try {
          const { data: rows, error } = await supabaseAdmin
            .from('server_monthly_ranks')
            .select('user_id, display_name, kills, deaths')
            .eq('port', port)
            .eq('month', month)
            .not('user_id', 'is', null)
            .order('kills', { ascending: false })
            .limit(limit);
          if (!error && rows?.length) {
            data = {
              port,
              month,
              updated_at: null,
              source: 'supabase',
              top: rows.map((r) => {
                const kills = r.kills | 0;
                const deaths = r.deaths | 0;
                return {
                  user_id: r.user_id,
                  name: r.display_name || 'Oyuncu',
                  kills,
                  deaths,
                  kd:
                    deaths > 0
                      ? Math.round((kills / deaths) * 100) / 100
                      : kills,
                };
              }),
            };
          }
        } catch (_) {
          /* keep disk result */
        }
      }

      const top = await withPublicVip(supabaseAdmin, data.top || []);
      res.json({
        success: true,
        is_current: month === istanbulMonth(),
        port: data.port,
        month: data.month,
        updated_at: data.updated_at || null,
        source: data.source || 'disk',
        top,
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /** GET /api/rankings — all known ports summary (top 3 each) or ?port= */
  app.get('/api/rankings', async (req, res) => {
    try {
      const month = String(req.query.month || istanbulMonth()).slice(0, 7);
      if (req.query.port) {
        const port = parseInt(req.query.port, 10);
        const data = topForPort(port, 20, month);
        const top = await withPublicVip(supabaseAdmin, data.top || []);
        return res.json({
          success: true,
          is_current: month === istanbulMonth(),
          ...data,
          top,
        });
      }
      const ports = listKnownPorts().sort((a, b) => a - b);
      const servers = [];
      for (const port of ports) {
        const data = topForPort(port, 3, month);
        servers.push({
          ...data,
          top: await withPublicVip(supabaseAdmin, data.top || []),
        });
      }
      res.json({ success: true, month, servers });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /** POST /api/rankings/kill — optional HTTP ingest (secret), account UUID only */
  app.post('/api/rankings/kill', (req, res) => {
    try {
      const secret = req.headers['x-rank-secret'] || req.body?.secret;
      if (secret !== ingestSecret) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      const port = parseInt(req.body?.port, 10);
      const killerUserId = req.body?.killerUserId || req.body?.killer || '';
      const victimUserId = req.body?.victimUserId || req.body?.victim || '';
      if (!port || (!killerUserId && !victimUserId)) {
        return res.status(400).json({
          success: false,
          error: 'port + (killerUserId ve/veya victimUserId) gerekli',
        });
      }
      const applied = applyKill(port, killerUserId, victimUserId, {
        killerName: req.body?.killerName,
        victimName: req.body?.victimName,
      });
      if (!applied) {
        return res.status(400).json({
          success: false,
          error: 'En az bir gecerli kayitli hesap (UUID) gerekli',
        });
      }
      res.json({ success: true, month: istanbulMonth() });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });
}

module.exports = { registerRankingsRoutes };
