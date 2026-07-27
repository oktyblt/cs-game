/** @module ui/serverSettings — owner server settings modal + AMXX */
import { API_URL } from '../api.js';
import { $, notify } from '../dom.js';
import { getSessionToken, getCurrentUsername, getCurrentUser } from '../auth.js';
import { getStoredAmxPassword, clearAmxPasswordCache } from '../net/amxPassword.js';
import { normalizeMapName } from '../game/vfs.js';

function getUserNicknameInput() {
  return document.getElementById('user-nickname');
}

// ─── SERVER SETTINGS MODAL ───────────────────────────────────────────────────
const serverSettingsModal = $('server-settings-modal');
const btnSettingsClose = $('btn-settings-close');
const tabRcon = $('tab-rcon');
const tabGeneral = $('tab-general');
const tabAmx = $('tab-amx');
const settingsRconView = $('settings-rcon-view');
const settingsGeneralView = $('settings-general-view');
const settingsAmxView = $('settings-amx-view');

let currentSettingsServerId = null;
let _currentSettingsServer = null; // tam server objesi
let _currentAmxAdmins = [];

function renderAmxAdminList() {
  const listEl = $('amx-admin-list');
  if (!listEl) return;

  if (!_currentAmxAdmins.length) {
    listEl.innerHTML = '<div style="font-size:0.65rem;color:var(--text-dim);padding:0.35rem 0;">Henüz admin eklenmedi.</div>';
    return;
  }

  listEl.innerHTML = _currentAmxAdmins.map((admin, index) => {
    const account = admin.username
      ? `@${admin.username}`
      : (admin.userId ? 'kayıtlı kullanıcı' : 'manuel nick');
    const resendBtn = admin.userId
      ? `<button type="button" class="toolbar-btn amx-resend-pw" data-userid="${admin.userId}" title="Şifreyi mail/bildirim olarak yeniden gönder" style="font-size:0.55rem;padding:0.2rem 0.4rem;">MAIL</button>`
      : '';
    return `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:0.4rem;padding:0.35rem 0.45rem;border:1px solid rgba(255,255,255,0.08);border-radius:4px;background:rgba(255,255,255,0.03);">
      <div style="min-width:0;">
        <div style="font-size:0.72rem;color:var(--text-bright);font-family:var(--font-hud);">${admin.name}</div>
        <div style="font-size:0.58rem;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;">${account} · flags: ${admin.flags || 'abcdefghijklmnopqrstu'}</div>
      </div>
      <div style="display:flex;gap:0.25rem;flex-shrink:0;">
        ${resendBtn}
        <button type="button" class="toolbar-btn danger amx-remove-admin" data-index="${index}" style="font-size:0.58rem;padding:0.2rem 0.45rem;">SİL</button>
      </div>
    </div>`;
  }).join('');

  listEl.querySelectorAll('.amx-remove-admin').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-index'), 10);
      if (!Number.isNaN(idx)) {
        _currentAmxAdmins.splice(idx, 1);
        renderAmxAdminList();
      }
    });
  });

  listEl.querySelectorAll('.amx-resend-pw').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const uid = btn.getAttribute('data-userid');
      if (!uid || !currentSettingsServerId) return;
      btn.disabled = true;
      try {
        const token = await getSessionToken();
        const res = await fetch(`${API_URL}/api/servers/${currentSettingsServerId}/admins/resend-password`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ userId: uid })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Gönderilemedi');
        notify(data.message || 'Şifre gönderildi.', 'success');
      } catch (e) {
        notify('Mail/bildirim hatası: ' + e.message, 'error');
      }
      btn.disabled = false;
    });
  });
}

