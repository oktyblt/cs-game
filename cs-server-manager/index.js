const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const Docker = require('dockerode');
const nodeDataChannel = require('node-datachannel');
require('dotenv').config();
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');

// Node.js < 22 için global WebSocket polyfill
global.WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nobzqygwzuqdlipnuchi.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_UCmJqqwDuYcPuxALFv8Z0w_VJrFZ8F-';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const ADMIN_PASS = process.env.ADMIN_PASS || 'browsercsadmin';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin_secret_token_777';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://browsercs.com';

// Anon client — kullanıcı işlemleri (auth.getUser vb.)
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Service role client — RLS bypass, sadece backend içi DB işlemleri
const supabaseAdmin = SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  : supabase; // Service key yoksa anon'a düş (test ortamları için)

const app = express();

// CORS: browsercs.com, cs-web-game.pages.dev ve localhost (development)
const allowedOrigins = [
  CORS_ORIGIN,
  'https://browsercs.com',
  'https://www.browsercs.com',
  'http://localhost:3000',
  'http://localhost:5173'
];
app.use(cors({
  origin: (origin, callback) => {
    // origin undefined = same-origin / curl testleri
    // Cloudflare Pages preview URLs: *.cs-web-game.pages.dev
    if (!origin || allowedOrigins.includes(origin) || /^https:\/\/[a-z0-9-]+\.cs-web-game\.pages\.dev$/.test(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS policy: Bu origin izinli değil: ' + origin));
    }
  },
  credentials: true
}));
app.use(express.json());

// Nginx/proxy arkasında çalışırken X-Forwarded-For güvenini aç
app.set('trust proxy', 1);

// Rate Limiting
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 dakika
  max: 10, // 15 dakikada en fazla 10 deneme
  message: { success: false, error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false } // proxy arkasında false bırak
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 dakika
  max: 60, // 60 istek/dakika
  message: { success: false, error: 'Too many requests. Please slow down.' },
  validate: { xForwardedForHeader: false }
});

app.use('/api/', apiLimiter);

const docker = new Docker(); // Connects to local docker socket by default

const PORT = process.env.PORT || 4000;
const DOCKER_IMAGE = process.env.DOCKER_IMAGE || 'xash3d-cs15-server:latest';

// Utility to create a server
async function createServerContainer(options) {
  const { map, maxplayers, name, port, isOfficial, owner_id } = options;

  // Supabase'den ayarları çekelim
  let serverSettings = {
    rcon_password: 'admin',
    start_money: 16000,
    gravity: 800,
    round_time: 5,
    admin_name: '',
    admin_password: ''
  };

  try {
    const { data: dbServer } = await supabase
      .from('purchased_servers')
      .select('rcon_password, start_money, gravity, round_time, admin_name, admin_password')
      .eq('owner_id', owner_id)
      .eq('port', port)
      .single();
      
    if (dbServer) {
      if (dbServer.rcon_password !== null) serverSettings.rcon_password = dbServer.rcon_password;
      if (dbServer.start_money !== null) serverSettings.start_money = dbServer.start_money;
      if (dbServer.gravity !== null) serverSettings.gravity = dbServer.gravity;
      if (dbServer.round_time !== null) serverSettings.round_time = dbServer.round_time;
      if (dbServer.admin_name !== null) serverSettings.admin_name = dbServer.admin_name;
      if (dbServer.admin_password !== null) serverSettings.admin_password = dbServer.admin_password;
    }
  } catch (e) { console.error("Supabase settings fetch error", e); }

  // Yalıtılmış konfigürasyon dizini oluştur
  const configDir = `/home/ubuntu/server_configs/${port}`;
  fs.mkdirSync(configDir, { recursive: true });

  // Sunucu adını normalize et (Türkçe karakterleri kaldır) ve BROWSERCS ekle
  const formatHostname = (rawName) => {
    const trMap = {
      'ç': 'c', 'Ç': 'C', 'ğ': 'g', 'Ğ': 'G', 'ı': 'i', 'I': 'I',
      'i': 'i', 'İ': 'I', 'ö': 'o', 'Ö': 'O', 'ş': 's', 'Ş': 'S',
      'ü': 'u', 'Ü': 'U'
    };
    const cleanName = String(rawName || '').replace(/[çÇğĞıIİöÖşŞüÜ]/g, m => trMap[m]);
    return `BROWSERCS | ${cleanName}`;
  };
  const finalHostname = formatHostname(name);

  const serverCfgContent = `
hostname "${finalHostname}"
rcon_password "${serverSettings.rcon_password}"
mp_startmoney ${serverSettings.start_money}
sv_gravity ${serverSettings.gravity}
mp_roundtime ${serverSettings.round_time}
mp_consistency 0
sv_consistency 0
sv_fileconsistency 0
`;
  fs.writeFileSync(path.join(configDir, 'server.cfg'), serverCfgContent.trim());

  let usersIniContent = ``;
  if (serverSettings.admin_name) {
    usersIniContent = `"${serverSettings.admin_name}" "${serverSettings.admin_password || ''}" "abcdefghijklmnopqrstu" "a"\n`;
  }
  fs.writeFileSync(path.join(configDir, 'users.ini'), usersIniContent);

  // We map the container's 27015 UDP port to the host's \`port\`
  const container = await docker.createContainer({
    Image: DOCKER_IMAGE,
    name: `cs15-${port}`,
    Tty: true,
    Cmd: [
      'sh', '-c',
      `cd /opt/xashds && exec ./xash -dedicated -game cstrike +map "${map}" +maxplayers "${maxplayers}" +hostname "${finalHostname}" +sv_lan 1 +port 27015 +servercfgfile server.cfg`
    ],
    HostConfig: {
      Binds: [
        '/home/ubuntu/xashds/xashds-linux-i386/xash:/opt/xashds/xash',
        '/home/ubuntu/xashds/xashds-linux-i386/filesystem_stdio.so:/opt/xashds/filesystem_stdio.so',
        '/home/ubuntu/valve:/opt/xashds/valve',
        '/home/ubuntu/cstrike:/opt/xashds/cstrike',
        `${configDir}/server.cfg:/opt/xashds/cstrike/server.cfg`,
        `${configDir}/users.ini:/opt/xashds/cstrike/addons/amxmodx/configs/users.ini`
      ],
      PortBindings: {
        '27015/udp': [{ HostPort: port.toString() }],
        '27015/tcp': [{ HostPort: port.toString() }]
      },
      RestartPolicy: isOfficial ? { Name: 'always' } : { Name: 'no' }
    },
    Env: [
      `MAP=${map}`,
      `MAXPLAYERS=${maxplayers}`,
      `HOSTNAME=${name}`,
      `PORT=27015`
    ],
    Labels: {
      'cs-web-game': 'true',
      'isOfficial': isOfficial ? 'true' : 'false',
      'serverName': name,
      'mapName': map,
      'maxPlayers': maxplayers.toString(),
      'owner_id': owner_id || ''
    }
  });

  await container.start();
  
  try {
    const exec = await container.exec({
      Cmd: ['sh', '-c', `echo 'sv_allowdownload 1\nsv_downloadurl "https://browsercs.com/cs-assets/"\nsv_timeout 999\nmp_timelimit 30\nmp_roundtime 3\nmp_freezetime 0\nmp_consistency 0\nsv_consistency 0\nsv_lan 1\nsys_ticrate 100\n' >> cstrike/server.cfg`],
      AttachStdout: true, AttachStderr: true
    });
    await exec.start();
  } catch (err) {
    console.error("Failed to inject FastDL settings:", err);
  }

  return container;
}

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Oturum açmanız gerekiyor' });
  }
  const token = authHeader.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return res.status(401).json({ success: false, error: 'Geçersiz veya süresi dolmuş oturum' });
  }
  req.user = user;
  next();
}

