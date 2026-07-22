/**
 * Public server list API
 */
const fs = require('fs');
const {
  portFromContainer,
  normalizeServerState,
} = require('../lib/dockerServers');

function registerServerRoutes(app, ctx) {
  const { docker, supabaseAdmin, queryA2S } = ctx;

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
}

module.exports = { registerServerRoutes };