async function loadAmxAdminsForServer(id) {
  _currentAmxAdmins = [];
  try {
    const token = await getSessionToken();
    if (!token) return;
    const res = await fetch(`${API_URL}/api/servers/${id}/admins`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    _currentAmxAdmins = Array.isArray(data.admins) ? data.admins : [];
    if (!_currentAmxAdmins.length && data.primaryAdmin?.name) {
      _currentAmxAdmins = [data.primaryAdmin];
    }
  } catch (e) {
    console.warn('[AMXX] admin list load failed', e);
  }
  renderAmxAdminList();
}

/** Join: isimler (şifresiz) + sadece KENDİ admin şifrem */
export async function prefetchAmxAdminsForPort(port) {
  if (!port) return;
  try {
    const namesRes = await fetch(`${API_URL}/api/ports/${port}/admin-names`);
    if (namesRes.ok) {
      const namesData = await namesRes.json();
      const names = Array.isArray(namesData.names) ? namesData.names : [];
      if (names.length && typeof window.setBrowserCSAdminNames === 'function') {
        window.setBrowserCSAdminNames(names);
      }
    }

    const token = await getSessionToken().catch(() => null);
    if (!token) return;

    const res = await fetch(`${API_URL}/api/me/server-admin?port=${encodeURIComponent(port)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.isAdmin || !data.password) return;

    // Sadece bu oturum — localStorage'a YAZMA (misafir/nick ile admin sızıntısı olmasın)
    try {
      sessionStorage.setItem(`_csAmxPw_${port}`, String(data.password));
      localStorage.removeItem(`_csAmxPw_${port}`);
    } catch (e) { /* ignore */ }

    // Kendimiz adminsek neon — loading bitince / skorboard'da gösterilir
    window._browserCSPendingAdminBanner =
      data.gameName ||
      getCurrentUsername() ||
      (getUserNicknameInput()?.value.trim()) ||
      'Admin';
    // Erken flush yapma: game-wrapper opacity:0 iken banner görünmeden kayboluyordu

    // Nick eşleşmesi için oyun adını öner (sadece üye oturumunda)
    const _nickEl = getUserNicknameInput();
    if (data.gameName && _nickEl && !_nickEl.value.trim()) {
      _nickEl.value = data.gameName;
    }
  } catch (e) {
    /* sessiz */
  }
}

window.prefetchAmxAdminsForPort = prefetchAmxAdminsForPort;
export { clearAmxPasswordCache };

async function saveAmxAdmins(showRestartMsg = false) {
  if (!currentSettingsServerId) {
    notify('Sunucu seçilmedi!', 'error');
    return false;
  }
  try {
    const token = await getSessionToken();
    const res = await fetch(`${API_URL}/api/servers/${currentSettingsServerId}/admins`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ admins: _currentAmxAdmins })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Admin kaydı başarısız');
    _currentAmxAdmins = data.admins || _currentAmxAdmins;
    renderAmxAdminList();
    // Kendi hesabım bu listede ise _pw'yi sakla
    const port = window._browserCSConnectPort || window._currentSettingsServerPort;
    if (port) {
      await prefetchAmxAdminsForPort(port);
      const stored = getStoredAmxPassword(port);
      if (stored && typeof executeEngineCommand === 'function' && window.engineRunning) {
        executeEngineCommand(`setinfo _pw "${String(stored).replace(/["\\]/g, '')}"`);
      }
    }
    notify(showRestartMsg ? 'Adminler kaydedildi (sunucuya yazıldı).' : 'Admin listesi kaydedildi.', 'success');
    return true;
  } catch (e) {
    notify('AMXX admin kaydı hatası: ' + e.message, 'error');
    return false;
  }
}

