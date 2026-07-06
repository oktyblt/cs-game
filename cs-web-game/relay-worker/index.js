// RelayRoom: Durable Object - Oda başına tek bir instance
// Host ve client'lar arasında gerçek zamanlı WebSocket köprüsü
export class RelayRoom {
  constructor(state) {
    this.state = state;
    this.host = null;
    this.clients = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);
    const role = url.searchParams.get('role') || 'client';

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response(JSON.stringify({
        status: 'ok',
        host: !!this.host,
        clients: this.clients.size
      }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const pair = new WebSocketPair();
    const [clientWs, serverWs] = Object.values(pair);
    serverWs.accept();

    if (role === 'host') {
      // Eski host bağlantısını kapat
      if (this.host) {
        try { this.host.close(1011, 'New host replaced'); } catch(e) {}
      }
      this.host = serverWs;
      const roomStr = url.searchParams.get('room') || 'unknown';
      console.log(`[Relay] New host joined: ${roomStr}`);

      serverWs.addEventListener('message', async (evt) => {
        let broadcastCount = 0;
        let data = evt.data;
        if (data && typeof data.arrayBuffer === 'function') {
            data = await data.arrayBuffer();
        }
        let isBinary = data instanceof ArrayBuffer;
        
        for (const [id, ws] of this.clients) {
          try { ws.send(data); broadcastCount++; } catch(e) {
            this.clients.delete(id);
          }
        }
        console.log(`[Relay] Host sent packet to ${broadcastCount} clients. Type: ${typeof data}, isArrayBuffer: ${isBinary}`);
      });

      serverWs.addEventListener('close', () => {
        if (this.host === serverWs) this.host = null;
      });

      serverWs.addEventListener('error', () => {
        if (this.host === serverWs) this.host = null;
      });

    } else {
      // Client olarak kayıt
      const clientId = Date.now() + '_' + Math.random().toString(36).substr(2, 4);
      this.clients.set(clientId, serverWs);
      console.log(`[Relay] New client joined: ${clientId}`);

      serverWs.addEventListener('message', async (evt) => {
        let data = evt.data;
        if (data && typeof data.arrayBuffer === 'function') {
            data = await data.arrayBuffer();
        }
        let isBinary = data instanceof ArrayBuffer;
        
        if (this.host) {
          try { 
            this.host.send(data); 
            console.log(`[Relay] Client ${clientId} sent packet to Host. Type: ${typeof data}, isArrayBuffer: ${isBinary}`); 
          } catch(e) {
            console.error(`[Relay] Host connection lost when client ${clientId} sent packet.`);
            this.host = null;
          }
        } else {
          console.warn(`[Relay] Client ${clientId} sent packet but no Host is connected!`);
        }
      });

      serverWs.addEventListener('close', () => {
        this.clients.delete(clientId);
      });

      serverWs.addEventListener('error', () => {
        this.clients.delete(clientId);
      });
    }

    return new Response(null, {
      status: 101,
      webSocket: clientWs,
      headers: {
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// Ana Worker handler
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Upgrade'
        }
      });
    }

    const room = url.searchParams.get('room');
    if (!room) {
      return new Response(JSON.stringify({ error: 'Missing room parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Room ID'ye göre Durable Object al (her oda için tek instance)
    const id = env.RELAY.idFromName(room);
    const stub = env.RELAY.get(id);

    return stub.fetch(request);
  }
};
