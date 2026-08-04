/**
 * Public server list API
 */
const fs = require('fs');
const {
  portFromContainer,
  normalizeServerState,
} = require('../lib/dockerServers');

function registerServerRoutes(app, ctx) {
  const { docker, supabaseAdmin, queryA2S, queryA2SPlayers, sendRcon, readPortRconPassword } = ctx;
  const playersCache = new Map(); // port -> { at, payload }

  async function resolveServerMeta(idOrPort) {
    const key = String(idOrPort || '').trim();
    if (!key) return null;
    const asPort = Number(key);
    const containers = await docker.listContainers({
      all: true,
      filters: { label: ['cs-web-game=true'] },
    });
    for (const c of containers) {
      const port = portFromContainer(c);
      if (!port) continue;
      const matches =
        c.Id === key ||
        c.Id.startsWith(key) ||
        String(port) === key ||
        (Number.isFinite(asPort) && port === asPort) ||
        (c.Labels?.serverId && String(c.Labels.serverId) === key);
      if (!matches) continue;
      return {
        id: c.Id,
        port,
        name: c.Labels?.serverName || 'Sunucu',
        map: c.Labels?.mapName || '',
        maxplayers: parseInt(c.Labels?.maxPlayers, 10) || 16,
        state: normalizeServerState(c.State),
        isOfficial: c.Labels?.isOfficial === 'true',
      };
    }
    // purchased_servers UUID / port fallback
    if (ctx.supabaseAdmin) {
      try {
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
        let q = ctx.supabaseAdmin.from('purchased_servers').select('id,name,map,port,max_players,container_id,status');
        const { data } = isUUID
          ? await q.eq('id', key).maybeSingle()
          : Number.isFinite(asPort)
            ? await q.eq('port', asPort).maybeSingle()
            : { data: null };
        if (data?.port) {
          return {
            id: data.container_id || data.id,
            port: data.port,
            name: data.name || 'Sunucu',
            map: data.map || '',
            maxplayers: data.max_players || 16,
            state: data.status === 'running' ? 'running' : 'stopped',
            isOfficial: false,
          };
        }
      } catch (_) { /* ignore */ }
    }
    return null;
  }

  app.get('/api/servers', async (req, res) => {
    try {
      const containers = await docker.listContainers({
        all: true,
        filters: { label: ['cs-web-game=true'] },
      });

      let dbServers = [];
      if (supabaseAdmin) {
        const { data, error } = await supabaseAdmin
          .from('purchased_servers')
          .select('*');
        if (error) {
          console.warn('[api/servers] purchased_servers fetch:', error.message);
        }
        dbServers = data || [];
      }

      const portToDb = new Map();
      dbServers.forEach((row) => {
        if (row.port) portToDb.set(row.port, row);
      });

      const seenPorts = new Set();
      const servers = [];

      async function buildServerEntry(c, dbRow) {
        const isOfficial = c.Labels?.isOfficial === 'true';
        const port =
          portFromContainer(c) || dbRow?.port || 0;
        if (port) seenPorts.add(port);

        const state = normalizeServerState(c.State);
        let currentMap = c.Labels?.mapName || dbRow?.map || 'de_dust2';
        let currentPlayers = 0;
        const maxPlayers =
          parseInt(c.Labels?.maxPlayers, 10) || dbRow?.max_players || 16;

        if (state === 'running' && port) {
          const a2s = await queryA2S('127.0.0.1', port);
          if (a2s && a2s.map) {
            currentMap = a2s.map;
            currentPlayers = a2s.players;
          }
        }

        let serverMode = c.Labels?.gameMode || 'normal';
        let hasPassword = false;
        let vipOnly = String(c.Labels?.vipOnly || '').toLowerCase().trim() || null;
        if (port) {
          try {
            const modeFile = `/home/ubuntu/server_configs/${port}/mode.txt`;
            if (fs.existsSync(modeFile)) {
              serverMode = fs.readFileSync(modeFile, 'utf8').trim();
            } else if (c.Labels?.gameMode) {
              serverMode = c.Labels.gameMode;
            }
            const pwFile = `/home/ubuntu/server_configs/${port}/server_password.txt`;
            if (fs.existsSync(pwFile)) {
              hasPassword =
                fs.readFileSync(pwFile, 'utf8').trim().length > 0;
            }
            const vipOnlyFile = `/home/ubuntu/server_configs/${port}/vip_only.txt`;
            if (fs.existsSync(vipOnlyFile)) {
              const v = fs.readFileSync(vipOnlyFile, 'utf8').trim().toLowerCase();
              if (['silver', 'gold', 'platinum'].includes(v)) vipOnly = v;
            }
          } catch (e) {
            /* sessiz */
          }
        }

        const serverId = dbRow?.id || null;
        return {
          id: serverId || c.Id,
          serverId,
          containerId: c.Id,
          name: c.Labels?.serverName || dbRow?.name || 'CS Server',
          map: currentMap,
          players: currentPlayers,
          maxplayers: maxPlayers,
          port,
          isOfficial,
          owner_id: c.Labels?.owner_id || dbRow?.owner_id || null,
          state,
          mode: serverMode,
          gameMode: c.Labels?.gameMode || serverMode,
          hasPassword,
          vipOnly: vipOnly || null,
          status: state,
          created_at: dbRow?.created_at || null,
          expires_at: dbRow?.expires_at || null,
          // NOTA: rcon_password / admin_* asla public listeye eklenmez
        };
      }

      for (const c of containers) {
        const port = portFromContainer(c);
        const dbRow = port
          ? portToDb.get(port)
          : dbServers.find(
              (r) => r.container_id && c.Id.startsWith(r.container_id)
            ) || null;
        servers.push(await buildServerEntry(c, dbRow));
      }

      for (const dbRow of dbServers) {
        if (!dbRow.port || seenPorts.has(dbRow.port)) continue;
        servers.push({
          id: dbRow.id,
          serverId: dbRow.id,
          containerId: dbRow.container_id || null,
          name: dbRow.name,
          map: dbRow.map || 'de_dust2',
          players: 0,
          maxplayers: dbRow.max_players || 16,
          port: dbRow.port,
          isOfficial: false,
          owner_id: dbRow.owner_id,
          state: 'stopped',
          mode: 'normal',
          hasPassword: false,
          status: 'stopped',
          created_at: dbRow.created_at || null,
          expires_at: dbRow.expires_at || null,
        });
      }

      // Running first, then by port
      servers.sort((a, b) => {
        if (a.state === 'running' && b.state !== 'running') return -1;
        if (a.state !== 'running' && b.state === 'running') return 1;
        return (a.port || 0) - (b.port || 0);
      });

      res.json({ success: true, servers });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Public player roster for server browser (bcs_roster teams + A2S fallback).
  function parseBcsRoster(text) {
    const players = [];
    if (!text) return players;
    for (const rawLine of String(text).split(/\r?\n/)) {
      const line = rawLine.replace(/^\s*print\s*/i, '').trim();
      if (!line.startsWith('BCS_PLAYER|')) continue;
      const parts = line.split('|');
      // BCS_PLAYER|pid|name|team|score|deaths|bot
      if (parts.length < 7) continue;
      const teamNum = parseInt(parts[3], 10);
      let team = 'SPEC';
      if (teamNum === 1) team = 'T';
      else if (teamNum === 2) team = 'CT';
      else if (teamNum === 0) team = 'UNASSIGNED';
      players.push({
        name: parts[2] || 'Oyuncu',
        team,
        teamNum: Number.isFinite(teamNum) ? teamNum : 3,
        score: parseInt(parts[4], 10) || 0,
        deaths: parseInt(parts[5], 10) || 0,
        bot: parts[6] === '1',
        duration: null,
      });
    }
    return players;
  }

  async function queryRosterWithTeams(port) {
    if (typeof sendRcon !== 'function') return null;
    const pw =
      (typeof readPortRconPassword === 'function' && readPortRconPassword(port)) ||
      'admin';
    try {
      const text = await sendRcon('127.0.0.1', port, pw, 'bcs_roster', 2000);
      const players = parseBcsRoster(text);
      if (!players.length && text && !/BCS_ROSTER_BEGIN/.test(text)) return null;
      return players;
    } catch (_) {
      return null;
    }
  }

  app.get('/api/servers/:id/players', async (req, res) => {
    try {
      const meta = await resolveServerMeta(req.params.id);
      if (!meta) {
        return res.status(404).json({ success: false, error: 'Sunucu bulunamadı', players: [], teams: { T: [], CT: [], SPEC: [] } });
      }
      if (meta.state !== 'running') {
        return res.json({
          success: true,
          id: meta.id,
          port: meta.port,
          name: meta.name,
          map: meta.map,
          maxplayers: meta.maxplayers,
          players: [],
          teams: { T: [], CT: [], SPEC: [] },
        });
      }

      const cacheKey = String(meta.port);
      const cached = playersCache.get(cacheKey);
      if (cached && Date.now() - cached.at < 3000) {
        return res.json({ ...cached.payload, cached: true });
      }

      const [info, roster, detail] = await Promise.all([
        typeof queryA2S === 'function' ? queryA2S('127.0.0.1', meta.port).catch(() => null) : null,
        queryRosterWithTeams(meta.port),
        typeof queryA2SPlayers === 'function' ? queryA2SPlayers('127.0.0.1', meta.port).catch(() => null) : null,
      ]);

      let players = Array.isArray(roster) ? roster.slice() : [];
      let source = players.length ? 'roster' : 'a2s';

      if (!players.length) {
        const raw = Array.isArray(detail?.players) ? detail.players : (Array.isArray(detail) ? detail : []);
        players = raw.map((p, i) => ({
          index: i,
          name: p.name || `Oyuncu #${i + 1}`,
          score: Number.isFinite(p.score) ? p.score : 0,
          duration: Number.isFinite(p.duration) && p.duration >= 0 ? Math.round(p.duration) : null,
          team: 'UNKNOWN',
          bot: false,
        }));
      }

      players.sort((a, b) => (b.score - a.score) || String(a.name).localeCompare(String(b.name)));

      const teams = { T: [], CT: [], SPEC: [], UNASSIGNED: [], UNKNOWN: [] };
      for (const p of players) {
        const key = teams[p.team] ? p.team : 'UNKNOWN';
        teams[key].push(p);
      }

      const map = (info && info.map) || meta.map;
      const payload = {
        success: true,
        id: meta.id,
        port: meta.port,
        name: meta.name,
        map,
        maxplayers: meta.maxplayers,
        players,
        teams: {
          T: teams.T,
          CT: teams.CT,
          SPEC: [...teams.SPEC, ...teams.UNASSIGNED, ...teams.UNKNOWN],
        },
        source,
        cached: false,
      };
      playersCache.set(cacheKey, { at: Date.now(), payload });
      res.json(payload);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message, players: [], teams: { T: [], CT: [], SPEC: [] } });
    }
  });

}

module.exports = { registerServerRoutes };
