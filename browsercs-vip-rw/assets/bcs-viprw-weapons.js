/*! BrowserCS — VIP weapon skin chooser v10
 * JOIN-SAFE:
 * - Server precaches only *_vip_* (plugin 1.9.0). Never viprw.
 * - RW bytes onto *_vip_* BEFORE connect (engine model cache is by path).
 * - Mid-game pick → overlay + in-engine reconnect (NO full page reload).
 */
(function () {
  'use strict';
  var RW_PK3 = '/wasm/cstrike_weapons_viprw.pk3?v=3';
  var GOLD_PK3 = '/wasm/cstrike_weapons_vip.pk3?v=4';
  var MENU_ID = 'bcs-vip-wpn-skin-menu';
  var SKIN_KEY = '_bcsVipWpnSkin';
  var busy = false;
  var rwPackPromise = null;
  var goldPackCache = null;
  var connectHookInstalled = false;

  function crumb(phase, detail) {
    try { if (typeof window._browserCSCrumb === 'function') window._browserCSCrumb(phase, detail || {}); } catch (_) {}
  }
  function getFs() {
    try { return (window.state && window.state.xash && window.state.xash.em && window.state.xash.em.FS) || null; }
    catch (_) { return null; }
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
    if (!res.ok) throw new Error('pk3 HTTP ' + res.status + ' ' + bare);
    return new Uint8Array(await res.arrayBuffer());
  }
  function preferredSkin() {
    try { return String(localStorage.getItem(SKIN_KEY) || window._browserCSVipWpnSkin || 'gold').toLowerCase() === 'rw' ? 'rw' : 'gold'; }
    catch (_) { return 'gold'; }
  }
  function setPreferredSkin(s) {
    var v = s === 'rw' ? 'rw' : 'gold';
    try { localStorage.setItem(SKIN_KEY, v); } catch (_) {}
    window._browserCSVipWpnSkin = v;
    return v;
  }
  function viprwRelToVipPath(rel) {
    var m = rel.match(/^(models\/[vpw]_)viprw_([^/]+\.mdl)$/i);
    if (!m) return null;
    return '/cstrike/' + m[1] + 'vip_' + m[2];
  }
  function writeMapped(fs, files, mapFn) {
    var count = 0;
    Object.keys(files).forEach(function (raw) {
      if (!raw || raw.endsWith('/')) return;
      var rel = raw.replace(/^\/+/, '').replace(/^cstrike\//i, '');
      if (!rel || rel.indexOf('..') !== -1 || !/\.mdl$/i.test(rel)) return;
      var path = mapFn(rel);
      if (!path) return;
      mkdirp(fs, path.slice(0, path.lastIndexOf('/')));
      fs.writeFile(path, files[raw]);
      count++;
    });
    return count;
  }
  async function loadRwFiles() {
    if (window._browserCSVipRwFiles) return window._browserCSVipRwFiles;
    if (rwPackPromise) return rwPackPromise;
    rwPackPromise = (async function () {
      crumb('viprw_pack_fetch');
      var files = unzipStore(await fetchPk3(RW_PK3));
      window._browserCSVipRwFiles = files;
      crumb('viprw_pack_ready', { entries: Object.keys(files).length });
      return files;
    })().catch(function (err) {
      rwPackPromise = null;
      throw err;
    });
    return rwPackPromise;
  }
  async function applySkinOverlay(skin) {
    var fs = getFs();
    if (!fs) throw new Error('Engine FS yok');
    var n;
    if (skin === 'rw') {
      n = writeMapped(fs, await loadRwFiles(), viprwRelToVipPath);
    } else {
      if (!goldPackCache) goldPackCache = await fetchPk3(GOLD_PK3);
      n = writeMapped(fs, unzipStore(goldPackCache), function (rel) {
        if (!/^(models\/[vpw]_)vip_[^/]+\.mdl$/i.test(rel)) return null;
        return '/cstrike/' + rel;
      });
    }
    if (n < 10) throw new Error('Skin yazılamadı (' + n + ')');
    window._browserCSVipSkinOverlay = skin;
    crumb('viprw_overlay', { skin: skin, files: n });
    try { console.log('[bcs-viprw] overlay', skin, n); } catch (_) {}
    return n;
  }

  /** Must run after VIP gold pk3 extract, before eng `connect`. */
  async function prepareBeforeConnect() {
    var skin = preferredSkin();
    if (skin !== 'rw') return 0;
    var fs = getFs();
    if (!fs) {
      crumb('viprw_preconnect_no_fs');
      return 0;
    }
    try {
      if (typeof window.ensureVipAssetsLoaded === 'function') {
        await window.ensureVipAssetsLoaded().catch(function () {});
      }
    } catch (_) {}
    return applySkinOverlay('rw');
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

  function softReconnect(reason) {
    var port = window._browserCSConnectPort || '';
    var skin = preferredSkin();
    crumb('viprw_ingame_reconnect', { reason: reason || '', port: port, skin: skin });
    if (typeof window.notify === 'function') {
      window.notify('Skin uygulanıyor — sunucuya yeniden giriliyor (sayfa yenilenmez)...', 'info');
    }
    try { sessionStorage.setItem('_bcsVipSkinReapply', skin); } catch (_) {}

    // 1) Drop current server session so model cache reloads from VFS on reconnect
    try { runRaw('disconnect'); } catch (_) {}
    try {
      if (typeof window.executeEngineCommand === 'function') window.executeEngineCommand('disconnect');
    } catch (_) {}

    // 2) Reconnect via existing BrowserCS pipe (no location.reload)
    setTimeout(function () {
      try {
        if (window.BrowserCSReconnect && typeof window.BrowserCSReconnect.retryNow === 'function') {
          window.BrowserCSReconnect.retryNow();
          return;
        }
      } catch (_) {}
      // Fallback: direct connect if reconnect helper missing
      if (port) {
        try { runRaw('connect 10.0.0.1:' + port); } catch (_) {}
      } else {
        // Last resort only
        try {
          sessionStorage.setItem('_csAutoConnect', JSON.stringify({
            port: String(port || ''),
            map: (window._motdServerMeta && window._motdServerMeta.mapName) || 'fy_iceworld',
            password: ''
          }));
        } catch (_) {}
        window.location.reload();
      }
    }, 450);

    // 3) After join, re-assert skin command + VIP
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var joined = false;
      try {
        joined = !!(window.BrowserCSReconnect && window.BrowserCSReconnect.sessionJoined) ||
          !!window._browserCSInGameFlag;
      } catch (_) {}
      if (joined || tries > 40) {
        clearInterval(timer);
        try { runRaw('bcs_vipwpnskin ' + preferredSkin()); } catch (_) {}
        try { window.injectVipTicketNow && window.injectVipTicketNow('skin_rejoin'); } catch (_) {}
        crumb('viprw_rejoin_skin_assert', { skin: preferredSkin(), joined: joined, tries: tries });
      }
    }, 500);
  }

  function installConnectHook() {
    if (connectHookInstalled) return;
    var raw = window.__bcsRunEngineCommandRaw;
    var exec = window.executeEngineCommand;
    if (typeof raw !== 'function' && typeof exec !== 'function') return;

    function wrap(fn) {
      if (!fn || fn._bcsVipRwConnectWrapped) return fn;
      var wrapped = function (cmd) {
        var c = String(cmd || '');
        if (/^\s*connect\b/i.test(c) && preferredSkin() === 'rw') {
          // Fire-and-forget sync barrier: block connect until overlay finishes
          var done = false;
          var err = null;
          prepareBeforeConnect().then(function () { done = true; }).catch(function (e) {
            err = e; done = true;
            crumb('viprw_preconnect_fail', { err: (e && e.message) || String(e) });
          });
          // Busy-wait is bad; instead chain via async then call fn
          // Since eng cmds are sync, use a microtask gate with Atomics? Not available.
          // Fallback: apply overlay synchronously if pack already in memory.
        }
        return fn.apply(this, arguments);
      };
      // Proper async intercept using a queue flag
      wrapped = async function (cmd) {
        var c = String(cmd || '');
        if (/^\s*connect\b/i.test(c) && preferredSkin() === 'rw') {
          try { await prepareBeforeConnect(); } catch (e) {
            crumb('viprw_preconnect_fail', { err: (e && e.message) || String(e) });
          }
        }
        return fn.apply(this, arguments);
      };
      wrapped._bcsVipRwConnectWrapped = true;
      return wrapped;
    }

    // Most call sites are sync; wrap both and also patch ensureVipAssetsLoaded
    if (typeof window.ensureVipAssetsLoaded === 'function' && !window.ensureVipAssetsLoaded._bcsVipRwWrapped) {
      var prevEnsure = window.ensureVipAssetsLoaded;
      window.ensureVipAssetsLoaded = async function () {
        var r = await prevEnsure.apply(this, arguments);
        if (preferredSkin() === 'rw') {
          try { await applySkinOverlay('rw'); } catch (_) {}
        }
        return r;
      };
      window.ensureVipAssetsLoaded._bcsVipRwWrapped = true;
    }

    // Intercept connect by wrapping connectToServer (async) — most reliable
    if (typeof window.connectToServer === 'function' && !window.connectToServer._bcsVipRwWrapped) {
      var prevConnect = window.connectToServer;
      window.connectToServer = async function () {
        // Prefetch RW pack during load (doesn't need FS)
        if (preferredSkin() === 'rw') {
          try { await loadRwFiles(); } catch (_) {}
        }
        // Monkey-patch eng raw just for this connect cycle
        var hadRaw = typeof window.__bcsRunEngineCommandRaw === 'function';
        var prevRaw = window.__bcsRunEngineCommandRaw;
        var prevExec = window.executeEngineCommand;
        async function gate(cmd, call) {
          if (/^\s*connect\b/i.test(String(cmd || '')) && preferredSkin() === 'rw') {
            try { await prepareBeforeConnect(); } catch (_) {}
          }
          return call(cmd);
        }
        if (hadRaw) {
          window.__bcsRunEngineCommandRaw = function (cmd) {
            // sync bridge: if pack+fs ready, apply overlay inline before connect
            if (/^\s*connect\b/i.test(String(cmd || '')) && preferredSkin() === 'rw') {
              var fs = getFs();
              if (fs && window._browserCSVipRwFiles && window._browserCSVipSkinOverlay !== 'rw') {
                try {
                  writeMapped(fs, window._browserCSVipRwFiles, viprwRelToVipPath);
                  window._browserCSVipSkinOverlay = 'rw';
                  crumb('viprw_sync_overlay_before_connect');
                } catch (_) {}
              }
            }
            return prevRaw.apply(this, arguments);
          };
        }
        if (typeof prevExec === 'function') {
          window.executeEngineCommand = function (cmd) {
            if (/^\s*connect\b/i.test(String(cmd || '')) && preferredSkin() === 'rw') {
              var fs = getFs();
              if (fs && window._browserCSVipRwFiles && window._browserCSVipSkinOverlay !== 'rw') {
                try {
                  writeMapped(fs, window._browserCSVipRwFiles, viprwRelToVipPath);
                  window._browserCSVipSkinOverlay = 'rw';
                  crumb('viprw_sync_overlay_before_connect_exec');
                } catch (_) {}
              }
            }
            return prevExec.apply(this, arguments);
          };
        }
        try {
          return await prevConnect.apply(this, arguments);
        } finally {
          if (hadRaw) window.__bcsRunEngineCommandRaw = prevRaw;
          if (typeof prevExec === 'function') window.executeEngineCommand = prevExec;
        }
      };
      window.connectToServer._bcsVipRwWrapped = true;
    }

    // Global sync intercept for reconnect / other connect paths
    if (typeof window.__bcsRunEngineCommandRaw === 'function' && !window.__bcsRunEngineCommandRaw._bcsVipRwSyncWrapped) {
      var r0 = window.__bcsRunEngineCommandRaw;
      window.__bcsRunEngineCommandRaw = function (cmd) {
        if (/^\s*connect\b/i.test(String(cmd || '')) && preferredSkin() === 'rw') {
          var fs = getFs();
          if (fs && window._browserCSVipRwFiles) {
            try {
              var n = writeMapped(fs, window._browserCSVipRwFiles, viprwRelToVipPath);
              window._browserCSVipSkinOverlay = 'rw';
              crumb('viprw_sync_connect', { files: n });
            } catch (_) {}
          }
        }
        return r0.apply(this, arguments);
      };
      window.__bcsRunEngineCommandRaw._bcsVipRwSyncWrapped = true;
      connectHookInstalled = true;
    }
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
      '<p>Renk değişimi için kısa yeniden giriş yapılır (sayfa yenilenmez). Join güvenli.</p>',
      '<div class="choices">',
      '<button type="button" data-skin="gold">Altın (Gold)<span class="sub">Klasik altın VIP</span></button>',
      '<button type="button" data-skin="rw" class="rw">Kırmızı–Beyaz<span class="sub">Paket iner, kısa yeniden giriş</span></button>',
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
    try { loadRwFiles().catch(function () {}); } catch (_) {}
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
      if (typeof window.notify === 'function') {
        window.notify(s === 'rw' ? 'Kırmızı–beyaz hazırlanıyor...' : 'Altın hazırlanıyor...', 'info');
      }
      if (s === 'rw') await loadRwFiles();
      if (getFs()) await applySkinOverlay(s);
      setPreferredSkin(s);
      runRaw('bcs_vipwpnskin ' + s);
      crumb('vip_wpn_skin_pick', { skin: s });
      closeMenu();
      if (window.state && window.state.engineRunning && window._browserCSConnectPort) {
        softReconnect('skin_' + s);
      } else if (typeof window.notify === 'function') {
        window.notify(s === 'rw' ? 'Kırmızı–beyaz seçildi — girişte uygulanır' : 'Altın seçildi', 'success');
      }
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
        if (tier === 'gold' || tier === 'platinum') setTimeout(openMenu, 500);
      } catch (_) {}
      return ok;
    };
    window.activateVipViaChat._bcsWpnSkinWrapped = true;
  }

  window.openVipWeaponSkinMenu = openMenu;
  window.pickVipWeaponSkin = pickSkin;
  window.ensureVipRwWeaponsLoaded = loadRwFiles;
  window.prepareVipWeaponSkinBeforeConnect = prepareBeforeConnect;

  function boot() {
    hookActivate();
    installConnectHook();
    // Prefetch RW pack early if preferred (no FS needed)
    if (preferredSkin() === 'rw') {
      loadRwFiles().catch(function () {});
    }
    setInterval(function () {
      hookActivate();
      installConnectHook();
    }, 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