export async function openServerSettings(id, serverObj) {
  currentSettingsServerId = id;
  _currentSettingsServer = serverObj || null;
  window._currentSettingsServerPort = serverObj?.port || null;
  serverSettingsModal.style.display = 'flex';
  switchTab(tabGeneral, settingsGeneralView);
  if ($('rcon-console-output')) $('rcon-console-output').textContent = 'Hazır. RCON şifresini gir ve komut gönder.';
  if ($('rcon-command-input')) $('rcon-command-input').value = '';

  // Önce serverObj'den doldur (hemen göstermek için)
  const sv = serverObj || {};
  const fillFields = (src) => {
    if ($('rcon-auth-pass') && src.rcon_password) $('rcon-auth-pass').value = src.rcon_password;
    if ($('cfg-rcon-pass') && src.rcon_password) $('cfg-rcon-pass').value = src.rcon_password;
    if ($('cfg-startmoney') && src.start_money) $('cfg-startmoney').value = src.start_money;
    if ($('cfg-gravity') && src.gravity) $('cfg-gravity').value = src.gravity;
    if ($('cfg-roundtime') && src.round_time) $('cfg-roundtime').value = src.round_time;
  };
  fillFields(sv);

  // GET /api/servers/:id → Supabase'den tam kayıt çek (rcon_password dahil)
  try {
    const token = await getSessionToken();
    if (token) {
      const res = await fetch(`${API_URL}/api/servers/${id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const d = await res.json();
        const full = d.server || d;
        fillFields(full);
        // Sunucu adını modal başlığına yaz
        if ($('settings-modal-title') && full.name) {
          $('settings-modal-title').textContent = `⚙ ${full.name.toUpperCase()} — YÖNETİM`;
        }
        if ($('cfg-rcon-pass') && full.rcon_password) $('cfg-rcon-pass').value = full.rcon_password;
        if ($('amx-admin-name') && full.admin_name) $('amx-admin-name').value = full.admin_name;
        if ($('amx-admin-pass') && full.admin_password) $('amx-admin-pass').value = full.admin_password;
        if (full.port) window._currentSettingsServerPort = full.port;
      }
    }
  } catch (e) { /* sessiz */ }

  await loadAmxAdminsForServer(id);
  const settingsPort = window._currentSettingsServerPort || sv.port;
  if (settingsPort) {
    await prefetchAmxAdminsForPort(settingsPort);
  }
}

window.openServerSettings = openServerSettings;

if (btnSettingsClose) {
  btnSettingsClose.addEventListener('click', () => {
    serverSettingsModal.style.display = 'none';
    // Kapatıldığında oyun focus'unu geri ver
    if (window.engineRunning) {
      const gameCanvas = document.getElementById('canvas');
      if (gameCanvas) gameCanvas.focus();
    }
  });
}

// OYUN MOTORUNUN (Xash3D) TUŞLARI ÇALMASINI ENGELLE
// Dropdown panel üzerindeki hiçbir keydown/keyup olayının window'a ulaşmasına izin verme
if (serverSettingsModal) {
  ['keydown', 'keyup', 'keypress'].forEach(evtType => {
    serverSettingsModal.addEventListener(evtType, (e) => {
      e.stopPropagation();
    });
  });
}

// Tab Switching
const _allSettingsTabs = [tabRcon, tabGeneral, tabAmx].filter(Boolean);
const _allSettingsViews = [settingsRconView, settingsGeneralView, settingsAmxView].filter(Boolean);
function switchTab(activeBtn, activeView) {
  _allSettingsTabs.forEach(t => { t.classList.remove('active'); t.style.borderBottom = 'none'; });
  _allSettingsViews.forEach(v => { v.style.display = 'none'; });
  if (activeBtn) { activeBtn.classList.add('active'); activeBtn.style.borderBottom = '2px solid var(--cs-yellow)'; }
  if (activeView) { activeView.style.display = 'flex'; }
}
if (tabRcon) tabRcon.addEventListener('click', () => switchTab(tabRcon, settingsRconView));
if (tabGeneral) tabGeneral.addEventListener('click', () => switchTab(tabGeneral, settingsGeneralView));
if (tabAmx) tabAmx.addEventListener('click', () => switchTab(tabAmx, settingsAmxView));

// RCON SEND
if ($('btn-rcon-send')) {
  $('btn-rcon-send').addEventListener('click', async () => {
    const password = $('rcon-auth-pass').value;
    const command = $('rcon-command-input').value;
    const out = $('rcon-console-output');

    if (!password) { notify('RCON Şifresi gerekli!', 'error'); return; }
    if (!command) return;

    out.textContent += `\n] ${command}`;
    $('rcon-command-input').value = '';

    try {
      const token = await getSessionToken();
      const res = await fetch(`${API_URL}/api/servers/${currentSettingsServerId}/command`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ rconPassword: password, command })
      });
      const data = await res.json();
      if (data.success) {
        const clean = stripCS(data.response);
        out.textContent += clean ? `\n${clean}` : '\n✓ OK';
      } else {
        out.textContent += `\nHATA: ${stripCS(data.error)}`;
      }
    } catch (e) {
      out.textContent += `\nBağlantı hatası!`;
    }
    out.scrollTop = out.scrollHeight;
  });
}

function getSettingsServerPort() {
  return _currentSettingsServer?.port || window._currentSettingsServerPort || null;
}

async function execModeCfg(filename, writeData) {
  const commands = [];
  if (writeData?.execCommand) {
    commands.push(writeData.execCommand);
  } else {
    const port = writeData?.port || getSettingsServerPort();
    if (port) commands.push(`exec browsercs_ports/${port}/${filename}.cfg`);
  }
  commands.push(`exec ${filename}.cfg`);

  let lastError = '';
  for (const cmd of commands) {
    const ok = await sendRcon(cmd, null);
    if (ok) return true;
    lastError = cmd;
  }
  if (lastError && typeof notify === 'function') {
    notify(`CFG dosyası çalıştırılamadı (${lastError}). RCON sekmesini kontrol edin.`, 'error');
  }
  return false;
}

function sanitizeCfgPassword(value) {
  return String(value || '').replace(/["\\;\r\n]/g, '');
}

function resetMatchPassModal() {
  const choiceRow = document.getElementById('match-pass-choice-row');
  const passInput = document.getElementById('match-pass-input');
  const confirmBtn = document.getElementById('match-pass-confirm');
  if (choiceRow) choiceRow.style.display = 'flex';
  if (passInput) {
    passInput.style.display = 'none';
    passInput.value = '';
  }
  if (confirmBtn) {
    confirmBtn.style.display = 'none';
    confirmBtn.disabled = false;
    confirmBtn.textContent = '⚔ MAÇ MODUNU BAŞLAT';
  }
}

function showMatchPassModal() {
  const modal = document.getElementById('match-pass-modal');
  if (!modal) return null;
  if (modal.parentElement !== document.body) {
    modal.style.position = 'fixed';
    modal.style.inset = '0';
    modal.style.zIndex = '9800';
    document.body.appendChild(modal);
  }
  resetMatchPassModal();
  modal.style.display = 'flex';
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  return modal;
}

function hideMatchPassModal() {
  const modal = document.getElementById('match-pass-modal');
  if (!modal) return;
  modal.classList.remove('show');
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
  resetMatchPassModal();
}

// ── CS RENK KODU TEMİZLEYİCİ ──────────────────────────────────────────────
function stripCS(str) {
  if (!str) return '';
  return String(str)
    .replace(/\^[0-9]/g, '')           // CS renk kodları: ^0-^9
    .replace(/\x1b\[[0-9;]*m/g, '')    // ANSI renk kodları
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Kontrol karakterleri
    .trim();
}

function getRconPassword() {
  return (
    ($('rcon-auth-pass') && $('rcon-auth-pass').value.trim()) ||
    ($('cfg-rcon-pass') && $('cfg-rcon-pass').value.trim()) ||
    ''
  );
}

async function sendRcon(command, successMsg) {
  const password = getRconPassword();
  const out = $('rcon-console-output');
  if (!password) {
    notify('Önce RCON şifresini girin (RCON veya Genel sekmesi)!', 'error');
    return false;
  }
  if (!currentSettingsServerId) {
    notify('Sunucu ID bulunamadı!', 'error');
    return false;
  }

  // Xash RCON tek komut alır — ; ile birleştirilmiş paketlerin çoğu sessizce başarısız olur
  const commands = Array.isArray(command)
    ? command.map((c) => String(c || '').trim()).filter(Boolean)
    : String(command || '')
        .split(';')
        .map((c) => c.trim())
        .filter(Boolean);

  if (!commands.length) {
    notify('Gönderilecek komut yok!', 'error');
    return false;
  }

  // changelevel: client VFS'ye BSP'yi önce yükle (yoksa Host_Error)
  for (const cmd of commands) {
    const mapMatch = cmd.match(/\bchangelevel\s+([a-zA-Z0-9_]+)/i);
    if (!mapMatch) continue;
    const map = normalizeMapName(mapMatch[1]);
    if (!map) continue;
    notify(`Harita indiriliyor: ${map}...`, 'info');
    const ok = await (window.ensureMapBspInVfs || (async () => false))(map);
    if (!ok) {
      notify(`Harita indirilemedi, map change iptal: ${map}`, 'error');
      return false;
    }
  }

  try {
    const token = await getSessionToken();
    let okCount = 0;
    for (const cmd of commands) {
      if (out) out.textContent += `\n] ${cmd}`;
      const r = await fetch(`${API_URL}/api/servers/${currentSettingsServerId}/command`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ rconPassword: password, command: cmd })
      });
      const d = await r.json();
      if (!d.success) {
        if (out) out.textContent += `\nHATA: ${stripCS(d.error)}`;
        notify('RCON hatası: ' + d.error, 'error');
        if (out) out.scrollTop = out.scrollHeight;
        return false;
      }
      const clean = stripCS(d.response);
      if (out && clean) out.textContent += `\n${clean}`;
      else if (out) out.textContent += `\n✓ OK`;
      okCount += 1;
      // Komutlar arası kısa bekleme (bot quota vs)
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    if (successMsg) notify(successMsg, 'success');
    if (out) out.scrollTop = out.scrollHeight;
    return okCount === commands.length;
  } catch (e) {
    if (out) out.textContent += `\nBağlantı hatası!`;
    notify('Bağlantı hatası!', 'error');
    if (out) out.scrollTop = out.scrollHeight;
    return false;
  }
}

function buildGeneralSettingsCommands() {
  const get = (id) => ($(id) ? $(id).value.trim() : '');
  const cmds = [];

  if (get('cfg-startmoney')) cmds.push(`mp_startmoney ${get('cfg-startmoney')}`);
  if (get('cfg-roundtime')) cmds.push(`mp_roundtime ${get('cfg-roundtime')}`);
  if (get('cfg-freezetime')) cmds.push(`mp_freezetime ${get('cfg-freezetime')}`);
  if (get('cfg-c4timer')) cmds.push(`mp_c4timer ${get('cfg-c4timer')}`);
  if (get('cfg-buytime')) cmds.push(`mp_buytime ${get('cfg-buytime')}`);
  if (get('cfg-gravity')) cmds.push(`sv_gravity ${get('cfg-gravity')}`);
  if (get('cfg-maxrounds')) cmds.push(`mp_maxrounds ${get('cfg-maxrounds')}`);
  if (get('cfg-timelimit')) cmds.push(`mp_timelimit ${get('cfg-timelimit')}`);
  if (get('cfg-limitteams')) cmds.push(`mp_limitteams ${get('cfg-limitteams')}`);
  if ($('cfg-friendlyfire')) cmds.push(`mp_friendlyfire ${$('cfg-friendlyfire').value}`);
  if ($('cfg-autoteambalance')) cmds.push(`mp_autoteambalance ${$('cfg-autoteambalance').value}`);
  if ($('cfg-autokick')) cmds.push(`mp_autokick ${$('cfg-autokick').value}`);
  if ($('cfg-tkpunish')) cmds.push(`mp_tkpunish ${$('cfg-tkpunish').value}`);
  if ($('cfg-svcheats')) cmds.push(`sv_cheats ${$('cfg-svcheats').value}`);

  const ybQuota = get('cfg-ybquota');
  if (ybQuota !== '') {
    // fill/match sunucuyu zorla doldurur — panelden her zaman normal quota
    cmds.push('yb_quota_mode normal');
    cmds.push('yb_autovacate 1');
    cmds.push(`yb_quota ${ybQuota}`);
    if (ybQuota === '0') {
      cmds.push('yb kickall instant');
    }
  }
  if (get('cfg-ybdiff')) cmds.push(`yb_difficulty ${get('cfg-ybdiff')}`);

  const svPass = get('cfg-sv-password');
  cmds.push(svPass ? `sv_password "${svPass.replace(/"/g, '')}"` : 'sv_password ""');
  const newRcon = get('cfg-rcon-pass');
  if (newRcon) cmds.push(`rcon_password "${newRcon.replace(/"/g, '')}"`);

  return cmds;
}

