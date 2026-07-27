const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const Docker = require('dockerode');
const nodeDataChannel = require('node-datachannel');
require('dotenv').config();
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const {
  listServerAdmins,
  saveServerAdmins,
  addRegisteredUserAdmin,
  findMyAdminForPort,
  searchProfiles,
  adminsToUsersIni,
  DEFAULT_FLAGS,
  PLATFORM_ADMIN,
  ensurePlatformAdmin,
  genAmxPassword,
  tableAvailable
} = require('./lib/serverAdmins');
const {
  isMailConfigured,
  sendEmail,
  buildAdminPasswordEmail
} = require('./lib/mail');
const {
  pushAdminPasswordNotice,
  listUnreadNotices,
  markNoticesRead
} = require('./lib/adminNotices');
const {
  bankInfoFromEnv,
  createOrder,
  listOrdersByOwner,
  listAllOrders,
  getOrderById,
  updateOrder
} = require('./lib/rentalOrders');

// Node.js < 22 için global WebSocket polyfill
global.WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const ADMIN_PASS = process.env.ADMIN_PASS;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://browsercs.com';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('[FATAL] SUPABASE_URL ve SUPABASE_ANON_KEY .env içinde zorunlu (hardcode yok).');
  process.exit(1);
}
if (!ADMIN_PASS || !ADMIN_TOKEN) {
  console.error('[FATAL] ADMIN_PASS ve ADMIN_TOKEN .env içinde zorunlu (varsayılan şifre yok).');
  process.exit(1);
}
if (!SUPABASE_SERVICE_KEY) {
  console.warn('[WARN] SUPABASE_SERVICE_KEY yok — admin DB işlemleri kısıtlı kalır. Client\'a asla koyma.');
}

// Anon client — kullanıcı işlemleri (auth.getUser vb.)
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Service role client — RLS bypass, sadece backend içi DB işlemleri
const supabaseAdmin = SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  : null;

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

const OFFICIAL_MAP_ROTATION = ['de_dust2', 'de_inferno', 'de_aztec', 'de_dust', 'fy_iceworld'];

/** Klasik (non-DM) sunucu standartları — resmi + yeni açılanlar. DM ayrı format. */
const CLASSIC_SERVER_DEFAULTS = Object.freeze({
  startMoney: 800,
  freezeTime: 0,
  c4Timer: 35,
  roundTime: 3,
  timeLimit: 30, // harita süresi (dk) — bitimine 3 dk kala votemap
  svCheats: 0,
  botDifficulty: 1, // normal YaPB
  botQuotaMin: 5,
  botQuotaMax: 8
});

function randomClassicBotQuota() {
  const min = CLASSIC_SERVER_DEFAULTS.botQuotaMin;
  const max = CLASSIC_SERVER_DEFAULTS.botQuotaMax;
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Eski rotasyon (yalnızca kiralık sunucular için opsiyonel). */
const getRotatedNextMapName = (currentMap) => {
  const idx = OFFICIAL_MAP_ROTATION.indexOf(currentMap);
  return idx !== -1 ? OFFICIAL_MAP_ROTATION[(idx + 1) % OFFICIAL_MAP_ROTATION.length] : 'de_dust2';
};

/**
 * Resmi sunucular sabit map: nextmap = mevcut map.
 * Kiralıkta lockMap=false ise eski rotasyon devam eder.
 */
const getNextMapName = (currentMap, { lockMap = true } = {}) => {
  const map = currentMap || 'de_dust2';
  if (lockMap) return map;
  return getRotatedNextMapName(map);
};

/** Resmi: tek satır mapcycle. Kiralık (lockMap=false): rotasyon listesi. */
const buildMapCycleContent = (currentMap, { lockMap = true } = {}) => {
  const map = currentMap || 'de_dust2';
  if (lockMap) return `${map}\n`;

  const startIdx = OFFICIAL_MAP_ROTATION.indexOf(map);
  if (startIdx === -1) return OFFICIAL_MAP_ROTATION.join('\n') + '\n';
  const ordered = [];
  for (let i = 0; i < OFFICIAL_MAP_ROTATION.length; i++) {
    ordered.push(OFFICIAL_MAP_ROTATION[(startIdx + i) % OFFICIAL_MAP_ROTATION.length]);
  }
  return ordered.join('\n') + '\n';
};

const DEFAULT_ADMIN_FLAGS = DEFAULT_FLAGS;

function parseUsersIni(content) {
  const admins = [];
  if (!content) return admins;
  const lineRe = /^\s*"([^"]*)"\s*"([^"]*)"\s*"([^"]*)"\s*"([^"]*)"/;
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;
    const match = line.match(lineRe);
    if (!match) continue;
    admins.push({
      name: match[1],
      password: match[2],
      flags: match[3] || DEFAULT_ADMIN_FLAGS,
      immunity: match[4] || 'a'
    });
  }
  return admins;
}

function buildUsersIni(admins) {
  return adminsToUsersIni(admins);
}


function getConfigDirForPort(port) {
  return `/home/ubuntu/server_configs/${port}`;
}

function readUsersIniForPort(port) {
  const iniPath = path.join(getConfigDirForPort(port), 'users.ini');
  if (!fs.existsSync(iniPath)) return [];
  return parseUsersIni(fs.readFileSync(iniPath, 'utf8'));
}

function writeUsersIniForPort(port, admins) {
  const configDir = getConfigDirForPort(port);
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'users.ini'), buildUsersIni(admins));
}

/** Admin eklendiğinde şifreyi mail + site bildirimi ile kullanıcıya ilet */
async function deliverAdminPasswordToUser(supabaseAdminClient, {
  userId,
  gameName,
  password,
  serverName,
  port
}) {
  const result = {
    email: null,
    emailSent: false,
    emailError: null,
    noticeId: null,
    mailConfigured: isMailConfigured()
  };
  if (!userId || !password) return result;

  let username = gameName;
  try {
    const { data: profile } = await supabaseAdminClient
      .from('profiles')
      .select('username')
      .eq('id', userId)
      .maybeSingle();
    if (profile?.username) username = profile.username;
  } catch (e) { /* ignore */ }

  try {
    const { data: authData, error: authErr } =
      await supabaseAdminClient.auth.admin.getUserById(userId);
    if (authErr) throw authErr;
    result.email = authData?.user?.email || null;
  } catch (e) {
    result.emailError = e.message || 'Kullanıcı e-postası alınamadı';
  }

  try {
    const notice = await pushAdminPasswordNotice(supabaseAdminClient, userId, {
      gameName,
      password,
      serverName: serverName || null,
      port: port || null,
      username
    });
    result.noticeId = notice?.id || null;
  } catch (e) {
    console.warn('[admin-mail] notice kaydı başarısız:', e.message);
  }

  if (result.email) {
    const tpl = buildAdminPasswordEmail({
      username,
      gameName,
      password,
      serverName,
      port
    });
    try {
      const sent = await sendEmail({
        to: result.email,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text
      });
      if (sent.ok) {
        result.emailSent = true;
      } else {
        result.emailError = sent.error || 'E-posta gönderilemedi';
        if (sent.skipped) {
          console.warn('[admin-mail]', sent.error);
        }
      }
    } catch (e) {
      result.emailError = e.message;
    }
  } else if (!result.emailError) {
    result.emailError = 'Kullanıcının kayıtlı e-postası yok';
  }

  return result;
}

async function resolveManagedServer(req, id) {
  const authHeader = req.headers.authorization;
  const token = authHeader ? authHeader.split(' ')[1] : null;
  const adminHeader = req.headers['x-admin-token'];
  const isMasterAdmin = adminHeader === ADMIN_TOKEN;

  const userSb = token
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } }
      })
    : null;

  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  let dbServer = null;
  let containerId = null;
  let containerInfo = null;

  if (isUUID && userSb) {
    const { data } = await userSb.from('purchased_servers').select('*').eq('id', id).single();
    dbServer = data;
    if (dbServer?.container_id) containerId = dbServer.container_id;
  } else {
    containerInfo = await docker.getContainer(id).inspect().catch(() => null);
    if (containerInfo) {
      containerId = containerInfo.Id;
      const portStr = containerInfo.HostConfig.PortBindings?.['27015/udp']?.[0]?.HostPort;
      if (portStr && userSb) {
        const { data } = await userSb.from('purchased_servers').select('*').eq('port', parseInt(portStr, 10)).single();
        dbServer = data;
      }
      if (!dbServer && isMasterAdmin) {
        dbServer = {
          id: null,
          owner_id: null,
          port: parseInt(portStr, 10),
          name: containerInfo.Config.Labels.serverName || 'Official Server',
          map: containerInfo.Config.Labels.mapName || 'de_dust2',
          rcon_password: 'browsercs',
          container_id: containerId
        };
      }
    }
  }

  if (!dbServer) {
    return { error: 'Sunucu bulunamadı.', status: 404 };
  }

  const isOfficial = containerInfo?.Config?.Labels?.isOfficial === 'true';
  const isOwner = dbServer.owner_id && req.user && dbServer.owner_id === req.user.id;
  if (!isOwner && !isMasterAdmin) {
    return { error: 'Bu sunucuyu yönetme yetkiniz yok.', status: 403 };
  }

  if (!containerId && dbServer.container_id) containerId = dbServer.container_id;
  if (!containerInfo && containerId) {
    containerInfo = await docker.getContainer(containerId).inspect().catch(() => null);
  }

  const port = dbServer.port || parseInt(
    containerInfo?.HostConfig?.PortBindings?.['27015/udp']?.[0]?.HostPort,
    10
  );

  return { dbServer, containerId, containerInfo, port, userSb, isOfficial, isMasterAdmin };
}