app.post('/api/start-server', loginLimiter, requireAuth, async (req, res) => {
  try {
    const { map, maxplayers, name, host } = req.body;
    const serverName = name || `${host || 'CS'}'s Server`;
    const serverMap  = map || 'de_dust2';
    const serverSlots = parseInt(maxplayers) || 16;
    
    // Mevcut kullanıcı port aralığını kontrol ederek çakışmayan port bul
    const existingContainers = await docker.listContainers({ all: true });
    const usedPorts = new Set();
    existingContainers.forEach(c => {
      if (c.Ports) c.Ports.forEach(p => { if (p.PublicPort) usedPorts.add(p.PublicPort); });
    });
    
    let port = 27200;
    while (usedPorts.has(port) && port < 28000) port++;
    if (port >= 28000) {
      return res.status(503).json({ success: false, error: 'Sunucu kapasitesi dolu.' });
    }
    
    const container = await createServerContainer({
      map: serverMap,
      maxplayers: serverSlots,
      name: serverName,
      port: port,
      isOfficial: false,
      owner_id: req.user.id
    });

    // purchased_servers kaydını service role ile oluştur (RLS bypass)
    let serverDbId = null;
    try {
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 10);

      // Önce eski kaydı temizle (farklı sahibe ait eski port kaydı varsa)
      await supabaseAdmin.from('purchased_servers').delete().eq('port', port);

      // Yeni kaydı ekle
      const { data: insertData, error: insertErr } = await supabaseAdmin
        .from('purchased_servers')
        .insert([{
          owner_id: req.user.id,
          name: serverName,
          map: serverMap,
          max_players: serverSlots,
          status: 'running',
          port: port,
          container_id: container.id,
          expires_at: expiresAt.toISOString()
        }])
        .select('id')
        .single();

      if (insertErr) {
        console.warn('[start-server] purchased_servers INSERT hatası:', insertErr.message);
      } else {
        serverDbId = insertData?.id || null;
        console.log('[start-server] purchased_servers kaydı oluşturuldu, port:', port, 'id:', serverDbId);
      }
    } catch(dbErr) {
      console.warn('[start-server] DB kayıt hatası (sunucu yine de çalışıyor):', dbErr.message);
    }

    res.json({ success: true, containerId: container.id, port, serverId: serverDbId });
  } catch (err) {
    console.error("Error starting server:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// removed duplicate dgram

function queryA2S(ip, port) {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    let resolved = false;
    const req = Buffer.from([0xFF, 0xFF, 0xFF, 0xFF, 0x54, 0x53, 0x6F, 0x75, 0x72, 0x63, 0x65, 0x20, 0x45, 0x6E, 0x67, 0x69, 0x6E, 0x65, 0x20, 0x51, 0x75, 0x65, 0x72, 0x79, 0x00]);

    const timeout = setTimeout(() => {
      if (!resolved) { resolved = true; client.close(); resolve(null); }
    }, 500);

    client.on('message', (msg) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      client.close();
      try {
        let offset = 4;
        const header = msg.readUInt8(offset++);
        if (header === 0x6D) { // GoldSrc format
          while (msg.readUInt8(offset++) !== 0) {} // address
          while (msg.readUInt8(offset++) !== 0) {} // servername
          let mapStart = offset;
          while (msg.readUInt8(offset++) !== 0) {}
          const map = msg.toString('utf8', mapStart, offset - 1);
          while (msg.readUInt8(offset++) !== 0) {} // gamedir
          while (msg.readUInt8(offset++) !== 0) {} // gamedesc
          const players = msg.readUInt8(offset++);
          const maxPlayers = msg.readUInt8(offset++);
          resolve({ map, players, maxPlayers });
        } else if (header === 0x49) { // Source Engine format
          offset++; // protocol (byte)
          while (msg.readUInt8(offset++) !== 0) {} // servername
          let mapStart = offset;
          while (msg.readUInt8(offset++) !== 0) {}
          const map = msg.toString('utf8', mapStart, offset - 1);
          while (msg.readUInt8(offset++) !== 0) {} // gamedir
          while (msg.readUInt8(offset++) !== 0) {} // gamedesc
          offset += 2; // ID (short)
          const players = msg.readUInt8(offset++);
          const maxPlayers = msg.readUInt8(offset++);
          resolve({ map, players, maxPlayers });
        } else {
          resolve(null);
        }
      } catch (e) { resolve(null); }
    });

    client.on('error', () => {
      if (!resolved) { resolved = true; clearTimeout(timeout); client.close(); resolve(null); }
    });

    client.send(req, 0, req.length, port, ip);
  });
}