// ── HIZLI KOMUT BUTONLARI (.rcon-quick) ───────────────────────────────────
document.querySelectorAll('.rcon-quick').forEach(btn => {
  btn.addEventListener('click', async () => {
    const cmd = btn.getAttribute('data-cmd');
    if (!cmd) return;
    await sendRcon(cmd, `✓ ${cmd}`);
  });
});

// ── HARİTA DEĞİŞTİR ───────────────────────────────────────────────────────
if ($('btn-rcon-map')) {
  $('btn-rcon-map').addEventListener('click', async () => {
    const mapSel = $('rcon-map-select');
    const map = (mapSel ? mapSel.value : '').trim();
    if (!map) { notify('Harita seçin!', 'error'); return; }
    // sendRcon içinde ensureMapBspInVfs çağrılır
    await sendRcon(`changelevel ${map}`, `Harita değiştiriliyor: ${map}`);
  });
}

// ── OYUNCU KICK ───────────────────────────────────────────────────────────
if ($('btn-rcon-kick')) {
  $('btn-rcon-kick').addEventListener('click', async () => {
    const target = ($('rcon-kick-input') ? $('rcon-kick-input').value : '').trim();
    if (!target) { notify('Oyuncu adı veya #ID girin!', 'error'); return; }
    const cmd = target.startsWith('#') ? `kick ${target}` : `kick "${target}"`;
    await sendRcon(cmd, `Oyuncu atıldı: ${target}`);
  });
}