function buildServerCfgContent({
  hostname,
  rconPassword,
  startMoney,
  gravity,
  roundTime,
  map,
  gameMode,
  freezeTime,
  c4Timer,
  buyTime,
  maxRounds,
  timeLimit,
  limitTeams,
  friendlyFire,
  autoTeamBalance,
  autoKick,
  tkPunish,
  svCheats,
  botQuota,
  botDifficulty
}) {
  const isDm = gameMode === 'deathmatch';
  const d = CLASSIC_SERVER_DEFAULTS;

  // Klasik: standartlar; DM kendi bloğunda override eder.
  const money = !isDm
    ? (startMoney !== undefined && startMoney !== '' ? parseInt(startMoney, 10) : d.startMoney)
    : startMoney;
  const round = !isDm
    ? (roundTime !== undefined && roundTime !== '' ? parseFloat(roundTime) : d.roundTime)
    : roundTime;
  const tlRaw = timeLimit !== undefined && timeLimit !== ''
    ? parseInt(timeLimit, 10)
    : (isDm ? 0 : d.timeLimit);
  const tl = Number.isFinite(tlRaw) ? tlRaw : (isDm ? 0 : d.timeLimit);

  let content = `
hostname "${hostname}"
rcon_password "${rconPassword}"
mp_startmoney ${money}
sv_gravity ${gravity}
mp_roundtime ${round}
mp_consistency 0
sv_consistency 0
sv_fileconsistency 0
browsercs_nextmap "${getNextMapName(map || 'de_dust2', { lockMap: true })}"
mp_timelimit ${tl}
mp_chattime 5
`;

  if (!isDm) {
    const ft = freezeTime !== undefined && freezeTime !== ''
      ? parseInt(freezeTime, 10)
      : d.freezeTime;
    content += `mp_freezetime ${Number.isFinite(ft) ? ft : d.freezeTime}\n`;

    const c4 = c4Timer !== undefined && c4Timer !== ''
      ? parseInt(c4Timer, 10)
      : d.c4Timer;
    content += `mp_c4timer ${Number.isFinite(c4) ? c4 : d.c4Timer}\n`;

    // Hile tamamen kapalı (klasik sunucular)
    content += `sv_cheats 0\n`;

    const q = botQuota !== undefined && botQuota !== ''
      ? Math.max(0, Math.min(32, parseInt(botQuota, 10) || 0))
      : 6;
    const diff = botDifficulty !== undefined && botDifficulty !== ''
      ? Math.max(0, Math.min(4, parseInt(botDifficulty, 10) || d.botDifficulty))
      : d.botDifficulty;
    content += `yb_quota_mode "normal"\n`;
    content += `yb_autovacate 1\n`;
    content += `yb_join_after_player 0\n`;
    content += `yb_quota ${q}\n`;
    content += `yb_difficulty ${diff}\n`;
  } else {
    if (freezeTime !== undefined && freezeTime !== '') {
      content += `mp_freezetime ${parseInt(freezeTime, 10) || 0}\n`;
    }
    if (c4Timer !== undefined && c4Timer !== '') {
      content += `mp_c4timer ${parseInt(c4Timer, 10) || 35}\n`;
    }
    if (svCheats !== undefined && svCheats !== '') {
      content += `sv_cheats ${parseInt(svCheats, 10) ? 1 : 0}\n`;
    }
    if (botQuota !== undefined && botQuota !== '') {
      const q = Math.max(0, Math.min(32, parseInt(botQuota, 10) || 0));
      content += `yb_quota_mode "normal"\n`;
      content += `yb_autovacate 1\n`;
      content += `yb_quota ${q}\n`;
    }
    if (botDifficulty !== undefined && botDifficulty !== '') {
      content += `yb_difficulty ${Math.max(0, Math.min(4, parseInt(botDifficulty, 10) || 1))}\n`;
    }
  }

  if (buyTime !== undefined && buyTime !== '') {
    content += `mp_buytime ${parseFloat(buyTime) || 0.25}\n`;
  }
  if (maxRounds !== undefined && maxRounds !== '') {
    content += `mp_maxrounds ${parseInt(maxRounds, 10) || 0}\n`;
  }
  if (limitTeams !== undefined && limitTeams !== '') {
    content += `mp_limitteams ${parseInt(limitTeams, 10) || 0}\n`;
  }
  if (friendlyFire !== undefined && friendlyFire !== '') {
    content += `mp_friendlyfire ${parseInt(friendlyFire, 10) ? 1 : 0}\n`;
  }
  if (autoTeamBalance !== undefined && autoTeamBalance !== '') {
    content += `mp_autoteambalance ${parseInt(autoTeamBalance, 10) ? 1 : 0}\n`;
  }
  if (autoKick !== undefined && autoKick !== '') {
    content += `mp_autokick ${parseInt(autoKick, 10) ? 1 : 0}\n`;
  }
  if (tkPunish !== undefined && tkPunish !== '') {
    content += `mp_tkpunish ${parseInt(tkPunish, 10) ? 1 : 0}\n`;
  }

  if (isDm) {
    content += `
// BrowserCS Deathmatch — anında respawn (browsercs_deathmatch.amxx)
browsercs_dm 1
browsercs_dm_delay 1.5
browsercs_dm_protect 1.0
mp_forcerespawn 1
mp_freezetime 0
mp_buytime 999
mp_timelimit 0
mp_maxrounds 0
mp_friendlyfire 0
mp_autoteambalance 0
mp_limitteams 0
mp_forcecamera 0
mp_forcechasecam 0
mp_tkpunish 0
mp_autokick 0
sv_alltalk 1
mp_allowspectators 0
mp_chattime 0
yb_quota 0
yb_quota_mode "normal"
`;
  }

  // Net / tick — her yeni ve yeniden yazılan server.cfg'de zorunlu
  content += `
sv_allowdownload 1
sv_downloadurl "https://browsercs.com/cs-assets/"
sv_timeout 999
sv_lan 1
sv_maxrate 25000
sv_minrate 20000
sv_maxupdaterate 101
sv_minupdaterate 60
sys_ticrate 100
sv_unlag 1
sv_maxunlag 0.5
sv_unlagpush 0.0
sv_unlagsamples 1
`;
  return content;
}

/** Rank Takip: host port'u cfg + localinfo + rank_port.txt'ye yaz (AMXX queue için) */
function ensureRankPortInCfg(configDir, port) {
  try {
    const hostPort = parseInt(port, 10) || 0;
    fs.mkdirSync(configDir, { recursive: true });
    // Per-server file mounted into AMXX configs (survives Xash cvar reset)
    fs.writeFileSync(path.join(configDir, 'rank_port.txt'), `${hostPort}\n`);

    const cfgPath = path.join(configDir, 'server.cfg');
    if (!fs.existsSync(cfgPath)) return;
    let cfg = fs.readFileSync(cfgPath, 'utf8');
    const line = `bcs_rank_port ${hostPort}`;
    if (/^bcs_rank_port\s+/m.test(cfg)) {
      cfg = cfg.replace(/^bcs_rank_port\s+\S+/m, line);
    } else {
      cfg = cfg.trimEnd() + `\n${line}\n`;
    }
    if (!/^bcs_rank\s+/m.test(cfg)) {
      cfg = cfg.trimEnd() + `\nbcs_rank 1\n`;
    }
    const li = `localinfo bcs_rank_port ${hostPort}`;
    if (/^localinfo\s+bcs_rank_port\s+/m.test(cfg)) {
      cfg = cfg.replace(/^localinfo\s+bcs_rank_port\s+\S+/m, li);
    } else {
      cfg = cfg.trimEnd() + `\n${li}\n`;
    }
    fs.writeFileSync(cfgPath, cfg);
  } catch (e) {
    console.warn('[rank] ensureRankPortInCfg:', e.message);
  }
}

function getConfigDir(port) {
  return `/home/ubuntu/server_configs/${port}`;
}

function ensureModeCfgFiles(configDir) {
  const matchPath = path.join(configDir, 'match.cfg');
  const normalPath = path.join(configDir, 'normal.cfg');
  if (!fs.existsSync(matchPath)) {
    fs.writeFileSync(matchPath, '// BrowserCS — maç modu preset (panelden yazılır)\n', 'utf8');
  }
  if (!fs.existsSync(normalPath)) {
    fs.writeFileSync(normalPath, '// BrowserCS — normal mod preset (panelden yazılır)\n', 'utf8');
  }
}

function readServerMode(configDir, gameMode) {
  if (gameMode === 'deathmatch') return 'deathmatch';
  try {
    const modePath = path.join(configDir, 'mode.txt');
    if (fs.existsSync(modePath)) {
      const mode = fs.readFileSync(modePath, 'utf8').trim();
      if (mode === 'match' || mode === 'normal') return mode;
    }
  } catch (e) { /* ignore */ }
  return 'normal';
}

function hasModeCfgContent(filePath) {
  if (!fs.existsSync(filePath)) return false;
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .some(line => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith('//');
    });
}

function appendModeExec(serverCfgContent, configDir, mode) {
  const port = getPortFromConfigDir(configDir);
  if (!port) return serverCfgContent;
  if (mode === 'match' && hasModeCfgContent(path.join(configDir, 'match.cfg'))) {
    return `${serverCfgContent}\nexec browsercs_ports/${port}/match.cfg\n`;
  }
  if (mode === 'normal' && hasModeCfgContent(path.join(configDir, 'normal.cfg'))) {
    return `${serverCfgContent}\nexec browsercs_ports/${port}/normal.cfg\n`;
  }
  return serverCfgContent;
}