// GoldSrc RCON function
function sendRcon(ip, port, password, command) {
  return new Promise((resolve, reject) => {
    const client = dgram.createSocket('udp4');
    let responseText = '';
    let responseTimer = null;

    const timeoutTimer = setTimeout(() => {
      clearTimeout(responseTimer);
      client.close();
      reject(new Error('RCON Timeout - Şifre yanlış olabilir veya sunucu kapalı.'));
    }, 5000);

    client.on('message', (msg) => {
      // Strip the 4-byte \xff\xff\xff\xff header from raw buffer, then decode as UTF-8
      const payload = msg.slice(4).toString('utf8')
        .replace(/\x00/g, '')           // null bytes
        .replace(/ÿÿÿÿ/g, '')          // residual header mojibake
        .replace(/^\s*print\s*/gm, '') // Xash3D "print" prefix
        .trim();
      if (payload) responseText += (responseText ? '\n' : '') + payload;

      // Collect for 200ms (Xash3D may send multiple packets)
      clearTimeout(responseTimer);
      responseTimer = setTimeout(() => {
        clearTimeout(timeoutTimer);
        client.close();
        resolve(responseText.trim());
      }, 200);
    });

    client.on('error', (err) => {
      clearTimeout(timeoutTimer);
      clearTimeout(responseTimer);
      try { client.close(); } catch(e) {}
      reject(err);
    });

    // Xash3D RCON: direkt format, challenge yok
    // Format: \xFF\xFF\xFF\xFF rcon "password" command \n
    const pkt = Buffer.concat([
      Buffer.from([0xff, 0xff, 0xff, 0xff]),
      Buffer.from(`rcon "${password}" ${command}\n`, 'utf8')
    ]);
    client.send(pkt, 0, pkt.length, port, ip);
  });
}