// ── OYUNCU BAN ────────────────────────────────────────────────────────────
if ($('btn-rcon-ban')) {
  $('btn-rcon-ban').addEventListener('click', async () => {
    const target = ($('rcon-ban-input') ? $('rcon-ban-input').value : '').trim();
    if (!target) { notify('IP veya #ID girin!', 'error'); return; }
    const cmd = target.includes('.') ? `addip 0 ${target}; writeid` : `banid 0 ${target}; writeid`;
    await sendRcon(cmd, `Banlama yapıldı: ${target}`);
  });
}

// ── SUNUCU ŞİFRESİ AYARLA ─────────────────────────────────────────────────
if ($('btn-rcon-svpass')) {
  $('btn-rcon-svpass').addEventListener('click', async () => {
    const pass = ($('rcon-svpass-input') ? $('rcon-svpass-input').value : '').trim();
    const cmd = pass ? `sv_password "${pass}"` : 'sv_password ""';
    const msg = pass ? `Sunucu şifresi ayarlandı` : 'Sunucu şifresi kaldırıldı';
    await sendRcon(cmd, msg);
  });
}

// ── GENEL AYARLAR KAYDET (TÜM AYARLAR RCON İLE) ──────────────────────
if ($('btn-cfg-save')) {
  $('btn-cfg-save').addEventListener('click', async () => {
    const btn = $('btn-cfg-save');
    btn.disabled = true;
    btn.textContent = 'UYGULANIYOR...';
    const cmds = buildGeneralSettingsCommands();
    if (!cmds.length) {
      notify('Uygulanacak ayar yok!', 'warn');
      btn.disabled = false;
      btn.textContent = 'AYARLARI UYGULA (RCON)';
      return;
    }
    const ok = await sendRcon(cmds, null);
    if (ok) notify(`${cmds.length} ayar tek tek uygulandı!`, 'success');
    btn.disabled = false;
    btn.textContent = 'AYARLARI UYGULA (RCON)';
  });
}