async function resolveServerPortFromRequest(id, authToken) {
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  if (isUUID && authToken) {
    const userSb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${authToken}` } }
    });
    const { data } = await userSb.from('purchased_servers').select('port, container_id').eq('id', id).single();
    if (data?.port) return data.port;
    if (data?.container_id) {
      const info = await docker.getContainer(data.container_id).inspect().catch(() => null);
      const boundPort = info?.HostConfig?.PortBindings?.['27015/udp']?.[0]?.HostPort;
      if (boundPort) return parseInt(boundPort, 10);
    }
  }

  let container = await docker.getContainer(id).inspect().catch(() => null);
  if (!container) {
    const ctrs = await docker.listContainers({ all: true, filters: { label: ['cs-web-game=true'] } });
    container = ctrs.find(c => c.Id.startsWith(id) || c.Id === id);
    if (container) {
      return container.Ports?.find(p => p.PrivatePort === 27015)?.PublicPort || null;
    }
    return null;
  }

  const boundPort = container.HostConfig?.PortBindings?.['27015/udp']?.[0]?.HostPort;
  return boundPort ? parseInt(boundPort, 10) : null;
}

function writePortScopedModeCfg(port, filename, content) {
  const modeDir = getConfigDir(port);
  fs.mkdirSync(modeDir, { recursive: true });
  ensureModeCfgFiles(modeDir);

  const hostCfgPath = path.join(modeDir, `${filename}.cfg`);
  fs.writeFileSync(hostCfgPath, content, 'utf8');

  const cstrikePortDir = path.join('/home/ubuntu/cstrike/browsercs_ports', String(port));
  fs.mkdirSync(cstrikePortDir, { recursive: true });
  const execCfgPath = path.join(cstrikePortDir, `${filename}.cfg`);
  fs.writeFileSync(execCfgPath, content, 'utf8');

  return { hostCfgPath, execCfgPath, execCommand: `exec browsercs_ports/${port}/${filename}.cfg` };
}

function getPortFromConfigDir(configDir) {
  const match = String(configDir || '').match(/server_configs\/(\d+)$/);
  return match ? match[1] : null;
}

// Utility to create a server
async function createServerContainer(options) {
  const {
    map,
    maxplayers,
    name,
    port,
    isOfficial,
    owner_id,
    gameMode = 'classic',
    vipOnly = null,
  } = options;

  // Supabase'den ayarları çekelim
  let serverSettings = {
    rcon_password: 'admin',
    start_money: CLASSIC_SERVER_DEFAULTS.startMoney,
    gravity: 800,
    round_time: CLASSIC_SERVER_DEFAULTS.roundTime,
    admin_name: '',
    admin_password: ''
  };

  if (isOfficial && gameMode === 'deathmatch') {
    serverSettings.rcon_password = 'browsercs';
    serverSettings.start_money = 16000;
    serverSettings.round_time = 999;
  }

  try {
    const { data: dbServer } = await supabase
      .from('purchased_servers')
      .select('rcon_password, start_money, gravity, round_time, admin_name, admin_password')
      .eq('owner_id', owner_id)
      .eq('port', port)
      .single();
      
    if (dbServer) {
      if (dbServer.rcon_password !== null) serverSettings.rcon_password = dbServer.rcon_password;
      // Klasik: para/round standart; DB rcon/admin/gravity kalsın
      if (gameMode === 'deathmatch' && dbServer.start_money !== null) {
        serverSettings.start_money = dbServer.start_money;
      }
      if (dbServer.gravity !== null) serverSettings.gravity = dbServer.gravity;
      if (gameMode === 'deathmatch' && dbServer.round_time !== null) {
        serverSettings.round_time = dbServer.round_time;
      }
      if (dbServer.admin_name !== null) serverSettings.admin_name = dbServer.admin_name;
      if (dbServer.admin_password !== null) serverSettings.admin_password = dbServer.admin_password;
    }
  } catch (e) { console.error("Supabase settings fetch error", e); }

  if (gameMode !== 'deathmatch') {
    serverSettings.start_money = CLASSIC_SERVER_DEFAULTS.startMoney;
    serverSettings.round_time = CLASSIC_SERVER_DEFAULTS.roundTime;
  }

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

  const classicBotQuota = gameMode !== 'deathmatch' ? randomClassicBotQuota() : 0;
  const serverCfgContent = buildServerCfgContent({
    hostname: finalHostname,
    rconPassword: serverSettings.rcon_password,
    startMoney: serverSettings.start_money,
    gravity: serverSettings.gravity,
    roundTime: serverSettings.round_time,
    map,
    gameMode,
    freezeTime: gameMode !== 'deathmatch' ? CLASSIC_SERVER_DEFAULTS.freezeTime : undefined,
    c4Timer: gameMode !== 'deathmatch' ? CLASSIC_SERVER_DEFAULTS.c4Timer : undefined,
    timeLimit: gameMode !== 'deathmatch' ? CLASSIC_SERVER_DEFAULTS.timeLimit : 0,
    svCheats: 0,
    botQuota: gameMode !== 'deathmatch' ? classicBotQuota : 0,
    botDifficulty: gameMode !== 'deathmatch' ? CLASSIC_SERVER_DEFAULTS.botDifficulty : undefined
  });
  fs.writeFileSync(path.join(configDir, 'server.cfg'), serverCfgContent);
  ensureRankPortInCfg(configDir, port);
  if (gameMode !== 'deathmatch') {
    // Resmi sunucular sabit map; kiralık sunucular da tek-map (rotasyon kapalı)
    fs.writeFileSync(
      path.join(configDir, 'mapcycle.txt'),
      buildMapCycleContent(map || 'de_dust2', { lockMap: true })
    );
  }
  fs.writeFileSync(
    path.join(configDir, 'mode.txt'),
    gameMode === 'deathmatch' ? 'deathmatch' : 'normal'
  );
  if (gameMode !== 'deathmatch') {
    ensureModeCfgFiles(configDir);
  }

  if (gameMode === 'deathmatch') {
    const metamodDir = path.join(configDir, 'metamod');
    fs.mkdirSync(metamodDir, { recursive: true });
    fs.writeFileSync(
      path.join(metamodDir, 'plugins.ini'),
      'linux addons/amxmodx/dlls/amxmodx_mm_i386.so\n; YaPB DM sunucusunda nav crash yapıyor — botlar kapalı\n'
    );
    fs.writeFileSync(
      path.join(configDir, 'amx_plugins.ini'),
      fs.readFileSync(path.join(__dirname, 'amxmodx/configs/plugins-dm.ini'), 'utf8')
    );
  }

  // Platform owner always present; merge rented-server owner admin if set
  const seedAdmins = [];
  if (serverSettings.admin_name) {
    seedAdmins.push({
      name: serverSettings.admin_name,
      password: serverSettings.admin_password || '',
      flags: DEFAULT_FLAGS
    });
  }
  fs.writeFileSync(path.join(configDir, 'users.ini'), buildUsersIni(seedAdmins));

  const vipOnlyTier = String(vipOnly || '').toLowerCase().trim();
  const vipOnlyActive = ['silver', 'gold', 'platinum'].includes(vipOnlyTier);
  if (vipOnlyActive) {
    fs.writeFileSync(path.join(configDir, 'vip_only.txt'), vipOnlyTier);
  }

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
        ...(gameMode !== 'deathmatch'
          ? [
              `${configDir}/mapcycle.txt:/opt/xashds/cstrike/mapcycle.txt`,
              `${configDir}/match.cfg:/opt/xashds/cstrike/match.cfg`,
              `${configDir}/normal.cfg:/opt/xashds/cstrike/normal.cfg`
            ]
          : []),
        `${configDir}/users.ini:/opt/xashds/cstrike/addons/amxmodx/configs/users.ini`,
        `${configDir}/mode.txt:/opt/xashds/cstrike/addons/amxmodx/configs/browsercs_mode.txt`,
        `${configDir}/rank_port.txt:/opt/xashds/cstrike/addons/amxmodx/configs/browsercs_rank_port.txt`,
        ...(vipOnlyActive
          ? [
              `${configDir}/vip_only.txt:/opt/xashds/cstrike/addons/amxmodx/configs/browsercs_vip_only.txt`
            ]
          : []),
        ...(gameMode === 'deathmatch'
          ? [
              `${configDir}/metamod/plugins.ini:/opt/xashds/cstrike/addons/metamod/plugins.ini`,
              `${configDir}/amx_plugins.ini:/opt/xashds/cstrike/addons/amxmodx/configs/plugins.ini`
            ]
          : [])
      ],
      PortBindings: {
        '27015/udp': [{ HostPort: port.toString() }],
        '27015/tcp': [{ HostPort: port.toString() }]
      },
      // Tty=true + unlimited json-file logs fills the 8GB root volume in hours.
      LogConfig: {
        Type: 'json-file',
        Config: { 'max-size': '10m', 'max-file': '2' },
      },
      RestartPolicy: isOfficial ? { Name: 'always' } : { Name: 'unless-stopped' }
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
      'owner_id': owner_id || '',
      'gameMode': gameMode || 'classic',
      'vipOnly': vipOnlyActive ? vipOnlyTier : ''
    }
  });

  await container.start();
  
  try {
    // server.cfg bind-mount; ortak /cstrike mapcycle'ina YAZMA (tum sunucular paylasiyor).
    // mapcycle.txt zaten port bazli bind ile mount ediliyor.
    if (gameMode !== 'deathmatch') {
      // FastDL / net — ana blok buildServerCfgContent'te; restartround + rate yedegi
      const exec = await container.exec({
        Cmd: ['sh', '-c', `echo 'sv_restartround 1\nsv_maxrate 25000\nsv_minrate 20000\nsv_maxupdaterate 101\nsv_minupdaterate 60\nsys_ticrate 100\n' >> cstrike/server.cfg`],
        AttachStdout: true, AttachStderr: true
      });
      await exec.start();
    }
  } catch (err) {
    console.error("Failed to inject FastDL settings:", err);
  }

  // MOTD'u bosalt (HTML overlay kullaniyoruz, in-game MOTD kapatildi)
  try {
    const motdExec = await container.exec({
      Cmd: ['sh', '-c', 'echo -n "" > /opt/xashds/cstrike/motd.txt'],
      AttachStdout: true, AttachStderr: true
    });
    await motdExec.start();
  } catch (err) { /* sessiz */ }

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
  // Reject banned accounts (login/join APIs)
  if (supabaseAdmin) {
    const { isBanActive, banRejectMessage, isMissingColumnError } = require('./lib/userModeration');
    const { data: prof, error: banErr } = await supabaseAdmin
      .from('profiles')
      .select('is_banned, banned_until, ban_reason')
      .eq('id', user.id)
      .maybeSingle();
    if (banErr) {
      if (!isMissingColumnError(banErr)) {
        console.warn('[requireAuth] ban check:', banErr.message);
      }
    } else if (prof && isBanActive(prof)) {
      return res.status(403).json({
        success: false,
        error: banRejectMessage(prof),
        banned: true,
        banned_until: prof.banned_until || null,
      });
    }
  }
  req.user = user;
  next();
}

async function provisionRentalForUser(ownerId, opts = {}) {
  const serverName = opts.name || `${opts.host || 'CS'}'s Server`;
  const serverMap = opts.map || 'de_dust2';
  const serverSlots = parseInt(opts.maxplayers, 10) || 16;
  const serverRcon = opts.rconPassword || 'admin';
  const serverAdmin = opts.adminName || opts.host || '';
  const serverAdminPass = opts.adminPassword || '';

  const existingContainers = await docker.listContainers({ all: true });
  const usedPorts = new Set();
  existingContainers.forEach(c => {
    if (c.Ports) c.Ports.forEach(p => { if (p.PublicPort) usedPorts.add(p.PublicPort); });
  });

  let port = 27202;
  while (usedPorts.has(port) && port < 28000) port++;
  if (port >= 28000) {
    return { success: false, status: 503, error: 'Sunucu kapasitesi dolu.' };
  }

  const existingOwned = existingContainers.find(c =>
    c.Labels?.['cs-web-game'] === 'true' &&
    c.Labels?.isOfficial !== 'true' &&
    c.Labels?.owner_id === ownerId
  );
  if (existingOwned) {
    if (existingOwned.State !== 'running') {
      try {
        await docker.getContainer(existingOwned.Id).start();
      } catch (startErr) {
        console.warn('[start-server] Mevcut konteyner başlatılamadı:', startErr.message);
      }
    }
    const existingPort = existingOwned.Ports?.find(p => p.PrivatePort === 27015)?.PublicPort;
    let existingDbId = null;
    if (existingPort && supabaseAdmin) {
      const { data: existingRow } = await supabaseAdmin
        .from('purchased_servers')
        .select('id')
        .eq('owner_id', ownerId)
        .eq('port', parseInt(existingPort, 10))
        .maybeSingle();
      existingDbId = existingRow?.id || null;
    }
    return {
      success: true,
      containerId: existingOwned.Id,
      port: existingPort,
      serverId: existingDbId,
      name: existingOwned.Labels?.serverName || serverName,
      map: existingOwned.Labels?.mapName || serverMap,
      reused: true
    };
  }

  const container = await createServerContainer({
    map: serverMap,
    maxplayers: serverSlots,
    name: serverName,
    port: port,
    isOfficial: false,
    owner_id: ownerId
  });

  let serverDbId = null;
  try {
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 10);

    await supabaseAdmin
      .from('purchased_servers')
      .delete()
      .eq('port', port)
      .eq('owner_id', ownerId);

    const { data: insertData, error: insertErr } = await supabaseAdmin
      .from('purchased_servers')
      .insert([{
        owner_id: ownerId,
        name: serverName,
        map: serverMap,
        max_players: serverSlots,
        status: 'running',
        port: port,
        container_id: container.id,
        rcon_password: serverRcon,
        admin_name: serverAdmin,
        admin_password: serverAdminPass,
        expires_at: expiresAt.toISOString()
      }])
      .select('id')
      .single();

    if (insertErr) {
      console.error('[start-server] purchased_servers INSERT hatası:', insertErr.message);
      try { await container.remove({ force: true }); } catch (removeErr) { /* ignore */ }
      return {
        success: false,
        status: 500,
        error: 'Veritabanı kaydı oluşturulamadı: ' + insertErr.message
      };
    }

    serverDbId = insertData?.id || null;
    console.log('[start-server] purchased_servers kaydı oluşturuldu, port:', port, 'id:', serverDbId);
  } catch (dbErr) {
    console.error('[start-server] DB kayıt hatası:', dbErr.message);
    return { success: false, status: 500, error: 'Veritabanı hatası: ' + dbErr.message };
  }

  if (serverAdmin) {
    writeUsersIniForPort(port, [{
      name: serverAdmin,
      password: serverAdminPass,
      flags: DEFAULT_ADMIN_FLAGS,
      immunity: 'a'
    }]);
  }
  try {
    const configDir = getConfigDirForPort(port);
    const cfgPath = path.join(configDir, 'server.cfg');
    if (fs.existsSync(cfgPath)) {
      let cfg = fs.readFileSync(cfgPath, 'utf8');
      cfg = cfg.replace(/rcon_password\s+"[^"]*"/, `rcon_password "${serverRcon}"`);
      fs.writeFileSync(cfgPath, cfg);
    }
  } catch (cfgErr) {
    console.warn('[start-server] server.cfg patch warning:', cfgErr.message);
  }

  return {
    success: true,
    containerId: container.id,
    port,
    serverId: serverDbId,
    name: serverName,
    map: serverMap
  };
}

