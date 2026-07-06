/**
 * CS Browser Game - Asset Server
 * CS 1.5 dosyalarını browser'a servis eder.
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import dgram from 'dgram';
import { WebSocketServer } from 'ws';
import http from 'http';

const require = createRequire(import.meta.url);
const archiver = require('archiver');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

const server = http.createServer(app);
const PORT = 3001;

// --- Multiplayer Sunucu Yönetimi ---
const activeServers = [];
let nextPort = 27015;
let nextWsPort = 28000;


// Global hata yakalayıcı - sunucunun çökmesini engeller
process.on('uncaughtException', (err) => {
  console.error('CRITICAL UNCAUGHT ERROR:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('CRITICAL UNHANDLED REJECTION:', err);
});

// CS 1.5 kurulum yolları
const CS_PATH    = '/Users/oktaybulut/Desktop/Hlf/Hlf/cstrike';
const HL_PATH    = '/Users/oktaybulut/Desktop/Hlf/Hlf';
const VALVE_PATH = path.join(HL_PATH, 'valve');

app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy',    'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy',  'require-corp');
  // COEP fix: cross-origin kaynaklara izin ver (COEP require-corp ile gerekli)
  res.setHeader('Cross-Origin-Resource-Policy',  'cross-origin');
  res.setHeader('Access-Control-Allow-Origin',   '*');
  res.setHeader('Access-Control-Allow-Methods',  'GET, POST, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',  'Range, Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// GET /api/servers
app.get('/api/servers', (req, res) => {
  res.json({ servers: activeServers });
});

// POST /api/create-server - Play-CS.com (Listen Server / Browser Host) Yöntemi
// Docker veya QEMU beklemeden odayı anında oluşturup tarayıcı içi host motorunu başlatır!
app.post('/api/create-server', (req, res) => {
  const { map, maxplayers, name, host } = req.body;
  const mapName = map || 'de_dust2';
  const players = maxplayers || 16;
  
  const serverId = `room_${Date.now()}`;
  const serverName = name || `CS Web Oda (${mapName})`;
  const hostName = host || 'Player';
  const relayPort = nextWsPort++;

  console.log(`[Listen Server] Oda oluşturuldu: "${serverName}" (Kurucu: ${hostName}, Harita: ${mapName}, Port: ${relayPort})`);
  
  const room = {
    id: serverId,
    name: serverName,
    host: hostName,
    map: mapName,
    players: 1,
    maxplayers: players,
    port: relayPort,
    isListenServer: true
  };
  
  activeServers.push(room);
  startWsRelay(relayPort, serverName);
  
  // Tarayıcıya anında (0 saniyede) yanıt dön, motor +map ile başlasın!
  res.json({ 
    success: true, 
    isListenServer: true,
    port: relayPort,
    name: serverName,
    map: mapName,
    maxplayers: players
  });
});

// WS -> WS Relay Hub (Tarayıcı İçi Host P2P Köprüsü)
function startWsRelay(wsPort, roomName) {
  try {
    const wss = new WebSocketServer({ port: wsPort });
    console.log(`[Relay Hub] Oda "${roomName}" için köprü başlatıldı: WS:${wsPort}`);

    let hostWs = null;
    const clientSet = new Set();

    wss.on('connection', (ws, req) => {
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });

      const urlParams = new URL(req.url, `http://${req.headers.host}`);
      const role = urlParams.searchParams.get('role');

      if (role === 'host') {
        hostWs = ws;
        console.log(`[Relay WS:${wsPort}] 👑 HOST bağlandı.`);
        
        ws.on('message', (msg) => {
          clientSet.forEach(client => {
            if (client.readyState === client.OPEN) {
              client.send(msg);
            }
          });
        });

        ws.on('close', () => {
          hostWs = null;
          console.log(`[Relay WS:${wsPort}] 🔴 HOST ayrıldı! Client'lar bağlantıyı kaybedecek.`);
        });
      } else {
        clientSet.add(ws);
        console.log(`[Relay WS:${wsPort}] 🎮 CLIENT bağlandı. (Toplam Client: ${clientSet.size})`);
        
        ws.on('message', (msg) => {
          if (hostWs && hostWs.readyState === hostWs.OPEN) {
            hostWs.send(msg);
          }
        });

        ws.on('close', () => {
          clientSet.delete(ws);
          console.log(`[Relay WS:${wsPort}] 🎮 CLIENT ayrıldı. (Kalan: ${clientSet.size})`);
        });
      }
    });

    const interval = setInterval(() => {
      wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
      });
    }, 15000);

    wss.on('close', () => clearInterval(interval));

    wss.on('error', (err) => {
      console.error(`Relay server error on port ${wsPort}:`, err);
    });
  } catch (err) {
    console.error(`Failed to start Relay proxy on port ${wsPort}:`, err);
  }
}


// WS -> UDP Proxy
function startWsProxy(wsPort, udpPort) {
  try {
    const wss = new WebSocketServer({ port: wsPort });
    console.log(`Started WebSocket Proxy on WS:${wsPort} -> UDP:${udpPort}`);

    wss.on('connection', (ws) => {
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });

      console.log(`[Proxy WS:${wsPort}] Yeni WebSocket bağlantısı kuruldu.`);
      const udpClient = dgram.createSocket('udp4');
      let clientPackets = 0;
      let serverPackets = 0;
      
      ws.on('message', (msg) => {
        clientPackets++;
        if (clientPackets <= 20) {
          const ascii = msg.toString('ascii').replace(/[^\x20-\x7E]/g, '.');
          console.log(`[Proxy WS:${wsPort} -> UDP:${udpPort}] [Paket #${clientPackets}] Tarayıcıdan sunucuya: ${msg.length} byte.`);
        }
        udpClient.send(msg, udpPort, '127.0.0.1', (err) => {
          if (err) console.error(`[Proxy WS:${wsPort} -> UDP:${udpPort}] UDP Gönderim Hatası:`, err);
        });
      });

      udpClient.on('message', (msg) => {
        serverPackets++;
        if (serverPackets <= 20) {
          const ascii = msg.toString('ascii').replace(/[^\x20-\x7E]/g, '.');
          console.log(`[Proxy UDP:${udpPort} -> WS:${wsPort}] [Paket #${serverPackets}] Sunucudan tarayıcıya: ${msg.length} byte.`);
        }
        if (ws.readyState === ws.OPEN) {
          ws.send(msg);
        }
      });

      ws.on('close', (code, reason) => {
        console.log(`[Proxy WS:${wsPort}] WebSocket bağlantısı kapandı. Kod: ${code}`);
        udpClient.close();
      });
      
      udpClient.on('error', (err) => {
        console.error(`UDP Client error for WS port ${wsPort}:`, err);
        udpClient.close();
      });
    });

    const interval = setInterval(() => {
      wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
      });
    }, 15000);

    wss.on('close', () => clearInterval(interval));

    wss.on('error', (err) => {
      console.error(`WebSocket server error on port ${wsPort}:`, err);
    });
  } catch (err) {
    console.error(`Failed to start WebSocket proxy on port ${wsPort}:`, err);
  }
}


app.get('/api/maps', (req, res) => {
  try {
    const mapsDir = path.join(CS_PATH, 'maps');
    if (!fs.existsSync(mapsDir)) return res.json({ maps: [], total: 0 });
    
    const files = fs.readdirSync(mapsDir)
      .filter(f => f.endsWith('.bsp'))
      .map(f => {
        const name = f.replace('.bsp', '');
        return {
          name,
          size: fs.statSync(path.join(mapsDir, f)).size,
          description: '',
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ maps: files, total: files.length });
  } catch (err) {
    console.error('/api/maps error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/wads', (req, res) => {
  try {
    const files = fs.readdirSync(CS_PATH).filter(f => f.toLowerCase().endsWith('.wad'));
    res.json({ wads: files });
  } catch (err) {
    console.error('/api/wads error:', err);
    res.status(500).json({ error: err.message });
  }
});

function serveFile(filePath, req, res) {
  try {
    if (!fs.existsSync(filePath)) {
      console.log('File not found:', filePath);
      return res.status(404).send('Not found');
    }
    const stat = fs.statSync(filePath);
    const total = stat.size;

    if (req.headers.range) {
      const range = req.headers.range.replace(/bytes=/, '').split('-');
      const start = parseInt(range[0], 10);
      const end   = range[1] && range[1] !== '' ? parseInt(range[1], 10) : total - 1;
      
      if (isNaN(start) || isNaN(end) || start >= total || end >= total) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}` });
        return res.end();
      }

      const chunkSize = (end - start) + 1;
      res.writeHead(206, {
        'Content-Range':  `bytes ${start}-${end}/${total}`,
        'Accept-Ranges':  'bytes',
        'Content-Length': chunkSize,
        'Content-Type':   'application/octet-stream',
      });
      const stream = fs.createReadStream(filePath, { start, end });
      stream.on('error', err => console.error('Stream error:', err));
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': total,
        'Content-Type':   'application/octet-stream',
        'Accept-Ranges':  'bytes',
      });
      const stream = fs.createReadStream(filePath);
      stream.on('error', err => console.error('Stream error:', err));
      stream.pipe(res);
    }
  } catch (err) {
    console.error('serveFile error:', err);
    if (!res.headersSent) res.status(500).send('Server Error');
  }
}

// Fallback sprite yolları: CS 1.5 kurulumunda eksik olabilecek dosyalar
// bu dizinlerden sırayla aranır.
const DMC_PATH   = path.join(HL_PATH, 'dmc');
const FALLBACK_PATHS = [CS_PATH, path.join(HL_PATH, 'valve'), DMC_PATH];

app.use('/cs-assets/cstrike', (req, res) => {
  // Önce cstrike'ta ara, yoksa valve → dmc fallback
  for (const base of FALLBACK_PATHS) {
    const filePath = path.join(base, req.path);
    if (fs.existsSync(filePath)) {
      if (base !== CS_PATH) {
        console.log(`📦 Fallback asset: ${req.path} (${path.basename(base)})`);
      }
      return serveFile(filePath, req, res);
    }
  }
  console.log(`📦 Asset not found anywhere: ${req.path}`);
  res.status(404).send('Not found');
});


app.use('/cs-assets/valve', (req, res) => {
  const filePath = path.join(VALVE_PATH, req.path);
  console.log(`📦 Valve Asset request: ${req.path}`);
  serveFile(filePath, req, res);
});

// Geriye dönük uyumluluk için eski harita yolu
app.get('/cs-assets/maps/:mapname.bsp', (req, res) => {
  const filePath = path.join(CS_PATH, 'maps', `${req.params.mapname}.bsp`);
  serveFile(filePath, req, res);
});

// Map önizleme görseli: /maps/:name.jpg
// CS haritaları kendi JPG önizlemesi içermediğinden dinamik SVG/PNG üretiyoruz.
app.get('/maps/:mapname.jpg', (req, res) => {
  const mapName = req.params.mapname || 'unknown';

  // Harita adından deterministik renk üret
  let hash = 0;
  for (let i = 0; i < mapName.length; i++) hash = (hash * 31 + mapName.charCodeAt(i)) >>> 0;
  const hue  = hash % 360;
  const hue2 = (hue + 40) % 360;

  // Harita tipine göre ikon karakteri
  const prefix = mapName.split('_')[0] || 'de';
  const icons = { de: '💣', cs: '🛡', as: '🎯', es: '💰', fy: '⚡' };
  const icon = icons[prefix] || '🗺';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="hsl(${hue},60%,18%)"/>
      <stop offset="100%" stop-color="hsl(${hue2},55%,12%)"/>
    </linearGradient>
    <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="hsl(${hue},40%,30%)" stroke-width="0.5" opacity="0.4"/>
    </pattern>
  </defs>
  <rect width="320" height="180" fill="url(#bg)"/>
  <rect width="320" height="180" fill="url(#grid)"/>
  <rect x="0" y="140" width="320" height="40" fill="rgba(0,0,0,0.5)"/>
  <text x="160" y="80" font-family="monospace" font-size="42" text-anchor="middle" dominant-baseline="middle" fill="rgba(255,255,255,0.15)" font-weight="bold">MAP</text>
  <text x="160" y="90" font-family="sans-serif" font-size="28" text-anchor="middle" dominant-baseline="middle">${icon}</text>
  <text x="160" y="162" font-family="monospace" font-size="13" text-anchor="middle" dominant-baseline="middle" fill="hsl(${hue},80%,75%)" font-weight="bold">${mapName}</text>
</svg>`;

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(svg);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[CS Asset Server] http://localhost:${PORT} üzerinde çalışıyor.`);
});
