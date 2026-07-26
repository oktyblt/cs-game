const {
  istanbulMonth,
  applyKill,
  topForPort,
  listKnownPorts,
} = require('../lib/rankings');

function registerRankingsRoutes(app, ctx = {}) {
  const { supabaseAdmin } = ctx;
  const ingestSecret = process.env.RANK_INGEST_SECRET || 'browsercs-rank-ingest';

  /** GET /api/rankings/:port — Top 20 for one server (current month) */
  app.get('/api/rankings/:port', (req, res) => {
    try {
      const port = parseInt(req.params.port, 10);
      if (!port || port < 1) {
        return res.status(400).json({ success: false, error: 'Geçersiz port' });
      }
      const month = String(req.query.month || istanbulMonth()).slice(0, 7);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const data = topForPort(port, limit, month);
      res.json({ success: true, ...data });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /** GET /api/rankings — all known ports summary (top 3 each) or ?port= */
  app.get('/api/rankings', (req, res) => {
    try {
      const month = String(req.query.month || istanbulMonth()).slice(0, 7);
      if (req.query.port) {
        const port = parseInt(req.query.port, 10);
        return res.json({ success: true, ...topForPort(port, 20, month) });
      }
      const ports = listKnownPorts().sort((a, b) => a - b);
      const servers = ports.map((port) => topForPort(port, 3, month));
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
      const killerUserId = req.body?.killerUserId || req.body?.killer;
      const victimUserId = req.body?.victimUserId || req.body?.victim;
      if (!port || !killerUserId || !victimUserId) {
        return res.status(400).json({
          success: false,
          error: 'port + killerUserId + victimUserId gerekli',
        });
      }
      const applied = applyKill(port, killerUserId, victimUserId, {
        killerName: req.body?.killerName,
        victimName: req.body?.victimName,
      });
      if (!applied) {
        return res.status(400).json({
          success: false,
          error: 'Her iki taraf da gecerli kayitli hesap olmali',
        });
      }
      res.json({ success: true, month: istanbulMonth() });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  void supabaseAdmin;
}

module.exports = { registerRankingsRoutes };