async function handleStartServer(req, res) {
  try {
    const { map, maxplayers, name, host, rconPassword, adminName, adminPassword } = req.body;
    const result = await provisionRentalForUser(req.user.id, {
      map, maxplayers, name, host, rconPassword, adminName, adminPassword
    });
    if (!result.success) {
      return res.status(result.status || 500).json({ success: false, error: result.error });
    }
    res.json(result);
  } catch (err) {
    console.error('Error starting server:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

app.post('/api/start-server', loginLimiter, requireAuth, handleStartServer);
app.post('/api/provision-rental', loginLimiter, requireAuth, handleStartServer);

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

/** A2S player details (challenge → names). */
function queryA2SPlayers(ip, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      try { client.close(); } catch (_) { /* ignore */ }
      resolve(val);
    };
    const timer = setTimeout(() => done(null), timeoutMs);

    client.on('message', (msg) => {
      try {
        if (msg.length >= 9 && msg[4] === 0x41) {
          const challenge = msg.readInt32LE(5);
          const req = Buffer.alloc(9);
          req.writeUInt32LE(0xFFFFFFFF, 0);
          req[4] = 0x55;
          req.writeInt32LE(challenge, 5);
          client.send(req, 0, 9, port, ip);
          return;
        }
        if (msg.length >= 6 && msg[4] === 0x44) {
          clearTimeout(timer);
          let offset = 5;
          const count = msg.readUInt8(offset++);
          const players = [];
          for (let i = 0; i < count && offset < msg.length; i++) {
            offset++; // index
            const start = offset;
            while (offset < msg.length && msg[offset] !== 0) offset++;
            const name = msg.toString('utf8', start, offset);
            offset++; // null
            const score = msg.readInt32LE(offset); offset += 4;
            const duration = msg.readFloatLE(offset); offset += 4;
            players.push({ name, score, duration });
          }
          done({ count, players });
        }
      } catch (_) {
        done(null);
      }
    });

    client.on('error', () => done(null));
    client.send(Buffer.from([0xff, 0xff, 0xff, 0xff, 0x55, 0xff, 0xff, 0xff, 0xff]), 0, 9, port, ip);
  });
}

let _yapbBotNamesCache = null;
let _yapbBotNamesAt = 0;

function loadYapbBotNames() {
  const now = Date.now();
  if (_yapbBotNamesCache && now - _yapbBotNamesAt < 10 * 60 * 1000) {
    return _yapbBotNamesCache;
  }
  const names = new Set();
  const candidates = [
    path.join('/home/ubuntu/cstrike/addons/yapb/conf/lang/en_names.cfg'),
    path.join(__dirname, '../cstrike/addons/yapb/conf/lang/en_names.cfg'),
    '/opt/xashds/cstrike/addons/yapb/conf/lang/en_names.cfg'
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith(';') || t.startsWith('//')) continue;
        names.add(t.toLowerCase());
      }
      break;
    } catch (_) { /* try next */ }
  }
  _yapbBotNamesCache = names;
  _yapbBotNamesAt = now;
  return names;
}

function readPortRconPassword(port) {
  try {
    const cfgPath = path.join('/home/ubuntu/server_configs', String(port), 'server.cfg');
    if (!fs.existsSync(cfgPath)) return null;
    const m = fs.readFileSync(cfgPath, 'utf8').match(/^\s*rcon_password\s+"?([^"\n]+)"?/m);
    return m ? m[1].trim() : null;
  } catch (_) {
    return null;
  }
}

/** Parse Xash `status` — bots show ping field "Bot". */
function parseStatusPlayerBreakdown(text) {
  let realPlayers = 0;
  let botPlayers = 0;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!/^\s*\d+\s+-?\d+\s+\S+/.test(line)) continue;
    if (/score\s+ping/i.test(line)) continue;
    const m = line.match(/^\s*\d+\s+-?\d+\s+(\S+)\s+/);
    if (!m) continue;
    const pingField = m[1];
    if (/^ping$/i.test(pingField)) continue;
    if (/^bot$/i.test(pingField)) botPlayers += 1;
    else realPlayers += 1;
  }
  return { realPlayers, botPlayers };
}

/**
 * Gerçek / bot oyuncu sayımı.
 * 1) RCON status (ping=Bot)
 * 2) A2S isimleri ∩ YaPB names.cfg
 * 3) A2S total only
 */
async function countPlayersBreakdown(port, preferredPassword = null) {
  const empty = { players: 0, realPlayers: 0, botPlayers: 0, map: null, source: 'none' };
  if (!port) return empty;

  const a2s = await queryA2S('127.0.0.1', port).catch(() => null);
  const total = a2s?.players || 0;
  const map = a2s?.map || null;
  if (total <= 0) {
    return { players: 0, realPlayers: 0, botPlayers: 0, map, source: 'a2s' };
  }

  const passwords = [];
  const cfgPw = readPortRconPassword(port);
  for (const pw of [preferredPassword, cfgPw, 'admin', 'browsercs']) {
    if (pw && !passwords.includes(pw)) passwords.push(pw);
  }

  for (const pw of passwords) {
    try {
      const statusText = await sendRcon('127.0.0.1', port, pw, 'status', 1500);
      const parsed = parseStatusPlayerBreakdown(statusText);
      const counted = parsed.realPlayers + parsed.botPlayers;
      if (counted === 0 && /#\s*score\s+ping/i.test(statusText) && total > 0) {
        // status boş ama A2S dolu → sonraki yönteme geç
        break;
      }
      if (counted > 0) {
        return {
          players: Math.max(total, counted),
          realPlayers: parsed.realPlayers,
          botPlayers: parsed.botPlayers,
          map,
          source: 'rcon'
        };
      }
    } catch (_) { /* try next password */ }
  }

  const detail = await queryA2SPlayers('127.0.0.1', port).catch(() => null);
  const botNames = loadYapbBotNames();
  if (detail?.players?.length && botNames.size) {
    let botPlayers = 0;
    let realPlayers = 0;
    for (const p of detail.players) {
      const n = String(p.name || '').trim().toLowerCase();
      if (n && botNames.has(n)) botPlayers += 1;
      else realPlayers += 1;
    }
    return {
      players: total,
      realPlayers,
      botPlayers,
      map,
      source: 'yapb-names'
    };
  }

  return {
    players: total,
    realPlayers: 0,
    botPlayers: total,
    map,
    source: 'a2s-unknown'
  };
}

