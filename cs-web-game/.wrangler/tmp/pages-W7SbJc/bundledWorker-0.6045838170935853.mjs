var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// _worker.js
if (!globalThis.CS_ROOMS) globalThis.CS_ROOMS = /* @__PURE__ */ new Map();
if (!globalThis.CS_SOCKETS) globalThis.CS_SOCKETS = /* @__PURE__ */ new Map();
var MAPS = [
  { name: "de_dust2", size: 2057288, description: "Bomb Defusal" },
  { name: "de_dust", size: 1359684, description: "Bomb Defusal" },
  { name: "de_inferno", size: 3567372, description: "Bomb Defusal" },
  { name: "cs_assault", size: 1041700, description: "Hostage Rescue" },
  { name: "cs_office", size: 4679872, description: "Hostage Rescue" },
  { name: "de_aztec", size: 2740604, description: "Bomb Defusal" },
  { name: "de_nuke", size: 2036392, description: "Bomb Defusal" },
  { name: "cs_italy", size: 2303480, description: "Hostage Rescue" },
  { name: "as_oilrig", size: 2056040, description: "VIP Assassination" },
  { name: "as_tundra", size: 2335152, description: "VIP Assassination" },
  { name: "cs_747", size: 1702788, description: "Hostage Rescue" },
  { name: "cs_backalley", size: 2142344, description: "Hostage Rescue" },
  { name: "cs_estate", size: 4485488, description: "Hostage Rescue" },
  { name: "cs_havana", size: 4988672, description: "Hostage Rescue" },
  { name: "cs_militia", size: 2022676, description: "Hostage Rescue" },
  { name: "cs_siege", size: 3361120, description: "Hostage Rescue" },
  { name: "de_cbble", size: 1698648, description: "Bomb Defusal" },
  { name: "de_chateau", size: 4953700, description: "Bomb Defusal" },
  { name: "de_piranesi", size: 3391792, description: "Bomb Defusal" },
  { name: "de_prodigy", size: 1929740, description: "Bomb Defusal" },
  { name: "de_storm", size: 2955604, description: "Bomb Defusal" },
  { name: "de_survivor", size: 6464260, description: "Bomb Defusal" },
  { name: "de_torn", size: 5466396, description: "Bomb Defusal" },
  { name: "de_train", size: 1145428, description: "Bomb Defusal" },
  { name: "de_vegas", size: 5148716, description: "Bomb Defusal" },
  { name: "de_vertigo", size: 2146792, description: "Bomb Defusal" }
];
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS }
  });
}
__name(json, "json");
var worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }
    if (path === "/api/maps") return json({ maps: MAPS, total: MAPS.length });
    if (path === "/api/servers") return json({ servers: Array.from(globalThis.CS_ROOMS.values()) });
    if (path === "/api/wads") return json({ wads: ["ajawad.wad", "as_tundra.wad", "cached.wad", "chateau.wad", "cs_747.wad", "cs_bdog.wad", "cs_cbble.wad", "cs_dust.wad", "cs_havana.wad", "cs_office.wad", "cstrike.wad", "de_aztec.wad", "de_piranesi.wad", "de_storm.wad", "de_vegas.wad", "decals.wad", "itsItaly.wad", "jos.wad", "n0th1ng.wad", "pldecal.wad", "prodigy.wad", "torntextures.wad"] });
    if (path === "/api/create-server" && request.method === "POST") {
      try {
        const body = await request.json();
        const mapName = body.map || "de_dust2";
        const maxplayers = parseInt(body.maxplayers) || 16;
        const name = body.name || `CS Web Oda (${mapName})`;
        const roomId = `room_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        globalThis.CS_ROOMS.set(roomId, { id: roomId, name, host: body.host || "Player", map: mapName, players: 1, maxplayers, port: roomId, created: Date.now() });
        globalThis.CS_SOCKETS.set(roomId, { host: null, clients: /* @__PURE__ */ new Set() });
        return json({ success: true, isListenServer: true, port: roomId, name, map: mapName, maxplayers });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }
    if (path === "/api/create-checkout-session" && request.method === "POST") {
      try {
        const body = await request.json();
        const stripeKey = env.STRIPE_SECRET_KEY;
        if (!stripeKey) {
          return json({ url: "https://checkout.stripe.com/pay/cs_test_mock_url_lutfen_admin_panelinden_key_girin" });
        }
        const formData = new URLSearchParams();
        formData.append("payment_method_types[0]", "card");
        formData.append("line_items[0][price_data][currency]", "try");
        formData.append("line_items[0][price_data][product_data][name]", "CS 1.5 Sunucu (1 Ayl\u0131k)");
        formData.append("line_items[0][price_data][unit_amount]", "35000");
        formData.append("line_items[0][quantity]", "1");
        formData.append("mode", "payment");
        formData.append("success_url", `${url.origin}/?payment=success`);
        formData.append("cancel_url", `${url.origin}/?payment=cancel`);
        formData.append("client_reference_id", body.userId);
        const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${stripeKey}`,
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: formData.toString()
        });
        const data = await res.json();
        return json({ url: data.url });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }
    if (path === "/relay") {
      const upgrade = request.headers.get("Upgrade");
      if (!upgrade || upgrade.toLowerCase() !== "websocket") return new Response("Expected WebSocket", { status: 426 });
      const roomId = url.searchParams.get("room") || "default";
      const role = url.searchParams.get("role") || "client";
      const [client, server] = Object.values(new WebSocketPair());
      server.accept();
      let room = globalThis.CS_SOCKETS.get(roomId);
      if (!room) {
        room = { host: null, clients: /* @__PURE__ */ new Set() };
        globalThis.CS_SOCKETS.set(roomId, room);
      }
      if (role === "host") {
        room.host = server;
        server.addEventListener("message", (e) => {
          for (const c of room.clients) {
            try {
              c.send(e.data);
            } catch (_) {
              room.clients.delete(c);
            }
          }
        });
        server.addEventListener("close", () => {
          room.host = null;
          globalThis.CS_ROOMS.delete(roomId);
          for (const c of room.clients) {
            try {
              c.close();
            } catch (_) {
            }
          }
        });
      } else {
        room.clients.add(server);
        const rd = globalThis.CS_ROOMS.get(roomId);
        if (rd) rd.players = Math.min(rd.maxplayers, (rd.players || 1) + 1);
        server.addEventListener("message", (e) => {
          if (room.host) {
            try {
              room.host.send(e.data);
            } catch (_) {
              room.host = null;
            }
          }
        });
        server.addEventListener("close", () => {
          room.clients.delete(server);
          const r = globalThis.CS_ROOMS.get(roomId);
          if (r && r.players > 1) r.players--;
        });
      }
      return new Response(null, { status: 101, webSocket: client });
    }
    if (env.ASSETS) {
      return await env.ASSETS.fetch(request);
    }
    return new Response("Not Found", { status: 404, headers: CORS });
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=bundledWorker-0.6045838170935853.mjs.map
