/**
 * CS Web Game — Cloudflare Pages Advanced Mode Worker
 * Bu worker hem API endpoints hem de static assets'i yönetir.
 */

if (!globalThis.CS_ROOMS) globalThis.CS_ROOMS = new Map();
if (!globalThis.CS_SOCKETS) globalThis.CS_SOCKETS = new Map();

const MAPS = [
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

const API_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // OPTIONS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: API_HEADERS });
    }

    // GET /api/maps
    if (path === '/api/maps' && request.method === 'GET') {
      return Response.json({ maps: MAPS, total: MAPS.length }, { headers: API_HEADERS });
    }

    // GET /api/servers
    if (path === '/api/servers' && request.method === 'GET') {
      const now = Date.now();
      const servers = [];
      for (const [id, room] of globalThis.CS_ROOMS.entries()) {
        const socketRoom = globalThis.CS_SOCKETS.get(id);
        // Eğer sunucu kurulalı 15 saniyeden fazla olduysa ve host WebSocket'i yoksa, bu bir "hayalet" odadır.
        if (!socketRoom || !socketRoom.host) {
          if (now - room.created > 15000) {
            globalThis.CS_ROOMS.delete(id);
            globalThis.CS_SOCKETS.delete(id);
            continue;
          }
        }
        servers.push(room);
      }
      return Response.json({ servers }, { headers: API_HEADERS });
    }

    // GET /api/wads
    if (path === '/api/wads' && request.method === 'GET') {
      const wads = ['ajawad.wad','as_tundra.wad','cached.wad','chateau.wad','cs_747.wad','cs_bdog.wad','cs_cbble.wad','cs_dust.wad','cs_havana.wad','cs_office.wad','cstrike.wad','de_aztec.wad','de_piranesi.wad','de_storm.wad','de_vegas.wad','decals.wad','itsItaly.wad','jos.wad','n0th1ng.wad','pldecal.wad','prodigy.wad','torntextures.wad'];
      return Response.json({ wads }, { headers: API_HEADERS });
    }

    // POST /api/create-server
    if (path === '/api/create-server' && request.method === 'POST') {
      try {
        const body = await request.json();
        const mapName = body.map || 'de_dust2';
        const maxplayers = parseInt(body.maxplayers) || 16;
        const name = body.name || `CS Web Oda (${mapName})`;
        const host = body.host || 'Player';
        const roomId = `room_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

        globalThis.CS_ROOMS.set(roomId, {
          id: roomId, name, host, map: mapName,
          players: 1, maxplayers, port: roomId, created: Date.now()
        });
        globalThis.CS_SOCKETS.set(roomId, { host: null, clients: new Set() });

        return Response.json({
          success: true, isListenServer: true,
          port: roomId, name, map: mapName, maxplayers
        }, { headers: API_HEADERS });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: API_HEADERS });
      }
    }

    // WebSocket /relay
    if (path === '/relay') {
      const upgrade = request.headers.get('Upgrade');
      if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket', { status: 426 });
      }

      const roomId = url.searchParams.get('room') || 'default';
      const role = url.searchParams.get('role') || 'client';
      const [clientWs, serverWs] = Object.values(new WebSocketPair());
      serverWs.accept();

      let room = globalThis.CS_SOCKETS.get(roomId);
      if (!room) {
        room = { host: null, clients: new Set() };
        globalThis.CS_SOCKETS.set(roomId, room);
      }

      if (role === 'host') {
        room.host = serverWs;
        serverWs.addEventListener('message', e => {
          for (const c of room.clients) { try { c.send(e.data); } catch(_) { room.clients.delete(c); } }
        });
        const cleanupHost = () => {
          room.host = null;
          globalThis.CS_ROOMS.delete(roomId);
          for (const c of room.clients) { try { c.close(); } catch(_) {} }
        };
        serverWs.addEventListener('close', cleanupHost);
        serverWs.addEventListener('error', cleanupHost);
      } else {
        room.clients.add(serverWs);
        const rd = globalThis.CS_ROOMS.get(roomId);
        if (rd) rd.players = Math.min(rd.maxplayers, (rd.players || 1) + 1);
        serverWs.addEventListener('message', e => {
          if (room.host) { try { room.host.send(e.data); } catch(_) { room.host = null; } }
        });
        const cleanupClient = () => {
          room.clients.delete(serverWs);
          const r = globalThis.CS_ROOMS.get(roomId);
          if (r && r.players > 1) r.players--;
        };
        serverWs.addEventListener('close', cleanupClient);
        serverWs.addEventListener('error', cleanupClient);
      }

      return new Response(null, { status: 101, webSocket: clientWs });
    }

    // Static asset fallback
    const assetResponse = await env.ASSETS.fetch(request);
    const response = new Response(assetResponse.body, assetResponse);
    response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    return response;
  }
};
