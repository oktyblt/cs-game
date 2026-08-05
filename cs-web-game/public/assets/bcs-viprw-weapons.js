/*! BrowserCS — VIP weapon skin chooser v12
 * Ayrı paket (gold gibi):
 * - gold  → models/*_vip_*.mdl     (cstrike_weapons_vip.pk3)
 * - rw    → models/*_viprw_*.mdl   (cstrike_weapons_viprw.pk3)
 * Server 2.0.0+ precaches both (VIP-only Gold / Kırmızı-Beyaz); client extracts viprw to real paths.
 * Skin switch = bcs_vipwpnskin + lastinv (no page reload / no same-name overlay).
 */
(function () {
  'use strict';
  var RW_PK3 = '/wasm/cstrike_weapons_viprw_v4.pk3?v=1';
  var RW_PK3_NAME = 'cstrike_weapons_viprw_v4.pk3';
  var MENU_ID = 'bcs-vip-wpn-skin-menu';
  var SKIN_KEY = '_bcsVipWpnSkin';
  var busy = false;
  var loadPromise = null;

  function crumb(phase, detail) {
    try { if (typeof window._browserCSCrumb === 'function') window._browserCSCrumb(phase, detail || {}); } catch (_) {}
  }
  function getFs() {
    try { return (window.state && window.state.xash && window.state.xash.em && window.state.xash.em.FS) || null; }
    catch (_) { return null; }
  }
  function runRaw(cmd) {
    if (typeof window.__bcsRunEngineCommandRaw === 'function') return window.__bcsRunEngineCommandRaw(cmd);
    if (typeof window.executeEngineCommand === 'function') {
      window._browserCSVipSayPassthrough = true;
      try { return window.executeEngineCommand(cmd); }
      finally { window._browserCSVipSayPassthrough = false; }
    }
    return false;
  }
  function mkdirp(fs, path) {
    var parts = path.split('/').filter(Boolean), cur = '';
    for (var i = 0; i < parts.length; i++) {
      cur += '/' + parts[i];
      try { fs.mkdir(cur); } catch (_) {}
    }
  }
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
  function unzipStore(buf) {
    var out = {}, b = buf instanceof Uint8Array ? buf : new Uint8Array(buf), i = 0;
    while (i + 30 < b.length) {
      if (u32(b, i) !== 0x04034b50) break;
      var method = u16(b, i + 8);
      var compSize = u32(b, i + 18);
      var nameLen = u16(b, i + 26);
      var extraLen = u16(b, i + 28);
      var name = '';
      for (var n = 0; n < nameLen; n++) name += String.fromCharCode(b[i + 30 + n]);
      var dataStart = i + 30 + nameLen + extraLen;
      var data = b.subarray(dataStart, dataStart + compSize);
      if (method !== 0) throw new Error('compressed pk3: ' + name);
      out[name] = data;
      i = dataStart + compSize;
    }
    return out;
  }
  async function fetchPk3(url) {
    var bare = url.split('?')[0];
    var res = await fetch(bare, { cache: 'force-cache' }).catch(function () { return null; });
    if (!res || !res.ok) res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('RW pk3 HTTP ' + res.status + ' ' + bare);
    return new Uint8Array(await res.arrayBuffer());
  }

  function extractViprwToVfs(fs, bytes) {
    var files = unzipStore(bytes);
    var count = 0;
    Object.keys(files).forEach(function (raw) {
      if (!raw || raw.endsWith('/')) return;
      var rel = raw.replace(/^\/+/, '').replace(/^cstrike\//i, '');
      if (!rel || rel.indexOf('..') !== -1 || !/\.mdl$/i.test(rel)) return;
      if (!/[\/]?[vpw]_viprw_[^/]+\.mdl$/i.test(rel)) return;
      var path = '/cstrike/' + rel;
      mkdirp(fs, path.slice(0, path.lastIndexOf('/')));
      fs.writeFile(path, files[raw]);
      count++;
    });
    return count;
  }

  /** Gold-parity: write archive + extract models/*_viprw_*.mdl */
  async function ensureRwModels() {
    if (window._browserCSVipRwAssetsReady && window._browserCSVipRwVfsCount > 20) {
      return window._browserCSVipRwVfsCount;
    }
    if (loadPromise) return loadPromise;
    loadPromise = (async function () {
      crumb('viprw_assets_start');
      var fs = getFs();
      if (!fs) throw new Error('Engine FS yok — once oyuna gir');
      var bytes = await fetchPk3(RW_PK3);
      try { fs.writeFile('/cstrike/' + RW_PK3_NAME, bytes); } catch (_) {}
      var n = extractViprwToVfs(fs, bytes);
      window._browserCSVipRwVfsCount = n;
      window._browserCSVipRwAssetsReady = true;
      window._browserCSVipRwWeaponsReady = true;
      crumb('viprw_vfs_ready', { files: n });
      try { console.log('[bcs-viprw] separate pack ready', n, 'mdl'); } catch (_) {}
      if (n < 10) throw new Error('RW modeller yazılamadı (' + n + ')');
      return n;
    })().catch(function (err) {
      loadPromise = null;
      window._browserCSVipRwAssetsReady = false;
      crumb('viprw_assets_fail', { err: (err && err.message) || String(err) });
      throw err;
    });
    return loadPromise;
  }

  function preferredSkin() {
    try {
      return String(localStorage.getItem(SKIN_KEY) || window._browserCSVipWpnSkin || 'gold').toLowerCase() === 'rw' ? 'rw' : 'gold';
    } catch (_) { return 'gold'; }
  }
  function setPreferredSkin(s) {
    var v = s === 'rw' ? 'rw' : 'gold';
    try { localStorage.setItem(SKIN_KEY, v); } catch (_) {}
    window._browserCSVipWpnSkin = v;
    return v;
  }

  function nudgeWeapon() {
    setTimeout(function () { try { runRaw('lastinv'); } catch (_) {} }, 80);
    setTimeout(function () { try { runRaw('lastinv'); } catch (_) {} }, 250);
    setTimeout(function () { try { runRaw('lastinv'); } catch (_) {} }, 600);
  }

  function ensureStyle() {
    if (document.getElementById('bcs-vip-wpn-skin-style')) return;
    var s = document.createElement('style');
    s.id = 'bcs-vip-wpn-skin-style';
    s.textContent = [
      '#' + MENU_ID + '{position:fixed;inset:0;z-index:12000;display:none;align-items:center;justify-content:center;background:rgba(6,8,12,.72);backdrop-filter:blur(4px);}',
      '#' + MENU_ID + '.show{display:flex;}',
      '#' + MENU_ID + ' .panel{width:min(420px,92vw);padding:1.25rem 1.35rem 1.1rem;border:1px solid rgba(255,215,0,.28);background:linear-gradient(165deg,#141820 0%,#0c1018 100%);color:#f2f4f8;font-family:ui-sans-serif,system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.45);}',
      '#' + MENU_ID + ' h2{margin:0 0 .35rem;font-size:1.15rem;letter-spacing:.04em;color:#ffd700;}',
      '#' + MENU_ID + ' p{margin:0 0 1rem;color:#a8b0bd;font-size:.88rem;line-height:1.4;}',
      '#' + MENU_ID + ' .choices{display:grid;gap:.65rem;}',
      '#' + MENU_ID + ' button{appearance:none;border:1px solid rgba(255,255,255,.12);background:#1a2230;color:#fff;padding:.85rem 1rem;text-align:left;cursor:pointer;font-size:.95rem;}',
      '#' + MENU_ID + ' button:hover{border-color:rgba(255,215,0,.55);background:#222c3d;}',
      '#' + MENU_ID + ' button .sub{display:block;margin-top:.2rem;color:#8b95a5;font-size:.78rem;}',
      '#' + MENU_ID + ' button.rw{border-color:rgba(220,40,60,.45);}',
      '#' + MENU_ID + ' .close{margin-top:.85rem;background:transparent;border:none;color:#8b95a5;font-size:.8rem;cursor:pointer;}'
    ].join('');
    document.head.appendChild(s);
  }
  function ensureMenu() {
    ensureStyle();
    var el = document.getElementById(MENU_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = MENU_ID;
    el.innerHTML = [
      '<div class="panel" role="dialog">',
      '<h2>VIP SİLAH SKİN</h2>',
      '<p>VIP özel: Altın veya Kırmızı–Beyaz. Seçince oyun içinde değişir.</p>',
      '<div class="choices">',
      '<button type="button" data-skin="gold">Altın<span class="sub">Klasik VIP gold silahlar</span></button>',
      '<button type="button" data-skin="rw" class="rw">Kırmızı–Beyaz<span class="sub">VIP özel yeni paket</span></button>',
      '</div>',
      '<button type="button" class="close" data-close="1">Kapat</button>',
      '</div>'
    ].join('');
    el.addEventListener('click', function (e) {
      if (e.target === el || (e.target && e.target.getAttribute('data-close'))) closeMenu();
    });
    el.querySelectorAll('button[data-skin]').forEach(function (btn) {
      btn.addEventListener('click', function () { pickSkin(btn.getAttribute('data-skin')); });
    });
    document.body.appendChild(el);
    return el;
  }
  function openMenu() {
    ensureMenu().classList.add('show');
    crumb('vip_wpn_skin_menu_open');
    try { ensureRwModels().catch(function () {}); } catch (_) {}
  }
  function closeMenu() {
    var el = document.getElementById(MENU_ID);
    if (el) el.classList.remove('show');
  }

  async function pickSkin(skin) {
    var s = String(skin || 'gold').toLowerCase() === 'rw' ? 'rw' : 'gold';
    if (busy) return;
    busy = true;
    try {
      if (s === 'rw') {
        if (typeof window.notify === 'function') window.notify('Kırmızı–beyaz paket yükleniyor...', 'info');
        await ensureRwModels();
        await new Promise(function (r) { setTimeout(r, 150); });
      }
      setPreferredSkin(s);
      runRaw('bcs_vipwpnskin ' + s);
      nudgeWeapon();
      if (typeof window.notify === 'function') {
        window.notify(s === 'rw' ? 'Silah skin: Kırmızı–Beyaz' : 'Silah skin: Altın', 'success');
      }
      crumb('vip_wpn_skin_pick', { skin: s });
      closeMenu();
    } catch (err) {
      if (typeof window.notify === 'function') window.notify('Skin hata: ' + ((err && err.message) || err), 'error');
      crumb('vip_wpn_skin_fail', { err: (err && err.message) || String(err) });
    } finally {
      busy = false;
    }
  }

  function hookActivate() {
    var prev = window.activateVipViaChat;
    if (typeof prev !== 'function' || prev._bcsWpnSkinWrapped) return;
    window.activateVipViaChat = async function () {
      var ok = await prev.apply(this, arguments);
      try {
        var port = window._browserCSConnectPort || '';
        var meta = typeof window.getStoredVipMeta === 'function' ? window.getStoredVipMeta(port) : null;
        var tier = String((meta && (meta.tier || meta.plan)) || '').toLowerCase();
        if (tier === 'gold' || tier === 'platinum') {
          // Load separate RW pack in background (like gold VIP pk3)
          ensureRwModels().catch(function () {});
          setTimeout(openMenu, 500);
        }
      } catch (_) {}
      return ok;
    };
    window.activateVipViaChat._bcsWpnSkinWrapped = true;
  }

  /** Before connect: put viprw files in VFS so server precache finds local IDST (not FastDL HTML). */
  function hookConnect() {
    if (typeof window.connectToServer !== 'function' || window.connectToServer._bcsVipRwPackWrapped) return;
    var prev = window.connectToServer;
    window.connectToServer = async function () {
      // Prefetch pk3 bytes early (no FS needed)
      var prefetch = fetchPk3(RW_PK3).catch(function () { return null; });
      // Patch eng connect to sync-extract if FS ready
      var prevRaw = window.__bcsRunEngineCommandRaw;
      var prevExec = window.executeEngineCommand;
      function syncExtractBeforeConnect(cmd) {
        if (!/^\s*connect\b/i.test(String(cmd || ''))) return;
        var fs = getFs();
        if (!fs) return;
        try {
          if (window._browserCSVipRwBytes) {
            try { fs.writeFile('/cstrike/' + RW_PK3_NAME, window._browserCSVipRwBytes); } catch (_) {}
            var n = extractViprwToVfs(fs, window._browserCSVipRwBytes);
            window._browserCSVipRwVfsCount = n;
            window._browserCSVipRwAssetsReady = n > 20;
            crumb('viprw_preconnect_extract', { files: n });
          }
        } catch (_) {}
      }
      if (typeof prevRaw === 'function') {
        window.__bcsRunEngineCommandRaw = function (cmd) {
          syncExtractBeforeConnect(cmd);
          return prevRaw.apply(this, arguments);
        };
      }
      if (typeof prevExec === 'function') {
        window.executeEngineCommand = function (cmd) {
          syncExtractBeforeConnect(cmd);
          return prevExec.apply(this, arguments);
        };
      }
      try {
        var bytes = await prefetch;
        if (bytes) window._browserCSVipRwBytes = bytes;
        return await prev.apply(this, arguments);
      } finally {
        if (typeof prevRaw === 'function') window.__bcsRunEngineCommandRaw = prevRaw;
        if (typeof prevExec === 'function') window.executeEngineCommand = prevExec;
      }
    };
    window.connectToServer._bcsVipRwPackWrapped = true;
  }

  // Also load alongside gold VIP assets
  function hookVipAssets() {
    if (typeof window.ensureVipAssetsLoaded !== 'function' || window.ensureVipAssetsLoaded._bcsVipRwPackWrapped) return;
    var prev = window.ensureVipAssetsLoaded;
    window.ensureVipAssetsLoaded = async function () {
      var r = await prev.apply(this, arguments);
      try { await ensureRwModels(); } catch (_) {}
      return r;
    };
    window.ensureVipAssetsLoaded._bcsVipRwPackWrapped = true;
  }

  window.openVipWeaponSkinMenu = openMenu;
  window.pickVipWeaponSkin = pickSkin;
  window.ensureVipRwWeaponsLoaded = ensureRwModels;

  function boot() {
    hookActivate();
    hookConnect();
    hookVipAssets();
    setInterval(function () {
      hookActivate();
      hookConnect();
      hookVipAssets();
    }, 1200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
