const express = require('express');
const cors = require('cors');
const Docker = require('dockerode');
const nodeDataChannel = require('node-datachannel');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const docker = new Docker(); // Connects to local docker socket by default

const PORT = process.env.PORT || 4000;
const DOCKER_IMAGE = process.env.DOCKER_IMAGE || 'xash3d-cs15-server:latest';

// Utility to create a server
async function createServerContainer(options) {
  const { map, maxplayers, name, port, isOfficial } = options;

  // We map the container's 27015 UDP port to the host's `port`
  const container = await docker.createContainer({
    Image: DOCKER_IMAGE,
    name: `cs15-${port}`,
    Tty: true,
    HostConfig: {
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
      'maxPlayers': maxplayers.toString()
    }
  });

  await container.start();
  
  try {
    const exec = await container.exec({
      Cmd: ['sh', '-c', 'echo \'sv_allowdownload 1\nsv_downloadurl "https://browsercs.com/cs-assets/"\nmp_timelimit 30\nmp_consistency 0\nsv_consistency 0\nsv_lan 1\nsys_ticrate 100\nrcon_password "browsercs"\n\' >> cstrike/server.cfg'],
      AttachStdout: true, AttachStderr: true
    });
    await exec.start();
  } catch (err) {
    console.error("Failed to inject FastDL settings:", err);
  }

  return container;
}

app.post('/api/start-server', async (req, res) => {
  try {
    const { map, maxplayers, name, host } = req.body;
    
    // In a real scenario, we'd find an available port starting from 27016
    const port = 27000 + Math.floor(Math.random() * 1000); 
    
    const container = await createServerContainer({
      map: map || 'de_dust2',
      maxplayers: maxplayers || 16,
      name: name || `${host}'s Server`,
      port: port,
      isOfficial: false
    });

    res.json({ success: true, containerId: container.id, port });
  } catch (err) {
    console.error("Error starting server:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

const dgram = require('dgram');

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
app.post('/api/servers/:id/command', async (req, res) => {
  try {
    const { id } = req.params;
    const { rconPassword, command } = req.body;
    const container = docker.getContainer(id);
    const info = await container.inspect();
    const portBind = info.NetworkSettings.Ports['27015/udp'];
    if (!portBind) throw new Error('Sunucu kapalı');
    const port = parseInt(portBind[0].HostPort);

    const response = await sendRcon('127.0.0.1', port, rconPassword, command);
    res.json({ success: true, response });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/servers/:id/settings', async (req, res) => {
  try {
    const { id } = req.params;
    const { rconPassword, startMoney, gravity, roundTime, c4Timer, adminName, adminPassword } = req.body;
    const container = docker.getContainer(id);
    
    let cfgCmds = [];
    if (rconPassword) cfgCmds.push(`rcon_password "${rconPassword}"`);
    if (startMoney) cfgCmds.push(`mp_startmoney ${startMoney}`);
    if (gravity) cfgCmds.push(`sv_gravity ${gravity}`);
    if (roundTime) cfgCmds.push(`mp_roundtime ${roundTime}`);
    if (c4Timer) cfgCmds.push(`mp_c4timer ${c4Timer}`);
    
    if (cfgCmds.length > 0) {
      const cfgString = cfgCmds.join('\\n');
      const exec = await container.exec({
        Cmd: ['sh', '-c', `echo '${cfgString}' >> cstrike/server.cfg`],
        AttachStdout: true, AttachStderr: true
      });
      await exec.start();
    }
    
    if (adminName) {
      const execAdmin = await container.exec({
        Cmd: ['sh', '-c', `echo '"${adminName}" "${adminPassword || ''}" "abcdefghijklmnopqrstu" "a"' >> cstrike/addons/amxmodx/configs/users.ini`],
        AttachStdout: true, AttachStderr: true
      });
      await execAdmin.start();
    }
    
    await container.restart();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Eski / Eski kalıntıları silmeye gerek yok, geriye dönük uyumluluk kalsın
app.post('/api/servers/:id/restart', async (req, res) => {
  try {
    const { id } = req.params;
    const container = docker.getContainer(id);
    
    // Güvenlik ve timeout fix'i için restart anında da config basıyoruz
    try {
      const exec = await container.exec({
        Cmd: ['sh', '-c', 'echo \'sv_allowdownload 1\nsv_downloadurl "https://browsercs.com/cs-assets/"\nmp_timelimit 30\nmp_consistency 0\nsv_consistency 0\n\' >> cstrike/server.cfg'],
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
  const officialMaps = ['de_dust2', 'de_dust', 'de_inferno', 'de_aztec'];
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
const rtcConfig = { iceServers: ['stun:stun.l.google.com:19302'] };

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
      try { udpSocket.close(); } catch(e) {}
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
    if (state === 'failed' || state === 'closed') {
      try { udpSocket.close(); } catch(e) {}
      peers.delete(peerId);
      peer.close();
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
  if (!p) return res.status(404).json({ error: 'Not found' });
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