if ($('btn-cfg-persist')) {
  $('btn-cfg-persist').addEventListener('click', async () => {
    const btn = $('btn-cfg-persist');
    if (!currentSettingsServerId) {
      notify('Sunucu ID bulunamadı!', 'error');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'KAYDEDİLİYOR...';
    const get = (id) => ($(id) ? $(id).value.trim() : '');
    try {
      // Önce anlık uygula (botlar dahil), sonra kalıcı yaz + restart
      const liveCmds = buildGeneralSettingsCommands();
      if (liveCmds.length && getRconPassword()) {
        await sendRcon(liveCmds, null);
      }

      const token = await getSessionToken();
      const res = await fetch(`${API_URL}/api/servers/${currentSettingsServerId}/settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          rconPassword: get('cfg-rcon-pass'),
          startMoney: get('cfg-startmoney'),
          gravity: get('cfg-gravity'),
          roundTime: get('cfg-roundtime'),
          freezeTime: get('cfg-freezetime'),
          c4Timer: get('cfg-c4timer'),
          buyTime: get('cfg-buytime'),
          maxRounds: get('cfg-maxrounds'),
          timeLimit: get('cfg-timelimit'),
          limitTeams: get('cfg-limitteams'),
          friendlyFire: $('cfg-friendlyfire') ? $('cfg-friendlyfire').value : undefined,
          autoTeamBalance: $('cfg-autoteambalance') ? $('cfg-autoteambalance').value : undefined,
          autoKick: $('cfg-autokick') ? $('cfg-autokick').value : undefined,
          tkPunish: $('cfg-tkpunish') ? $('cfg-tkpunish').value : undefined,
          svCheats: $('cfg-svcheats') ? $('cfg-svcheats').value : undefined,
          botQuota: get('cfg-ybquota'),
          botDifficulty: get('cfg-ybdiff'),
          svPassword: get('cfg-sv-password'),
          admins: _currentAmxAdmins,
          adminName: get('amx-admin-name'),
          adminPassword: get('amx-admin-pass')
        })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Kayıt başarısız');
      notify('Ayarlar kalıcı kaydedildi, sunucu yeniden başlatılıyor.', 'success');
    } catch (e) {
      notify('Kalıcı kayıt hatası: ' + e.message, 'error');
    }
    btn.disabled = false;
    btn.textContent = 'KALICI KAYDET VE YENİDEN BAŞLAT';
  });
}

let _amxUserSearchTimer = null;
let _amxSelectedUser = null;

function renderAmxUserSearchResults(users) {
  const box = $('amx-user-search-results');
  if (!box) return;
  if (!users.length) {
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  box.style.display = 'block';
  box.innerHTML = users.map((u) => `
    <button type="button" class="amx-user-pick" data-id="${u.id}" data-username="${String(u.username || '').replace(/"/g, '&quot;')}"
      style="display:block;width:100%;text-align:left;padding:0.4rem 0.55rem;border:0;border-bottom:1px solid rgba(255,255,255,0.06);background:transparent;color:var(--text-bright);font-family:var(--font-hud);font-size:0.72rem;cursor:pointer;">
      @${u.username || 'kullanici'}
    </button>
  `).join('');
  box.querySelectorAll('.amx-user-pick').forEach((btn) => {
    btn.addEventListener('click', () => {
      _amxSelectedUser = {
        id: btn.getAttribute('data-id'),
        username: btn.getAttribute('data-username') || ''
      };
      if ($('amx-selected-user-id')) $('amx-selected-user-id').value = _amxSelectedUser.id;
      if ($('amx-user-search')) $('amx-user-search').value = `@${_amxSelectedUser.username}`;
      if ($('amx-admin-name') && !$('amx-admin-name').value.trim()) {
        $('amx-admin-name').value = _amxSelectedUser.username;
      }
      box.style.display = 'none';
      notify(`${_amxSelectedUser.username} seçildi. "+ Admin Ekle" ile kaydet.`, 'ok');
    });
  });
}

if ($('amx-user-search')) {
  $('amx-user-search').addEventListener('input', () => {
    clearTimeout(_amxUserSearchTimer);
    const q = ($('amx-user-search').value || '').replace(/^@/, '').trim();
    _amxSelectedUser = null;
    if ($('amx-selected-user-id')) $('amx-selected-user-id').value = '';
    if (q.length < 1) {
      renderAmxUserSearchResults([]);
      return;
    }
    _amxUserSearchTimer = setTimeout(async () => {
      try {
        const token = await getSessionToken();
        if (!token) return;
        const res = await fetch(`${API_URL}/api/users/search?q=${encodeURIComponent(q)}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        renderAmxUserSearchResults(Array.isArray(data.users) ? data.users : []);
      } catch (e) { /* ignore */ }
    }, 280);
  });
}

