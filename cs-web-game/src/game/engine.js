/** @module game/engine — initEngine / changeMap */
import { unzipSync } from 'fflate';
import { API_URL, ASSET_URL } from '../api.js';
import { $, notify } from '../dom.js';
import { handleBrowserCSAdminLog } from '../ui/hudBridge.js';
import { BrowserCSReconnect } from '../net/reconnect.js';
import { getStoredAmxPassword } from '../net/amxPassword.js';
import { state } from './state.js';
import { isDeathmatchServer } from './serverMeta.js';
import { fsMkdirP, ensureMapBspInVfs, recoverMissingMapBsp, extractMissingMapFromLog, normalizeMapName } from './vfs.js';
import { startRenderStability } from './renderStability.js';

/**
 * Her join'de tüm harita WAD'larını (~60MB+) WASM VFS'e yazmak aşırı lag/GC yapıyordu.
 * Ortak + sadece mevcut haritanın WAD'ını yükle.
 */
const ALWAYS_CSTRIKE_WADS = new Set([
  'cstrike.wad',
  'cached.wad',
  'decals.wad',
  'pldecal.wad',
  'jos.wad',
  'n0th1ng.wad',
  'ajawad.wad',
  'tswad.wad'
]);

const MAP_EXTRA_WADS = {
  de_dust2: ['cs_dust.wad'],
  de_dust: ['cs_dust.wad'],
  de_inferno: ['de_inferno.wad'],
  cs_assault: ['cs_assault.wad'],
  cs_office: ['cs_office.wad'],
  de_aztec: ['de_aztec.wad'],
  cs_747: ['cs_747.wad'],
  cs_havana: ['cs_havana.wad'],
  cs_italy: ['itsItaly.wad'],
  de_cbble: ['cs_cbble.wad'],
  de_chateau: ['chateau.wad'],
  de_piranesi: ['de_piranesi.wad'],
  de_storm: ['de_storm.wad'],
  de_vegas: ['de_vegas.wad'],
  de_prodigy: ['prodigy.wad'],
  de_torn: ['torntextures.wad'],
  as_tundra: ['as_tundra.wad'],
  cs_bdog: ['cs_bdog.wad'],
  // snow → cs_office.wad, lv_marble → de_vegas.wad (yoksa mor/siyah zemin)
  fy_iceworld: ['cs_office.wad', 'de_vegas.wad']
};

function selectCstrikeWadsForMap(mapName, allWads) {
  const key = normalizeMapName(mapName || '').toLowerCase();
  const want = new Set(ALWAYS_CSTRIKE_WADS);
  const extras = MAP_EXTRA_WADS[key] || [];
  for (const w of extras) want.add(w);

  const list = Array.isArray(allWads) ? allWads : [];
  const stem = key.replace(/^(de|cs|as|fy)_/, '');
  for (const w of list) {
    const ws = String(w || '').replace(/\.wad$/i, '').toLowerCase();
    const wsStem = ws.replace(/^(de|cs|as|fy)_/, '');
    // Kısa stem false-positive'lerini engelle (örn. "in" ⊂ "inferno")
    if (
      ws === key ||
      wsStem === stem ||
      (stem.length >= 4 && (ws.includes(stem) || (wsStem.length >= 4 && stem.includes(wsStem))))
    ) {
      want.add(w);
    }
  }

  // API listesi eski/eksik olsa bile harita WAD'larını her zaman iste
  const selected = list.filter((w) => want.has(w));
  for (const w of want) {
    if (!selected.includes(w)) selected.push(w);
  }
  return selected;
}

function isWad3Buffer(buf) {
  return !!(buf && buf.length > 12 && buf[0] === 0x57 && buf[1] === 0x41 && buf[2] === 0x44 && buf[3] === 0x33);
}

// DOM refs used during boot (resolved at call time where needed)
function gameEls() {
  return {
    gameWrapper: $('game-wrapper'),
    gameCanvas: $('canvas'),
    toolbarMapName: $('toolbar-map-name'),
    loadingOverlay: $('loading-overlay'),
    loadingMapName: $('loading-map-name'),
    loadingProgress: $('loading-progress-fill'),
    loadingLog: $('loading-log'),
    userNicknameInput: $('user-nickname'),
    previewPanel: $('preview-panel'),
    btnLaunch: $('btn-launch'),
    engineDot: $('engine-dot'),
    engineStatusTxt: $('engine-status-text'),
  };
}

// These helpers are still provided by main via window during transition
function addLoadingLog(msg, cls = '') {
  if (typeof window.__bcsAddLoadingLog === 'function') return window.__bcsAddLoadingLog(msg, cls);
  console.log(msg);
}
function addConsoleLog(msg, cls = '') {
  if (typeof window.__bcsAddConsoleLog === 'function') return window.__bcsAddConsoleLog(msg, cls);
  if (typeof window.__bcsAddLoadingLog === 'function') return window.__bcsAddLoadingLog(msg, cls);
  console.log(msg);
}
function setEngineStatus(msg, stateName = 'orange') {
  if (typeof window.__bcsSetEngineStatus === 'function') {
    return window.__bcsSetEngineStatus(msg, stateName);
  }
  const { engineDot, engineStatusTxt } = gameEls();
  if (engineStatusTxt) engineStatusTxt.textContent = msg;
  if (engineDot) engineDot.className = `status-dot ${stateName}`;
}
function setProgress(pct, msg) {
  if (typeof window.__bcsSetProgress === 'function') return window.__bcsSetProgress(pct, msg);
}
async function fetchWithProgress(url, label) {
  if (typeof window.__bcsFetchWithProgress === 'function') return window.__bcsFetchWithProgress(url, label);
  const res = await fetch(url);
  return res.arrayBuffer();
}
function appendBrowserCSPerfConfig(cfgBuffer) {
  if (typeof window.__bcsAppendPerfConfig === 'function') return window.__bcsAppendPerfConfig(cfgBuffer);
  return cfgBuffer;
}
function startFPSCounter() {
  if (typeof window.__bcsStartFPSCounter === 'function') window.__bcsStartFPSCounter();
}
function runEngineCommandRaw(cmd) {
  if (typeof window.__bcsRunEngineCommandRaw === 'function') return window.__bcsRunEngineCommandRaw(cmd);
}
function executeEngineCommand(cmd) {
  if (typeof window.executeEngineCommand === 'function') return window.executeEngineCommand(cmd);
}
function browserCSDebugLog(...args) {
  if (typeof window.__bcsDebugLog === 'function') return window.__bcsDebugLog(...args);
}

// ─── Engine Başlatma ──────────────────────────────────────────────────────────

