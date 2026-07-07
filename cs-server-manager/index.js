const express = require('express');
const cors = require('cors');
const Docker = require('dockerode');
const nodeDataChannel = require('node-datachannel');
require('dotenv').config();
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');

// Node.js < 22 için global WebSocket polyfill
global.WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://nobzqygwzuqdlipnuchi.supabase.co',
  'sb_publishable_UCmJqqwDuYcPuxALFv8Z0w_VJrFZ8F-'
);

const app = express();
app.use(cors());
app.use(express.json());

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

  const serverCfgContent = `
hostname "${name}"
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
      `cd /opt/xashds && exec ./xash -dedicated -game cstrike +map "${map}" +maxplayers "${maxplayers}" +hostname "${name}" +sv_lan 1 +port 27015 +servercfgfile server.cfg`
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
      Cmd: ['sh', '-c', 'echo \'sv_allowdownload 1\nsv_downloadurl "https://browsercs.com/cs-assets/"\nsv_timeout 999\nmp_timelimit 30\nmp_roundtime 3\nmp_freezetime 0\nmp_consistency 0\nsv_consistency 0\nsv_lan 1\nsys_ticrate 100\nrcon_password "browsercs"\n\' >> cstrike/server.cfg'],
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

app.post('/api/start-server', requireAuth, async (req, res) => {
  try {
    const { map, maxplayers, name, host } = req.body;
    
    // In a real scenario, we'd find an available port starting from 27016
    const port = 27000 + Math.floor(Math.random() * 1000); 
    
    const container = await createServerContainer({
      map: map || 'de_dust2',
      maxplayers: maxplayers || 16,
      name: name || `${host}'s Server`,
      port: port,
      isOfficial: false,
      owner_id: req.user.id
    });

    res.json({ success: true, containerId: container.id, port });
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
    let challenge = '';
    let responseText = '';
    
    const timeout = setTimeout(() => {
      client.close();
      reject(new Error('RCON Timeout - Şifre yanlış olabilir veya sunucu kapalı.'));
    }, 2000);

    client.on('message', (msg) => {
      const response = msg.toString('binary');
      if (response.includes('challenge rcon')) {
        challenge = response.split(' ')[2].trim();
        const rconCmd = Buffer.from(`\xFF\xFF\xFF\xFFrcon ${challenge} "${password}" ${command}\n`, 'binary');
        client.send(rconCmd, 0, rconCmd.length, port, ip);
      } else {
        responseText += response.substring(4);
        // Clean up text
        responseText = responseText.replace(/\x00/g, '');
        clearTimeout(timeout);
        client.close();
        resolve(responseText);
      }
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      client.close();
      reject(err);
    });

    const challengeReq = Buffer.from('\xFF\xFF\xFF\xFFchallenge rcon\n', 'binary');
    client.send(challengeReq, 0, challengeReq.length, port, ip);
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
        owner_id: c.Labels.owner_id || null,
        state: c.State
      };
    }));

    res.json({ success: true, servers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin Endpoints
const ADMIN_PASS = 'browsercsadmin';
const ADMIN_TOKEN = 'admin_secret_token_777';

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (token === ADMIN_TOKEN) {
    next();
  } else {
    res.status(403).json({ success: false, error: 'Yetkisiz erişim' });
  }
}

app.post('/api/admin/login', express.json(), (req, res) => {
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

// Server Yönetim Endpoint'leri (YENİ SİSTEM)
app.post('/api/servers/:id/command', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { rconPassword, command } = req.body;
    const container = docker.getContainer(id);
    const info = await container.inspect();
    if (info.Config.Labels.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Bu sunucuyu yönetme yetkiniz yok.' });
    }
    const portBind = info.NetworkSettings.Ports['27015/udp'];
    if (!portBind) throw new Error('Sunucu kapalı');
    const port = parseInt(portBind[0].HostPort);

    const response = await sendRcon('127.0.0.1', port, rconPassword, command);
    res.json({ success: true, response });
  } catch(e) {
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

    const container = docker.getContainer(id);
    const info = await container.inspect();
    if (info.Config.Labels.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Bu sunucuyu yönetme yetkiniz yok.' });
    }
    
    const portBindings = info.HostConfig.PortBindings['27015/udp'];
    const portStr = portBindings ? portBindings[0].HostPort : null;
    if (!portStr) {
      return res.status(404).json({ success: false, error: 'Sunucu port bilgisi bulunamadı.' });
    }

    const { createClient } = require('@supabase/supabase-js');
    const userSupabase = createClient(
      'https://nobzqygwzuqdlipnuchi.supabase.co',
      'sb_publishable_UCmJqqwDuYcPuxALFv8Z0w_VJrFZ8F-',
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    // Port üzerinden Supabase purchased_servers satırını bul (kullanıcının kendi tokeni ile)
    const { data: dbServer, error: fetchErr } = await userSupabase
      .from('purchased_servers')
      .select('*')
      .eq('port', parseInt(portStr))
      .single();

    if (fetchErr || !dbServer) {
      return res.status(404).json({ success: false, error: 'Sunucu veritabanında bulunamadı veya erişim yetkiniz yok (port: ' + portStr + ').' });
    }

    // Update payload oluştur
    const updates = {};
    if (rconPassword !== undefined) updates.rcon_password = rconPassword;
    if (startMoney !== undefined) updates.start_money = startMoney;
    if (gravity !== undefined) updates.gravity = gravity;
    if (roundTime !== undefined) updates.round_time = roundTime;
    if (adminName !== undefined) updates.admin_name = adminName;
    if (adminPassword !== undefined) updates.admin_password = adminPassword;

    if (Object.keys(updates).length > 0) {
      const { error: updateErr } = await userSupabase
        .from('purchased_servers')
        .update(updates)
        .eq('id', dbServer.id);
        
      if (updateErr) {
        return res.status(500).json({ success: false, error: 'Ayarlar veritabanına kaydedilemedi: ' + updateErr.message });
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

    const serverCfgContent = `
hostname "${dbServer.name}"
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
    if (info.Config.Labels.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Bu sunucuyu yönetme yetkiniz yok.' });
    }
    
    // Güvenlik ve timeout fix'i için restart anında da config basıyoruz
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