if ($('btn-amx-add-admin')) {
  $('btn-amx-add-admin').addEventListener('click', async () => {
    const userId = ($('amx-selected-user-id')?.value || _amxSelectedUser?.id || '').trim();
    const gameName = ($('amx-admin-name')?.value || '').trim();
    const flags = ($('amx-admin-flags')?.value || 'abcdefghijklmnopqrstu').trim();

    if (!userId) {
      notify('Önce kayıtlı bir kullanıcı seçin.', 'error');
      return;
    }
    if (!currentSettingsServerId) {
      notify('Sunucu seçilmedi!', 'error');
      return;
    }

    try {
      const token = await getSessionToken();
      const res = await fetch(`${API_URL}/api/servers/${currentSettingsServerId}/admins/add-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ userId, gameName: gameName || undefined, flags })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Admin eklenemedi');
      _currentAmxAdmins = Array.isArray(data.admins) ? data.admins : [];
      renderAmxAdminList();
      if ($('amx-user-search')) $('amx-user-search').value = '';
      if ($('amx-selected-user-id')) $('amx-selected-user-id').value = '';
      _amxSelectedUser = null;
      const sent = data.delivery?.emailSent;
      notify(
        data.message ||
          (sent
            ? 'Admin eklendi — şifre e-posta ile gönderildi.'
            : 'Admin eklendi — şifre site bildirimi olarak bırakıldı.'),
        sent ? 'success' : 'ok'
      );
    } catch (e) {
      notify('Admin ekleme hatası: ' + e.message, 'error');
    }
  });
}

/** Üye admin yapıldığında gelen şifre bildirimi (mail yedeği) */
window.checkAdminPasswordNotices = async function checkAdminPasswordNotices() {
  try {
    if (!getCurrentUser()) return;
    const token = await getSessionToken();
    if (!token) return;
    const res = await fetch(`${API_URL}/api/me/admin-notices`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    const notices = Array.isArray(data.notices) ? data.notices : [];
    if (!notices.length) return;

    const n = notices[0];
    const modal = document.getElementById('admin-pw-notice-modal');
    const body = document.getElementById('admin-pw-notice-body');
    if (!modal || !body) {
      if (typeof window.customAlert === 'function') {
        window.customAlert(
          `Admin şifren: ${n.password}\n\nKonsol:\nsetinfo _pw ${n.password}\nretry`
        );
      }
      return;
    }

    const serverLine = [n.serverName, n.port ? `port ${n.port}` : '']
      .filter(Boolean)
      .join(' · ');
    body.innerHTML = `
      <p style="margin:0 0 0.75rem;color:var(--text-dim);font-size:0.82rem;line-height:1.45;">
        Bir sunucuya <strong style="color:var(--text-bright)">admin</strong> olarak eklendin.
        ${serverLine ? `<br><span style="color:var(--cs-yellow)">${serverLine}</span>` : ''}
      </p>
      <div style="background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:0.75rem;margin-bottom:0.85rem;text-align:left;">
        <div style="font-size:0.65rem;color:var(--text-dim);margin-bottom:0.25rem;">OYUN ADI</div>
        <div style="font-family:var(--font-hud);color:var(--text-bright);margin-bottom:0.65rem;">${n.gameName || '—'}</div>
        <div style="font-size:0.65rem;color:var(--text-dim);margin-bottom:0.25rem;">ADMIN ŞİFRE (_pw)</div>
        <div style="font-family:var(--font-hud);color:var(--cs-yellow);font-size:1.1rem;letter-spacing:0.04em;" id="admin-pw-notice-pass">${n.password}</div>
      </div>
      <p style="margin:0 0 0.5rem;font-size:0.75rem;color:var(--text-dim);text-align:left;line-height:1.4;">
        Siteye girişliyken şifre genelde otomatik gelir. Nick değiştirirsen konsolda:
      </p>
      <pre style="margin:0;padding:0.65rem 0.75rem;background:#0a0e14;border-radius:4px;font-size:0.72rem;color:#9fef00;text-align:left;overflow:auto;">setinfo _pw ${n.password}
retry</pre>
    `;
    modal.style.display = 'flex';
    modal.dataset.noticeIds = notices.map((x) => x.id).join(',');
  } catch (e) {
    /* sessiz */
  }
};

window.dismissAdminPasswordNotices = async function () {
  const modal = document.getElementById('admin-pw-notice-modal');
  if (!modal) return;
  const ids = (modal.dataset.noticeIds || '').split(',').filter(Boolean);
  modal.style.display = 'none';
  try {
    const token = await getSessionToken();
    if (!token || !ids.length) return;
    await fetch(`${API_URL}/api/me/admin-notices/read`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ ids })
    });
  } catch (e) { /* ignore */ }
};

if ($('btn-amx-save-admins')) {
  $('btn-amx-save-admins').addEventListener('click', () => saveAmxAdmins(true));
}

document.querySelectorAll('.amx-quick').forEach(btn => {
  btn.addEventListener('click', async () => {
    const cmd = btn.getAttribute('data-cmd');
    if (!cmd) return;
    const rconPass = $('rcon-auth-pass')?.value || $('cfg-rcon-pass')?.value || '';
    if (!rconPass) {
      notify('RCON şifresi gerekli (RCON sekmesi).', 'error');
      switchTab(tabRcon, settingsRconView);
      return;
    }
    await sendRcon(cmd, `AMXX: ${cmd}`);
  });
});

if ($('btn-amx-command-send')) {
  $('btn-amx-command-send').addEventListener('click', async () => {
    const cmd = ($('amx-command-input')?.value || '').trim();
    if (!cmd) return;
    await sendRcon(cmd, null);
    if ($('amx-command-input')) $('amx-command-input').value = '';
  });
}

// ── 5v5 MAÇ MODU — modal tabanlı akış (overrideMatchModeBtn) ───────────────
// Eski doğrudan handler kaldırıldı; tek giriş noktası overrideMatchModeBtn.

// ── NORMAL MODA DÖN — NORMAL.CFG YAZ + EXEC ──────────────────────────────
if ($('btn-normal-mode')) {
  $('btn-normal-mode').addEventListener('click', async () => {
    const btn = $('btn-normal-mode');
    const rconPass = $('rcon-auth-pass') ? $('rcon-auth-pass').value : '';
    if (!rconPass) { notify('RCON sekmesinde şifrenizi girin!', 'error'); switchTab(tabRcon, settingsRconView); return; }
    if (!currentSettingsServerId) { notify('Sunucu ID bulunamadı!', 'error'); return; }
    btn.textContent = 'NORMAL.CFG YAZILIYOR...';
    btn.disabled = true;

    // DB'deki kayıtlı ayarları kullan (varsa), yoksa pub default'ları
    const startMoney = $('cfg-startmoney')?.value || '16000';
    const roundTime = $('cfg-roundtime')?.value || '5';
    const freezeTime = $('cfg-freezetime')?.value || '6';
    const gravity = $('cfg-gravity')?.value || '800';
    const timelimit = $('cfg-timelimit')?.value || '30';

    const normalCfgContent = `// CS 1.5 Normal Pub Config - BrowserCS
sv_cheats 0
sv_lan 0
sv_gravity ${gravity}
sv_maxspeed 320
mp_friendlyfire 0
mp_autoteambalance 1
mp_limitteams 2
mp_autokick 1
mp_tkpunish 1
mp_startmoney ${startMoney}
mp_buytime 1.5
mp_freezetime ${freezeTime}
mp_roundtime ${roundTime}
mp_c4timer 35
mp_timelimit ${timelimit}
mp_maxrounds 0
mp_winlimit 0
mp_flashlight 1
mp_footsteps 1
mp_fadetoblack 0
mp_forcechasecam 0
allow_spectators 1
sv_password ""
browsercs_match 0
log off
say "== NORMAL MOD AKTIF =="
say "FF:OFF | MONEY:${startMoney} | ROUND:${roundTime}dk | TIME:${timelimit}dk"
sv_restartround 3
`;

    try {
      const token = await getSessionToken();
      const writeRes = await fetch(`${API_URL}/api/servers/${currentSettingsServerId}/write-cfg`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
        body: JSON.stringify({ filename: 'normal', content: normalCfgContent })
      });
      const writeData = await writeRes.json();
      if (!writeData.success) throw new Error(writeData.error || 'CFG yazılamıyor');

      const execOk = await execModeCfg('normal', writeData);
      if (execOk) {
        notify('↩ Normal mod aktif! Round 3 saniye içinde yeniden başlayacak.', 'success');
      }
    } catch (e) {
      notify('Normal CFG hatası: ' + e.message, 'error');
    }
    btn.disabled = false;
    btn.textContent = '↩ NORMAL MODA DÖN';
  });
}


export function initServerSettings() {
  /* side effects on import */
}