export async function initEngine(mapName, connectPort = null, isHost = false) {
  const {
    gameWrapper, gameCanvas, toolbarMapName, loadingOverlay,
    loadingMapName, loadingProgress, loadingLog, userNicknameInput,
    previewPanel, btnLaunch
  } = gameEls();
  if (connectPort && connectPort !== "listen") {
    BrowserCSReconnect.prepareConnection();
  }
  // Asset indirme sürerken WebRTC olayları bağlantı ekranını veya retry
  // döngüsünü başlatmamalı. Bu bayrak yalnızca ilk gerçek connect komutundan
  // hemen önce açılır.
  window._browserCSAssetsReady = false;

  window._browserCSConnectPort =
    connectPort && connectPort !== "listen"
      ? String(connectPort)
      : "";

  window._browserCSIsDeathmatch =
    connectPort == 27201 ||
    (window.__loadedServers || []).some(
      (s) => s.port == connectPort && isDeathmatchServer(s)
    ) ||
    isDeathmatchServer(window._motdServerMeta || {});

  if (state.engineRunning && state.xash) {
    if (connectPort) {
      // Zaten açıksa konsol komutu ile bağlan
      addConsoleLog(`connect WebRTC port ${connectPort} via /webrtc/offer`);
      // TODO: state.xash konsoluna komut gönderme
    } else {
      changeMap(mapName);
    }
    return;
  }

  // UI geçişi
  if (gameWrapper) gameWrapper.classList.add('active');
  if (previewPanel) previewPanel.classList.add('hidden');
  if (loadingOverlay) loadingOverlay.classList.add('active');
  if (loadingMapName) loadingMapName.textContent = mapName;
  if (toolbarMapName) toolbarMapName.textContent = mapName;
  if (loadingLog) loadingLog.innerHTML = '';
  if (loadingProgress) loadingProgress.style.width = '0%';
  if (btnLaunch) btnLaunch.disabled = true;

  setEngineStatus('Oyun dosyaları indiriliyor...', 'orange');

  // İlk bağlantı bilgi mesajları
  addLoadingLog('🚀 Sunucuya bağlanılıyor: ' + mapName, 'ok');
  addLoadingLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  addLoadingLog('⚠️  İLK İNDİRME: oyun paketleri hazırlanıyor...', 'warn');
  addLoadingLog('   İlk kez bağlanıyorsanız oyun dosyaları indiriliyor.', 'warn');
  addLoadingLog('   Bu işlem 1-3 dakika sürebilir (yaklaşık 250 MB).', 'warn');
  addLoadingLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  addLoadingLog('✅ Sonraki girişlerde dosyalar önbellekten yüklenir.');
  addLoadingLog('ℹ️  Çerezleri temizlerseniz tekrar indirilir.');
  addLoadingLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  function looksLikeWasm(buf) {
    if (!buf || buf.byteLength < 4) return false;
    const u8 = new Uint8Array(buf);
    // \0asm
    return u8[0] === 0x00 && u8[1] === 0x61 && u8[2] === 0x73 && u8[3] === 0x6d;
  }

  // Akıllı Önbellek (Cache API) - Her girişte 250MB indirmeyi engeller
  async function cachedFetch(url, noCache = false) {
    if (noCache) return fetch(url);
    const wantWasm = /\.wasm(\?|$)/i.test(url);
    try {
      const cache = await caches.open('cs-assets-v1');
      const req = new Request(url);
      let res = await cache.match(req);
      if (res) {
        if (wantWasm) {
          const cached = await res.clone().arrayBuffer();
          if (!looksLikeWasm(cached)) {
            await cache.delete(req);
            res = null;
          } else {
            browserCSDebugLog('[Cache] Yüklendi:', url);
            return res;
          }
        } else {
          browserCSDebugLog('[Cache] Yüklendi:', url);
          return res;
        }
      }
      res = await fetch(url);
      if (res.ok && res.status === 200) {
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('text/html')) {
          return res;
        }
        if (wantWasm) {
          const body = await res.clone().arrayBuffer();
          if (!looksLikeWasm(body)) {
            // SPA fallback HTML bazen application/wasm header ile geliyor
            return res;
          }
        }
        cache.put(req, res.clone());
      }
      return res;
    } catch (e) {
      return fetch(url);
    }
  }

  try {
    // ── Adım 1: Tüm Dosyaları RAM'e İndir (Engine başlamadan ÖNCE) ─────────
    setProgress(5, 'xash.wasm indiriliyor... (~3.7MB)');
    // Eski yanlış path (state.xash.wasm) SPA HTML döndürüyordu — gerçek dosya xash.wasm
    try {
      const badCache = await caches.open('cs-assets-v1');
      await badCache.delete(new Request('/wasm/state.xash.wasm'));
    } catch (_) { /* ignore */ }
    const wasmRes = await cachedFetch('/wasm/xash.wasm');
    if (!wasmRes.ok) throw new Error('xash.wasm indirilemedi');
    const wasmBinary = await wasmRes.arrayBuffer();
    if (!looksLikeWasm(wasmBinary)) {
      throw new Error('xash.wasm geçersiz (HTML/SPA döndü). Cache temizleyip yenileyin.');
    }


    // Oyun dosyaları preRun içinde asenkron olarak sırayla indirilecek.
    // Bu sayede JS RAM kullanımı ve WASM Heap şişmesi önlenecek.
    const cacheBust = `?v=${Date.now()}`;

    // ─── KRİTİK SPRITE DÜZELTMESİ (SPA 404 SORUNU) ─────────────
    setProgress(40, "Oyun motoru modülleri ve sprite'lar indiriliyor...");

    // Cloudflare Pages SPA modunda olmayan dosyalara index.html döndürüldüğü için
    // sprite fetch işlemleri "200 OK" dönüyor ve oyun .spr dosyası yerine HTML 
    // parse edip "wrong id" veya "unknown format" diyerek çöküyor.
    // Garantili olan muzzleflash1.spr dosyasını "dummy/fallback" sprite olarak kullanalım.
    const dummySprRes = await cachedFetch(`${ASSET_URL}/cs-assets/cstrike/sprites/muzzleflash1.spr`);
    if (!dummySprRes.ok) throw new Error('muzzleflash1.spr (fallback) indirilemedi');
    const dummySprBuffer = new Uint8Array(await dummySprRes.arrayBuffer());
    window.dummySprBuffer = dummySprBuffer;

    const dummyMdlRes = await cachedFetch(`${ASSET_URL}/cs-assets/cstrike/models/p_galil.mdl`);
    if (dummyMdlRes.ok) window.dummyMdlBuffer = new Uint8Array(await dummyMdlRes.arrayBuffer());

    window.dummyWavBuffer = new Uint8Array([
      82, 73, 70, 70, 36, 0, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32, 16, 0, 0, 0, 1, 0, 1, 0,
      68, 172, 0, 0, 136, 88, 1, 0, 2, 0, 16, 0, 100, 97, 116, 97, 0, 0, 0, 0
    ]);

    // İhtiyaç duyulan diğer sprite'ları güvenli bir şekilde fetch eden yardımcı
    async function safeFetchSprite(path) {
      try {
        const res = await cachedFetch(path);
        const contentType = res.headers.get('content-type') || '';
        // Eğer SPA fallback yüzünden HTML geldiyse reddet
        if (res.ok && !contentType.includes('text/html')) {
          const buf = await res.arrayBuffer();
          // Header kontrolü: "IDSP" (0x50534449 in little endian = 73, 68, 83, 80)
          const u8 = new Uint8Array(buf);
          if (u8.length > 4 && u8[0] === 73 && u8[1] === 68 && u8[2] === 83 && u8[3] === 80) {
            return u8;
          }
        }
      } catch (e) { }
      return dummySprBuffer;
    }

    const [
      gfxRes, fontsRes,
      csServerRes, csClientRes, csMenuRes,
      fsRes, glRes,
      vDeltaRes, vRcRes, cDeltaRes, cCfgRes, serverCfgRes, cmdMenuRes,
      dotSprBuffer, animglowSprBuffer, richoSprBuffer, shellchromeSprBuffer, crosshairsSprBuffer, radioSprBuffer,
      gasPuffSprBuffer
    ] = await Promise.all([
      cachedFetch(`${ASSET_URL}/cs-assets/valve/gfx.wad`),
      cachedFetch(`${ASSET_URL}/cs-assets/valve/fonts.wad`),
      cachedFetch((isHost || !connectPort || connectPort === 'listen' || connectPort === true) ? '/wasm/dlls/cs_emscripten_wasm32_v36.wasm' : '/wasm/dlls/cs_emscripten_wasm32_v34_stable.wasm'),
      cachedFetch('/wasm/cl_dlls/client_emscripten_wasm32_damage_v1.wasm'),
      cachedFetch('/wasm/cl_dlls/menu_emscripten_wasm32_v36.wasm'),
      cachedFetch('/wasm/filesystem_stdio.wasm'),
      cachedFetch('/wasm/libref_webgl2.wasm'),
      cachedFetch(`${ASSET_URL}/cs-assets/valve/delta.lst`),
      cachedFetch(`${ASSET_URL}/cs-assets/valve/valve.rc`),
      cachedFetch(`${ASSET_URL}/cs-assets/cstrike/delta.lst`),
      cachedFetch(`${ASSET_URL}/cs-assets/cstrike/config.cfg`),
      cachedFetch(`${ASSET_URL}/cs-assets/cstrike/server.cfg`).catch(() => new Response("")),
      cachedFetch(`${ASSET_URL}/cs-assets/cstrike/commandmenu.txt`).catch(() => new Response("")),
      safeFetchSprite(`${ASSET_URL}/cs-assets/cstrike/sprites/dot.spr`),
      safeFetchSprite(`${ASSET_URL}/cs-assets/cstrike/sprites/animglow01.spr`),
      safeFetchSprite(`${ASSET_URL}/cs-assets/cstrike/sprites/richo1.spr`),
      safeFetchSprite(`${ASSET_URL}/cs-assets/cstrike/sprites/shellchrome.spr`),
      safeFetchSprite(`${ASSET_URL}/cs-assets/cstrike/sprites/crosshairs.spr`),
      safeFetchSprite(`${ASSET_URL}/cs-assets/cstrike/sprites/radio.spr`),
      safeFetchSprite(`${ASSET_URL}/cs-assets/cstrike/sprites/gas_puff_01.spr`)
    ]);

    addLoadingLog(`✓ Sprite'lar yüklendi (Fallbacks aktif)`);

    setProgress(50, 'Ekstra harita dokuları (WAD) sırayla indiriliyor...');
    const wadsRes = await cachedFetch(`${ASSET_URL}/api/wads`, true);
    const { wads } = await wadsRes.json();
    const selectedWads = selectCstrikeWadsForMap(mapName, Array.isArray(wads) ? wads : []);
    addLoadingLog(
      `WAD seçimi: ${selectedWads.length}/${(wads || []).length} (harita: ${normalizeMapName(mapName)})`
    );

    const downloadedWads = [];
    for (const wad of selectedWads) {
      const wadUrl = `${ASSET_URL}/cs-assets/cstrike/${wad}`;
      let res = await cachedFetch(wadUrl);
      if (res.ok && !(res.headers.get("content-type") || "").includes("text/html")) {
        let wadData = new Uint8Array(await res.arrayBuffer());
        // Bozuk/eksik cache (HTML veya truncated) → taze indir
        if (!isWad3Buffer(wadData)) {
          try {
            const cache = await caches.open('cs-assets-v1');
            await cache.delete(new Request(wadUrl));
          } catch (_) { /* ignore */ }
          res = await cachedFetch(wadUrl, true);
          if (res.ok) wadData = new Uint8Array(await res.arrayBuffer());
        }
        if (isWad3Buffer(wadData)) {
          downloadedWads.push({ name: wad, data: wadData });
        } else {
          addLoadingLog(`⚠ WAD atlandı (geçersiz): ${wad}`, 'warn');
        }
      }
    }

    // halflife1/2 bu pakette truncated/corrupt (~36MB) — yükleme lag + bellek şişmesi yapıyor.
    // xeno.wad CS'te gerekmiyor (~6MB). Küçük stabil set yeterli.
    const valveWadsList = ['halflife.wad', 'cached.wad', 'decals.wad', 'liquids.wad', 'pldecal.wad', 'spraypaint.wad', 'fonts.wad', 'gfx.wad'];
    const downloadedValveWads = [];
    for (const wad of valveWadsList) {
      const res = await cachedFetch(`${ASSET_URL}/cs-assets/valve/${wad}`);
      if (res.ok && !(res.headers.get("content-type") || "").includes("text/html")) {
        const wadData = new Uint8Array(await res.arrayBuffer());
        downloadedValveWads.push({ name: wad, data: wadData });
      }
    }

    setProgress(40, 'Dosyalar hazırlanıyor...');

    if (!gfxRes.ok) throw new Error('gfx.wad indirilemedi');
    if (!csServerRes.ok) throw new Error('cs_emscripten_wasm32.wasm indirilemedi');

    const gfxBuffer = new Uint8Array(await gfxRes.arrayBuffer());
    const fontsBuffer = new Uint8Array(await fontsRes.arrayBuffer());
    const csServerBuffer = new Uint8Array(await csServerRes.arrayBuffer());
    const csClientBuffer = new Uint8Array(await csClientRes.arrayBuffer());
    const csMenuBuffer = new Uint8Array(await csMenuRes.arrayBuffer());

    const fsBuffer = new Uint8Array(await fsRes.arrayBuffer());
    const glBuffer = new Uint8Array(await glRes.arrayBuffer());
    const vDeltaBuffer = (vDeltaRes.ok && !(vDeltaRes.headers.get("content-type") || "").includes("text/html")) ? new Uint8Array(await vDeltaRes.arrayBuffer()) : new Uint8Array(0);

    const vRcBuffer = (vRcRes.ok && !(vRcRes.headers.get("content-type") || "").includes("text/html")) ? new Uint8Array(await vRcRes.arrayBuffer()) : new Uint8Array(0);

    const cDeltaBuffer = (cDeltaRes.ok && !(cDeltaRes.headers.get("content-type") || "").includes("text/html")) ? new Uint8Array(await cDeltaRes.arrayBuffer()) : new Uint8Array(0);

    const cCfgBuffer = (cCfgRes.ok && !(cCfgRes.headers.get("content-type") || "").includes("text/html")) ? new Uint8Array(await cCfgRes.arrayBuffer()) : new Uint8Array(0);

    const cmdMenuBuffer = (cmdMenuRes.ok && !(cmdMenuRes.headers.get("content-type") || "").includes("text/html")) ? new Uint8Array(await cmdMenuRes.arrayBuffer()) : new Uint8Array(0);


    setProgress(45, 'CS yapılandırma (liblist.gam) indiriliyor...');
    const liblistRes = await cachedFetch(`${ASSET_URL}/cs-assets/cstrike/liblist.gam`);
    if (!liblistRes.ok) throw new Error('liblist.gam indirilemedi');
    const liblistBuffer = (liblistRes.ok && !(liblistRes.headers.get("content-type") || "").includes("text/html")) ? new Uint8Array(await liblistRes.arrayBuffer()) : new Uint8Array(0);


    setProgress(50, `Harita indiriliyor: ${mapName}.bsp...`);
    // Banner gömme denemesi client/server CRC'yi bozmuştu — orijinal BSP kullanılıyor.
    // Eski Cache API kayıtlarını temizle, dust2'yi taze çek.
    const mapBspUrl = `${ASSET_URL}/cs-assets/cstrike/maps/${mapName}.bsp`;
    if (mapName === 'de_dust2') {
      try {
        const mapCache = await caches.open('cs-assets-v1');
        const staleKeys = [
          mapBspUrl,
          `${mapBspUrl}?v=browsercs-sign-1`,
          `${mapBspUrl}?v=restore-original-1`,
          `${mapBspUrl}?v=restore-original-2`,
          `${mapBspUrl}?v=restore-original-3`,
          '/cs-assets/cstrike/maps/de_dust2.bsp',
          '/cs-assets/cstrike/maps/de_dust2.bsp?v=browsercs-sign-1',
          '/cs-assets/cstrike/maps/de_dust2.bsp?v=restore-original-2'
        ];
        for (const k of staleKeys) {
          await mapCache.delete(new Request(k));
        }
      } catch (_) { /* ignore */ }
    }
    const bspRes = await cachedFetch(mapBspUrl, mapName === 'de_dust2');
    if (!bspRes.ok) throw new Error(`${mapName}.bsp indirilemedi`);
    const bspBuffer = new Uint8Array(await bspRes.arrayBuffer());

    // ── Adım 2: Xash3D WASM instance oluştur ────────────────────────────────
    setProgress(65, 'Oyun motoru hazırlanıyor...');

    // Retina 2× fillrate salınımını kes; buffer = CSS boyutu
    startRenderStability(gameCanvas);

    // Grafik desteği kontrolü
    const checkGL = gameCanvas.getContext('webgl2') || gameCanvas.getContext('webgl') || gameCanvas.getContext('experimental-webgl');
    if (!checkGL) {
      window.customAlert("Oyun başlatılamadı. Tarayıcınız veya ekran kartınız oyunu çalıştırmıyor.\n\nChrome veya Edge kullanın ve ayarlardan 'Donanım hızlandırması' seçeneğinin açık olduğundan emin olun.");
      throw new Error('Grafik desteği yok.');
    }

    const nickname = (userNicknameInput && userNicknameInput.value.trim()) ? userNicknameInput.value.trim() : '';
    if (!nickname) {
      window.customAlert("Lütfen oyuna girmeden önce bir oyuncu adı belirleyin!");
      throw new Error("Boş oyuncu adı");
    }
    // Admin şifresi connect ÖNCESİ setinfo'da olmalı (AMXX "a" flag)
    const earlyAmxPw = getStoredAmxPassword(connectPort);
    let xashArgs = [
      '-windowed',
      '-game', 'cstrike',
      '+setinfo', '_vgui_menus 0',
      '+mp_consistency', '0',
      '+sv_lan', '0',
      '+sv_allow_download', '1',
      '+cl_allowdownload', '0',
      '+cl_download_ingame', '0',
      // 1 = client-side weapon prediction (ateş hissi). 0 sunucu onayı bekler → WebRTC'de kasık ateş.
      '+cl_lw', '1',
      '+voice_enable', '0',
      '+sv_voiceenable', '0',
      '+touch_enable', '0',
      '+touch_emulate', '0',
      '+name', nickname,
      '+bind', '1', 'slot1',
      '+bind', '2', 'slot2',
      '+bind', '3', 'slot3',
      '+bind', '4', 'slot4',
      '+bind', '5', 'slot5',
      '+bind', '6', 'slot6',
      '+bind', '7', 'slot7',
      '+bind', '8', 'slot8',
      '+bind', '9', 'slot9',
      '+bind', '0', 'slot10',
      '+bind', 'm', 'chooseteam',
      '+bind', 'b', 'buy',
      '+alias', 'toggle_hand', 'hand_left',
      '+alias', 'hand_left', 'cl_righthand 0; alias toggle_hand hand_right',
      '+alias', 'hand_right', 'cl_righthand 1; alias toggle_hand hand_left',
      '+bind', 'h', 'toggle_hand',
      '-heapsize', '65536',
      '+ip', '10.0.0.2',
      '+clientport', (27000 + Math.floor(Math.random() * 1000)).toString(),
      '+fps_max', '100',
      '+fps_override', '1',
      '+gl_vsync', '0',
      '+cl_updaterate', '60',
      '+cl_cmdrate', '60',
      '+rate', '75000',
      '+ex_interp', '0.03',
      '+setinfo', '_vgui_menus', '0',
      '+setinfo', 'vgui_menus', '0',
      ...(earlyAmxPw
        ? ['+setinfo', '_pw', String(earlyAmxPw).replace(/["\\]/g, '').slice(0, 32)]
        : []),
      '+sensitivity', '3',
      '+zoom_sensitivity_ratio', '1.2',
      '+cl_bob', '0.01',
      '+cl_bobup', '0.5',
      '+r_drawviewmodel', '1',
      '+hud_fastswitch', '1',
      '+gl_clear', '0',
      '+r_novis', '0',
      '+setinfo', '_vgui_menus', '0',
    ];


    let actualWsPort = null;
    if (isHost || !connectPort || connectPort === 'listen' || connectPort === true) {
      xashArgs.push('+maxplayers', '16', '+map', mapName);
      actualWsPort = (connectPort && connectPort !== 'listen') ? connectPort : null;
    } else {
      // İstemci olarak bağlanıyoruz.
      // KRİTİK FIX: İlk yüklemede engine henüz assetleri (PK3) tam çekmeden +connect
      // komutu gelirse, Xash3D bağlantıyı reddedip ana menüye düşüyor.
      // Bu yüzden +connect'i argüman olarak vermek yerine,
      // PK3 indirmesi bitince executeEngineCommand() ile 'connect' göndereceğiz.
      actualWsPort = connectPort;
    }

    const Xash3DWebSocket = window.Xash3DWebSocket;
    if (typeof Xash3DWebSocket !== 'function') {
      throw new Error('Xash3DWebSocket henüz yüklenmedi (main.js Net bridge)');
    }
    state.xash = new Xash3DWebSocket({
      canvas: gameCanvas,
      arguments: xashArgs,
      connectPort: actualWsPort,
      isHost: isHost,
      renderer: 'gl4es',
      libraries: {
        menu: '/wasm/cl_dlls/menu_emscripten_wasm32_v36.wasm',
        client: '/wasm/cl_dlls/client_emscripten_wasm32_damage_v1.wasm',
        server: (isHost || !connectPort || connectPort === 'listen' || connectPort === true) ? '/wasm/dlls/cs_emscripten_wasm32_v36.wasm' : '/wasm/dlls/cs_emscripten_wasm32_v34_stable.wasm',
        render: {
          gl4es: '/wasm/libref_webgl2.wasm'
        }
      },

      filesMap: {
        'filesystem_stdio.wasm': '/wasm/filesystem_stdio.wasm',
        'cl_dlls/menu_emscripten_wasm32.wasm': '/wasm/cl_dlls/menu_emscripten_wasm32_v36.wasm',
        'cl_dlls/client_emscripten_wasm32.wasm': '/wasm/cl_dlls/client_emscripten_wasm32_damage_v1.wasm',
        'dlls/cs_emscripten_wasm32.wasm': (isHost || !connectPort || connectPort === 'listen' || connectPort === true) ? '/wasm/dlls/cs_emscripten_wasm32_v36.wasm' : '/wasm/dlls/cs_emscripten_wasm32_v34_stable.wasm',
        'dlls/hl_emscripten_wasm32.wasm': '/wasm/dlls/hl_emscripten_wasm32.wasm',
      },

      module: {
        keyboardListeningElement: gameCanvas,
        wasmBinary,
        INITIAL_MEMORY: 536870912,
        instantiateWasm: (imports, successCallback) => {
          let memRef = null;

          const patchResize = (envObj) => {
            envObj['emscripten_resize_heap'] = (requestedSize) => {
              requestedSize = requestedSize >>> 0;
              if (!memRef) {
                console.error('[Memory] memRef henüz hazır değil!');
                return 0;
              }
              const oldSize = memRef.buffer.byteLength;
              if (requestedSize <= oldSize) return 1;
              const pages = Math.ceil((requestedSize - oldSize) / 65536);
              try {
                memRef.grow(pages);
                browserCSDebugLog(`[Memory] Büyütüldü: +${pages} page → ${Math.round(memRef.buffer.byteLength / 1048576)} MB`);

                // CRITICAL FIX: Notify Emscripten JS runtime about the memory growth
                // This updates HEAPU8, HEAP32 etc. globally so we don't get Detached ArrayBuffer!
                if (envObj['emscripten_notify_memory_growth']) {
                  envObj['emscripten_notify_memory_growth'](0);
                }

                return 1;
              } catch (e) {
                console.error('[Memory] grow() başarısız:', e.message, 'istenen:', Math.round(requestedSize / 1048576) + 'MB', 'mevcut:', Math.round(oldSize / 1048576) + 'MB');
                return 0;
              }
            };

            // Some state.xash.wasm builds import these legacy HTML5 sensor helpers,
            // while the current Emscripten runtime omits them on desktop.
            // Report "no data" so a fresh cache can still instantiate safely.
            const noSensorData = () => -8;
            envObj['_emscripten_get_last_deviceorientation_event'] ??= noSensorData;
            envObj['emscripten_get_last_deviceorientation_event'] ??= noSensorData;
            envObj['_emscripten_get_last_devicemotion_event'] ??= noSensorData;
            envObj['emscripten_get_last_devicemotion_event'] ??= noSensorData;
          };

          if (imports.env) patchResize(imports.env);
          if (imports['wasi_snapshot_preview1']) patchResize(imports['wasi_snapshot_preview1']);

          WebAssembly.instantiate(wasmBinary, imports).then(output => {
            memRef = output.instance.exports.memory || (imports && imports.env && imports.env.memory) || window.wasmMemory;
            if (!memRef && output.instance.exports) {
              for (const key in output.instance.exports) {
                if (output.instance.exports[key] instanceof WebAssembly.Memory) {
                  memRef = output.instance.exports[key];
                  break;
                }
              }
            }
            if (memRef && memRef.buffer) {
              window.wasmMemory = memRef; // Expose globally so Net.sendto can read the always-valid buffer!
              browserCSDebugLog('[Memory] WASM hafızası alındı:', Math.round(memRef.buffer.byteLength / 1048576), 'MB');
            } else {
              console.warn('[Memory] WASM hafıza referansı exports veya imports.env içinde bulunamadı.');
            }
            successCallback(output.instance, output.module);
          }).catch(e => {
            console.error('[WASM] instantiate hatası:', e);
          });

          return {}; // async instantiation sinyali
        },
        preRun: [(em) => {
          addLoadingLog('Sanal dosya sistemi (FS) kuruluyor...');
          const safeMkdir = (dir) => { try { em.FS.mkdir(dir); } catch (e) { } };

          safeMkdir('/cstrike');
          safeMkdir('/cstrike/maps');
          safeMkdir('/cstrike/dlls');
          safeMkdir('/cstrike/cl_dlls');
          safeMkdir('/cstrike/models');
          safeMkdir('/cstrike/models/shield');
          safeMkdir('/cstrike/sprites');
          safeMkdir('/valve');
          safeMkdir('/valve/dlls');

          // --- VFS FALLBACK HOOK ---
          // Xash3D çökmelerini önlemek için eksik dosyalar istendiğinde dummy döner
          const originalOpen = em.FS.open;
          em.FS.open = function (path, flags, mode) {
            try {
              return originalOpen(path, flags, mode);
            } catch (e) {
              if (e.name === 'ErrnoError' && e.errno === 44) { // ENOENT
                const p = path.toLowerCase();
                if (p.endsWith('.spr') || p.endsWith('.mdl') || p.endsWith('.wav')) {
                  console.warn(`[VFS Fallback] Eksik dosya tespit edildi: ${path}. Çökmeyi önlemek için dummy kullanılıyor.`);
                  // İlgili dizinleri oluştur
                  const parentDir = path.substring(0, path.lastIndexOf('/'));
                  const parts = parentDir.split('/').filter(Boolean);
                  let current = '';
                  for (const part of parts) {
                    current += '/' + part;
                    try { em.FS.mkdir(current); } catch (err) { }
                  }
                  // Dosyayı oluştur
                  if (p.endsWith('.spr') && window.dummySprBuffer) {
                    em.FS.writeFile(path, window.dummySprBuffer);
                  } else if (p.endsWith('.mdl') && window.dummyMdlBuffer) {
                    em.FS.writeFile(path, window.dummyMdlBuffer);
                  } else if (p.endsWith('.wav') && window.dummyWavBuffer) {
                    em.FS.writeFile(path, window.dummyWavBuffer);
                  } else {
                    // boş dosya yaz
                    em.FS.writeFile(path, new Uint8Array(0));
                  }
                  // Tekrar dene
                  return originalOpen(path, flags, mode);
                }
              }
              throw e;
            }
          };

          em.addRunDependency('load_pk3_assets');
          window.pk3Promise = (async () => {
            const pk3Files = [
              '/wasm/cstrike_models_player.pk3',
              '/wasm/cstrike_models_shield.pk3',
              '/wasm/cstrike_models_other.pk3',
              '/wasm/cstrike_gfx_env.pk3',
              '/wasm/cstrike_gfx_other.pk3',
              '/wasm/cstrike_sound.pk3',
              '/wasm/cstrike_sprites.pk3',
              '/wasm/cstrike_essential.pk3',
              '/wasm/buy_menus.pk3?nocache=1',
              '/wasm/valve_models.pk3',
              '/wasm/valve_sound.pk3',
              '/wasm/valve_sprites.pk3',
              '/wasm/valve_gfx.pk3',
              '/wasm/valve_essential.pk3',
              '/wasm/cstrike_wads.pk3'
            ];

            let loadedCount = 0;
            for (const file of pk3Files) {
              try {
                const rawFile = file.split('?')[0];
                const filename = rawFile.split('/').pop();
                const targetPath = rawFile.includes('valve_') ? `/valve/${filename}` : `/cstrike/${filename}`;
                addLoadingLog(`İndiriliyor: ${filename}...`);
                // buy_menus.pk3 için cache bypass
                const isBuyMenus = rawFile.includes('buy_menus');
                const res = isBuyMenus
                  ? await fetch(rawFile, { cache: 'no-store' })
                  : await cachedFetch(file);
                if (res && res.ok) {
                  const buf = new Uint8Array(await res.arrayBuffer());
                  em.FS.writeFile(targetPath, buf);
                  loadedCount++;
                  setProgress(20 + Math.floor((loadedCount / pk3Files.length) * 60), `İndirildi: ${filename}`);
                }
              } catch (e) {
                console.error(`[Assets] Dosya indirilemedi: ${file}`, e);
              }
            }
            addLoadingLog(`📦 ${loadedCount} adet oyun paketi (.pk3) başarıyla sisteme yazıldı.`, 'ok');
            browserCSDebugLog("[DEBUG VFS] /cstrike/ contents:", em.FS.readdir('/cstrike'));
            browserCSDebugLog("[DEBUG VFS] /valve/ contents:", em.FS.readdir('/valve'));

            // CS 1.5 buy CFG'leri - cstrike/custom/touch/ = Xash3D en yüksek öncelikli dizin
            const buyMenuCFGs = ['buy_pistol_t', 'buy_pistol_ct', 'buy_rifle_t', 'buy_rifle_ct',
              'buy_submachinegun_t', 'buy_submachinegun_ct',
              'buy_machinegun_t', 'buy_machinegun_ct',
              'buy_shotgun_t', 'buy_shotgun_ct'];
            try { em.FS.mkdir('/cstrike/custom'); } catch (e) { }
            try { em.FS.mkdir('/cstrike/custom/touch'); } catch (e) { }
            try { em.FS.mkdir('/cstrike/touch'); } catch (e) { }
            let cfgWritten = 0;
            for (const cfgName of buyMenuCFGs) {
              try {
                const r = await fetch(`/wasm/touch/${cfgName}.cfg`, { cache: 'no-store' });
                if (r.ok) {
                  const buf = new Uint8Array(await r.arrayBuffer());
                  // #1 oncelik: cstrike/custom/touch/ (Xash3D en yuksek oncelik)
                  em.FS.writeFile(`/cstrike/custom/touch/${cfgName}.cfg`, buf);
                  // #2 fallback: cstrike/touch/
                  em.FS.writeFile(`/cstrike/touch/${cfgName}.cfg`, buf);
                  cfgWritten++;
                  browserCSDebugLog(`[BuyMenu] Yazildi: ${cfgName}.cfg (${buf.length}B)`);
                } else {
                  console.error(`[BuyMenu] HATA: ${cfgName}.cfg HTTP ${r.status}`);
                }
              } catch (e) { console.error(`[BuyMenu] Exception: ${cfgName}`, e); }
            }
            addLoadingLog(`CS 1.5 buy CFGleri yazildi: ${cfgWritten}/${buyMenuCFGs.length}`, 'ok');
            browserCSDebugLog('[BuyMenu] custom/touch VFS:', em.FS.readdir('/cstrike/custom/touch'));
            // Fetch custom localized files to override pk3 defaults
            const customTexts = [
              '/cs-assets/cstrike/motd.txt',
              '/cs-assets/cstrike/resource/cstrike_english.txt',
              '/cs-assets/valve/resource/valve_english.txt',
              '/cs-assets/cstrike/commandmenu.txt',
              '/cs-assets/cstrike/liblist.gam',
              '/cs-assets/cstrike/titles.txt'
            ];
            for (const fileUrl of customTexts) {
              try {
                const res = await cachedFetch(fileUrl);
                if (res.ok) {
                  const buf = new Uint8Array(await res.arrayBuffer());
                  const path = fileUrl.replace('/cs-assets', '');
                  try { em.FS.writeFile(path, buf); } catch (e) {
                    // Fallback create dir
                    if (path.includes('/resource/')) {
                      const isValve = path.startsWith('/valve');
                      try { em.FS.mkdir(isValve ? '/valve/resource' : '/cstrike/resource'); } catch (e2) { }
                      em.FS.writeFile(path, buf);
                    }
                  }
                }
              } catch (e) { }
            }

            em.removeRunDependency('load_pk3_assets');
          })();

          em.FS.writeFile('/cstrike/liblist.gam', liblistBuffer);
          em.FS.writeFile(`/cstrike/maps/${mapName}.bsp`, bspBuffer);

          // İstemci ise: autoexec.cfg'ye connect yazmıyoruz.
          // Motor haritayı +map ile yükleyecek, sonra engine tam hazır olduktan sonra
          // delayed connect komutu göndereceğiz (aşağıda, engine başladıktan sonra).

          downloadedWads.forEach(wad => {
            em.FS.writeFile(`/cstrike/${wad.name}`, wad.data);
          });
          let halflife1Data = null;
          let halflife2Data = null;
          let dedicatedHalflife = null;

          downloadedValveWads.forEach(wad => {
            if (wad.name === 'halflife.wad') {
              // Prefer the real BrowserCS/valve halflife.wad (signs + iceworld c_stone1)
              dedicatedHalflife = wad.data;
            } else if (wad.name === 'halflife1.wad') {
              halflife1Data = wad.data;
            } else if (wad.name === 'halflife2.wad') {
              halflife2Data = wad.data;
            } else {
              em.FS.writeFile(`/valve/${wad.name}`, wad.data);
            }
          });

          const isWad3 = (buf) => buf && buf.length > 12 && buf[0] === 0x57 && buf[1] === 0x41 && buf[2] === 0x44 && buf[3] === 0x33;
          if (isWad3(dedicatedHalflife)) {
            em.FS.writeFile('/valve/halflife.wad', dedicatedHalflife);
          } else if (isWad3(halflife1Data) && isWad3(halflife2Data)) {
            // Legacy split pack only if both halves are valid WAD3 (ours are truncated — skip)
            const combined = new Uint8Array(halflife1Data.length + halflife2Data.length);
            combined.set(halflife1Data);
            combined.set(halflife2Data, halflife1Data.length);
            em.FS.writeFile('/valve/halflife.wad', combined);
          } else if (isWad3(halflife1Data)) {
            em.FS.writeFile('/valve/halflife.wad', halflife1Data);
          }

          addLoadingLog(`📦 Dosyalar RAM dosya sistemine yazıldı. (+${downloadedWads.length + downloadedValveWads.length} WAD)`, 'ok');

          // ─── KRİTİK: WASM crash'e neden olan sprite'lar ─────────────────────
          // CS 1.5 kurulumunda cstrike/sprites/ dizininde bulunmuyorlar.
          // Bunlar asset server'ın dmc/sprites fallback'inden gerçek dosyalar olarak
          // yüklendi ve şimdi VFS'e yazılıyor. Bu eksiklik WASM memory crash'ine neden oluyordu.
          em.FS.writeFile('/cstrike/sprites/dot.spr', dotSprBuffer);
          em.FS.writeFile('/cstrike/sprites/animglow01.spr', animglowSprBuffer);
          em.FS.writeFile('/cstrike/sprites/richo1.spr', richoSprBuffer);
          em.FS.writeFile('/cstrike/sprites/shellchrome.spr', shellchromeSprBuffer);
          em.FS.writeFile('/cstrike/sprites/crosshairs.spr', crosshairsSprBuffer);
          em.FS.writeFile('/cstrike/sprites/radio.spr', radioSprBuffer);
          em.FS.writeFile('/cstrike/sprites/gas_puff_01.spr', gasPuffSprBuffer);
          // valve/sprites dizinine de yaz (bazı CS sürümleri oradan okur)
          try { em.FS.mkdir('/valve/sprites'); } catch (e) { }
          em.FS.writeFile('/valve/sprites/dot.spr', dotSprBuffer);
          em.FS.writeFile('/valve/sprites/animglow01.spr', animglowSprBuffer);
          em.FS.writeFile('/valve/sprites/richo1.spr', richoSprBuffer);
          em.FS.writeFile('/valve/sprites/shellchrome.spr', shellchromeSprBuffer);
          em.FS.writeFile('/valve/sprites/crosshairs.spr', crosshairsSprBuffer);
          // ─────────────────────────────────────────────────────────────────────

          // CS 1.6 missing sprites (for CS 1.5 compatibility)
          // NOT: gas_puff_01.spr artik public asset — muzzleflash dummy ile ezme (sis bozuluyordu)
          const missingSprites = [
            '/cstrike/sprites/shadow_circle.spr',
            '/cstrike/sprites/voiceicon.spr',
            '/cstrike/sprites/radaropaque.spr',
            '/cstrike/sprites/sniper_scope.spr'
          ];
          missingSprites.forEach(path => em.FS.writeFile(path, dummySprBuffer));

          // Scope arc TGA stubs (sniperscope.cpp uses scanline rendering now, not TGA textures)
          // Write minimal valid 1x1 transparent TGA files to avoid file-not-found crashes
          const stubTga = new Uint8Array([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 32, 8, 0, 0, 0, 0]);
          em.FS.writeFile('/cstrike/sprites/scope_arc_nw.tga', stubTga);
          em.FS.writeFile('/cstrike/sprites/scope_arc_ne.tga', stubTga);
          em.FS.writeFile('/cstrike/sprites/scope_arc_se.tga', stubTga);
          em.FS.writeFile('/cstrike/sprites/scope_arc_sw.tga', stubTga);
          em.FS.writeFile('/cstrike/sprites/scope_arc.tga', stubTga);


          // DLL dosyaları
          em.FS.writeFile('/cstrike/dlls/cs_emscripten_wasm32.wasm', csServerBuffer);
          em.FS.writeFile('/cstrike/cl_dlls/client_emscripten_wasm32.wasm', csClientBuffer);
          em.FS.writeFile('/cstrike/cl_dlls/menu_emscripten_wasm32.wasm', csMenuBuffer);

          em.FS.writeFile('/filesystem_stdio.wasm', fsBuffer);
          em.FS.writeFile('/libref_webgl2.wasm', glBuffer);
          em.FS.writeFile('/libref_gles3compat.wasm', glBuffer);

          // Valve dosyaları
          em.FS.writeFile('/valve/gfx.wad', gfxBuffer);
          em.FS.writeFile('/valve/fonts.wad', fontsBuffer);
          em.FS.writeFile('/valve/delta.lst', vDeltaBuffer);
          em.FS.writeFile('/valve/valve.rc', vRcBuffer);

          // CS config dosyaları
          em.FS.writeFile('/cstrike/delta.lst', cDeltaBuffer);
          em.FS.writeFile('/cstrike/config.cfg', appendBrowserCSPerfConfig(cCfgBuffer));
          if (cmdMenuBuffer && cmdMenuBuffer.length > 0) {
            em.FS.writeFile('/cstrike/commandmenu.txt', cmdMenuBuffer);
          }
          // server.cfg write removed

          // ─── c0a0.bsp STUB ────────────────────────────────────────────────────
          // Xash3D client modu başlarken arka plan menü sunucu için c0a0.bsp arar.
          // Bu dosya olmadan Host_ErrorInit hatası ve alert dialog çıkar.
          // Geçici çözüm: seçili haritanın BSP'sini c0a0.bsp olarak da yaz.
          // Engine bağlandıktan sonra sunucunun haritasına geçiş yapar.
          try {
            safeMkdir('/valve/maps');
            em.FS.writeFile('/valve/maps/c0a0.bsp', bspBuffer);
            em.FS.writeFile('/cstrike/maps/c0a0.bsp', bspBuffer);
            addLoadingLog('c0a0.bsp stub yazıldı ✓', 'ok');
          } catch (e) {
            addLoadingLog('c0a0 stub yazma uyarısı: ' + e.message, 'warn');
          }
          // ─────────────────────────────────────────────────────────────────────

          addLoadingLog('Tüm dosyalar FS\'ye yazıldı ✓');

          // ── KRİTİK FIX: SOCKFS WebSocket URL'ini WSS'e zorla ────────────────
          // Emscripten'in SOCKFS kodu varsayılan olarak ws:// URL'i oluşturuyor.
          // HTTPS sayfasında bu Mixed Content hatası ile bloklaniyor.
          // websocketArgs.url = 'wss://' diyerek tüm engine WebSocket bağlantılarını
          // güvenli WSS kanalına yönlendiriyoruz.
          try {
            if (em.SOCKFS) {
              em.SOCKFS.websocketArgs['url'] = 'wss://';
              addLoadingLog('SOCKFS WSS override uygulandı ✓', 'ok');
            }
          } catch (e) {
            addLoadingLog('SOCKFS override uyarısı: ' + e.message, 'warn');
          }
          // ─────────────────────────────────────────────────────────────────────

        }],
        print: (log) => {
          if (
            window.BrowserCSReconnect &&
            typeof log === "string"
          ) {
            const retryablePatterns = [
              /server connection timed out/i,
              /connection to server lost/i,
              /connection lost/i,
              /couldn't connect/i,
              /could not connect/i,
              /network error/i,
              /connection failed/i,
              /server is not responding/i
            ];

            const nonRetryablePatterns = [
              /you have been kicked/i,
              /kicked by server/i,
              /banned/i,
              /bad password/i,
              /server is full/i
            ];

            const connectedPatterns = [
              /connected to/i,
              /connection accepted/i,
              /entered the game/i,
              /joined the game/i,
              /started map/i,
              /welcome to/i,
              /client .* connected/i,
              /\[BROWSERCS_SCOREBOARD\]/i,
              /skor verme/i
            ];

            const isNonRetryable =
              nonRetryablePatterns.some(
                (pattern) => pattern.test(log)
              );

            const isRetryable =
              retryablePatterns.some(
                (pattern) => pattern.test(log)
              );

            if (
              connectedPatterns.some((pattern) => pattern.test(log))
            ) {
              window._browserCSInGameFlag = true;
              if (typeof window.hideMenuBackground === 'function') {
                window.hideMenuBackground();
              }
              window.BrowserCSReconnect.connected();
            } else if (isNonRetryable) {
              window.BrowserCSReconnect.nonRetryable(
                log.trim()
              );
            } else if (isRetryable && window._browserCSAssetsReady) {
              window.BrowserCSReconnect.start(
                log.trim()
              );
            }
          }

          if (log.includes('Could not get TCP/IPv6 address')) return;
          if (log.includes('File exists from loopback')) return;
          if (log.includes('ScriptProcessorNode')) return;

          if (handleBrowserCSAdminLog(log)) {
            return;
          }

          if (log.includes('[BROWSERCS_SCOREBOARD]')) {
            try {
              const jsonStr = log.split('[BROWSERCS_SCOREBOARD]')[1].trim();
              const payload = JSON.parse(jsonStr);
              // serverName boş gelirse join sırasında sakladığımız ismi kullan
              const resolvedServerName = payload.serverName
                || (window._motdServerMeta && window._motdServerMeta.serverName)
                || 'BrowserCS';
              if (window.updateBrowserCSScoreboard) {
                // Avoid JSON.stringify round-trip alloc on hot scoreboard path
                window.updateBrowserCSScoreboard(
                  payload.players || [],
                  resolvedServerName,
                  payload.localPlayerId,
                  payload.teams || []
                );
              }
            } catch (e) {
              console.error('Scoreboard parse error', e);
            }
            return;
          }

          if (log.includes('[BROWSERCS_HIDE_SCOREBOARD]')) {
            // Tab basılıyken motor hide gönderse bile paneli kapatma (titreme)
            if (
              !window._browserCSScoreboardPinned &&
              !window._browserCSScoreboardTabHeld
            ) {
              const sbContainer = document.getElementById('custom-scoreboard');
              if (sbContainer) sbContainer.style.display = 'none';
            }
            return;
          }

          const lowerLog = log.toLowerCase();
          if (
            lowerLog.includes('intermission') ||
            lowerLog.includes('changing map') ||
            lowerLog.includes('changelevel') ||
            (lowerLog.includes('loading map') && !lowerLog.includes('background'))
          ) {
            if (typeof window.beginBrowserCSScoreReset === 'function') {
              window.beginBrowserCSScoreReset(20000);
            }
            if (typeof window.pinBrowserCSScoreboard === 'function') {
              window.pinBrowserCSScoreboard(true, 'Harita değiştiriliyor — skor tablosu sabitlendi');
            } else if (typeof window.zeroBrowserCSScoreboard === 'function') {
              window.zeroBrowserCSScoreboard();
            }
          }

          if (
            lowerLog.includes('started map') ||
            lowerLog.includes('entered the game') ||
            lowerLog.includes('spawning server')
          ) {
            if (typeof window.beginBrowserCSScoreReset === 'function') {
              window.beginBrowserCSScoreReset(10000);
            }
            if (window._browserCSIsDeathmatch && lowerLog.includes('entered the game')) {
              setTimeout(() => {
                if (typeof executeEngineCommand === 'function') {
                  executeEngineCommand('firstperson');
                  executeEngineCommand('fullupdate');
                }
              }, 400);
              setTimeout(() => {
                if (typeof executeEngineCommand === 'function') {
                  executeEngineCommand('fullupdate');
                }
              }, 1200);
            }
            if (window._browserCSScoreboardPinned) {
              setTimeout(() => {
                if (typeof window.zeroBrowserCSScoreboard === 'function') {
                  window.zeroBrowserCSScoreboard();
                }
                if (typeof window.pinBrowserCSScoreboard === 'function') {
                  window.pinBrowserCSScoreboard(false);
                }
              }, 1200);
            }
          }

          if (log.includes('[BROWSERCS_TEXTMENU_CLOSE]')) {
            const tm = document.getElementById('custom-textmenu');
            if (tm) tm.style.display = 'none';
            window.textMenuSlots = 0;
            return;
          }

          if (log.includes('[BROWSERCS_TEXTMENU]')) {
            try {
              const parts = log.split('[BROWSERCS_TEXTMENU]')[1].trim();
              const pipeIdx = parts.indexOf('|');
              if (pipeIdx > -1) {
                window.textMenuSlots = parseInt(parts.substring(0, pipeIdx));
                const textStr = parts.substring(pipeIdx + 1).replace(/\\n/g, '\n');

                const tm = document.getElementById('custom-textmenu');
                const tmTitle = document.getElementById('textmenu-title');
                const tmItems = document.getElementById('textmenu-items');
                if (tm && tmTitle && tmItems) {
                  tmItems.innerHTML = '';
                  const lines = textStr.split('\n');

                  // Clean color codes (\y, \w, \r, \d, \b) from the title
                  let titleStr = lines[0] || 'MENU';
                  titleStr = titleStr.replace(/\\[ywrdb]/g, '').trim();
                  tmTitle.innerText = titleStr;
                  const itemLines = lines.slice(1);

                  const isTeamMenu = /tak[iı]m|team/i.test(titleStr);
                  if (isTeamMenu && window._browserCSIsDeathmatch) {
                    tm.style.display = 'none';
                    window.textMenuSlots = 0;
                    /* Sunucu plugin jointeam + random spawn yapıyor — menuselect yarışını önle */
                    return;
                  }

                  for (let i = 1; i < lines.length; i++) {
                    let line = lines[i].trim();
                    if (!line) continue;

                    // Clean color codes before regex match
                    line = line.replace(/\\[ywrdb]/g, '').trim();

                    const match = line.match(/^(\d+)[.)\-\s]+\s*(.*)/);
                    if (match) {
                      const slotNum = parseInt(match[1]);
                      const slotText = match[2];

                      const isZero = (slotNum === 0);
                      const bitCheck = isZero ? (1 << 9) : (1 << (slotNum - 1));
                      const btn = window._browserCSRenderTextMenuItem({
                        tm,
                        titleStr,
                        itemLines,
                        slotNum,
                        slotText,
                        bitCheck,
                      });
                      if (btn) tmItems.appendChild(btn);
                    } else {
                      // Non-selectable text line
                      const div = document.createElement('div');
                      div.style.color = 'var(--text-dim)';
                      div.style.fontSize = '0.7rem';
                      div.style.padding = '0.2rem 0';
                      div.innerText = line;
                      tmItems.appendChild(div);
                    }
                  }
                  browserCSDebugLog('[DEBUG] Opening HTML Text Menu:', titleStr);
                  tm.style.display = 'flex';
                  if (window.BrowserCSReconnect) {
                    window.BrowserCSReconnect.connected();
                  }
                }
              }
            } catch (e) { console.error('Textmenu parse error', e); }
            return;
          }

          // BUY DEBUG: silah satın alma logları
          if (log.includes('[BUY_DEBUG]')) {
            console.warn('%c' + log, 'color: #ff0; background: #000; font-weight: bold; font-size: 13px;');
            addConsoleLog('🛒 ' + log, 'warn');
            return;
          }

          // Eksik harita: changelevel sonrası client VFS'te BSP yoksa indir + retry
          if (
            log.includes('Could not load model') ||
            log.includes('Host_Error')
          ) {
            const missingMap = extractMissingMapFromLog(log);
            if (missingMap) {
              console.warn('[Map] Eksik BSP tespit edildi:', missingMap);
              addConsoleLog(`Eksik harita: ${missingMap}.bsp — indiriliyor...`, 'warn');
              recoverMissingMapBsp(missingMap);
              return;
            }
          }

          // Ağ/resource spam'ini bastır (svc_resourcelist, lightstyle, usermessage...)
          if (
            /svc_resource|svc_lightstyle|svc_usermessage|svc_stufftext|Wrote erroneous|BAD:\s*\d+/i.test(log) ||
            /Last \d+ messages parsed/i.test(log)
          ) {
            return;
          }

          // Sadece gerçek disconnect/kick/CRC sorunlarını vurgula
          const isKeyDisconnect =
            /\bDisconnect(ed|ing)?\b/i.test(log) ||
            /\bkicked\b/i.test(log) ||
            (/\bCRC\b/i.test(log) && /\b(differ|mismatch|inconsistent)\b/i.test(log)) ||
            /\binconsistent file\b/i.test(log) ||
            /\brejected by server\b/i.test(log);

          if (isKeyDisconnect) {
            console.warn('[ENGINE KEY]', log);
            addConsoleLog('>>> ' + log, 'warn');
          } else {
            // Filter noisy keystrokes or unbounds
            if (log.trim().length <= 3) return;
            if (log.startsWith('"')) return;
            if (log.includes('is unbound')) return;
            if (log.includes('Unknown command:')) return;

            browserCSDebugLog('[Engine Output]', log);
            // Combat FPS: rutin engine log'larını DOM'a yazma (sadece debug)
            const verbose =
              (typeof window !== 'undefined' && window._browserCSVerboseLogs === true) ||
              (typeof localStorage !== 'undefined' && localStorage.getItem('browsercs_debug') === '1');
            if (verbose) addConsoleLog(log);
          }
          if (log.includes('Loading map') || log.includes('Spawning server')) {
            setProgress(90, log);
          }
        },
        printErr: (log) => {
          if (log.includes('Could not get TCP/IPv6 address')) return;
          if (log.includes('File exists from loopback')) return;
          if (log.includes('ScriptProcessorNode')) return;
          if (log.includes('INVALID_ENUM')) return;
          if (log.includes('WebGL')) return;
          if (log.includes('Deprecation')) return;
          if (
            log.includes('Could not load model') ||
            log.includes('Host_Error')
          ) {
            const missingMap = extractMissingMapFromLog(log);
            if (missingMap) {
              console.warn('[Map] Eksik BSP (printErr):', missingMap);
              recoverMissingMapBsp(missingMap);
              return;
            }
          }
          if (/svc_resource|Wrote erroneous|BAD:\s*\d+/i.test(log)) return;
          const isKeyErr =
            /\bDisconnect(ed|ing)?\b/i.test(log) ||
            /\bkicked\b/i.test(log) ||
            (/\bCRC\b/i.test(log) && /\b(differ|mismatch|inconsistent)\b/i.test(log)) ||
            /\bHost_Error\b/i.test(log) ||
            /\brejected by server\b/i.test(log);
          const verbose =
            (typeof window !== 'undefined' && window._browserCSVerboseLogs === true) ||
            (typeof localStorage !== 'undefined' && localStorage.getItem('browsercs_debug') === '1');
          if (isKeyErr || verbose) {
            console.error('[Engine Error]', log);
            addConsoleLog(log, !log.includes('WARNING') ? 'err' : 'warn');
          } else {
            browserCSDebugLog('[Engine Error]', log);
          }
        },
      },
    });

    setProgress(80, 'Engine init (boot) ediliyor...');
    await state.xash.init();
    browserCSDebugLog('[DEBUG] state.xash.init() completed successfully!');

    // ── Adım 4: Engine main loop başlat ─────────────────────────────
    setProgress(88, 'Engine ana döngüsü başlatılıyor...');
    state.xash.main();
    browserCSDebugLog('[DEBUG] state.xash.main() completed successfully!');
    state.engineRunning = true;

    setProgress(92, 'Ağ bağlantısı hazırlanıyor...');
    setEngineStatus('Oyun çalışıyor', 'green');

    // Asset indirme sırasında WebRTC'yi ısıt — yükleme bitince kanal çoğu zaman hazır olur.
    // ensureDcReady tek-uçuşlu; startInitialConnect aynı promise'i paylaşır (peer yarışı yok).
    const needsRemoteJoin = !isHost && connectPort && connectPort !== 'listen' && connectPort !== true;
    if (needsRemoteJoin && state.xash?.ensureDcReady) {
      browserCSDebugLog('[DEBUG] WebRTC warm-start (asset indirme ile paralel)');
      window._webrtcWarmPromise = state.xash
        .ensureDcReady(90000)
        .then(() => true)
        .catch((err) => {
          browserCSDebugLog('[DEBUG] WebRTC warm-start henüz hazır değil:', err?.message || err);
          return false;
        });
    } else {
      window._webrtcWarmPromise = Promise.resolve(false);
    }

    // Loading overlay'i gizle
    setTimeout(async () => {
      if (window.pk3Promise) {
        setProgress(96, 'Oyun assetlerinin indirilmesi bekleniyor...');
        await window.pk3Promise;
      }
      // Warm WebRTC bitsin diye kısa bekle (max 3s) — genelde zaten açıktır
      if (needsRemoteJoin && window._webrtcWarmPromise) {
        setProgress(98, 'Sunucu bağlantısı hazırlanıyor...');
        await Promise.race([
          window._webrtcWarmPromise,
          new Promise((r) => setTimeout(r, 3000))
        ]);
      }
      setProgress(100, 'Tamamlandı!');
      notify('Oyun başladı! Canvas\'a tıkla → mouse yakala', 'success');

      // Delay before hiding so user sees 100%
      setTimeout(async () => {
        if (loadingOverlay) loadingOverlay.classList.remove('active');
        if (gameCanvas) gameCanvas.focus();
        startFPSCounter();

        // Neon döngüsü: sadece gerçek join sonrası (sessionJoined) tetiklenir
        if (typeof window.startBrowserCSPromoLoop === 'function') {
          window.startBrowserCSPromoLoop(connectPort);
        }

        // Eğer istemciysek ve uzak sunucuya bağlanmamız gerekiyorsa:
        if (needsRemoteJoin) {
          browserCSDebugLog('[DEBUG] Assetler yüklendi, uzak sunucuya bağlanılıyor...');
          addConsoleLog('Assetler tamamlandı. Sunucuya bağlanılıyor...', 'ok');
          window._browserCSAssetsReady = true;

          if (
            typeof BrowserCSReconnect !== 'undefined' &&
            BrowserCSReconnect?.startInitialConnect
          ) {
            BrowserCSReconnect.startInitialConnect(
              `Port ${connectPort} üzerinden sunucuya bağlanılıyor.`
            );
            // Yükleme config'inden sonra native +showscores'un kapalı kaldığını
            // garanti et; TAB HTML skorboard tarafından yönetilir.
            setTimeout(() => {
              if (typeof window.configureHtmlScoreboardBinding === 'function') {
                window.configureHtmlScoreboardBinding();
              }
            }, 500);
            setTimeout(() => {
              if (typeof window.configureHtmlScoreboardBinding === 'function') {
                window.configureHtmlScoreboardBinding();
              }
            }, 3000);
          }
        }

        // ── Keybind overlay: oyuna girilince 9 saniye göster ─────────
        const keybindOverlay = document.getElementById('keybind-overlay');
        if (keybindOverlay) {
          keybindOverlay.style.display = 'block';
          setTimeout(() => { keybindOverlay.style.display = 'none'; }, 9000);
        }

        // ── Welcome MOTD overlay: bağlantıdan 1.5sn sonra göster ─────
        setTimeout(() => {
          if (window.BrowserCSReconnect?.reconnecting) {
            return;
          }
          const meta = window._motdServerMeta || {};
          if (typeof window.showWelcomeMOTD === 'function') {
            window.showWelcomeMOTD(meta.serverName, meta.mapName);
          }
        }, 1500);
      }, 200);
    }, 400);

    // ── Mouse lock bildirimi ──────────────────────────────────────
    const mouselockTip = document.getElementById('mouselock-tip');
    document.addEventListener('pointerlockchange', () => {
      if (!mouselockTip) return;
      if (document.pointerLockElement === gameCanvas) {
        mouselockTip.style.display = 'block';
        mouselockTip.style.animation = 'none';
        mouselockTip.offsetHeight; // reflow
        mouselockTip.style.animation = 'fadeout-tip 3s ease forwards';
        setTimeout(() => { mouselockTip.style.display = 'none'; }, 3100);
      } else {
        mouselockTip.style.display = 'none';
      }
    });


    // Focus canvas automatically on click
    gameCanvas.addEventListener('click', () => {
      if (document.activeElement !== gameCanvas) {
        gameCanvas.focus();
      }
      if (state.engineRunning && !document.pointerLockElement) {
        // Tarayıcı kilit reddettiğinde ESC vb basılırsa oyun menüye düşüyor.
        // Ekrana tıkladığında zorla kilidi geri isteyelim.
        try { gameCanvas.requestPointerLock(); } catch (e) { }
      }
    });

  } catch (err) {
    // Xash3D WASM bazen sayısal değer (Infinity) throw ediyor — stringify et
    const errMsg = (err && err.message) ? err.message : String(err);
    if (errMsg === 'Infinity' || errMsg === 'NaN' || errMsg === '0') {
      // Bu WASM'ın internal crash'i — sayfayı koru, overlay göster
      const overlay = document.getElementById('fatal-error-overlay');
      const msg = document.getElementById('fatal-error-msg');
      if (overlay) { overlay.style.display = 'flex'; }
      if (msg) msg.textContent = 'Oyunda beklenmeyen bir hata oluştu. Sayfayı yenileyin.';
      state.engineRunning = false;
      return;
    }
    console.error('Engine hatası:', err);
    addLoadingLog(`⚠ HATA: ${errMsg}`, 'warn');
    addConsoleLog(`Oyun başlatma hatası: ${errMsg}`, 'err');
    notify(`Oyun hatası: ${errMsg}`, 'error');
    setEngineStatus('Oyun hatası', 'red');

    if (errMsg.includes('magic word')) {
      addLoadingLog('→ Oyun dosyası yanlış yüklenmiş. Sayfayı yenileyin.', 'warn');
    }
    if (errMsg.includes('SharedArrayBuffer')) {
      addLoadingLog('→ Tarayıcı kısıtlaması. Sayfayı yenileyin veya Chrome/Edge deneyin.', 'warn');
    }

    state.engineRunning = false;
    state.xash = null;
    if (btnLaunch) btnLaunch.disabled = false;

    setTimeout(() => {
      if (loadingOverlay) loadingOverlay.classList.remove('active');
      if (gameWrapper) gameWrapper.classList.remove('active');
      if (previewPanel) previewPanel.classList.remove('hidden');
    }, 4000);
  }
}

export async function changeMap(mapName) {
  if (!state.xash || !state.engineRunning) return;
  const {
    loadingMapName, toolbarMapName, loadingLog, loadingOverlay, loadingProgress,
  } = gameEls();
  if (loadingMapName) loadingMapName.textContent = mapName;
  if (toolbarMapName) toolbarMapName.textContent = mapName;
  if (loadingLog) loadingLog.innerHTML = '';
  if (loadingOverlay) loadingOverlay.classList.add('active');
  if (loadingProgress) loadingProgress.style.width = '20%';
  addLoadingLog(`Harita değişiyor: ${mapName}`, 'ok');

  try {
    const ok = await ensureMapBspInVfs(mapName);
    if (!ok) throw new Error(`${mapName}.bsp indirilemedi`);
    setProgress(70, `${mapName}.bsp yüklendi`);
    executeEngineCommand(`map ${mapName}`);
    setProgress(90, 'Harita yükleniyor...');
    setTimeout(() => {
      setProgress(100, 'Hazır!');
      setTimeout(() => {
        if (loadingOverlay) loadingOverlay.classList.remove('active');
        state.currentMap = mapName;
      }, 800);
    }, 2000);
  } catch (err) {
    addLoadingLog(`Harita yüklenemedi: ${err.message}`, 'warn');
    setTimeout(() => {
      if (loadingOverlay) loadingOverlay.classList.remove('active');
    }, 2000);
  }
}