app.get('/api/servers', async (req, res) => {
  try {
    const containers = await docker.listContainers({
      filters: { label: ['cs-web-game=true'] }
    });

    const servers = await Promise.all(containers.map(async c => {
      const isOfficial = c.Labels.isOfficial === 'true';
      const port = c.Ports.find(p => p.PrivatePort === 27015)?.PublicPort || 0;
      
      let currentMap = c.Labels.mapName;
      let currentPlayers = 0;
      const maxPlayers = parseInt(c.Labels.maxPlayers) || 16;

      if (c.State === 'running' && port) {
        const a2s = await queryA2S('127.0.0.1', port);
        if (a2s && a2s.map) {
          currentMap = a2s.map;
          currentPlayers = a2s.players;
        }
      }

      return {
        id: c.Id,
        name: c.Labels.serverName,
        map: currentMap,
        players: currentPlayers,
        maxplayers: maxPlayers,
        port: port,
        isOfficial: isOfficial,
        owner_id: c.Labels.owner_id || null,   // Sunucu sahibini frontend'e bildir (Yönet butonu için)
        state: c.State
      };
    }));

    res.json({ success: true, servers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin Endpoints
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (token === ADMIN_TOKEN) {
    next();
  } else {
    res.status(403).json({ success: false, error: 'Yetkisiz erişim' });
  }
}

app.post('/api/admin/login', loginLimiter, express.json(), (req, res) => {
  if (req.body.password === ADMIN_PASS) {
    res.json({ success: true, token: ADMIN_TOKEN });
  } else {
    res.status(401).json({ success: false, error: 'Hatalı şifre' });
  }
});

app.delete('/api/admin/servers/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const container = docker.getContainer(id);
    await container.remove({ force: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Server Yönetim Endpoint'leri — hem UUID hem Docker container ID kabul eder
app.post('/api/servers/:id/command', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { rconPassword, command } = req.body;

    if (!rconPassword) return res.status(400).json({ success: false, error: 'RCON şifresi gerekli.' });
    if (!command) return res.status(400).json({ success: false, error: 'Komut gerekli.' });

    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    let port = null;

    if (isUUID) {
      // Kullanıcının JWT token'ı ile user-scoped sorgu (RLS uyumlu)
      const authHeader = req.headers.authorization;
      const token = authHeader ? authHeader.split(' ')[1] : null;
      let dbServer = null;

      if (token) {
        const userSb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          global: { headers: { Authorization: `Bearer ${token}` } }
        });
        const { data } = await userSb.from('purchased_servers').select('port, owner_id').eq('id', id).single();
        dbServer = data;
      }

      if (dbServer) {
        // RLS ile bulundu
        if (dbServer.owner_id !== req.user.id) return res.status(403).json({ success: false, error: 'Bu sunucuyu yönetme yetkiniz yok.' });
        port = dbServer.port;
      } else {
        // RLS bulamadı → Docker container listesinde owner_id label'ına göre ara
        const containers = await docker.listContainers({ filters: { label: [`cs-web-game=true`, `owner_id=${req.user.id}`] } });
        if (containers.length === 0) return res.status(404).json({ success: false, error: 'Aktif sunucu bulunamadı.' });
        // Birden fazla container varsa port en büyüğünü al (en son başlatılan)
        const container = containers[0];
        const boundPort = container.Ports.find(p => p.PrivatePort === 27015)?.PublicPort;
        if (!boundPort) return res.status(400).json({ success: false, error: 'Sunucu kapalı veya port bulunamadı.' });
        port = boundPort;
      }
    } else {
      // Docker container ID → inspect → port bul
      const container = docker.getContainer(id);
      const info = await container.inspect();
      if (info.Config.Labels.owner_id !== req.user.id) {
        return res.status(403).json({ success: false, error: 'Bu sunucuyu yönetme yetkiniz yok.' });
      }
      const portBind = info.NetworkSettings.Ports['27015/udp'];
      if (!portBind) throw new Error('Sunucu kapalı');
      port = parseInt(portBind[0].HostPort);
    }

    const response = await sendRcon('127.0.0.1', port, rconPassword, command);
    res.json({ success: true, response });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


// Tek başına RCON şifre güncelleme
app.post('/api/servers/:id/rcon', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { rconPassword } = req.body;
    if (!rconPassword) return res.status(400).json({ success: false, error: 'RCON şifresi gerekli.' });

    // settings endpoint'ini yeniden kullan (sadece rconPassword güncelle)
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ success: false, error: 'Authorization gerekli.' });
    const token = authHeader.split(' ')[1];
    const { createClient } = require('@supabase/supabase-js');
    const userSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    let dbServer = null;
    if (isUUID) {
      const { data } = await userSupabase.from('purchased_servers').select('*').eq('id', id).single();
      dbServer = data;
    } else {
      const info = await docker.getContainer(id).inspect().catch(() => null);
      if (info) {
        const port = info.HostConfig.PortBindings?.['27015/udp']?.[0]?.HostPort;
        if (port) {
          const { data } = await userSupabase.from('purchased_servers').select('*').eq('port', parseInt(port)).single();
          dbServer = data;
        }
      }
    }
    if (!dbServer || dbServer.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Yetki yok veya sunucu bulunamadı.' });
    }

    await userSupabase.from('purchased_servers').update({ rcon_password: rconPassword }).eq('id', dbServer.id);

    // server.cfg güncelle
    const configDir = `/home/ubuntu/server_configs/${dbServer.port}`;
    const cfgPath = `${configDir}/server.cfg`;
    if (fs.existsSync(cfgPath)) {
      let cfg = fs.readFileSync(cfgPath, 'utf8');
      cfg = cfg.replace(/rcon_password\s+".*?"/, `rcon_password "${rconPassword}"`);
      fs.writeFileSync(cfgPath, cfg);
    }

    res.json({ success: true, message: 'RCON şifresi güncellendi.' });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Admin ekleme
app.post('/api/servers/:id/admin', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { adminName, adminPassword } = req.body;
    if (!adminName) return res.status(400).json({ success: false, error: 'Admin adı gerekli.' });

    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ success: false, error: 'Authorization gerekli.' });
    const token = authHeader.split(' ')[1];
    const { createClient } = require('@supabase/supabase-js');
    const userSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    let dbServer = null;
    if (isUUID) {
      const { data } = await userSupabase.from('purchased_servers').select('*').eq('id', id).single();
      dbServer = data;
    } else {
      const info = await docker.getContainer(id).inspect().catch(() => null);
      if (info) {
        const port = info.HostConfig.PortBindings?.['27015/udp']?.[0]?.HostPort;
        if (port) {
          const { data } = await userSupabase.from('purchased_servers').select('*').eq('port', parseInt(port)).single();
          dbServer = data;
        }
      }
    }
    if (!dbServer || dbServer.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Yetki yok veya sunucu bulunamadı.' });
    }

    await userSupabase.from('purchased_servers').update({ admin_name: adminName, admin_password: adminPassword || '' }).eq('id', dbServer.id);

    // users.ini güncelle
    const configDir = `/home/ubuntu/server_configs/${dbServer.port}`;
    fs.mkdirSync(configDir, { recursive: true });
    const usersIni = adminName ? `"${adminName}" "${adminPassword || ''}" "abcdefghijklmnopqrstu" "a"\n` : '';
    fs.writeFileSync(`${configDir}/users.ini`, usersIni);

    res.json({ success: true, message: `${adminName} admin olarak eklendi.` });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Tek sunucu durumu sorgulama
app.get('/api/servers/:id/status', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const container = docker.getContainer(id);
    const info = await container.inspect();

    if (info.Config.Labels.owner_id && info.Config.Labels.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Yetki yok.' });
    }

    const portBind = info.NetworkSettings.Ports?.['27015/udp'];
    const port = portBind ? parseInt(portBind[0].HostPort) : null;
    let a2sData = null;
    if (port && info.State.Running) {
      a2sData = await queryA2S('127.0.0.1', port).catch(() => null);
    }

    res.json({
      success: true,
      id: info.Id,
      name: info.Config.Labels.serverName,
      state: info.State.Status,
      running: info.State.Running,
      port,
      map: a2sData?.map || info.Config.Labels.mapName,
      players: a2sData?.players || 0,
      maxplayers: parseInt(info.Config.Labels.maxPlayers) || 16,
      startedAt: info.State.StartedAt
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Stripe key yönetimi (admin only)
app.post('/api/admin/stripe', requireAdmin, (req, res) => {
  try {
    const { stripeSecretKey, stripeWebhookSecret } = req.body;
    if (!stripeSecretKey) return res.status(400).json({ success: false, error: 'Stripe key gerekli.' });

    // .env dosyasına yaz (runtime güncelleme)
    const envPath = path.join(__dirname, '.env');
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    
    if (envContent.includes('STRIPE_SECRET_KEY=')) {
      envContent = envContent.replace(/STRIPE_SECRET_KEY=.*/g, `STRIPE_SECRET_KEY=${stripeSecretKey}`);
    } else {
      envContent += `\nSTRIPE_SECRET_KEY=${stripeSecretKey}`;
    }
    if (stripeWebhookSecret) {
      if (envContent.includes('STRIPE_WEBHOOK_SECRET=')) {
        envContent = envContent.replace(/STRIPE_WEBHOOK_SECRET=.*/g, `STRIPE_WEBHOOK_SECRET=${stripeWebhookSecret}`);
      } else {
        envContent += `\nSTRIPE_WEBHOOK_SECRET=${stripeWebhookSecret}`;
      }
    }
    fs.writeFileSync(envPath, envContent);
    
    // Runtime'da da güncelle
    process.env.STRIPE_SECRET_KEY = stripeSecretKey;
    if (stripeWebhookSecret) process.env.STRIPE_WEBHOOK_SECRET = stripeWebhookSecret;
    
    console.log('[Admin] Stripe keys updated.');
    res.json({ success: true, message: 'Stripe anahtarları güncellendi.' });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Genel istatistikler (auth gerektirmiyor)
app.get('/api/stats', async (req, res) => {
  try {
    const containers = await docker.listContainers({
      filters: { label: ['cs-web-game=true'] }
    });
    const running = containers.filter(c => c.State === 'running');
    let totalPlayers = 0;
    for (const c of running) {
      const portData = c.Ports?.find(p => p.PrivatePort === 27015 && p.Type === 'udp');
      if (portData?.PublicPort) {
        const a2s = await queryA2S('127.0.0.1', portData.PublicPort).catch(() => null);
        if (a2s) totalPlayers += a2s.players || 0;
      }
    }
    res.json({ success: true, activeServers: running.length, totalServers: containers.length, totalPlayers });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});



// GET /api/servers/:id — tek sunucu detayı
app.get('/api/servers/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.split(' ')[1] : null;
    if (!token) return res.status(401).json({ success: false, error: 'Authorization gerekli.' });
    const userSb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
    const { data, error } = await userSb.from('purchased_servers').select('*').eq('id', id).single();
    if (error || !data) return res.status(404).json({ success: false, error: 'Sunucu bulunamadı.' });
    res.json({ success: true, server: data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/servers/:id/write-cfg — server'a cfg dosyası yaz (restart gerektirmez)
app.post('/api/servers/:id/write-cfg', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { filename, content } = req.body;
    if (!filename || !/^[a-zA-Z0-9_]+$/.test(filename)) {
      return res.status(400).json({ success: false, error: 'Geçersiz dosya adı.' });
    }
    if (!content) return res.status(400).json({ success: false, error: 'İçerik gerekli.' });

    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.split(' ')[1] : null;
    if (!token) return res.status(401).json({ success: false, error: 'Authorization gerekli.' });
    const userSb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    let port = null;

    if (isUUID) {
      const { data } = await userSb.from('purchased_servers').select('port, owner_id').eq('id', id).single();
      if (!data) return res.status(404).json({ success: false, error: 'Sunucu bulunamadı.' });
      if (data.owner_id !== req.user.id) return res.status(403).json({ success: false, error: 'Yetki yok.' });
      port = data.port;
    } else {
      const containers = await docker.listContainers({ filters: { label: [`cs-web-game=true`, `owner_id=${req.user.id}`] } });
      const c = containers.find(c => c.Id.startsWith(id)) || containers[0];
      if (!c) return res.status(404).json({ success: false, error: 'Container bulunamadı.' });
      port = c.Ports.find(p => p.PrivatePort === 27015)?.PublicPort;
      if (!port) return res.status(400).json({ success: false, error: 'Port bulunamadı.' });
    }

    const configDir = `/home/ubuntu/server_configs/${port}`;
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, `${filename}.cfg`), content, 'utf8');
    res.json({ success: true, path: `${configDir}/${filename}.cfg` });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/servers/:id/settings', requireAuth, async (req, res) => {


  try {
    const { id } = req.params;
    const { rconPassword, startMoney, gravity, roundTime, c4Timer, adminName, adminPassword } = req.body;
    
    // Auth object var mı kontrol et
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ success: false, error: 'Authorization header eksik.' });
    }
    const token = authHeader.split(' ')[1];

    const { createClient } = require('@supabase/supabase-js');
    const userSupabase = createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    let dbServer = null;
    let containerId = id;

    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (isUUID) {
      const { data, error } = await userSupabase.from('purchased_servers').select('*').eq('id', id).single();
      if (data) {
        dbServer = data;
        containerId = data.container_id;
      } else {
        // RLS / kayıt yok → Docker'da owner_id label'ına göre ara
        const containers = await docker.listContainers({ filters: { label: [`cs-web-game=true`, `owner_id=${req.user.id}`] } });
        if (containers.length === 0) {
          return res.status(404).json({ success: false, error: 'Aktif sunucu bulunamadı.' });
        }
        const c = containers[0];
        const boundPort = c.Ports.find(p => p.PrivatePort === 27015)?.PublicPort;
        if (!boundPort) return res.status(400).json({ success: false, error: 'Sunucu kapalı veya port bulunamadı.' });
        // Geçici dbServer objesi oluştur
        dbServer = { id: null, owner_id: req.user.id, port: boundPort, rcon_password: 'admin', start_money: 16000, gravity: 800, round_time: 5 };
        containerId = c.Id;
      }
    } else {
      const containerInfo = await docker.getContainer(id).inspect().catch(() => null);
      if (!containerInfo) {
         return res.status(404).json({ success: false, error: 'Sunucu container bilgisi bulunamadı.' });
      }
      const portBindings = containerInfo.HostConfig.PortBindings['27015/udp'];
      const portStr = portBindings ? portBindings[0].HostPort : null;
      if (!portStr) return res.status(404).json({ success: false, error: 'Sunucu port bilgisi bulunamadı.' });
      
      const { data, error } = await userSupabase.from('purchased_servers').select('*').eq('port', parseInt(portStr)).single();
      if (error || !data) return res.status(404).json({ success: false, error: 'Sunucu veritabanında bulunamadı.' });
      dbServer = data;
    }

    if (dbServer.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Bu sunucuyu yönetme yetkiniz yok.' });
    }

    const container = docker.getContainer(containerId);

    // Update payload oluştur
    const updates = {};
    if (rconPassword !== undefined && rconPassword !== '') updates.rcon_password = rconPassword;
    if (startMoney !== undefined && startMoney !== '') updates.start_money = parseInt(startMoney);
    if (gravity !== undefined && gravity !== '') updates.gravity = parseInt(gravity);
    if (roundTime !== undefined && roundTime !== '') updates.round_time = parseInt(roundTime);
    if (adminName !== undefined) updates.admin_name = adminName;
    if (adminPassword !== undefined) updates.admin_password = adminPassword;

    // Supabase'de kayıt varsa güncelle (Docker fallback durumunda id null olur)
    if (dbServer.id && Object.keys(updates).length > 0) {
      const { error: updateErr } = await userSupabase
        .from('purchased_servers')
        .update(updates)
        .eq('id', dbServer.id);
        
      if (updateErr) {
        console.warn('Supabase update warning:', updateErr.message);
        // Kritik değil, cfg dosyası yine de yazılacak
      }
    }

    // Ayarları dosyaya tekrar yaz
    const port = dbServer.port;
    const configDir = `/home/ubuntu/server_configs/${port}`;
    fs.mkdirSync(configDir, { recursive: true });

    // Mevcut değerleri al
    const s_rcon = updates.rcon_password !== undefined ? updates.rcon_password : (dbServer.rcon_password || 'admin');
    const s_money = updates.start_money !== undefined ? updates.start_money : (dbServer.start_money || 16000);
    const s_grav = updates.gravity !== undefined ? updates.gravity : (dbServer.gravity || 800);
    const s_round = updates.round_time !== undefined ? updates.round_time : (dbServer.round_time || 5);
    const s_admin = updates.admin_name !== undefined ? updates.admin_name : (dbServer.admin_name || '');
    const s_pass = updates.admin_password !== undefined ? updates.admin_password : (dbServer.admin_password || '');

    const formatHostname = (rawName) => {
      const trMap = {
        'ç': 'c', 'Ç': 'C', 'ğ': 'g', 'Ğ': 'G', 'ı': 'i', 'I': 'I',
        'i': 'i', 'İ': 'I', 'ö': 'o', 'Ö': 'O', 'ş': 's', 'Ş': 'S',
        'ü': 'u', 'Ü': 'U'
      };
      const cleanName = String(rawName || '').replace(/[çÇğĞıIİöÖşŞüÜ]/g, m => trMap[m]);
      return `BROWSERCS | ${cleanName}`;
    };
    const finalHostname = formatHostname(dbServer.name);

    const serverCfgContent = `
hostname "${finalHostname}"
rcon_password "${s_rcon}"
mp_startmoney ${s_money}
sv_gravity ${s_grav}
mp_roundtime ${s_round}
mp_consistency 0
sv_consistency 0
sv_fileconsistency 0
`;
    fs.writeFileSync(path.join(configDir, 'server.cfg'), serverCfgContent.trim());

    let usersIniContent = ``;
    if (s_admin) {
      usersIniContent = `"${s_admin}" "${s_pass || ''}" "abcdefghijklmnopqrstu" "a"\n`;
    }
    fs.writeFileSync(path.join(configDir, 'users.ini'), usersIniContent);

    // Restart the container to apply changes
    await container.restart();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Eski / Eski kalıntıları silmeye gerek yok, geriye dönük uyumluluk kalsın
app.post('/api/servers/:id/restart', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const container = docker.getContainer(id);
    const info = await container.inspect();
    
    // Owner kontrolü - sadece kendi sunucusunu restart edebilir
    if (info.Config.Labels.owner_id && info.Config.Labels.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Bu sunucuyu yeniden başlatma yetkiniz yok.' });
    }
    
    // Resmi sunucular sadece admin restart edebilir
    if (info.Config.Labels.isOfficial === 'true') {
      const adminHeader = req.headers['x-admin-token'];
      if (adminHeader !== ADMIN_TOKEN) {
        return res.status(403).json({ success: false, error: 'Resmi sunucular sadece admin tarafından yeniden başlatılabilir.' });
      }
    }
    
    try {
      const exec = await container.exec({
        Cmd: ['sh', '-c', 'echo \'sv_allowdownload 1\nsv_downloadurl "https://browsercs.com/cs-assets/"\nsv_timeout 999\nmp_timelimit 30\nmp_roundtime 3\nmp_freezetime 0\nmp_consistency 0\nsv_consistency 0\n\' >> cstrike/server.cfg'],
        AttachStdout: true, AttachStderr: true
      });
      await exec.start();
    } catch(e) { }

    await container.restart();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Start official servers on startup
async function startOfficialServers() {
  const officialMaps = ['de_dust2', 'de_dust', 'de_inferno', 'de_aztec', 'fy_iceworld'];
  let startingPort = 27015;

  try {
    // Check existing official servers
    const existing = await docker.listContainers({
      all: true,
      filters: { label: ['isOfficial=true'] }
    });

    for (let i = 0; i < officialMaps.length; i++) {
      const map = officialMaps[i];
      const port = startingPort + i;
      
      const exists = existing.find(c => c.Names.includes(`/cs15-${port}`));
      if (!exists) {
        console.log(`Starting official server for ${map} on port ${port}...`);
        try {
          await createServerContainer({
            map: map,
            maxplayers: 32,
            name: `CS BROWSER OFFICIAL - ${map}`,
            port: port,
            isOfficial: true
          });
        } catch (e) {
          console.error(`Failed to start official server on port ${port}:`, e.message);
        }
      } else {
        if (exists.State !== 'running') {
          console.log(`Restarting official server on port ${port}...`);
          const container = docker.getContainer(exists.Id);
          await container.start();
        }
      }
    }
  } catch(e) {
    console.error("Error managing official servers:", e.message);
  }
}
// --- WEBRTC SIGNALING & RELAY ---
const peers = new Map();
// STUN/TURN sunucuları - 5 STUN + 3 TURN ile NAT traversal güvenilirliği artırıldı
const rtcConfig = {
  iceServers: [
    'stun:stun.l.google.com:19302',
    'stun:stun1.l.google.com:19302',
    'stun:stun2.l.google.com:19302',
    'stun:stun3.l.google.com:19302',
    'stun:stun.cloudflare.com:3478',
    'stun:relay.metered.ca:80',
    'turn:relay.metered.ca:80?transport=udp&username=openrelayproject&credential=openrelayproject',
    'turn:relay.metered.ca:443?transport=tcp&username=openrelayproject&credential=openrelayproject',
    'turns:relay.metered.ca:443?transport=tcp&username=openrelayproject&credential=openrelayproject'
  ],
  iceTransportPolicy: 'all'
};

app.post('/webrtc/offer', (req, res) => {
  const { gamePort, sdp } = req.body;
  if (!gamePort || !sdp) return res.status(400).json({ error: 'Missing gamePort or sdp' });

  const peerId = Math.random().toString(36).substr(2, 9);
  const peer = new nodeDataChannel.PeerConnection(peerId, rtcConfig);
  const udpSocket = dgram.createSocket('udp4');
  let dataChannel = null;

  peer.onDataChannel((dc) => {
    dataChannel = dc;
    dataChannel.onMessage((msg) => {
      const buf = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
      udpSocket.send(buf, gamePort, '127.0.0.1');
    });
    dataChannel.onClosed(() => {
      console.log(`[WebRTC] DataChannel kapandı - peer ${peerId} disconnect`);
      // Xash3D disconnect paketi gönder (0xff 0xff 0xff 0xff + "disconnect\n")
      const disc = Buffer.from([0xff, 0xff, 0xff, 0xff, ...Buffer.from('disconnect\n')]);
      try { udpSocket.send(disc, gamePort, '127.0.0.1'); } catch(e) {}
      setTimeout(() => { try { udpSocket.close(); } catch(e) {} }, 500);
    });
  });

  udpSocket.on('message', (msg) => {
    if (dataChannel && dataChannel.isOpen()) {
      dataChannel.sendMessageBinary(msg);
    }
  });

  let answerSent = false;
  peer.onLocalDescription((answerSdp, type) => {
    if (!answerSent) {
      answerSent = true;
      res.json({ peerId, sdp: answerSdp, type });
    }
  });

  const candidates = [];
  peer.onLocalCandidate((candidate, mid) => {
    candidates.push({ candidate, mid });
  });

  peer.onStateChange((state) => {
    console.log(`[WebRTC] Peer ${peerId} state: ${state}`);
    if (state === 'failed' || state === 'closed' || state === 'disconnected') {
      // Disconnect sinyali gönder
      const disc = Buffer.from([0xff, 0xff, 0xff, 0xff, ...Buffer.from('disconnect\n')]);
      try { udpSocket.send(disc, gamePort, '127.0.0.1'); } catch(e) {}
      // Cleanup'ı geciktir: client hala candidates polling yapıyor olabilir
      setTimeout(() => {
        try { udpSocket.close(); } catch(e) {}
        peers.delete(peerId);
        try { peer.close(); } catch(e) {}
      }, 5000);
    }
  });

  try {
    peer.setRemoteDescription(sdp, 'offer');
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }

  peers.set(peerId, { peer, udpSocket, candidates });
});

app.get('/webrtc/candidates/:peerId', (req, res) => {
  const p = peers.get(req.params.peerId);
  // 404 yerine boş array dön - client retry yapabilsin
  if (!p) return res.json([]);
  const toSend = [...p.candidates];
  p.candidates = [];
  res.json(toSend);
});

app.post('/webrtc/candidate/:peerId', (req, res) => {
  const p = peers.get(req.params.peerId);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const { candidate, mid } = req.body;
  if (candidate && mid !== undefined) {
    p.peer.addRemoteCandidate(candidate, mid);
  }
  res.json({ success: true });
});

app.listen(PORT, async () => {
  console.log(`CS Server Manager listening on port ${PORT}`);
  await startOfficialServers();
});

// Start a background task to broadcast messages to all active servers every 3 minutes
setInterval(async () => {
  try {
    const containers = await docker.listContainers({
      filters: { label: ['cs-web-game=true'] }
    });
    for (const c of containers) {
      let port = null;
      if (c.Ports) {
        const p = c.Ports.find(x => x.PrivatePort === 27015 && x.Type === 'udp');
        if (p && p.PublicPort) port = p.PublicPort;
      }
      
      if (port) {
        // AMX Mod X varsa ekranın ortasına yeşil yazıyla büyük yazar
        sendRcon('127.0.0.1', port, 'browsercs', 'amx_csay green BROWSERCS 1.5').catch(() => {});
      }
    }
  } catch (err) {
    console.error("Broadcast error:", err);
  }
}, 180000); // 3 minutes