// GoldSrc RCON function
function sendRcon(ip, port, password, command, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const client = dgram.createSocket('udp4');
    let responseText = '';
    let responseTimer = null;

    const timeoutTimer = setTimeout(() => {
      clearTimeout(responseTimer);
      client.close();
      reject(new Error('RCON Timeout - Şifre yanlış olabilir veya sunucu kapalı.'));
    }, timeoutMs);

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


const { registerServerRoutes } = require('./routes/servers');
registerServerRoutes(app, { docker, supabaseAdmin, queryA2S });

const { registerRankingsRoutes } = require('./routes/rankings');
const { startRankIngestLoop } = require('./lib/rankings');
const {
  issueRankTicket,
  startRankSessionCleanup,
} = require('./lib/rankSessions');
const { startVipSessionCleanup } = require('./lib/vipSessions');
registerRankingsRoutes(app, { supabaseAdmin });
startRankIngestLoop(supabaseAdmin);
startRankSessionCleanup();
startVipSessionCleanup();


// Admin Endpoints




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

// Public: sadece admin İSİMLERİ (şifre ASLA yok) — scoreboard badge
app.get('/api/ports/:port/admin-names', async (req, res) => {
  try {
    const port = parseInt(req.params.port, 10);
    if (!Number.isFinite(port) || port < 27015 || port > 29000) {
      return res.status(400).json({ success: false, error: 'Geçersiz port' });
    }
    const { data: server } = await supabaseAdmin
      .from('purchased_servers')
      .select('id')
      .eq('port', port)
      .maybeSingle();
    let names = [];
    if (server?.id) {
      const admins = await listServerAdmins(supabaseAdmin, server.id);
      names = admins.map((a) => a.name).filter(Boolean);
    } else {
      names = readUsersIniForPort(port).map((a) => a.name).filter(Boolean);
    }
    res.json({ success: true, names });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Oyuncu kendi admin yetkisini alır (sadece kendi _pw) — join için
app.get('/api/me/server-admin', requireAuth, async (req, res) => {
  try {
    const port = parseInt(req.query.port, 10);
    if (!Number.isFinite(port)) {
      return res.status(400).json({ success: false, error: 'port gerekli' });
    }
    const mine = await findMyAdminForPort(supabaseAdmin, req.user.id, port);
    if (mine) {
      return res.json({
        success: true,
        isAdmin: true,
        gameName: mine.gameName,
        password: mine.password,
        flags: mine.flags
      });
    }

    // Platform owner: nick "BrowserCS" → her porta (resmi dahil) AMXX _pw
    if (supabaseAdmin) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('username, role')
        .eq('id', req.user.id)
        .maybeSingle();
      const uname = String(profile?.username || '').trim().toLowerCase();
      // Match reserved display nick or legacy short usernames
      if (
        uname === PLATFORM_ADMIN.name.toLowerCase() ||
        uname === 'browsercs admin' ||
        uname === 'browsercs' ||
        uname === 'oktay'
      ) {
        return res.json({
          success: true,
          isAdmin: true,
          gameName: PLATFORM_ADMIN.name,
          password: PLATFORM_ADMIN.password,
          flags: PLATFORM_ADMIN.flags
        });
      }
    }

    return res.json({ success: true, isAdmin: false });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * Profil güncelle — kullanıcı adı değiştirme.
 * Unique (case-insensitive), reserved nick kuralları, metadata senkronu.
 */
app.patch('/api/me/profile', requireAuth, async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(503).json({ success: false, error: 'Veritabanı yok' });
    }
    const username = String(req.body?.username || '').trim();
    if (!username) {
      return res.status(400).json({ success: false, error: 'Kullanıcı adı zorunludur.' });
    }
    if (username.length < 3) {
      return res.status(400).json({ success: false, error: 'Kullanıcı adı en az 3 karakter olmalı.' });
    }
    if (username.length > 24) {
      return res.status(400).json({ success: false, error: 'Kullanıcı adı en fazla 24 karakter olabilir.' });
    }
    if (!/^[A-Za-z0-9_\-.]+(?: [A-Za-z0-9_\-.]+)*$/.test(username)) {
      return res.status(400).json({
        success: false,
        error: 'Kullanıcı adı yalnızca harf, rakam, boşluk, _ . - içerebilir.',
      });
    }
    const compact = username.toLowerCase().replace(/[^a-z0-9]/g, '');
    const reservedAdminId = 'd4722d7f-d60a-45ba-951f-167a03ee3e03';
    if (compact.includes('browsercs') && !(req.user.id === reservedAdminId && username === 'BrowserCS')) {
      return res.status(400).json({
        success: false,
        error: '"browsercs" içeren kullanıcı adları saklıdır. Lütfen başka bir isim seçin.',
      });
    }

    const { data: current, error: curErr } = await supabaseAdmin
      .from('profiles')
      .select('id, username, role, vip_tier, vip_expires_at')
      .eq('id', req.user.id)
      .maybeSingle();
    if (curErr) throw curErr;
    if (!current) {
      return res.status(404).json({ success: false, error: 'Profil bulunamadı.' });
    }

    if (String(current.username || '').trim().toLowerCase() === username.toLowerCase()
        && String(current.username || '').trim() === username) {
      return res.json({ success: true, unchanged: true, username: current.username });
    }

    // Case-insensitive çakışma (kendisi hariç)
    const { data: clashRows, error: clashErr } = await supabaseAdmin
      .from('profiles')
      .select('id, username')
      .ilike('username', username)
      .neq('id', req.user.id)
      .limit(5);
    if (clashErr) throw clashErr;
    const taken = (clashRows || []).some(
      (r) => String(r.username || '').trim().toLowerCase() === username.toLowerCase()
    );
    if (taken) {
      return res.status(409).json({
        success: false,
        error: 'Bu kullanıcı adı zaten alınmış. Lütfen başka bir ad seçin.',
      });
    }

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('profiles')
      .update({ username })
      .eq('id', req.user.id)
      .select('id, username, role, vip_tier, vip_expires_at')
      .maybeSingle();
    if (updErr) {
      if (/unique|duplicate|profiles_username/i.test(updErr.message || '')) {
        return res.status(409).json({
          success: false,
          error: 'Bu kullanıcı adı zaten alınmış. Lütfen başka bir ad seçin.',
        });
      }
      throw updErr;
    }

    // Auth metadata senkron — oyun / UI tutarlılığı
    try {
      await supabaseAdmin.auth.admin.updateUserById(req.user.id, {
        user_metadata: {
          ...(req.user.user_metadata || {}),
          username,
        },
      });
    } catch (metaErr) {
      console.warn('[profile] metadata sync:', metaErr.message);
    }

    console.log(`[profile] username ${current.username} → ${username} (${req.user.id})`);
    res.json({ success: true, username: updated?.username || username, profile: updated });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * Account-based rank ticket for the current session.
 * Client never sends user_id — only this short-lived random ticket.
 */
app.post('/api/me/rank-ticket', requireAuth, async (req, res) => {
  try {
    const port = parseInt(req.body?.port ?? req.query.port, 10);
    if (!Number.isFinite(port) || port < 1) {
      return res.status(400).json({ success: false, error: 'port gerekli' });
    }

    let displayName =
      req.user.user_metadata?.username ||
      req.user.email?.split('@')[0] ||
      'Oyuncu';
    try {
      if (supabaseAdmin) {
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('username')
          .eq('id', req.user.id)
          .maybeSingle();
        if (profile?.username) displayName = profile.username;
      }
    } catch (_) {
      /* profile optional */
    }

    const issued = issueRankTicket({
      userId: req.user.id,
      displayName,
      port,
    });
    res.json({
      success: true,
      ticket: issued.ticket,
      expiresAt: issued.expiresAt,
      expiresIn: issued.expiresIn,
      displayName: issued.displayName,
      port: issued.port,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Kayıtlı kullanıcı ara (admin eklerken seçim)
app.get('/api/users/search', requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 1) return res.json({ success: true, users: [] });
    const users = await searchProfiles(supabaseAdmin, q, 25);
    res.json({
      success: true,
      users: users.map((u) => ({
        id: u.id,
        username: u.username,
        role: u.role
      }))
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Owner: sunucu admin listesi (şifreler sadece owner'a)
app.get('/api/servers/:id/admins', requireAuth, async (req, res) => {
  try {
    const resolved = await resolveManagedServer(req, req.params.id);
    if (resolved.error) return res.status(resolved.status).json({ success: false, error: resolved.error });
    if (!resolved.dbServer.id) {
      return res.status(400).json({ success: false, error: 'Bu sunucu için DB kaydı yok.' });
    }

    let admins = await listServerAdmins(supabaseAdmin, resolved.dbServer.id);
    // İlk geçiş: boşsa eski users.ini / admin_name'den seed
    if (!admins.length) {
      const legacy = readUsersIniForPort(resolved.port);
      if (!legacy.length && resolved.dbServer.admin_name) {
        legacy.push({
          name: resolved.dbServer.admin_name,
          password: resolved.dbServer.admin_password || genAmxPassword(),
          flags: DEFAULT_ADMIN_FLAGS
        });
      }
      if (legacy.length) {
        admins = await saveServerAdmins(
          supabaseAdmin,
          resolved.dbServer.id,
          legacy.map((a) => ({
            name: a.name,
            password: a.password || genAmxPassword(),
            flags: a.flags || DEFAULT_ADMIN_FLAGS
          })),
          req.user.id
        );
        writeUsersIniForPort(resolved.port, admins);
      }
    }

    const usingTable = await tableAvailable(supabaseAdmin);
    res.json({
      success: true,
      storage: usingTable ? 'table' : 'storage',
      admins: admins.map((a) => ({
        id: a.id,
        userId: a.userId,
        username: a.username,
        name: a.name,
        password: a.password,
        flags: a.flags,
        immunity: 'a'
      }))
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Owner: admin listesini kaydet + users.ini sync
app.put('/api/servers/:id/admins', requireAuth, async (req, res) => {
  try {
    const { admins } = req.body;
    if (!Array.isArray(admins)) {
      return res.status(400).json({ success: false, error: 'admins dizisi gerekli.' });
    }

    const resolved = await resolveManagedServer(req, req.params.id);
    if (resolved.error) return res.status(resolved.status).json({ success: false, error: resolved.error });
    if (!resolved.dbServer.id) {
      return res.status(400).json({ success: false, error: 'Bu sunucu için DB kaydı yok.' });
    }

    const saved = await saveServerAdmins(
      supabaseAdmin,
      resolved.dbServer.id,
      admins,
      req.user.id
    );
    writeUsersIniForPort(resolved.port, saved);
    await supabaseAdmin.from('purchased_servers').update({
      admin_name: saved[0]?.name || '',
      admin_password: saved[0]?.password || ''
    }).eq('id', resolved.dbServer.id);

    if (resolved.containerId) {
      try {
        await sendRcon(
          '127.0.0.1',
          resolved.port,
          resolved.dbServer.rcon_password || 'browsercs',
          'restart'
        );
      } catch (e) { /* optional */ }
    }

    res.json({ success: true, admins: saved, message: 'Admin listesi kaydedildi ve sunucuya yazıldı.' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Owner: kayıtlı kullanıcıyı admin yap (+ şifreyi mail/bildirim ile gönder)
app.post('/api/servers/:id/admins/add-user', requireAuth, async (req, res) => {
  try {
    const { userId, gameName, flags, rotatePassword } = req.body || {};
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId gerekli.' });
    }
    const resolved = await resolveManagedServer(req, req.params.id);
    if (resolved.error) return res.status(resolved.status).json({ success: false, error: resolved.error });
    if (!resolved.dbServer.id) {
      return res.status(400).json({ success: false, error: 'Bu sunucu için DB kaydı yok.' });
    }

    const { admins: saved, added } = await addRegisteredUserAdmin(
      supabaseAdmin,
      resolved.dbServer.id,
      userId,
      req.user.id,
      { gameName, flags, rotatePassword: Boolean(rotatePassword) }
    );
    writeUsersIniForPort(resolved.port, saved);
    await supabaseAdmin.from('purchased_servers').update({
      admin_name: saved[0]?.name || '',
      admin_password: saved[0]?.password || ''
    }).eq('id', resolved.dbServer.id);

    const delivery = await deliverAdminPasswordToUser(supabaseAdmin, {
      userId,
      gameName: added?.name || gameName,
      password: added?.password,
      serverName: resolved.dbServer.name || resolved.dbServer.server_name,
      port: resolved.port
    });

    const mailHint = delivery.emailSent
      ? ' Admin şifresi e-posta ile gönderildi.'
      : delivery.mailConfigured
        ? ` E-posta gönderilemedi (${delivery.emailError || 'bilinmeyen hata'}); site bildirimi bırakıldı.`
        : ' Admin şifresi site bildirimi olarak bırakıldı (e-posta için RESEND_API_KEY gerekli).';

    res.json({
      success: true,
      admins: saved,
      added,
      delivery: {
        emailSent: delivery.emailSent,
        email: delivery.email ? delivery.email.replace(/(.{2}).+(@.+)/, '$1***$2') : null,
        emailError: delivery.emailError,
        noticeId: delivery.noticeId,
        mailConfigured: delivery.mailConfigured
      },
      message: `Kayıtlı kullanıcı bu sunucuya admin olarak eklendi.${mailHint}`
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Owner: admin şifresini kullanıcıya yeniden mail/bildirim gönder
app.post('/api/servers/:id/admins/resend-password', requireAuth, async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId gerekli.' });
    }
    const resolved = await resolveManagedServer(req, req.params.id);
    if (resolved.error) return res.status(resolved.status).json({ success: false, error: resolved.error });
    if (!resolved.dbServer.id) {
      return res.status(400).json({ success: false, error: 'Bu sunucu için DB kaydı yok.' });
    }

    const admins = await listServerAdmins(supabaseAdmin, resolved.dbServer.id);
    const admin = admins.find((a) => a.userId === userId);
    if (!admin) {
      return res.status(404).json({ success: false, error: 'Bu kullanıcı admin listesinde yok.' });
    }

    const delivery = await deliverAdminPasswordToUser(supabaseAdmin, {
      userId,
      gameName: admin.name,
      password: admin.password,
      serverName: resolved.dbServer.name || resolved.dbServer.server_name,
      port: resolved.port
    });

    res.json({
      success: true,
      delivery: {
        emailSent: delivery.emailSent,
        email: delivery.email ? delivery.email.replace(/(.{2}).+(@.+)/, '$1***$2') : null,
        emailError: delivery.emailError,
        noticeId: delivery.noticeId,
        mailConfigured: delivery.mailConfigured
      },
      message: delivery.emailSent
        ? 'Admin şifresi yeniden e-posta ile gönderildi.'
        : `Site bildirimi bırakıldı.${delivery.emailError ? ` E-posta: ${delivery.emailError}` : ''}`
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Üye: okunmamış admin-şifre bildirimleri
app.get('/api/me/admin-notices', requireAuth, async (req, res) => {
  try {
    const notices = await listUnreadNotices(supabaseAdmin, req.user.id);
    res.json({
      success: true,
      notices: notices.map((n) => ({
        id: n.id,
        createdAt: n.createdAt,
        gameName: n.gameName,
        password: n.password,
        serverName: n.serverName,
        port: n.port
      }))
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/me/admin-notices/read', requireAuth, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    await markNoticesRead(supabaseAdmin, req.user.id, ids);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Admin ekleme (tek admin — geriye dönük uyumluluk)
app.post('/api/servers/:id/admin', requireAuth, async (req, res) => {
  try {
    const { adminName, adminPassword, flags, immunity, admins, userId } = req.body;

    const resolved = await resolveManagedServer(req, req.params.id);
    if (resolved.error) return res.status(resolved.status).json({ success: false, error: resolved.error });
    if (!resolved.dbServer.id) {
      return res.status(400).json({ success: false, error: 'Bu sunucu için DB kaydı yok.' });
    }

    let nextAdmins;
    let delivery = null;
    if (userId) {
      const result = await addRegisteredUserAdmin(
        supabaseAdmin,
        resolved.dbServer.id,
        userId,
        req.user.id,
        { gameName: adminName, password: adminPassword, flags }
      );
      nextAdmins = result.admins;
      delivery = await deliverAdminPasswordToUser(supabaseAdmin, {
        userId,
        gameName: result.added?.name || adminName,
        password: result.added?.password,
        serverName: resolved.dbServer.name || resolved.dbServer.server_name,
        port: resolved.port
      });
    } else {
      nextAdmins = Array.isArray(admins)
        ? admins
        : await listServerAdmins(supabaseAdmin, resolved.dbServer.id);

      if (adminName) {
        nextAdmins = nextAdmins.filter(
          (a) => a.name.toLowerCase() !== String(adminName).toLowerCase()
        );
        nextAdmins.unshift({
          name: String(adminName).trim(),
          password: String(adminPassword || genAmxPassword()),
          flags: String(flags || DEFAULT_ADMIN_FLAGS),
          immunity: String(immunity || 'a')
        });
      }
      nextAdmins = await saveServerAdmins(
        supabaseAdmin,
        resolved.dbServer.id,
        nextAdmins,
        req.user.id
      );
    }

    writeUsersIniForPort(resolved.port, nextAdmins);
    await supabaseAdmin.from('purchased_servers').update({
      admin_name: nextAdmins[0]?.name || '',
      admin_password: nextAdmins[0]?.password || ''
    }).eq('id', resolved.dbServer.id);

    res.json({
      success: true,
      message: adminName
        ? `${adminName} admin olarak eklendi.${delivery?.emailSent ? ' Şifre e-posta ile gönderildi.' : ''}`
        : 'Admin listesi güncellendi.',
      admins: nextAdmins,
      delivery: delivery
        ? {
            emailSent: delivery.emailSent,
            emailError: delivery.emailError,
            noticeId: delivery.noticeId,
            mailConfigured: delivery.mailConfigured
          }
        : null
    });
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

// --- ENPARA / havale sipariş API ---
app.get('/api/payment-info', (req, res) => {
  res.json({ success: true, ...bankInfoFromEnv() });
});

app.post('/api/rental-orders', loginLimiter, requireAuth, express.json(), async (req, res) => {
  try {
    const { name, map, maxplayers, max_players } = req.body || {};
    const order = await createOrder(supabaseAdmin, {
      ownerId: req.user.id,
      serverName: name,
      map,
      maxPlayers: maxplayers || max_players
    });
    res.json({
      success: true,
      order,
      payment: bankInfoFromEnv(),
      instruction:
        'Havale/EFT açıklamasına mutlaka sipariş numarasını yazın. Ödeme onaylanınca sunucunuz kurulur.'
    });
  } catch (e) {
    console.error('[rental-orders] create:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/rental-orders/mine', requireAuth, async (req, res) => {
  try {
    const orders = await listOrdersByOwner(supabaseAdmin, req.user.id);
    res.json({ success: true, orders });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});




// Stripe key yönetimi (legacy — artık kullanılmıyor)

// ─── Master Admin: overview / users / DB servers / AMXX admins ───────────────







// Genel istatistikler (auth gerektirmiyor)

const { registerAdminRoutes } = require('./routes/admin');
const { registerVipRoutes, applyVipGrant } = require('./routes/vip');
const { startRankVipRewardLoop } = require('./lib/rankVipRewards');
const siteContent = require('./lib/siteContent');
const { requireAdmin } = registerAdminRoutes(app, {
  ADMIN_PASS,
  ADMIN_TOKEN,
  loginLimiter,
  docker,
  supabaseAdmin,
  queryA2S,
  sendRcon,
  countPlayersBreakdown,
  readPortRconPassword,
  listAllOrders,
  getOrderById,
  updateOrder,
  bankInfoFromEnv,
  provisionRentalForUser: typeof provisionRentalForUser === 'function' ? provisionRentalForUser : async () => ({ success: false, error: 'provision missing' }),
  listServerAdmins,
  express,
});

// Classic CS VIP (Silver/Gold/Platinum) — ticket + admin grant (Phase 1)
registerVipRoutes(app, {
  supabaseAdmin,
  requireAuth,
  requireAdmin,
  express,
});
startRankVipRewardLoop(supabaseAdmin, applyVipGrant);

// Public site CMS (MOTD / promo / playable maps from admin catalog)
app.get('/api/site/settings', (req, res) => {
  try {
    res.json({ success: true, ...siteContent.publicSettingsPayload() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/site/maps', (req, res) => {
  try {
    res.json({ success: true, ...siteContent.publicMapsPayload() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/site/sitemap.xml', (req, res) => {
  try {
    res.type('application/xml').send(siteContent.buildSitemapXml());
  } catch (e) {
    res.status(500).send('<!-- sitemap error -->');
  }
});

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



// GET /api/servers/:id — tek sunucu detayı (UUID veya Docker container ID)
app.get('/api/servers/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.split(' ')[1] : null;
    if (!token) return res.status(401).json({ success: false, error: 'Authorization gerekli.' });
    const userSb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    let data, error;
    if (isUUID) {
      ({ data, error } = await userSb.from('purchased_servers').select('*').eq('id', id).single());
    } else {
      // Docker container ID → container_id sütununa bak
      ({ data, error } = await userSb.from('purchased_servers').select('*').eq('container_id', id).single());
      // Bulamazsa port üzerinden ara
      if (!data) {
        try {
          const container = docker.getContainer(id);
          const info = await container.inspect();
          const portBindings = info.NetworkSettings.Ports['27015/udp'];
          const port = portBindings ? parseInt(portBindings[0].HostPort) : null;
          if (port) {
            ({ data, error } = await userSb.from('purchased_servers').select('*').eq('port', port).single());
          }
        } catch(_) {}
      }
    }
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

    if (filename === 'match' || filename === 'normal') {
      const resolved = await resolveManagedServer(req, id);
      if (resolved.error) {
        return res.status(resolved.status).json({ success: false, error: resolved.error });
      }

      const port = resolved.port;
      if (!port) {
        return res.status(400).json({ success: false, error: 'Sunucu portu bulunamadı.' });
      }

      const { hostCfgPath, execCfgPath, execCommand } = writePortScopedModeCfg(port, filename, content);
      fs.writeFileSync(path.join(getConfigDir(port), 'mode.txt'), filename, 'utf8');
      console.log(`[write-cfg] ${hostCfgPath} yazıldı (port ${port})`);
      console.log(`[write-cfg] ${execCfgPath} yazıldı (port ${port})`);
      console.log(`[write-cfg] mode.txt → ${filename} (port ${port})`);

      const pwMatch = content.match(/sv_password\s+"([^"]*)"/);
      const svPw = pwMatch ? pwMatch[1] : '';
      fs.writeFileSync(path.join(getConfigDir(port), 'server_password.txt'), svPw, 'utf8');
      console.log(`[write-cfg] server_password.txt → ${svPw ? '(set)' : '(empty)'} (port ${port})`);

      return res.json({ success: true, path: hostCfgPath, execCommand, port });
    }

    const cfgPath = path.join('/home/ubuntu/cstrike', `${filename}.cfg`);
    fs.writeFileSync(cfgPath, content, 'utf8');
    console.log(`[write-cfg] ${cfgPath} yazıldı`);
    res.json({ success: true, path: cfgPath });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/servers/:port/verify-password — şifre doğrula (actual password'ü açığa çıkarmaz)
app.post('/api/servers/:port/verify-password', express.json(), async (req, res) => {
  try {
    const port = parseInt(req.params.port);
    const { password } = req.body;
    if (!port || isNaN(port)) return res.status(400).json({ success: false, error: 'Geçersiz port.' });

    const pwFile = `/home/ubuntu/server_configs/${port}/server_password.txt`;
    if (!fs.existsSync(pwFile)) {
      // Şifre dosyası yok = şifresiz sunucu, her şifre geçerli
      return res.json({ success: true, valid: true });
    }
    const storedPw = fs.readFileSync(pwFile, 'utf8').trim();
    if (!storedPw) {
      // Boş şifre = şifresiz
      return res.json({ success: true, valid: true });
    }
    const valid = (password || '') === storedPw;
    res.json({ success: true, valid });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/servers/:id/settings', requireAuth, async (req, res) => {


  try {
    const { id } = req.params;
    const {
      rconPassword,
      startMoney,
      gravity,
      roundTime,
      freezeTime,
      c4Timer,
      buyTime,
      maxRounds,
      timeLimit,
      limitTeams,
      friendlyFire,
      autoTeamBalance,
      autoKick,
      tkPunish,
      svCheats,
      botQuota,
      botDifficulty,
      adminName,
      adminPassword,
      admins,
      svPassword
    } = req.body;
    
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
        dbServer = { id: null, owner_id: req.user.id, port: boundPort, rcon_password: 'admin', start_money: 800, gravity: 800, round_time: 3 };
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

    const gameMode = (await docker.getContainer(containerId).inspect().catch(() => null))?.Config?.Labels?.gameMode || 'classic';

    // Mevcut değerleri al
    const s_rcon = updates.rcon_password !== undefined ? updates.rcon_password : (dbServer.rcon_password || 'admin');
    const s_money = updates.start_money !== undefined
      ? updates.start_money
      : (gameMode === 'deathmatch'
        ? (dbServer.start_money || 16000)
        : CLASSIC_SERVER_DEFAULTS.startMoney);
    const s_grav = updates.gravity !== undefined ? updates.gravity : (dbServer.gravity || 800);
    const s_round = updates.round_time !== undefined
      ? updates.round_time
      : (gameMode === 'deathmatch'
        ? (dbServer.round_time || 999)
        : CLASSIC_SERVER_DEFAULTS.roundTime);
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

    ensureModeCfgFiles(configDir);
    const preservedMode = readServerMode(configDir, gameMode);
    const classicForced = gameMode !== 'deathmatch';
    let serverCfgContent = buildServerCfgContent({
      hostname: finalHostname,
      rconPassword: s_rcon,
      startMoney: s_money,
      gravity: s_grav,
      roundTime: s_round,
      map: dbServer.map || 'de_dust2',
      gameMode,
      freezeTime: classicForced
        ? (freezeTime !== undefined && freezeTime !== '' ? freezeTime : CLASSIC_SERVER_DEFAULTS.freezeTime)
        : freezeTime,
      c4Timer: classicForced
        ? (c4Timer !== undefined && c4Timer !== '' ? c4Timer : CLASSIC_SERVER_DEFAULTS.c4Timer)
        : c4Timer,
      buyTime,
      maxRounds,
      timeLimit: classicForced
        ? (timeLimit !== undefined && timeLimit !== '' ? timeLimit : CLASSIC_SERVER_DEFAULTS.timeLimit)
        : timeLimit,
      limitTeams,
      friendlyFire,
      autoTeamBalance,
      autoKick,
      tkPunish,
      svCheats: classicForced ? 0 : svCheats,
      botQuota: classicForced
        ? (botQuota !== undefined && botQuota !== '' ? botQuota : randomClassicBotQuota())
        : botQuota,
      botDifficulty: classicForced
        ? (botDifficulty !== undefined && botDifficulty !== '' ? botDifficulty : CLASSIC_SERVER_DEFAULTS.botDifficulty)
        : botDifficulty
    });
    serverCfgContent = appendModeExec(serverCfgContent, configDir, preservedMode);
    if (svPassword !== undefined) {
      const svLine = svPassword ? `\nsv_password "${String(svPassword).replace(/"/g, '')}"\n` : '\nsv_password ""\n';
      fs.writeFileSync(path.join(configDir, 'server.cfg'), serverCfgContent + svLine);
      fs.writeFileSync(path.join(configDir, 'server_password.txt'), svPassword || '', 'utf8');
    } else {
      fs.writeFileSync(path.join(configDir, 'server.cfg'), serverCfgContent);
    }
    ensureRankPortInCfg(configDir, port);
    fs.writeFileSync(path.join(configDir, 'mode.txt'), preservedMode);

    let nextAdmins = Array.isArray(admins) ? admins : readUsersIniForPort(port);
    if (adminName) {
      nextAdmins = nextAdmins.filter(a => a.name.toLowerCase() !== String(adminName).toLowerCase());
      nextAdmins.unshift({
        name: adminName,
        password: s_pass || '',
        flags: DEFAULT_ADMIN_FLAGS,
        immunity: 'a'
      });
    } else if (!Array.isArray(admins) && s_admin) {
      nextAdmins = [{
        name: s_admin,
        password: s_pass || '',
        flags: DEFAULT_ADMIN_FLAGS,
        immunity: 'a'
      }];
    }
    writeUsersIniForPort(port, nextAdmins);

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
    const resolved = await resolveManagedServer(req, req.params.id);
    if (resolved.error) {
      return res.status(resolved.status).json({ success: false, error: resolved.error });
    }

    const { containerId, containerInfo, isOfficial, isMasterAdmin } = resolved;
    if (isOfficial && !isMasterAdmin) {
      return res.status(403).json({ success: false, error: 'Resmi sunucular sadece admin tarafından yeniden başlatılabilir.' });
    }
    if (!containerId) {
      return res.status(404).json({ success: false, error: 'Sunucu konteyneri bulunamadı. Yeniden başlatmak için sunucuyu tekrar oluşturun.' });
    }

    const container = docker.getContainer(containerId);
    const info = containerInfo || await container.inspect();
    const gameMode = info.Config.Labels?.gameMode || 'classic';
    const port = parseInt(
      info.HostConfig?.PortBindings?.['27015/udp']?.[0]?.HostPort || '0',
      10
    );

    if (port) {
      const configDir = `/home/ubuntu/server_configs/${port}`;
      if (fs.existsSync(configDir)) {
        const hostname = info.Config.Labels?.serverName || 'CS Server';
        const mapName = info.Config.Labels?.mapName || 'de_dust2';
        const formatHostname = (rawName) => {
          const trMap = {
            'ç': 'c', 'Ç': 'C', 'ğ': 'g', 'Ğ': 'G', 'ı': 'i', 'I': 'I',
            'i': 'i', 'İ': 'I', 'ö': 'o', 'Ö': 'O', 'ş': 's', 'Ş': 'S',
            'ü': 'u', 'Ü': 'U'
          };
          return `BROWSERCS | ${String(rawName || '').replace(/[çÇğĞıIİöÖşŞüÜ]/g, m => trMap[m])}`;
        };
        const dmSettings = gameMode === 'deathmatch'
          ? { startMoney: 16000, gravity: 800, roundTime: 999, rconPassword: 'browsercs', botQuota: 0 }
          : {
              startMoney: CLASSIC_SERVER_DEFAULTS.startMoney,
              gravity: 800,
              roundTime: CLASSIC_SERVER_DEFAULTS.roundTime,
              rconPassword: 'browsercs',
              botQuota: randomClassicBotQuota()
            };
        ensureModeCfgFiles(configDir);
        const preservedMode = readServerMode(configDir, gameMode);
        let serverCfgContent = buildServerCfgContent({
          hostname: formatHostname(hostname),
          rconPassword: dmSettings.rconPassword,
          startMoney: dmSettings.startMoney,
          gravity: dmSettings.gravity,
          roundTime: dmSettings.roundTime,
          map: mapName,
          gameMode,
          freezeTime: gameMode !== 'deathmatch' ? CLASSIC_SERVER_DEFAULTS.freezeTime : undefined,
          c4Timer: gameMode !== 'deathmatch' ? CLASSIC_SERVER_DEFAULTS.c4Timer : undefined,
          timeLimit: gameMode !== 'deathmatch' ? CLASSIC_SERVER_DEFAULTS.timeLimit : 0,
          svCheats: 0,
          botQuota: dmSettings.botQuota,
          botDifficulty: gameMode !== 'deathmatch' ? CLASSIC_SERVER_DEFAULTS.botDifficulty : undefined
        });
        // Net rate / FastDL buildServerCfgContent içinde
        serverCfgContent = appendModeExec(serverCfgContent, configDir, preservedMode);
        fs.writeFileSync(path.join(configDir, 'server.cfg'), serverCfgContent);
        ensureRankPortInCfg(configDir, port);
        if (gameMode !== 'deathmatch') {
          fs.writeFileSync(
            path.join(configDir, 'mapcycle.txt'),
            buildMapCycleContent(mapName || 'de_dust2', { lockMap: true })
          );
        }
        fs.writeFileSync(path.join(configDir, 'mode.txt'), preservedMode);
      }
    }

    await container.restart();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Start official servers on startup
async function startOfficialServers() {
  const officialMaps = ['de_dust2', 'de_inferno', 'de_aztec', 'de_dust', 'fy_iceworld'];
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
          try {
            await container.start();
          } catch (e) {
            // 304 = already started (race) — ignore
            if (!/already started|304/i.test(e.message || '')) {
              console.error(`Failed to restart official server on port ${port}:`, e.message);
            }
          }
        }
      }
    }

    const dmPort = 27201;
    const dmEnabled = process.env.OFFICIAL_DM_ENABLED !== '0';
    const dmExists = existing.find(c => c.Names.includes(`/cs15-${dmPort}`));
    if (!dmEnabled) {
      if (dmExists && dmExists.State === 'running') {
        console.log(`Official DEATHMATCH disabled (OFFICIAL_DM_ENABLED=0) — stopping port ${dmPort}...`);
        try {
          await docker.getContainer(dmExists.Id).stop({ t: 5 });
        } catch (e) {
          console.error(`Failed to stop deathmatch server on port ${dmPort}:`, e.message);
        }
      } else {
        console.log(`Official DEATHMATCH disabled (OFFICIAL_DM_ENABLED=0) — skip port ${dmPort}`);
      }
    } else if (!dmExists) {
      console.log(`Starting official DEATHMATCH server on port ${dmPort}...`);
      try {
        await createServerContainer({
          map: 'de_dust2',
          maxplayers: 32,
          name: 'CS BROWSER OFFICIAL - DEATHMATCH',
          port: dmPort,
          isOfficial: true,
          gameMode: 'deathmatch'
        });
      } catch (e) {
        console.error(`Failed to start deathmatch server on port ${dmPort}:`, e.message);
      }
    } else if (dmExists.State !== 'running') {
      console.log(`Restarting official deathmatch server on port ${dmPort}...`);
      try {
        await docker.getContainer(dmExists.Id).start();
      } catch (e) {
        if (!/already started|304/i.test(e.message || '')) {
          console.error(`Failed to restart deathmatch server on port ${dmPort}:`, e.message);
        }
      }
    }

    // VIP ODA — Gold/Platinum only (port 27020)
    const vipPort = 27020;
    const vipExists = existing.find(c => c.Names.includes(`/cs15-${vipPort}`));
    if (!vipExists) {
      console.log(`Starting official VIP ODA server on port ${vipPort}...`);
      try {
        await createServerContainer({
          map: 'de_dust2',
          maxplayers: 24,
          name: '★ VIP ODA — Gold/Platinum',
          port: vipPort,
          isOfficial: true,
          vipOnly: 'gold'
        });
      } catch (e) {
        console.error(`Failed to start VIP ODA on port ${vipPort}:`, e.message);
      }
    } else if (vipExists.State !== 'running') {
      console.log(`Restarting official VIP ODA on port ${vipPort}...`);
      try {
        await docker.getContainer(vipExists.Id).start();
      } catch (e) {
        if (!/already started|304/i.test(e.message || '')) {
          console.error(`Failed to restart VIP ODA on port ${vipPort}:`, e.message);
        }
      }
    }

  } catch(e) {
    if (!/already started|304/i.test(e.message || '')) {
      console.error("Error managing official servers:", e.message);
    }
  }
}
// --- WEBRTC SIGNALING & RELAY ---
const peers = new Map();
// STUN/TURN sunucuları - 5 STUN + 3 TURN ile NAT traversal güvenilirliği artırıldı
const rtcConfig = {
  iceServers: [
    'stun:stun.l.google.com:19302',
    'stun:stun.cloudflare.com:3478',
    // Local coturn on this host — required for many Windows/symmetric NATs
    'turn:35.159.95.54:3478?transport=udp&username=browsercs&credential=BcsTurn2026Relay',
    'turn:35.159.95.54:3478?transport=tcp&username=browsercs&credential=BcsTurn2026Relay'
  ],
  iceTransportPolicy: 'all'
};

app.post('/webrtc/offer', async (req, res) => {
  const { gamePort, sdp } = req.body;
  if (!gamePort || !sdp) return res.status(400).json({ error: 'Missing gamePort or sdp' });

  const portNum = parseInt(gamePort, 10);
  if (!Number.isFinite(portNum) || portNum < 1) {
    return res.status(400).json({ error: 'Invalid gamePort' });
  }

  // Kapalı sunucuya WebRTC denemesini erken kes (ICE fail spam / "bağlanamıyor")
  try {
    const { portFromContainer } = require('./lib/dockerServers');
    const running = await docker.listContainers({
      filters: { label: ['cs-web-game=true'], status: ['running'] },
    });
    const alive = running.some((c) => portFromContainer(c) === portNum);
    if (!alive) {
      console.log(`[WebRTC] reject offer → :${portNum} (server stopped)`);
      return res.status(503).json({
        error: 'Sunucu kapalı',
        code: 'SERVER_STOPPED',
        gamePort: portNum,
      });
    }
  } catch (e) {
    console.warn('[WebRTC] server status check failed:', e.message);
  }

  const peerId = Math.random().toString(36).substr(2, 9);
  const peer = new nodeDataChannel.PeerConnection(peerId, rtcConfig);
  // Bind ephemeral 127.0.0.1 port so this peer has a unique netadr.
  // Game server keys clients by IP+port — not IP alone.
  const udpSocket = dgram.createSocket('udp4');
  let dataChannel = null;
  let cleanedUp = false;
  const candidates = [];
  const peerEntry = {
    peer,
    udpSocket,
    candidates,
    createdAt: Date.now(),
    gamePort,
    dcOpened: false,
    lastState: 'new',
    localPort: 0,
    discSent: false,
  };
  peers.set(peerId, peerEntry);

  try {
    udpSocket.bind(0, '127.0.0.1');
  } catch (bindErr) {
    console.warn(`[WebRTC] UDP bind failed peer=${peerId}:`, bindErr.message);
  }
  udpSocket.on('listening', () => {
    try {
      peerEntry.localPort = udpSocket.address().port || 0;
    } catch (_) { /* ignore */ }
  });

  // Send GoldSrc OOB disconnect FROM THIS peer's socket only.
  // Source port scopes the leave — other WebRTC clients on 127.0.0.1 stay.
  const sendPeerDisconnect = (reason) => {
    if (peerEntry.discSent) return;
    peerEntry.discSent = true;
    const disc = Buffer.concat([
      Buffer.from([0xff, 0xff, 0xff, 0xff]),
      Buffer.from('disconnect\n', 'ascii'),
    ]);
    try {
      udpSocket.send(disc, gamePort, '127.0.0.1');
      console.log(
        `[WebRTC] disconnect OOB → :${gamePort} from 127.0.0.1:${peerEntry.localPort || '?'} peer=${peerId} (${reason})`
      );
    } catch (e) {
      console.warn(`[WebRTC] disconnect OOB failed peer=${peerId}:`, e.message);
    }
  };

  const cleanupPeer = (reason, delayMs = 400) => {
    if (cleanedUp) return;
    cleanedUp = true;
    sendPeerDisconnect(reason);
    setTimeout(() => {
      try { udpSocket.close(); } catch (e) { /* ignore */ }
      try { peer.close(); } catch (e) { /* ignore */ }
      peers.delete(peerId);
    }, delayMs);
  };

  peer.onDataChannel((dc) => {
    dataChannel = dc;
    peerEntry.dcOpened = true;
    dataChannel.onMessage((msg) => {
      const buf = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
      // BrowserCS relay keepalive — oyun sunucusuna iletme
      if (
        buf.length === 5 &&
        buf[0] === 0x00 &&
        buf[1] === 0x42 &&
        buf[2] === 0x43 &&
        buf[3] === 0x53 &&
        buf[4] === 0x4B
      ) {
        return;
      }
      // Eski hatalı keepalive (OOB benzeri) — asla iletme
      if (
        buf.length === 5 &&
        buf[0] === 0xff &&
        buf[1] === 0xff &&
        buf[2] === 0xff &&
        buf[3] === 0xff &&
        buf[4] === 0x69
      ) {
        return;
      }
      udpSocket.send(buf, gamePort, '127.0.0.1');
    });
    dataChannel.onClosed(() => {
      // Tab close / DC death: tell game server THIS client left (port-scoped).
      console.log(`[WebRTC] DataChannel kapandı - peer ${peerId} (disconnect + UDP kapatılacak)`);
      cleanupPeer('dc-closed', 400);
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

  peer.onLocalCandidate((candidate, mid) => {
    candidates.push({ candidate, mid });
  });

  peer.onStateChange((state) => {
    peerEntry.lastState = state;
    console.log(`[WebRTC] Peer ${peerId} state: ${state}`);
    // 'disconnected' geçici ICE — cleanup/kick YAPMA
    if (state === 'failed' || state === 'closed') {
      cleanupPeer(`ice-${state}`, 500);
    }
  });

  try {
    peer.setRemoteDescription(sdp, 'offer');
  } catch(e) {
    peers.delete(peerId);
    return res.status(500).json({ error: e.message });
  }
});

// Orphan peer GC: only kill abandoned offers — NEVER kill ICE still connecting/connected.
// (45s GC was closing peers mid-handshake → client stuck polling candidates, can't join.)
setInterval(() => {
  const now = Date.now();
  for (const [id, p] of peers.entries()) {
    if (p.dcOpened) continue;
    const age = now - (p.createdAt || 0);
    const st = p.lastState || '';
    if (st === 'connecting' || st === 'connected' || st === 'checking') {
      // Give slow ICE/TURN up to 3 minutes
      if (age < 180000) continue;
    } else if (age < 90000) {
      continue;
    }
    console.log(`[WebRTC] Orphan peer GC — ${id} age=${Math.round(age / 1000)}s state=${st || '?'} (no DC)`);
    // No game client was established if DC never opened — just drop sockets.
    try { p.udpSocket?.close(); } catch (_) { /* ignore */ }
    try { p.peer?.close(); } catch (_) { /* ignore */ }
    peers.delete(id);
  }
}, 20000);

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

// BROWSERCS 1.5 neon promo: AMXX browsercs_adminui her 180 sn [BROWSERCS_PROMO] marker gönderir.
// Web client bunu admin-join tarzı neon banner olarak gösterir (amx_csay yerine).
