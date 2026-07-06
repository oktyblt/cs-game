/**
 * CS Web Game - Cloudflare Worker & WebSocket Relay
 * Cloudflare Pages + Worker üzerinde sıfır maliyetli multiplayer CS 1.5 relay sunucusu.
 */

// In-Memory active rooms (Worker instance level)
if (!globalThis.CS_ACTIVE_ROOMS) globalThis.CS_ACTIVE_ROOMS = new Map();
if (!globalThis.CS_ROOM_SOCKETS) globalThis.CS_ROOM_SOCKETS = new Map();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers });
    }

    // GET /api/servers - Aktif odalar listesi
    if (url.pathname === '/api/servers') {
      const servers = Array.from(globalThis.CS_ACTIVE_ROOMS.values());
      return new Response(JSON.stringify({ servers }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // GET /api/maps - Harita listesi
    if (url.pathname === '/api/maps') {
      const maps = [
        { name: 'de_dust2', size: 2057288, description: 'Bomb Defusal' },
        { name: 'de_dust', size: 1359684, description: 'Bomb Defusal' },
        { name: 'de_inferno', size: 3567372, description: 'Bomb Defusal' },
        { name: 'cs_assault', size: 1041700, description: 'Hostage Rescue' },
        { name: 'cs_office', size: 4679872, description: 'Hostage Rescue' },
        { name: 'de_aztec', size: 2740604, description: 'Bomb Defusal' },
        { name: 'de_nuke', size: 2036392, description: 'Bomb Defusal' },
        { name: 'cs_italy', size: 2303480, description: 'Hostage Rescue' },
        { name: 'as_oilrig', size: 2056040, description: 'VIP Assassination' },
        { name: 'as_tundra', size: 2335152, description: 'VIP Assassination' },
        { name: 'cs_747', size: 1702788, description: 'Hostage Rescue' },
        { name: 'cs_backalley', size: 2142344, description: 'Hostage Rescue' },
        { name: 'cs_estate', size: 4485488, description: 'Hostage Rescue' },
        { name: 'cs_havana', size: 4988672, description: 'Hostage Rescue' },
        { name: 'cs_militia', size: 2022676, description: 'Hostage Rescue' },
        { name: 'cs_siege', size: 3361120, description: 'Hostage Rescue' },
        { name: 'de_cbble', size: 1698648, description: 'Bomb Defusal' },
        { name: 'de_chateau', size: 4953700, description: 'Bomb Defusal' },
        { name: 'de_piranesi', size: 3391792, description: 'Bomb Defusal' },
        { name: 'de_prodigy', size: 1929740, description: 'Bomb Defusal' },
        { name: 'de_storm', size: 2955604, description: 'Bomb Defusal' },
        { name: 'de_survivor', size: 6464260, description: 'Bomb Defusal' },
        { name: 'de_torn', size: 5466396, description: 'Bomb Defusal' },
        { name: 'de_train', size: 1145428, description: 'Bomb Defusal' },
        { name: 'de_vegas', size: 5148716, description: 'Bomb Defusal' },
        { name: 'de_vertigo', size: 2146792, description: 'Bomb Defusal' }
      ];
      return new Response(JSON.stringify({ maps, total: maps.length }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // GET /api/wads - WAD doku listesi
    if (url.pathname === '/api/wads') {
      const wads = [
        'cstrike.wad',
        'cs_dust.wad',
        'decals.wad',
        'cached.wad',
        'cs_office.wad',
        'de_aztec.wad',
        'itsItaly.wad',
        'cs_cbble.wad',
        'prodigy.wad',
        'ajawad.wad',
        'as_tundra.wad',
        'chateau.wad',
        'cs_747.wad',
        'cs_bdog.wad',
        'cs_havana.wad',
        'de_piranesi.wad',
        'de_storm.wad',
        'de_vegas.wad',
        'jos.wad',
        'n0th1ng.wad',
        'pldecal.wad',
        'torntextures.wad'
      ];
      return new Response(JSON.stringify({ wads }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // POST /api/create-server - Yeni P2P Oda Oluşturma
    if (url.pathname === '/api/create-server' && request.method === 'POST') {
      try {
        const body = await request.json();
        const mapName = body.map || 'de_dust2';
        const maxplayers = body.maxplayers || 16;
        const name = body.name || `CS Web Oda (${mapName})`;
        const host = body.host || 'Player';

        const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
        
        const roomData = {
          id: roomId,
          name: name,
          host: host,
          map: mapName,
          players: 1,
          maxplayers: maxplayers,
          port: roomId,
          isListenServer: true,
          created: Date.now()
        };

        globalThis.CS_ACTIVE_ROOMS.set(roomId, roomData);
        globalThis.CS_ROOM_SOCKETS.set(roomId, { host: null, clients: new Set() });

        return new Response(JSON.stringify({
          success: true,
          isListenServer: true,
          port: roomId,
          name: name,
          map: mapName,
          maxplayers: maxplayers
        }), {
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }

    // WebSocket Relay Handler (/relay?room=roomId&role=host|client)
    if (url.pathname === '/relay') {
      const upgradeHeader = request.headers.get('Upgrade');
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
        return new Response('Expected Upgrade: websocket', { status: 426 });
      }

      const roomId = url.searchParams.get('room') || url.searchParams.get('port') || 'default';
      const role = url.searchParams.get('role') || 'client';

      const pair = new WebSocketPair();
      const clientWs = pair[0];
      const serverWs = pair[1];

      serverWs.accept();

      let room = globalThis.CS_ROOM_SOCKETS.get(roomId);
      if (!room) {
        room = { host: null, clients: new Set() };
        globalThis.CS_ROOM_SOCKETS.set(roomId, room);
      }

      if (role === 'host') {
        room.host = serverWs;

        serverWs.addEventListener('message', event => {
          for (const client of Array.from(room.clients)) {
            try {
              client.send(event.data);
            } catch(e) {
              room.clients.delete(client);
            }
          }
        });

        serverWs.addEventListener('close', () => {
          room.host = null;
          globalThis.CS_ROOM_SOCKETS.delete(roomId);
          globalThis.CS_ACTIVE_ROOMS.delete(roomId);
          for (const client of Array.from(room.clients)) {
            try { client.close(); } catch(e){}
          }
          room.clients.clear();
        });

        serverWs.addEventListener('error', () => {
          try { serverWs.close(); } catch(e){}
        });

      } else {
        room.clients.add(serverWs);

        const roomData = globalThis.CS_ACTIVE_ROOMS.get(roomId);
        if (roomData) {
          roomData.players = Math.min(roomData.maxplayers, (roomData.players || 1) + 1);
        }

        serverWs.addEventListener('message', event => {
          if (room.host) {
            try {
              room.host.send(event.data);
            } catch(e) {
              room.host = null;
            }
          }
        });

        serverWs.addEventListener('close', () => {
          room.clients.delete(serverWs);
          const rData = globalThis.CS_ACTIVE_ROOMS.get(roomId);
          if (rData && rData.players > 1) {
            rData.players--;
          }
        });

        serverWs.addEventListener('error', () => {
          room.clients.delete(serverWs);
        });
      }

      return new Response(null, {
        status: 101,
        webSocket: clientWs,
        headers
      });
    }

    // Static Assets Fallback
    return env.ASSETS.fetch(request);
  }
};
