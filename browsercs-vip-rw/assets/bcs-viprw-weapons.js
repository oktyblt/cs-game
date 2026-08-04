/*! BrowserCS — VIP weapon skin chooser + lazy red/white pack v3
 * Gold pack stays in boot PK3s. Red/white loads only after VIP picks it.
 * FastDL now serves real viprw MDLs under /cs-assets/ for other players.
 */
(function () {
  'use strict';
  var PK3_URL = '/wasm/cstrike_weapons_viprw.pk3?v=1';
  var PK3_NAME = 'cstrike_weapons_viprw.pk3';
  var loading = null;
  var MENU_ID = 'bcs-vip-wpn-skin-menu';

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
      if (method !== 0) throw new Error('compressed pk3 entry: ' + name);
      out[name] = data;
      i = dataStart + compSize;
    }
    return out;
  }

  function extractToVfs(fs, files) {
    var count = 0;
    Object.keys(files).forEach(function (raw) {
      if (!raw || raw.endsWith('/')) return;
      var rel = raw.replace(/^\/+/, '').replace(/^cstrike\//i, '');
      if (!rel || rel.indexOf('..') !== -1 || !/\.mdl$/i.test(rel)) return;
      var path = '/cstrike/' + rel;
      mkdirp(fs, path.slice(0, path.lastIndexOf('/')));
      fs.writeFile(path, files[raw]);
      count++;
    });
    return count;
  }

  async function ensureVipRwWeaponsLoaded() {
    if (window._browserCSVipRwWeaponsReady) return true;
    if (loading) return loading;
    loading = (async function () {
      crumb('viprw_assets_start');
      var fs = getFs();
      if (!fs) throw new Error('Engine FS yok');
      var res = await fetch(PK3_URL, { cache: 'force-cache' }).catch(function () { return null; });
      if (!res || !res.ok) res = await fetch(PK3_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('viprw pk3 HTTP ' + res.status);
      var bytes = new Uint8Array(await res.arrayBuffer());
      try { fs.writeFile('/cstrike/' + PK3_NAME, bytes); } catch (_) {}
      var n = extractToVfs(fs, unzipStore(bytes));
      window._browserCSVipRwWeaponsReady = true;
      crumb('viprw_assets_ready', { files: n });
      try { console.log('[bcs-viprw] lazy ✓', n, 'mdl'); } catch (_) {}
      return true;
    })().catch(function (err) {
      loading = null;
      crumb('viprw_assets_fail', { err: (err && err.message) || String(err) });
      throw err;
    });
    return loading;
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
      '#' + MENU_ID + ' button.rw:hover{border-color:rgba(255,80,100,.8);}',
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
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = [
      '<div class="panel" role="dialog" aria-label="VIP silah skin">',
      '<h2>VIP SİLAH SKİN</h2>',
      '<p>Gold / Platinum için silah görünümü seç. İstediğin zaman F2 → /vip ile değiştirebilirsin.</p>',
      '<div class="choices">',
      '<button type="button" data-skin="gold">Altın (Gold)<span class="sub">Klasik VIP altın silahlar — herkese zaten yüklü</span></button>',
      '<button type="button" data-skin="rw" class="rw">Kırmızı–Beyaz<span class="sub">Özel VIP paket (ilk seçimde indirilir)</span></button>',
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
    var el = ensureMenu();
    el.classList.add('show');
    el.setAttribute('aria-hidden', 'false');
    crumb('vip_wpn_skin_menu_open');
  }

  function closeMenu() {
    var el = document.getElementById(MENU_ID);
    if (!el) return;
    el.classList.remove('show');
    el.setAttribute('aria-hidden', 'true');
  }

  async function pickSkin(skin) {
    var s = String(skin || 'gold').toLowerCase();
    if (s !== 'gold' && s !== 'rw') s = 'gold';
    try {
      if (s === 'rw') {
        if (typeof window.notify === 'function') window.notify('Kırmızı–beyaz paket yükleniyor...', 'info');
        await ensureVipRwWeaponsLoaded();
      }
      runRaw('bcs_vipwpnskin ' + s);
      try { localStorage.setItem('_bcsVipWpnSkin', s); } catch (_) {}
      window._browserCSVipWpnSkin = s;
      if (typeof window.notify === 'function') {
        window.notify(s === 'rw' ? 'Silah skin: Kırmızı–Beyaz' : 'Silah skin: Altın', 'success');
      }
      crumb('vip_wpn_skin_pick', { skin: s });
      closeMenu();
    } catch (err) {
      if (typeof window.notify === 'function') window.notify('Skin yüklenemedi: ' + ((err && err.message) || err), 'error');
      crumb('vip_wpn_skin_fail', { err: (err && err.message) || String(err) });
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
          setTimeout(openMenu, 450);
        }
      } catch (_) {}
      return ok;
    };
    window.activateVipViaChat._bcsWpnSkinWrapped = true;
  }

  window.ensureVipRwWeaponsLoaded = ensureVipRwWeaponsLoaded;
  window.openVipWeaponSkinMenu = openMenu;
  window.pickVipWeaponSkin = pickSkin;

  function boot() {
    hookActivate();
    setInterval(hookActivate, 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
