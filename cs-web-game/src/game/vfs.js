/** @module game/vfs */
import { ASSET_URL } from '../api.js';
import { notify } from '../dom.js';
import { state } from './state.js';

// ─── EM FS Yardımcıları ───────────────────────────────────────────────────────

/**
 * Emscripten FS'de iç içe dizin oluşturur (mkdir -p benzeri).
 */
export function fsMkdirP(em, fullPath) {
  const parts = fullPath.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current += '/' + part;
    try { em.FS.mkdir(current); } catch (e) { /* Zaten var */ }
  }
}

/** changelevel sırasında client VFS'ye eksik BSP'yi CDN'den yükler */
let _mapBspRecoveryInFlight = false;

export function normalizeMapName(mapName) {
  return String(mapName || '')
    .replace(/\.bsp$/i, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
}

export function extractMissingMapFromLog(log) {
  const m = String(log || '').match(
    /(?:Could not load model|Host_Error:.*)\s*maps\/([a-zA-Z0-9_]+)\.bsp/i
  ) || String(log || '').match(/maps\/([a-zA-Z0-9_]+)\.bsp/i);
  return m ? normalizeMapName(m[1]) : '';
}

export async function ensureMapBspInVfs(mapName) {
  const name = normalizeMapName(mapName);
  if (!name) return false;
  if (!state.xash || !state.xash.em) {
    console.warn('[Map] Engine hazır değil, BSP yazılamadı:', name);
    return false;
  }

  const em = state.xash.em;
  const path = `/cstrike/maps/${name}.bsp`;
  try {
    const st = em.FS.stat(path);
    if (st && st.size > 1000) return true;
  } catch (e) { /* yok */ }

  try {
    const url = `${ASSET_URL}/cs-assets/cstrike/maps/${name}.bsp`;
    let res = null;
    try {
      const cache = await caches.open('cs-assets-v1');
      res = await cache.match(url);
      if (!res) {
        res = await fetch(url);
        if (
          res.ok &&
          res.status === 200 &&
          !(res.headers.get('content-type') || '').includes('text/html')
        ) {
          try { await cache.put(url, res.clone()); } catch (e) { /* ignore */ }
        }
      }
    } catch (e) {
      res = await fetch(url);
    }

    if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : 0}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length < 1000) throw new Error('BSP geçersiz / çok küçük');

    fsMkdirP(em, '/cstrike/maps');
    em.FS.writeFile(path, buf);
    console.log(`[Map] VFS'ye yazıldı: ${path} (${buf.length}B)`);
    return true;
  } catch (err) {
    console.warn(`[Map] ${name}.bsp yüklenemedi:`, err);
    return false;
  }
}

window.ensureMapBspInVfs = ensureMapBspInVfs;

export async function recoverMissingMapBsp(mapName) {
  const name = normalizeMapName(mapName);
  if (!name || _mapBspRecoveryInFlight) return false;
  _mapBspRecoveryInFlight = true;
  try {
    if (typeof notify === 'function') {
      notify(`Eksik harita indiriliyor: ${name}...`, 'info');
    }
    const ok = await ensureMapBspInVfs(name);
    if (ok) {
      if (typeof notify === 'function') {
        notify(`Harita hazır, yeniden bağlanılıyor: ${name}`, 'success');
      }
      if (typeof executeEngineCommand === 'function') {
        executeEngineCommand('retry');
      }
      return true;
    }
    if (typeof notify === 'function') {
      notify(`Harita indirilemedi: ${name}`, 'error');
    }
    return false;
  } finally {
    _mapBspRecoveryInFlight = false;
  }
}

