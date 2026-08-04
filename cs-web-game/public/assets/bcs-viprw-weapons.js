/*! BrowserCS — VIP red/white weapon pack loader (additive) v1
 * Gold stock skins (cstrike_models_vipweapons) stay for everyone.
 * This pack adds models/v_viprw_*.mdl (+ p_/w_) for Gold/Platinum VIP sticky weapons.
 */
(function () {
  'use strict';
  var PK3_URL = '/wasm/cstrike_weapons_viprw.pk3?v=1';
  var PK3_NAME = 'cstrike_weapons_viprw.pk3';
  var loading = null;

  function crumb(phase, detail) {
    try {
      if (typeof window._browserCSCrumb === 'function') window._browserCSCrumb(phase, detail || {});
    } catch (_) {}
  }

  function getFs() {
    try {
      return (window.state && window.state.xash && window.state.xash.em && window.state.xash.em.FS) || null;
    } catch (_) {
      return null;
    }
  }

  function mkdirp(fs, path) {
    var parts = path.split('/').filter(Boolean);
    var cur = '';
    for (var i = 0; i < parts.length; i++) {
      cur += '/' + parts[i];
      try {
        fs.mkdir(cur);
      } catch (_) {}
    }
  }

  function inflatePk3(bytes) {
    // Prefer fflate/uzip if engine already exposed unzip via VIP loader internals — fallback: store-only zip parse
    if (typeof window.fflate !== 'undefined' && window.fflate.unzipSync) {
      return window.fflate.unzipSync(bytes);
    }
    return unzipStoreOrDeflate(bytes);
  }

  function u16(b, o) {
    return b[o] | (b[o + 1] << 8);
  }
  function u32(b, o) {
    return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  }

  function inflateRaw(data) {
    // Minimal inflate via DecompressionStream if available
    // For PK3 we build with store (method 0) — see unzip below.
    throw new Error('deflate pk3 unsupported in additive loader');
  }

  function unzipStoreOrDeflate(buf) {
    var out = {};
    var b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    var i = 0;
    while (i + 30 < b.length) {
      if (u32(b, i) !== 0x04034b50) break;
      var method = u16(b, i + 8);
      var compSize = u32(b, i + 18);
      var uncompSize = u32(b, i + 22);
      var nameLen = u16(b, i + 26);
      var extraLen = u16(b, i + 28);
      var name = '';
      for (var n = 0; n < nameLen; n++) name += String.fromCharCode(b[i + 30 + n]);
      var dataStart = i + 30 + nameLen + extraLen;
      var data = b.subarray(dataStart, dataStart + compSize);
      if (method === 0) {
        out[name] = data;
      } else if (method === 8) {
        // try browser DecompressionStream raw deflate — not always available for raw
        throw new Error('compressed pk3 entry: ' + name);
      } else {
        throw new Error('zip method ' + method + ' for ' + name);
      }
      i = dataStart + compSize;
    }
    return out;
  }

  function extractToVfs(fs, files) {
    var count = 0;
    Object.keys(files).forEach(function (raw) {
      if (!raw || raw.endsWith('/')) return;
      var rel = raw.replace(/^\/+/, '').replace(/^cstrike\//i, '');
      if (!rel || rel.indexOf('..') !== -1) return;
      if (!/\.mdl$/i.test(rel)) return;
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
      if (!fs) throw new Error('Engine FS yok — viprw paketi yazılamadı');
      var res = await fetch(PK3_URL, { cache: 'force-cache' }).catch(function () {
        return null;
      });
      if (!res || !res.ok) {
        res = await fetch(PK3_URL, { cache: 'no-store' });
      }
      if (!res.ok) throw new Error('viprw pk3 HTTP ' + res.status);
      var bytes = new Uint8Array(await res.arrayBuffer());
      try {
        fs.writeFile('/cstrike/' + PK3_NAME, bytes);
      } catch (_) {}
      var files = inflatePk3(bytes);
      var n = extractToVfs(fs, files);
      window._browserCSVipRwWeaponsReady = true;
      crumb('viprw_assets_ready', { files: n, bytes: bytes.length });
      try {
        console.log('[bcs-viprw] ✓', PK3_NAME, n, 'mdl');
      } catch (_) {}
      return true;
    })().catch(function (err) {
      loading = null;
      crumb('viprw_assets_fail', { err: (err && err.message) || String(err) });
      throw err;
    });
    return loading;
  }

  function hookVipLoader() {
    var prev = window.ensureVipAssetsLoaded;
    if (typeof prev === 'function' && !prev._bcsVipRwWrapped) {
      window.ensureVipAssetsLoaded = function () {
        return Promise.resolve(prev.apply(this, arguments)).then(function (ok) {
          return ensureVipRwWeaponsLoaded().then(function () {
            return ok;
          }).catch(function () {
            return ok;
          });
        });
      };
      window.ensureVipAssetsLoaded._bcsVipRwWrapped = true;
    }
  }

  function bootWatch() {
    hookVipLoader();
    // Also load after engine pk3Promise settles (everyone gets files in VFS; only VIP plugin applies them)
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      hookVipLoader();
      var fs = getFs();
      if (fs && window.pk3Promise) {
        Promise.resolve(window.pk3Promise)
          .then(function () {
            return ensureVipRwWeaponsLoaded();
          })
          .catch(function () {});
        clearInterval(t);
      } else if (tries > 240) {
        clearInterval(t);
      }
    }, 500);
  }

  window.ensureVipRwWeaponsLoaded = ensureVipRwWeaponsLoaded;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootWatch);
  } else {
    bootWatch();
  }
})();
