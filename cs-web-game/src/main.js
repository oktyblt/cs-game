/**
 * BrowserCS oyna entry — orchestrator.
 * Yeni özellikler buraya değil; ilgili module'e eklenir:
 *   admin/, ui/, net/, game/, api.js, dom.js
 */
import { initAuth, getCurrentUsername, getCurrentUser, getSessionToken, isUserPremium, isUserAdmin, getBanBlockMessage } from "./auth.js";
import { validatePublicNickname } from "./nick.js";
import { buyServer, supabase } from './supabase.js';
import { Xash3D, Net } from 'xash3d-fwgs';
import { API_URL, ASSET_URL } from './api.js';
import { $, notify } from './dom.js';
import './ui/modals.js';
import './game/frameDiagnostics.js';
import { startRenderStability } from './game/renderStability.js';
import { BrowserCSNetBridge, netWorkerEnabled, workerWebRtcAvailable } from './net/netBridge.js';
import { getIceServers } from './net/iceServers.js';
import { isBrowserCSProtocolLog } from './ui/hudBridge.js';
import { BrowserCSReconnect } from './net/reconnect.js';
import './net/rankTicket.js';
import './net/vipTicket.js';
import { state } from './game/state.js';
import { assertEngineBridges } from './game/engineBridge.js';
import { loadMapList, renderMapList, selectMap, getMapType, formatSize } from './game/maps.js';
import { ensureMapBspInVfs, recoverMissingMapBsp, extractMissingMapFromLog, normalizeMapName, fsMkdirP } from './game/vfs.js';
import { initEngine, changeMap } from './game/engine.js';
import { toggleConsole } from './game/console.js';
import { isDeathmatchServer, buildModePill } from './game/serverMeta.js';
import { initRankGiftPopup } from './ui/rankGiftPopup.js';

// Fix for Xash3D Emscripten Black Sky Bug + compositor jitter.
// desynchronized:true tears/flickers on Windows Chrome — keep compositor-synced.
const originalGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (type, attributes) {
  if (type === 'webgl' || type === 'experimental-webgl' || type === 'webgl2') {
    attributes = attributes || {};
    attributes.alpha = false;
    attributes.antialias = false;
    attributes.powerPreference = 'high-performance';
    attributes.desynchronized = false;
    attributes.preserveDrawingBuffer = false;
  }
  return originalGetContext.call(this, type, attributes);
};

// Fix for Browser AudioContext Autoplay Policy that silences game sounds.
// Keep native SDL ScriptProcessor — AudioWorklet rAF pump underruns under WASM
// hitches and cuts gun/footstep sounds short.
(function () {
  const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
  if (!OriginalAudioContext) return;
  const allAudioContexts = [];
  let audioPollTimer = null;
  let pollTicks = 0;

  const PatchedAudioContext = function (options) {
    // interactive = lower output latency for game SFX (was 'playback' → more buffering/lag)
    const opts = Object.assign({ latencyHint: 'interactive' }, options || {});
    const ctx = new OriginalAudioContext(opts);
    allAudioContexts.push(ctx);
    return ctx;
  };
  PatchedAudioContext.prototype = OriginalAudioContext.prototype;
  window.AudioContext = PatchedAudioContext;
  if (window.webkitAudioContext) window.webkitAudioContext = PatchedAudioContext;

  const resumeAll = () => {
    let anySuspended = false;
    allAudioContexts.forEach((ctx) => {
      if (ctx.state === 'suspended') {
        anySuspended = true;
        ctx.resume().catch(() => { });
      }
    });
    return anySuspended;
  };

  document.addEventListener('mousedown', resumeAll, { capture: true });
  document.addEventListener('keydown', resumeAll, { capture: true });
  document.addEventListener('touchstart', resumeAll, { capture: true });

  audioPollTimer = setInterval(() => {
    pollTicks += 1;
    const stillSuspended = resumeAll();
    const engOn = !!state.engineRunning;
    if ((!stillSuspended && engOn) || pollTicks >= 30) {
      clearInterval(audioPollTimer);
      audioPollTimer = null;
    }
  }, 10000);
})();

// Fix for Emscripten SOCKFS Mixed Content (ws:// blocked on HTTPS).
// Xash3D's net layer maps all hostnames to 101.101.x.x virtual IPs.
// SOCKFS then tries to open ws://101.101.x.x/ which Chrome blocks on HTTPS.
// Solution: intercept 101.101.x.x WebSocket attempts and return a fake WS
// that fires onerror immediately so the engine can handle the failure gracefully.
// Real relay connections (wss://backend.browsercs.com) pass through unchanged.
(function () {
  const OriginalWebSocket = window.WebSocket;

  function createFakeWebSocket(url) {
    // Create a minimal fake WebSocket that looks real but errors immediately
    const fake = {
      url,
      readyState: 3, // CLOSED
      bufferedAmount: 0,
      extensions: '',
      protocol: '',
      binaryType: 'arraybuffer',
      onopen: null, onclose: null, onerror: null, onmessage: null,
      send() { },
      close() { },
      addEventListener(type, fn) { if (type === 'error') setTimeout(() => fn && fn({ type: 'error' }), 0); },
      removeEventListener() { },
      dispatchEvent() { return true; },
    };
    // Fire onerror asynchronously so SOCKFS has time to attach the handler
    setTimeout(() => {
      if (typeof fake.onerror === 'function') fake.onerror({ type: 'error', message: 'Virtual IP not routable' });
      if (typeof fake.onclose === 'function') fake.onclose({ type: 'close', code: 1006, reason: 'Virtual IP' });
    }, 10);
    return fake;
  }

  function PatchedWebSocket(url, protocols) {
    // Intercept Xash3D's virtual 101.101.x.x IP connections
    if (typeof url === 'string' && /101\.101\./.test(url)) {
      return createFakeWebSocket(url);
    }
    // Upgrade ws:// → wss:// for any other connection on HTTPS (generic safety)
    if (typeof url === 'string' && url.startsWith('ws://') && location.protocol === 'https:') {
      url = url.replace('ws://', 'wss://');
    }
    const socket = protocols !== undefined
      ? new OriginalWebSocket(url, protocols)
      : new OriginalWebSocket(url);

    let isGameRelay = false;
    try {
      const relayUrl = new URL(url, window.location.href);
      isGameRelay =
        relayUrl.hostname === "backend.browsercs.com" &&
        relayUrl.pathname.startsWith("/ws/");
    } catch {
      isGameRelay = false;
    }

    if (isGameRelay) {
      const dispatchConnectionState = (state, reason = "") => {
        window.dispatchEvent(
          new CustomEvent("browsercs-connection-state", {
            detail: { state, reason }
          })
        );
      };

      const handleFirstMessage = () => {
        socket.removeEventListener(
          "message",
          handleFirstMessage
        );
        dispatchConnectionState("active");
      };

      socket.addEventListener(
        "message",
        handleFirstMessage
      );

      socket.addEventListener("close", (event) => {
        dispatchConnectionState(
          "disconnected",
          event.reason || "WebSocket bağlantısı kapandı."
        );
      });

      socket.addEventListener("error", () => {
        dispatchConnectionState(
          "disconnected",
          "WebSocket bağlantı hatası."
        );
      });
    }

    return socket;
  }

  PatchedWebSocket.prototype = OriginalWebSocket.prototype;
  PatchedWebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
  PatchedWebSocket.OPEN = OriginalWebSocket.OPEN;
  PatchedWebSocket.CLOSING = OriginalWebSocket.CLOSING;
  PatchedWebSocket.CLOSED = OriginalWebSocket.CLOSED;

  window.WebSocket = PatchedWebSocket;
})();


// --- WASM RUNTIME ERROR HANDLER ---
// Game DLL veya engine WASM crash olduğunda (memory access out of bounds vb.)
// sayfayı kurtarıp kullanıcıya bilgi ver.
//
// "İlk girişte bazen WASM crash" — bu genelde motor tam başlarken (Host_Main
// ilk mainloop tick'inde) oluşan nadir bir bellek erişim hatası; oyuncu henüz
// oyuna girmemiş oluyor. Böyle bir durumda kullanıcıyı "sayfayı yenile" ile
// baş başa bırakmak yerine, aynı sunucu/map bilgisiyle OTOMATİK olarak bir kez
// yeniden dene (reload + auto-reconnect). Aynı port'ta art arda ikinci kez
// olursa sonsuz reload döngüsüne girmemek için manuel overlay'e düşülür.
window.addEventListener('error', (event) => {
  if (event.error instanceof WebAssembly.RuntimeError) {
    originalError && originalError.call(console, '[WASM Crash]', event.error.message);
    if (typeof addConsoleLog === 'function') {
      addConsoleLog(`Oyun çöktü: ${event.error.message} — Yeniden bağlanmak için sayfayı yenileyin.`, 'err');
    }

    const alreadyInGame = !!(window.BrowserCSReconnect && window.BrowserCSReconnect.sessionJoined);
    const port = window._browserCSConnectPort || '';
    const retryGuardKey = `_csWasmBootCrashRetried_${port || 'none'}`;
    const canAutoRetry = !alreadyInGame && !sessionStorage.getItem(retryGuardKey);

    if (canAutoRetry) {
      try {
        sessionStorage.setItem(retryGuardKey, '1');
        const pw = window._pendingServerPassword || sessionStorage.getItem('_csLastPw_' + port) || '';
        sessionStorage.setItem('_csAutoConnect', JSON.stringify({
          port: port,
          map: state.currentMap || 'de_dust2',
          password: pw
        }));
        if (typeof notify === 'function') {
          notify('Motor başlarken bir sorun oluştu, otomatik olarak yeniden bağlanılıyor...', 'warn');
        }
        setTimeout(() => window.location.reload(), 600);
        event.preventDefault();
        return;
      } catch (_) { /* sessionStorage yoksa manuel overlay'e düş */ }
    }

    // Kullanıcıya UI mesajı göster (oyun içi crash veya ikinci ardışık boot crash)
    const overlay = document.getElementById('fatal-error-overlay');
    if (overlay) {
      overlay.style.display = 'flex';
      const msg = document.getElementById('fatal-error-msg');
      if (msg) msg.textContent = 'Oyunda bir hata oluştu. Sayfayı yenileyin.';
    }
    event.preventDefault(); // default crash davranışını engelle
  }
});

// Başarılı oyuna giriş — bu port için boot-crash retry kilidini kaldır,
// böylece ileride tekrar (nadiren) olursa bir defa daha otomatik denenebilir.
window.addEventListener('xash3d-ingame', () => {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith('_csWasmBootCrashRetried_')) sessionStorage.removeItem(key);
    }
  } catch (_) { /* ignore */ }
});


// Fix for typing in console input (stop event from bubbling to Emscripten)
document.addEventListener('DOMContentLoaded', () => {
  const consoleInput = document.getElementById('console-input');
  if (consoleInput) {
    consoleInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        if (typeof window.closeConsolePanel === 'function') window.closeConsolePanel();
        else {
          const cp = document.getElementById('console-panel');
          if (cp) cp.classList.remove('open');
          consoleInput.blur();
        }
      }
    });
    // Also stop keyup and keypress
    consoleInput.addEventListener('keyup', (e) => e.stopPropagation());
    consoleInput.addEventListener('keypress', (e) => e.stopPropagation());
  }
});
// ----------------------------------------

// --- OVERRIDE window.alert (Xash3D engine alert suppress) ---
// Xash3D WASM, hata durumunda window.customAlert() çağırıyor.
// Bu tarayıcı diyaloglarını göstermek yerine kendi UI sistemimize yönlendirelim.
const _origAlert = window.alert;
window.alert = function (msg) {
  // "Xash Error" veya "Host_ErrorInit" gibi engine mesajlarını engelle
  const s = String(msg || '');
  if (s.includes('Xash Error') || s.includes('Host_ErrorInit') || s.includes('c0a0') || s.includes('Could not load model')) {
    // Sessizce log'a yaz, alert dialog gösterme
    originalError && originalError.call(console, '[Xash Alert - Suppressed]', s);
    // Sadece kritik hataları console'a yaz
    if (typeof addConsoleLog === 'function') {
      addConsoleLog(`[Engine] ${s}`, 'warn');
    }
    const missingMap = extractMissingMapFromLog(s);
    if (missingMap && typeof recoverMissingMapBsp === 'function') {
      recoverMissingMapBsp(missingMap);
    }
    return;
  }
  // Diğer alertler için orijinal davranış
  _origAlert.call(window, msg);
};
window.confirm = function (msg) {
  // Engine onay diyaloglarını otomatik onayla
  return true;
};
// ----------------------------------------

// --- MONKEY PATCH WEBASSEMBLY MEMORY ---
// Emscripten is hardcoded to 256MB (4096 pages) and ALLOW_MEMORY_GROWTH=0 causes 
// detached ArrayBuffers when it tries to grow. We force the initial memory to 512MB (8192 pages).
const OriginalWebAssemblyMemory = WebAssembly.Memory;
WebAssembly.Memory = function (descriptor) {
  if (descriptor && descriptor.initial === 4096) {
    console.log("[Memory Patch] Forcing WebAssembly Memory from 256MB to 512MB!");
    descriptor.initial = 8192;
    if (descriptor.maximum === 4096) {
      descriptor.maximum = 8192;
    }
  }
  return new OriginalWebAssemblyMemory(descriptor);
};
// ----------------------------------------


// Redirect window console to our HTML console for easier debugging
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

// Verbose browser DevTools logs: ?debug=1 or localStorage.browsercs_debug=1
function isBrowserCSVerboseLogs() {
  try {
    if (window._browserCSVerboseLogs === true) return true;
    if (localStorage.getItem('browsercs_debug') === '1') return true;
    return /(?:^|[?&])debug=1(?:&|$)/.test(location.search || '');
  } catch (_) {
    return false;
  }
}

function browserCSDebugLog(...args) {
  if (isBrowserCSVerboseLogs()) originalLog.apply(console, args);
}

function shouldMirrorConsoleToHud(msg) {
  if (!msg) return false;
  if (msg.includes('[Engine Output]') || msg.includes('[Engine Error]')) return false;
  if (isBrowserCSProtocolLog(msg)) return false;
  // Gürültülü debug / cache satırlarını oyun konsoluna yansıtma
  if (
    /\[Cache\]|\[DEBUG\]|\[Ağ Log|\[Memory\]|\[BuyMenu\]|\[DEBUG VFS\]|\[Konsol\]|\[Browser\]|\[WebRTC\]|WebGL:|ScriptProcessorNode|INVALID_ENUM|Deprecation|AudioWorklet|entry type 'frame'|showscores|emscriptenWebGLGet/i.test(
      msg
    )
  ) {
    return false;
  }
  return true;
}

console.log = function (...args) {
  originalLog.apply(console, args);
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  if (shouldMirrorConsoleToHud(msg) && typeof addConsoleLog === 'function') {
    addConsoleLog(`[Log] ${msg}`);
  }
};

console.warn = function (...args) {
  originalWarn.apply(console, args);
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  if (shouldMirrorConsoleToHud(msg) && typeof addConsoleLog === 'function') {
    addConsoleLog(`[Warn] ${msg}`, 'warn');
  }
};

console.error = function (...args) {
  originalError.apply(console, args);
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  if (shouldMirrorConsoleToHud(msg) && typeof addConsoleLog === 'function') {
    addConsoleLog(`[Error] ${msg}`, 'err');
  }
};

// ==========================================
// Xash3D LZSS Decompression Monkey-Patch
// ==========================================
// By default, the remote client uses LZSS compression but the listen server doesn't 
// expect it and crashes with "clc_bad (76)". This decompressor intercepts UDP packets 
// in JS and safely decompresses them before handing them to the WASM engine.
function lzssDecompress(input) {
  if (input.length <= 8) return input;
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  // 'L', 'Z', 'S', 'S' (4C 5A 53 53) in little endian is 0x53535A4C
  if (view.getUint32(0, true) !== 0x53535A4C) return input; // LZSS_ID
  const actualSize = view.getUint32(4, true);
  if (!actualSize || actualSize > 262144) {
    console.error("[LZSS] Decompress FAILED: Invalid actualSize", actualSize);
    return input;
  }

  const out = new Uint8Array(actualSize);
  let total = 0, getCmd = 0, cmd = 0, inIdx = 8, outIdx = 0, len = input.length;
  while (true) {
    if (!getCmd) {
      if (inIdx >= len) { console.error("[LZSS] Decompress FAILED: inIdx >= len (cmd fetch)", inIdx, len); return null; }
      cmd = input[inIdx++];
    }
    getCmd = (getCmd + 1) & 7;
    if (cmd & 1) {
      if (inIdx >= len) { console.error("[LZSS] Decompress FAILED: inIdx >= len (pos fetch 1)", inIdx, len); return null; }
      let pos = input[inIdx++] << 4;
      if (inIdx >= len) { console.error("[LZSS] Decompress FAILED: inIdx >= len (pos fetch 2)", inIdx, len); return null; }
      pos |= (input[inIdx] >> 4);
      let count = (input[inIdx++] & 15) + 1;
      if (count === 1) break;
      let src = outIdx - pos - 1;
      if (total + count > actualSize || src < 0) {
        console.error(`[LZSS] Decompress FAILED: Out of bounds. total=${total}, count=${count}, actualSize=${actualSize}, src=${src}, outIdx=${outIdx}, pos=${pos}`);
        return null;
      }
      for (let i = 0; i < count; i++) out[outIdx++] = out[src++];
      total += count;
    } else {
      if (total + 1 > actualSize || inIdx >= len) {
        console.error(`[LZSS] Decompress FAILED: Byte copy out of bounds. total=${total}, actualSize=${actualSize}, inIdx=${inIdx}, len=${len}`);
        return null;
      }
      out[outIdx++] = input[inIdx++];
      total++;
    }
    cmd >>= 1;
  }

  if (total !== actualSize) {
    console.error(`[LZSS] Decompress FAILED: Size mismatch. total=${total}, actualSize=${actualSize}`);
    return input;
  }
  return out;
}

// =========================================================================
// FRAGMENT + LZSS DECOMPRESSOR
// Fragment paketleri içindeki LZSS payload'ını tespit edip decompress eder.
// Bu, "client-only" (ayrı sekme) modunda çalışırken, client LZSS ile
// sıkıştırıp gönderdiğinde server'ın bunu anlaması için gereklidir.
// =========================================================================
function decompressFragmentLzss(u8) {
  if (u8.length < 24) return u8;

  // Fragment bit: sequence byte 3'ün bit 6'sı (0x40)
  if ((u8[3] & 0x40) === 0) return u8; // fragment değil

  // LZSS magic'i paketin herhangi bir yerinde ara (offset 12'den sonra)
  let lzssOffset = -1;
  for (let i = 12; i <= u8.length - 8; i++) {
    if (u8[i] === 0x4C && u8[i + 1] === 0x5A && u8[i + 2] === 0x53 && u8[i + 3] === 0x53) {
      lzssOffset = i;
      break;
    }
  }
  if (lzssOffset < 0) return u8; // LZSS yok

  // LZSS payload'ı decompress et
  const lzssPayload = u8.subarray(lzssOffset);
  const decompressed = lzssDecompress(lzssPayload);
  if (!decompressed || decompressed === lzssPayload) return u8;

  // Yeni paket: header (lzssOffset byte) + decompressed payload
  const newPkt = new Uint8Array(lzssOffset + decompressed.length);
  newPkt.set(u8.subarray(0, lzssOffset), 0);
  newPkt.set(decompressed, lzssOffset);

  // ─── KRİTİK: frag_length alanını güncelle ───────────────────────────────
  // Netchan paket yapısı (byte seviyesinde, empirik olarak doğrulandı):
  //   bytes  0- 3: sequence (little-endian uint32)
  //   bytes  4- 7: ack      (little-endian uint32)
  //   bytes  8- 9: qport    (little-endian uint16)
  //   byte  10   : reliable_sequence (bit alanı)
  //   byte  11   : incoming_reliable_ack (bit alanı)
  //   byte  12   : has_frag[0] (FRAG_NORMAL_STREAM)
  //   byte  13   : has_frag[1] (FRAG_FILE_STREAM) = 0x01 signon'da
  //   bytes 14-17: fragid   (little-endian uint32)
  //   bytes 18-19: startpos (little-endian uint16, bit cinsinden)
  //   bytes 19-20: frag_length (little-endian uint16, BİT cinsinden) ← BURADA
  //   bytes 21-23: padding/reserved
  //   bytes 24+  : payload (LZSS veya ham veri)
  //
  // Empirik doğrulama:
  //   27-byte pkt  → bytes19-20 = 18 00 = 24 bit  = 3 byte  payload ✓
  //   139-byte pkt → bytes19-20 = 98 03 = 920 bit = 115 byte payload ✓
  const oldLengthBits = (u8[19] | (u8[20] << 8)); // orijinal (sıkıştırılmış)
  const newLengthBits = decompressed.length * 8;   // yeni (açılmış)
  newPkt[19] = newLengthBits & 0xFF;
  newPkt[20] = (newLengthBits >> 8) & 0xFF;
  // bytes 21-22 muhtemelen 0 ama temizleyelim
  newPkt[21] = 0;
  newPkt[22] = 0;

  console.log(`[LZSS-Frag] ${lzssPayload.length}B→${decompressed.length}B (offset ${lzssOffset}) | frag_length: ${oldLengthBits}→${newLengthBits} bit`);
  return newPkt;
}

/** Cache errno pointer — ccall on every empty poll kills combat FPS. */
Net.prototype._ensureErrnoPtr = function () {
  if (this._errnoPtr) return this._errnoPtr;
  try {
    const ptr = this.em?.Module?.ccall('getErrnoLocation', 'number', [], []);
    if (ptr) this._errnoPtr = ptr;
  } catch (_) { /* ignore */ }
  return this._errnoPtr || 0;
};

Net.prototype._setEagain = function () {
  const errnoPtr = this._ensureErrnoPtr();
  if (errnoPtr) this.em.setValue(errnoPtr, 6, 'i32');
};

/** Reuse TypedArray views of WASM memory; recreate only after grow/detach. */
Net.prototype._heapViews = function () {
  const buffer = window.wasmMemory.buffer;
  if (this._heapBuf !== buffer || !this._heapU8) {
    this._heapBuf = buffer;
    this._heapU8 = new Uint8Array(buffer);
    this._heap8 = new Int8Array(buffer);
    this._heap16 = new Int16Array(buffer);
    this._heap32 = new Int32Array(buffer);
  }
  return this;
};

/** Reuse outbound packet buffers to cut GC from per-packet .slice() */
Net.prototype._outPoolRing = null;
Net.prototype._outPoolIdx = 0;
Net.prototype._allocOutPacket = function (len) {
  if (!this._outPoolRing) {
    // 16 slots: sendtoBatch can emit many packets in one frame
    this._outPoolRing = Array.from({ length: 16 }, () => new Uint8Array(4096));
    this._outPoolIdx = 0;
  }
  let buf = this._outPoolRing[this._outPoolIdx];
  this._outPoolIdx = (this._outPoolIdx + 1) % this._outPoolRing.length;
  if (buf.length < len) {
    buf = new Uint8Array(len);
    const prev = (this._outPoolIdx + this._outPoolRing.length - 1) % this._outPoolRing.length;
    this._outPoolRing[prev] = buf;
  }
  return buf.subarray(0, len);
};

/** Reuse inbound payload buffers (WebRTC allocates a fresh ArrayBuffer every packet) */
Net.prototype._inBytePool = null;
Net.prototype._allocInBytes = function (len) {
  if (!this._inBytePool) this._inBytePool = [];
  let buf = this._inBytePool.pop();
  if (!buf || buf.byteLength < len) {
    buf = new Uint8Array(Math.max(len, 1536));
  }
  return buf;
};
Net.prototype._freeInBytes = function (buf) {
  if (!buf || !this._inBytePool) return;
  if (this._inBytePool.length < 128) this._inBytePool.push(buf);
};

Net.prototype.recvfrom = function (fd, bufPtr, bufLen, flags, sockaddrPtr, socklenPtr) {
  // Net Worker + SAB path (preferred when crossOriginIsolated)
  const bridge = this.sender && this.sender._netBridge;
  if (bridge && bridge.open) {
    const n = bridge.recvPacket(this, bufPtr, bufLen, sockaddrPtr, socklenPtr);
    if (n < 0) {
      this._setEagain();
      return -1;
    }
    return n;
  }

  const packet = this.incoming.pull();
  if (!packet) {
    // xash3d-fwgs 0.2.x: non-blocking empty socket must return EAGAIN
    this._setEagain();
    return -1;
  }
  this._heapViews();
  const data = packet.data;
  let copyLen = 0;
  if (data instanceof ArrayBuffer) {
    copyLen = Math.min(bufLen, data.byteLength);
    if (copyLen > 0) {
      // One short-lived view; bytes go into WASM heap (no second packet alloc)
      this._heapU8.set(new Uint8Array(data, 0, copyLen), bufPtr);
    }
  } else if (data instanceof Uint8Array) {
    copyLen = Math.min(bufLen, data.byteLength);
    if (copyLen > 0) this._heapU8.set(data.subarray(0, copyLen), bufPtr);
  } else if (data && data.length != null) {
    const finalData = new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength || data.length || 0);
    copyLen = Math.min(bufLen, finalData.length);
    if (copyLen > 0) this._heapU8.set(finalData.subarray(0, copyLen), bufPtr);
  }

  if (sockaddrPtr) {
    const port = packet.port;
    this._heap16[sockaddrPtr >> 1] = 2; // AF_INET
    this._heap8[sockaddrPtr + 2] = (port >> 8) & 0xff;
    this._heap8[sockaddrPtr + 3] = port & 0xff;
    this._heap8[sockaddrPtr + 4] = packet.ip[0];
    this._heap8[sockaddrPtr + 5] = packet.ip[1];
    this._heap8[sockaddrPtr + 6] = packet.ip[2];
    this._heap8[sockaddrPtr + 7] = packet.ip[3];
  }
  if (socklenPtr) this._heap32[socklenPtr >> 2] = 16;
  // Recycle envelope + pooled inbound bytes
  if (packet._poolBuf) {
    this._freeInBytes(packet._poolBuf);
    packet._poolBuf = null;
  }
  if (!this._inPktPool) this._inPktPool = [];
  if (this._inPktPool.length < 96) {
    packet.data = null;
    this._inPktPool.push(packet);
  }
  return copyLen;
};

// Override sendto to avoid Detached ArrayBuffer on WebAssembly Memory Grow
Net.prototype.sendto = function (fd, bufPtr, bufLen, flags, sockaddrPtr, socklenPtr) {
  this._heapViews();
  const [ip, port] = this.readSockaddrFast(sockaddrPtr);

  const bridge = this.sender && this.sender._netBridge;
  if (bridge && bridge.open) {
    if (this.sender.isHost) {
      if (!ip || ip[0] === 127) return bufLen;
    } else if (!ip || ip[0] !== 10) {
      return bufLen;
    }
    const ok = bridge.sendPacket(this._heapU8, bufPtr, bufLen, ip, port);
    if (!ok) {
      this._setEagain();
      return -1;
    }
    return bufLen;
  }

  // Pool + copy: DC must not hold a live HEAP view; avoid allocating a new
  // Uint8Array every packet (major GC source for 75↔45 FPS oscillation).
  const packetCopy = this._allocOutPacket(bufLen);
  packetCopy.set(this._heapU8.subarray(bufPtr, bufPtr + bufLen));
  const sent = this.sender.sendto({ data: packetCopy, ip, port });
  if (sent === false) {
    this._setEagain();
    return -1;
  }
  return bufLen;
};

// Override sendtoBatch to avoid Detached ArrayBuffer
Net.prototype.sendtoBatch = function (fd, bufsPtr, lensPtr, count, flags, sockaddrPtr, socklenPtr) {
  this._heapViews();
  let totalSize = 0;
  const [ip, port] = this.readSockaddrFast(sockaddrPtr);

  const bridge = this.sender && this.sender._netBridge;
  if (bridge && bridge.open) {
    if (this.sender.isHost) {
      if (!ip || ip[0] === 127) {
        for (let i = 0; i < count; ++i) totalSize += this._heap32[(lensPtr >> 2) + i];
        return totalSize;
      }
    } else if (!ip || ip[0] !== 10) {
      for (let i = 0; i < count; ++i) totalSize += this._heap32[(lensPtr >> 2) + i];
      return totalSize;
    }
    for (let i = 0; i < count; ++i) {
      const size = this._heap32[(lensPtr >> 2) + i];
      const packetPtr = this._heap32[(bufsPtr >> 2) + i];
      const ok = bridge.sendPacket(this._heapU8, packetPtr, size, ip, port);
      if (!ok) {
        this._setEagain();
        return totalSize > 0 ? totalSize : -1;
      }
      totalSize += size;
    }
    return totalSize;
  }

  for (let i = 0; i < count; ++i) {
    const size = this._heap32[(lensPtr >> 2) + i];
    const packetPtr = this._heap32[(bufsPtr >> 2) + i];
    const slice = this._allocOutPacket(size);
    slice.set(this._heapU8.subarray(packetPtr, packetPtr + size));
    this.sender.sendto({
      data: slice,
      port,
      ip
    });
    totalSize += size;
  }
  return totalSize;
};
// ==========================================// Özel WebSocket Ağ Arabirimi (Multiplayer bağlantıları için)
class Xash3DWebSocket extends Xash3D {
  constructor(opts) {
    super(opts);
    this.net = new Net(this, { maxPackets: 1024 });
    this.ws = null;
    this.connectPort = opts.connectPort || null;
    this.isHost = opts.isHost || false;
    this.packetCountSend = 0;
    this.packetCountRecv = 0;
    this.lastTargetIp = [127, 0, 0, 1];
    this.lastTargetPort = 27015;
    this.dcReady = Promise.resolve();
    this._webrtcTimeoutTimer = null;
    this._dcFailed = false;
    this._suppressDisconnectEvent = false;
    this._connectWsInFlight = null;
    this._ensureDcInFlight = null;
    this._pendingLocalCandidates = [];
    this._netBridge = null;
    this._preferNetWorker = netWorkerEnabled();
    if (this._preferNetWorker) {
      console.info('[Net] SAB OK — inbound worker + main-thread DC');
      browserCSDebugLog('[Net] SAB OK — inbound worker bridge on connect');
    } else {
      console.info('[Net] classic main-thread WebRTC');
    }
  }

  /** Live DC — classic `this.dc` or netBridge owned channel. */
  isDataChannelOpen() {
    return !!(this._netBridge?.open || this.dc?.readyState === 'open');
  }

  /**
   * ICE still negotiating / healthy — do NOT tear down (was causing AWS peer churn:
   * connected → client 10s timeout close → DataChannel kapandı storm).
   */
  isIceStillViable() {
    const pc = this._netBridge?._pc || this.pc;
    if (!pc) return false;
    const ice = pc.iceConnectionState;
    const conn = pc.connectionState;
    if (ice === 'failed' || ice === 'closed') return false;
    if (conn === 'failed' || conn === 'closed') return false;
    return (
      ice === 'new' ||
      ice === 'checking' ||
      ice === 'connected' ||
      ice === 'completed' ||
      ice === 'disconnected' ||
      conn === 'new' ||
      conn === 'connecting' ||
      conn === 'connected' ||
      conn === 'disconnected'
    );
  }

  _cleanupWebRTC() {
    if (this._netBridge) {
      try { this._netBridge.disconnect(); } catch (e) { /* ignore */ }
    }
    if (this._webrtcTimeoutTimer) {
      clearTimeout(this._webrtcTimeoutTimer);
      this._webrtcTimeoutTimer = null;
    }
    if (this._candidateInterval) {
      clearInterval(this._candidateInterval);
      this._candidateInterval = null;
    }
    if (this._keepAliveInterval) {
      clearInterval(this._keepAliveInterval);
      this._keepAliveInterval = null;
    }
    try { this.dc?.close(); } catch (e) { }
    try { this.pc?.close(); } catch (e) { }
    this.dc = null;
    this.pc = null;
    this.peerId = null;
    this._pendingLocalCandidates = [];
  }

  _flushPendingLocalCandidates() {
    if (!this.peerId || !this._pendingLocalCandidates?.length) return;
    const batch = this._pendingLocalCandidates.splice(0);
    for (const c of batch) {
      fetch(`${API_URL}/webrtc/candidate/${this.peerId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate: c.candidate, mid: c.mid })
      }).then(res => {
        if (res.status === 404) this.peerId = null;
      }).catch(() => { });
    }
  }

  _detachDcReady() {
    // Eski promise'i sessizce bırak — reject uncaught error üretmesin
    if (this.dcReady && typeof this.dcReady.catch === 'function') {
      this.dcReady.catch(() => {});
    }
    this._resolveDcReady = null;
    this._rejectDcReady = null;
  }

  _resetWebRTCConnection() {
    this._suppressDisconnectEvent = true;
    this._detachDcReady();
    this._connectWsInFlight = null;
    this._cleanupWebRTC();
    this._dcFailed = false;
    this._suppressDisconnectEvent = false;
  }

  async ensureDcReady(maxWaitMs = 60000) {
    if (this.isDataChannelOpen()) {
      return;
    }

    if (this._ensureDcInFlight) {
      return this._ensureDcInFlight;
    }

    // Windows NAT + TURN: first attempts need a long ICE budget.
    const ATTEMPT_MS = 40000;

    this._ensureDcInFlight = (async () => {
      try {
        const deadline = Date.now() + Math.max(maxWaitMs, 90000);
        let attempt = 0;

        while (Date.now() < deadline) {
          if (this.isDataChannelOpen()) {
            return;
          }

          if (this._connectWsInFlight) {
            await this._connectWsInFlight;
            if (this.isDataChannelOpen()) {
              return;
            }
          }

          attempt += 1;
          const slice = Math.max(
            25000,
            Math.min(ATTEMPT_MS, deadline - Date.now())
          );

          const hadSession = !!(this.pc || this.dc || this._netBridge || this._dcFailed);
          if (hadSession) {
            browserCSDebugLog(`[DEBUG] WebRTC deneme #${attempt}...`);
            if (attempt > 1) {
              addConsoleLog(`[Ağ] Bağlantı yeniden deneniyor (#${attempt})...`, 'warn');
            }
            this._resetWebRTCConnection();
          } else {
            browserCSDebugLog(`[DEBUG] WebRTC ilk bağlantı (#${attempt})...`);
            this._detachDcReady();
          }

          try {
            await this.connectWs({ timeoutMs: slice, quietTimeout: attempt < 3 });
          } catch (_) {
            /* next attempt */
          }

          if (this.isDataChannelOpen()) {
            return;
          }

          this._suppressDisconnectEvent = true;
          try { this._cleanupWebRTC(); } catch (_) { /* ignore */ }
          this._suppressDisconnectEvent = false;
          this._dcFailed = true;

          if (Date.now() >= deadline) break;
          await new Promise((r) => setTimeout(r, 500));
        }

        throw new Error('WebRTC timeout');
      } finally {
        this._ensureDcInFlight = null;
      }
    })();

    return this._ensureDcInFlight;
  }

  async init() {
    await super.init();
    const isRemoteClient = this.connectPort && this.connectPort !== 'listen' && !this.isHost;
    if (isRemoteClient) {
      // Assetler bitene kadar WebRTC kurma — ensureDcReady sonra bağlar.
      // Bekleyen (pending) promise oluşturma: reject → Uncaught (in promise) hatası.
      this.dcReady = Promise.resolve();
      return;
    }
    await this.connectWs();
  }

  async connectWs(opts = {}) {
    const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 28000;
    const quietTimeout = !!opts.quietTimeout;

    if (this.isDataChannelOpen()) {
      return;
    }

    if (this._connectWsInFlight) {
      return this._connectWsInFlight;
    }

    // Preferred: main-thread WebRTC + SAB packet rings (bounded/coalesced EmNet I/O)
    if (this._preferNetWorker) {
      this._connectWsInFlight = (async () => {
        if (!this.connectPort || this.connectPort === 'listen') {
          this.dcReady = Promise.resolve();
          return;
        }

        const sabOk = await workerWebRtcAvailable();
        if (!sabOk) {
          this._preferNetWorker = false;
          console.info('[Net] SharedArrayBuffer unavailable — classic path');
          browserCSDebugLog('[Net] SharedArrayBuffer unavailable — classic path');
          const held = this._connectWsInFlight;
          this._connectWsInFlight = null;
          try {
            await this._connectWsLegacy({ timeoutMs, quietTimeout });
          } finally {
            this._connectWsInFlight = held;
          }
          return;
        }

        const role = this.isHost ? 'host' : 'client';
        browserCSDebugLog(`[DEBUG] Net inbound-worker → port ${this.connectPort} (${role})`);
        addConsoleLog(`[Ağ] WebRTC (inbound worker) bağlanılıyor (${role.toUpperCase()}): port ${this.connectPort}`, 'warn');
        console.info('[Net] inbound-worker connect', { port: this.connectPort, role, api: API_URL });

        this.dcReady = new Promise((resolveDc, rejectDc) => {
          this._resolveDcReady = resolveDc;
          this._rejectDcReady = rejectDc;
        });
        this.dcReady.catch(() => {});

        try {
          if (!this._netBridge) {
            this._netBridge = new BrowserCSNetBridge({
              apiUrl: API_URL,
              isHost: this.isHost,
              connectPort: this.connectPort,
            });
          }
          await this._netBridge.connect(timeoutMs);
          this._dcFailed = false;
          this._resolveDcReady?.();
          addConsoleLog('[Ağ] WebRTC kanalı açık (inbound worker)', 'ok');
          console.info('[Net] channel open (inbound worker + main DC)');
        } catch (err) {
          this._dcFailed = true;
          console.error('[Net] inbound-worker bridge failed — legacy fallback', err);
          if (!quietTimeout) {
            addConsoleLog('[Ağ] WebRTC worker: ' + (err?.message || err), 'warn');
          }
          this._preferNetWorker = false;
          try { this._netBridge?.destroy(); } catch (_) { /* ignore */ }
          this._netBridge = null;
          // Fresh DC promise + full ICE budget for classic path (Windows NAT/TURN).
          this.dcReady = new Promise((resolveDc, rejectDc) => {
            this._resolveDcReady = resolveDc;
            this._rejectDcReady = rejectDc;
          });
          this.dcReady.catch(() => {});
          addConsoleLog('[Ağ] Klasik WebRTC deneniyor...', 'warn');
          const held = this._connectWsInFlight;
          this._connectWsInFlight = null;
          try {
            await this._connectWsLegacy({
              timeoutMs: Math.max(timeoutMs, 35000),
              quietTimeout,
            });
            if (!this.isDataChannelOpen()) {
              throw err instanceof Error ? err : new Error(String(err?.message || err || 'WebRTC timeout'));
            }
          } finally {
            this._connectWsInFlight = held;
          }
        }
      })().finally(() => {
        this._connectWsInFlight = null;
      });
      return this._connectWsInFlight;
    }

    return this._connectWsLegacy(opts);
  }

  async _connectWsLegacy(opts = {}) {
    const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 35000;
    const quietTimeout = !!opts.quietTimeout;

    if (this.dc?.readyState === 'open') {
      return;
    }

    if (this._connectWsInFlight) {
      return this._connectWsInFlight;
    }

    this._connectWsInFlight = new Promise(async (resolve) => {
      if (!this.connectPort || this.connectPort === 'listen') {
        this.dcReady = Promise.resolve();
        resolve();
        return;
      }

      this.dcReady = new Promise((resolveDc, rejectDc) => {
        this._resolveDcReady = resolveDc;
        this._rejectDcReady = rejectDc;
      });
      // Unhandled rejection olmasın
      this.dcReady.catch(() => {});

      const role = this.isHost ? 'host' : 'client';
      browserCSDebugLog(`[DEBUG] Connecting Xash3D Net WebRTC to port ${this.connectPort} (${role})`);
      addConsoleLog(`[Ağ] WebRTC ile bağlanılıyor (${role.toUpperCase()}): port ${this.connectPort}`, 'warn');

      let resolved = false;
      const safeResolve = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };

      const pc = new RTCPeerConnection({
        iceServers: getIceServers(),
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        iceCandidatePoolSize: 8
      });
      this.pc = pc;
      this._pendingLocalCandidates = [];

      // UDP-benzeri: retransmit kuyruğu ateş/combat'ta gecikme yaratıyordu.
      const dc = pc.createDataChannel('xash3d', {
        ordered: false,
        maxRetransmits: 0
      });
      this.dc = dc;
      dc.binaryType = 'arraybuffer';

      dc.onopen = () => {
        browserCSDebugLog('[DEBUG] Net WebRTC DataChannel connected!');
        addConsoleLog('[Ağ] WebRTC UDP-Kanalı bağlantısı başarılı!', 'ok');

        this._dcFailed = false;
        if (this._webrtcTimeoutTimer) {
          clearTimeout(this._webrtcTimeoutTimer);
          this._webrtcTimeoutTimer = null;
        }
        if (this._candidateInterval) {
          clearInterval(this._candidateInterval);
          this._candidateInterval = null;
        }
        this._resolveDcReady?.();
        window.dispatchEvent(
          new CustomEvent('browsercs-connection-state', {
            detail: { state: 'active' }
          })
        );
        // window.stop() burada yok — asset indirme hâlâ sürebilir (netBridge ile aynı)

        // Relay-only keepalive — oyun sunucusuna UDP olarak GİTMEMELİ
        this._keepAliveInterval = setInterval(() => {
          if (this.dc && this.dc.readyState === 'open') {
            try {
              if (!this._keepAlivePkt) {
                this._keepAlivePkt = new Uint8Array([0x00, 0x42, 0x43, 0x53, 0x4B]); // \0BCSK
              }
              this.dc.send(this._keepAlivePkt);
            } catch (e) { /* ignore */ }
          }
        }, 15000);

        safeResolve();
      };

      dc.onerror = (e) => {
        console.error('[DEBUG] Net WebRTC DataChannel error', e);
        addConsoleLog('[Ağ] WebRTC bağlantı hatası!', 'err');
        this._dcFailed = true;
        this._rejectDcReady?.(e);
        safeResolve();
      };

      dc.onclose = () => {
        if (this._keepAliveInterval) clearInterval(this._keepAliveInterval);
        browserCSDebugLog('[DEBUG] Net WebRTC DataChannel closed');
        if (this._suppressDisconnectEvent) {
          return;
        }
        addConsoleLog(`[Ağ] WebRTC bağlantısı kapandı!`, 'err');
        // Mid-game silent death was a dead pipe (lag). Always signal recovery.
        window.dispatchEvent(
          new CustomEvent('browsercs-connection-state', {
            detail: {
              state: 'disconnected',
              reason: 'WebRTC kanalı kapandı',
              forcePipe: !!window.BrowserCSReconnect?.sessionJoined,
            }
          })
        );
      };

      // Hard wait for DC open. Soft-resolve previously returned connectWs while ICE
      // was still connecting → Windows clients got "WebRTC timeout" on retry churn.
      this._webrtcTimeoutTimer = setTimeout(() => {
        if (this.dc?.readyState === 'open') return;
        if (!quietTimeout) {
          addConsoleLog('[Ağ] WebRTC bağlantı zaman aşımı', 'warn');
        } else {
          browserCSDebugLog('[DEBUG] WebRTC attempt timeout — retrying');
        }
        this._dcFailed = true;
        this._rejectDcReady?.(new Error('WebRTC timeout'));
        this._suppressDisconnectEvent = true;
        try { this._cleanupWebRTC(); } catch (_) { /* ignore */ }
        this._suppressDisconnectEvent = false;
        safeResolve();
      }, timeoutMs);

      dc.onmessage = (e) => {
        const raw = e.data;
        if (!raw) return;

        // Copy into pooled bytes immediately so WebRTC's ArrayBuffer can be GC'd
        // in bulk instead of fragmenting the heap (48↔85 FPS dips).
        let srcView;
        if (raw instanceof ArrayBuffer) {
          if (raw.byteLength === 0) return;
          srcView = new Uint8Array(raw);
        } else if (raw instanceof Uint8Array) {
          if (raw.byteLength === 0) return;
          srcView = raw;
        } else if (typeof raw === 'string') {
          if (!raw.length) return;
          srcView = new TextEncoder().encode(raw);
        } else {
          return;
        }

        const poolBuf = this.net._allocInBytes(srcView.byteLength);
        poolBuf.set(srcView, 0);
        const data = poolBuf.subarray(0, srcView.byteLength);

        this.packetCountRecv++;
        if (this.packetCountRecv <= 5) {
          browserCSDebugLog(`[Ağ Log - Alınan #${this.packetCountRecv}] ${data.byteLength} byte`);
        }

        const srcIp = this.isHost ? [10, 0, 0, 2] : [10, 0, 0, 1];
        const clientPort = Number(this.connectPort) || 27015;
        const srcPort = this.isHost ? 27005 : clientPort;

        try {
          let pkt = this.net._inPktPool && this.net._inPktPool.pop();
          if (!pkt) pkt = { ip: null, port: 0, data: null, _poolBuf: null };
          pkt.ip = srcIp;
          pkt.port = srcPort;
          pkt.data = data;
          pkt._poolBuf = poolBuf;
          this.net.incoming.enqueue(pkt);
        } catch (err) {
          this.net._freeInBytes(poolBuf);
          console.error('[Ağ Log] Xash3D enqueue hatası:', err);
        }
      };

      // CRITICAL: candidates often fire before peerId exists — buffer then flush.
      pc.onicecandidate = (e) => {
        if (!e.candidate) return;
        const payload = {
          candidate: e.candidate.candidate,
          mid: e.candidate.sdpMid
        };
        if (!this.peerId) {
          this._pendingLocalCandidates.push(payload);
          return;
        }
        fetch(`${API_URL}/webrtc/candidate/${this.peerId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then(res => {
          if (res.status === 404) this.peerId = null;
        }).catch(() => { });
      };

      pc.oniceconnectionstatechange = () => {
        const st = pc.iceConnectionState;
        browserCSDebugLog('[WebRTC] iceConnectionState:', st);
        if (st === 'failed') {
          addConsoleLog('[Ağ] ICE başarısız — yeniden denenecek', 'warn');
          this._dcFailed = true;
          this._rejectDcReady?.(new Error('ICE failed'));
          safeResolve();
        }
      };

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // Hemen offer gönder — trickle ICE ile adaylar sonra gelir.
        // Eski 1.2s gather beklemesi ilk join'i gereksiz yere geciktiriyordu.
        const res = await fetch(`${API_URL}/webrtc/offer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gamePort: this.connectPort, sdp: pc.localDescription.sdp })
        });

        const data = await res.json().catch(() => ({}));
        if (res.status === 503 || data.code === 'SERVER_STOPPED') {
          throw new Error(data.error || 'Sunucu kapalı');
        }
        if (!res.ok) throw new Error(data.error || ('Signaling server responded with ' + res.status));
        if (data.error) throw new Error(data.error);

        this.peerId = data.peerId;
        this._flushPendingLocalCandidates();
        await pc.setRemoteDescription(new RTCSessionDescription({ type: data.type, sdp: data.sdp }));
        this._flushPendingLocalCandidates();

        // DC açılana kadar sunucu adaylarını çek (ICE connected olsa bile)
        this._candidateInterval = setInterval(async () => {
          if (!this.pc || this.pc !== pc) {
            clearInterval(this._candidateInterval);
            this._candidateInterval = null;
            return;
          }
          if (this.dc?.readyState === 'open') {
            clearInterval(this._candidateInterval);
            this._candidateInterval = null;
            return;
          }
          if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
            clearInterval(this._candidateInterval);
            this._candidateInterval = null;
            return;
          }
          try {
            if (!this.peerId) return;
            const cRes = await fetch(`${API_URL}/webrtc/candidates/${this.peerId}`);
            if (!cRes.ok) return;
            const cands = await cRes.json();
            for (let c of cands) {
              await pc.addIceCandidate(new RTCIceCandidate({ candidate: c.candidate, sdpMid: c.mid })).catch(() => { });
            }
          } catch (err) { /* ignore */ }
        }, 200);

      } catch (err) {
        console.error('[WebRTC] Signaling Hatası:', err);
        addConsoleLog('[Ağ] WebRTC Signaling Hatası: ' + err.message, 'err');
        this._rejectDcReady?.(err);
        safeResolve();
      }
    }).finally(() => {
      this._connectWsInFlight = null;
    });

    return this._connectWsInFlight;
  }

  sendto(packet) {
    if (packet.ip) this.lastTargetIp = packet.ip;
    if (packet.port) this.lastTargetPort = packet.port;

    if (!this.dc || this.dc.readyState !== 'open') return false;

    const ip = packet.ip;

    if (this.isHost) {
      // HOST (Listen Server) mode
      if (!ip || ip[0] === 127) return false;
    } else {
      // CLIENT mode
      if (!ip || ip[0] !== 10) return false;
    }

    this.packetCountSend++;
    if (this.packetCountSend <= 20) {
      const dest = ip ? ip.join('.') : '?';
      browserCSDebugLog(`[Ağ Log - Gönderilen #${this.packetCountSend}] ${packet.data.byteLength} byte → ${dest}:${packet.port}`);
    }

    // Net.prototype.sendto havuzdan Uint8Array verir — DC.send TypedArray kabul eder.
    // buffer.slice() her pakette yeni allocation = GC salınımı; yapma.
    try {
      const data = packet.data;
      if (data instanceof ArrayBuffer) {
        this.dc.send(data);
      } else if (ArrayBuffer.isView(data)) {
        this.dc.send(data);
      } else {
        this.dc.send(data);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

}

window.Xash3DWebSocket = Xash3DWebSocket;

// ─── Durum — shared via game/state.js ────────────────────────────────────────

// --- Progress Helper for Large Downloads with Cache API ---
async function fetchWithProgress(url, label) {
  const cacheName = 'cs-assets-cache-v1';
  let cache;
  try {
    cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(url);
    if (cachedResponse) {
      addLoadingLog(`⚡ ${label} (Önbellekten saniyesinde yükleniyor...)`, 'ok');
      return await cachedResponse.arrayBuffer();
    }
  } catch (err) {
    console.warn('Cache API kullanılamıyor:', err);
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';

    let lastUpdate = 0;

    xhr.onprogress = (event) => {
      if (event.lengthComputable) {
        const now = Date.now();
        if (now - lastUpdate > 100) { // Saniyede en fazla 10 kez güncelle
          lastUpdate = now;
          const percent = Math.round((event.loaded / event.total) * 100);
          const loadedMB = (event.loaded / (1024 * 1024)).toFixed(1);
          const totalMB = (event.total / (1024 * 1024)).toFixed(1);
          const msg = `⬇️ ${label}: %${percent} (${loadedMB}MB / ${totalMB}MB)`;

          const splash = document.getElementById('splash-status');
          if (splash && splash.parentElement.style.opacity !== '0') {
            splash.textContent = msg;
          }
          addLoadingLog(msg, 'warn');
        }
      }
    };

    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (cache) {
          try {
            // İndirilen dosyayı bir dahaki sefere hızlı yüklemek için önbelleğe kaydet
            const responseToCache = new Response(xhr.response);
            await cache.put(url, responseToCache);
          } catch (e) {
            console.warn('Önbelleğe yazılamadı:', e);
          }
        }
        resolve(xhr.response); // ArrayBuffer
      } else {
        reject(new Error(`${url} indirilemedi (HTTP ${xhr.status})`));
      }
    };

    xhr.onerror = () => {
      reject(new Error(`${url} ağ hatası nedeniyle indirilemedi`));
    };

    xhr.send();
  });
}

// ── XASH3D BAŞLATMA MANTIĞI ─────────────────────────────────────────────────────────────────────
const splashEl = $('splash');
const splashBar = $('splash-bar');
const splashStatus = $('splash-status');
const engineDot = $('engine-dot');
const engineStatusTxt = $('engine-status-text');
const mapList = $('map-list');
const mapSearch = $('map-search');
const previewPanel = $('preview-panel');
const noMapState = $('no-map-state');
const mapCard = $('map-card');
const cardMapName = $('card-map-name');
const cardMapType = $('card-map-type');
const cardMapDesc = $('card-map-desc');
const btnLaunch = $('btn-launch');
const gameWrapper = $('game-wrapper');
const gameCanvas = $('canvas');
const toolbarMapName = $('toolbar-map-name');
const fpsDisplay = $('fps-display');
const loadingOverlay = $('loading-overlay');
const loadingMapName = $('loading-map-name');
const loadingProgress = $('loading-progress-fill');
const loadingLog = $('loading-log');
const consolePanel = $('console-panel');
const consoleLog = $('console-log');
const consoleInput = $('console-input');
const btnConsole = $('btn-console');
const btnCopyConsole = $('btn-copy-console');
const btnDownloadQConsole = $('btn-download-qconsole');
const mapCountInfo = $('map-count-info');
const tabMaps = $('tab-maps');
const tabServers = $('tab-servers');
const tabRank = $('tab-rank');
const tabAdmin = $('tab-admin');


const serverList = $('server-list');
const rankPanel = $('rank-panel');
const btnCreateServer = $('btn-create-server');
const adminPanel = $('admin-panel');
const activeServersContainer = $('active-servers-container');
let _rankTakipUnmount = null;

const userNicknameInput = $('user-nickname');
const serverNameInput = $('server-name-input');
const maxPlayersSelect = $('max-players-select');
const fullServerBrowser = $('full-server-browser');
const fullServersGrid = $('full-active-servers-grid');
const btnCloseServerBrowser = $('btn-close-server-browser');
const btnRefreshServers = $('btn-refresh-servers');
const onlineServersCount = $('online-servers-count');

if (userNicknameInput) {
  userNicknameInput.value = localStorage.getItem('cs_nickname') || '';
  userNicknameInput.addEventListener('input', () => {
    localStorage.setItem('cs_nickname', userNicknameInput.value.trim() || '');
  });
}

function requirePlayableNickname(raw) {
  const nickname = String(raw || '').trim();
  if (!nickname) {
    window.customAlert('Lütfen oyuna girmeden önce bir oyuncu adı belirleyin!');
    return null;
  }
  const nickErr = validatePublicNickname(nickname, { userId: getCurrentUser()?.id || null });
  if (nickErr) {
    window.customAlert(nickErr);
    return null;
  }
  return nickname;
}


// ─── Yardımcılar ─────────────────────────────────────────────────────────────

function setSplash(msg, pct) {
  splashStatus.textContent = msg;
  splashBar.style.width = `${pct}%`;
}

function setEngineStatus(msg, state = 'orange') {
  engineStatusTxt.textContent = msg;
  engineDot.className = `status-dot ${state}`;
}

function addConsoleLog(msg, cls = '') {
  // DOM elementinin hazır olup olmadığını kontrol et (Erken log yönlendirmesinde çökmeyi önler)
  if (isBrowserCSProtocolLog(String(msg || ''))) return;

  try {
    if (typeof consoleLog === 'undefined' || !consoleLog) {
      originalLog.apply(console, [`[Erken Log] ${msg}`]);
      return;
    }
    const p = document.createElement('p');
    p.className = `log-line ${cls}`;
    p.textContent = msg;
    consoleLog.appendChild(p);
    // Ring buffer: sınırsız DOM büyümesi FPS yer
    while (consoleLog.children.length > 200) {
      consoleLog.removeChild(consoleLog.firstChild);
    }
    consoleLog.scrollTop = consoleLog.scrollHeight;
  } catch (e) {
    originalError.apply(console, ['addConsoleLog hatası:', e]);
  }
}
window.addConsoleLog = addConsoleLog;



function stripConsoleQuotes(value) {
  const v = String(value || '').trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

function normalizeConsoleCommand(rawCmd) {
  const trimmed = String(rawCmd || '').trim();
  if (!trimmed) {
    return { commands: [], meta: null };
  }

  const nameMatch = trimmed.match(/^name\s+(.+)$/i);
  if (nameMatch) {
    const nick = stripConsoleQuotes(nameMatch[1]).replace(/["\\]/g, '').slice(0, 31);
    if (!nick) {
      return {
        commands: [],
        meta: { kind: 'error', message: 'Geçerli bir isim yaz: name "YeniIsim"' }
      };
    }
    const nickErr = validatePublicNickname(nick, { userId: getCurrentUser()?.id || null });
    if (nickErr) {
      return {
        commands: [],
        meta: { kind: 'error', message: nickErr }
      };
    }
    return {
      commands: [`name "${nick}"`, `setinfo name "${nick}"`],
      meta: { kind: 'name', name: nick }
    };
  }

  const setinfoMatch = trimmed.match(/^setinfo\s+(\S+)\s+(.+)$/i);
  if (setinfoMatch) {
    const key = setinfoMatch[1];
    const value = stripConsoleQuotes(setinfoMatch[2]).replace(/"/g, '');
    return {
      commands: [`setinfo ${key} "${value}"`],
      meta: { kind: 'setinfo', key, value }
    };
  }

  // Sunucu-only komutlar client konsolundan çalışmaz
  if (/^(sv_restart|restart|changelevel|map|kick|ban)\b/i.test(trimmed)) {
    return {
      commands: [trimmed],
      meta: {
        kind: 'server-only',
        message:
          `"${trimmed.split(/\s+/)[0]}" sunucu komutudur. Client konsolundan çalışmaz — YÖNET panelini veya RCON kullan.`
      }
    };
  }

  // AMXX menü/komutları sunucuya açıkça iletilsin
  if (/^amx[_a-z0-9]/i.test(trimmed) || /^amxmodmenu$/i.test(trimmed)) {
    const mapMatch = trimmed.match(/\bchangelevel\s+([a-zA-Z0-9_]+)/i);
    return {
      commands: [trimmed, `cmd ${trimmed}`],
      meta: {
        kind: 'amx',
        command: trimmed,
        preloadMap: mapMatch ? mapMatch[1] : null
      }
    };
  }

  return { commands: [trimmed], meta: null };
}

function runEngineCommandRaw(cmd) {
  if (!state.xash || !state.xash.em) {
    console.warn('[Konsol] Komut gönderilemedi, engine hazır değil:', cmd);
    return false;
  }
  if (!state.engineRunning) {
    console.warn('[Konsol] Engine henüz Cmd_Init tamamlamadı, komut ertelendi:', cmd);
    return false;
  }
  if (state.xash.exited) {
    console.warn('[Konsol] Engine kapalı, komut yok sayıldı:', cmd);
    return false;
  }

  const command = cmd.endsWith('\n') ? cmd : `${cmd}\n`;

  try {
    const em = state.xash.em;
    const asm = em.asm || (em.Module && em.Module.asm);

    if (asm && typeof asm.Cmd_ExecuteString === 'function' && typeof asm.malloc === 'function' && typeof asm.free === 'function') {
      const length = command.length + 1;
      const ptr = asm.malloc(length);
      if (ptr) {
        const heap = em.HEAPU8 || (em.Module && em.Module.HEAPU8) || (asm.memory && new Uint8Array(asm.memory.buffer));
        if (heap) {
          const view = new Uint8Array(heap.buffer || heap);
          for (let i = 0; i < command.length; i++) {
            view[ptr + i] = command.charCodeAt(i);
          }
          view[ptr + command.length] = 0;

          asm.Cmd_ExecuteString(ptr);
          asm.free(ptr);
          browserCSDebugLog(`[Konsol] direct-wasm-asm: ${cmd}`);
          return true;
        }
      }
    }

    const func = em._Cmd_ExecuteString || (em.Module && em.Module._Cmd_ExecuteString);
    const malloc = em._malloc || (em.Module && em.Module._malloc);
    const free = em._free || (em.Module && em.Module._free);
    if (typeof func === 'function' && typeof malloc === 'function' && typeof free === 'function') {
      const length = command.length + 1;
      const ptr = malloc(length);
      if (ptr) {
        const heap = em.HEAPU8 || (em.Module && em.Module.HEAPU8);
        const view = new Uint8Array(heap.buffer || heap);
        for (let i = 0; i < command.length; i++) {
          view[ptr + i] = command.charCodeAt(i);
        }
        view[ptr + command.length] = 0;
        func(ptr);
        free(ptr);
        browserCSDebugLog(`[Konsol] direct-wasm-export: ${cmd}`);
        return true;
      }
    }

    if (typeof em.ccall === 'function') {
      em.ccall('Cmd_ExecuteString', null, ['string'], [command]);
      browserCSDebugLog(`[Konsol] em.ccall: ${cmd}`);
      return true;
    }

    if (em.Module && typeof em.Module.ccall === 'function') {
      em.Module.ccall('Cmd_ExecuteString', null, ['string'], [command]);
      browserCSDebugLog(`[Konsol] em.Module.ccall: ${cmd}`);
      return true;
    }

    if (typeof state.xash.Cmd_ExecuteString === 'function') {
      state.xash.Cmd_ExecuteString(command);
      browserCSDebugLog(`[Konsol] Cmd_ExecuteString: ${cmd}`);
      return true;
    }
  } catch (e) {
    // WASM Host_Error bazen sayı (Infinity) fırlatır — stringify et
    const msg = e && typeof e === 'object' && 'message' in e ? e.message : String(e);
    if (msg === 'Infinity' || msg === 'NaN') {
      console.error('[Konsol] Engine abort (Mem/Cmd). Komut:', cmd);
    } else {
      console.error('[Konsol] Komut çalıştırma hatası:', e, 'cmd=', cmd);
    }
  }
  return false;
}

// Güvenli konsol komutu çalıştırma yardımcısı
window.executeEngineCommand = function executeEngineCommand(cmd) {
  const { commands, meta } = normalizeConsoleCommand(cmd);

  if (meta?.kind === 'error') {
    addConsoleLog(meta.message, 'err');
    if (typeof notify === 'function') notify(meta.message, 'error');
    return;
  }

  if (meta?.kind === 'server-only') {
    addConsoleLog(meta.message, 'warn');
    if (typeof notify === 'function') notify(meta.message, 'warn');
  }

  if (meta?.kind === 'name') {
    try {
      localStorage.setItem('cs_nickname', meta.name);
      if (userNicknameInput) userNicknameInput.value = meta.name;
    } catch (e) { /* ignore */ }
    addConsoleLog(`İsim güncellendi: ${meta.name}`, 'ok');
    if (typeof notify === 'function') {
      notify(`İsim: ${meta.name}`, 'success');
    }
  }

  if (meta?.kind === 'amx') {
    addConsoleLog(
      'AMXX komutu gönderildi. Menü açılmazsa bu sunucuda admin değilsindir (setinfo _pw + amx_admins).',
      'warn'
    );
  }

  const runCommands = () => {
    for (const c of commands) {
      runEngineCommandRaw(c);
    }
  };

  // Admin changelevel: önce client VFS'ye BSP yaz, sonra sunucuya komutu gönder
  if (meta?.preloadMap) {
    ensureMapBspInVfs(meta.preloadMap).then((ok) => {
      if (!ok) {
        addConsoleLog(`Harita VFS'ye yüklenemedi: ${meta.preloadMap}`, 'err');
        if (typeof notify === 'function') {
          notify(`Harita indirilemedi: ${meta.preloadMap}`, 'error');
        }
        return;
      }
      runCommands();
    });
    return;
  }

  runCommands();
};

function appendBrowserCSPerfConfig(cfgBuffer) {
  // HTML skorboard TAB olayının tek sahibidir. Native +showscores'u kapat.
  // Mouse teker duck — tüm oyuncular için sabit.
  let extra =
    '\nunbind "TAB"\nbind "TAB" ""\n' +
    'bind "MWHEELDOWN" "+duck"\n' +
    'bind "MWHEELUP" "+duck"\n' +
    'bind "y" "messagemode"\n' +
    'bind "u" "messagemode2"\n' +
    'cl_righthand "1"\n';
  if (window._browserCSTouchControls) {
    extra +=
      'touch_enable "1"\n' +
      'touch_emulate "0"\n' +
      'exec touch_defalias.cfg\n' +
      'exec touch.cfg\n';
  } else {
    extra += 'touch_enable "0"\ntouch_emulate "0"\n';
  }
  let base = cfgBuffer && cfgBuffer.length ? cfgBuffer : new Uint8Array(0);
  try {
    const text = new TextDecoder().decode(base);
    const stripped = text
      .replace(/^\s*bind\s+"?TAB"?\s+.+$/gim, '')
      .replace(/^\s*bind\s+"?tab"?\s+.+$/gim, '')
      .replace(/^\s*bind\s+"?MWHEELUP"?\s+.+$/gim, '')
      .replace(/^\s*bind\s+"?MWHEELDOWN"?\s+.+$/gim, '')
      .replace(/^\s*bind\s+"?mwheelup"?\s+.+$/gim, '')
      .replace(/^\s*bind\s+"?mwheeldown"?\s+.+$/gim, '')
      .replace(/^\s*touch_enable\s+.+$/gim, '')
      .replace(/^\s*touch_emulate\s+.+$/gim, '')
      // Eski/farkli deger tasiyan cl_righthand satirlarini temizle; dogru
      // deger asagidaki extra blokta tek sefer yazilir.
      .replace(/^\s*cl_righthand\s+.+$/gim, '');
    base = new TextEncoder().encode(stripped);
  } catch (_) {
    /* keep original bytes */
  }
  const guardBytes = new TextEncoder().encode(extra);
  const merged = new Uint8Array(base.length + guardBytes.length);
  merged.set(base, 0);
  merged.set(guardBytes, base.length);
  return merged;
}

window.BrowserCSReconnect = BrowserCSReconnect;

window.addEventListener(
  "browsercs-connection-state",
  (event) => {
    const state = event.detail?.state;

    if (state === "disconnected") {
      // WebRTC asset indirme sırasında ısıtılır. Bu aşamadaki ICE kapanması
      // kullanıcıya reconnect ekranı göstermemeli — forcePipe (oyun içi DC ölüm) hariç.
      if (!window._browserCSAssetsReady && !event.detail?.forcePipe) return;
      BrowserCSReconnect.start(
        event.detail?.reason ||
          "Sunucu bağlantısı kesildi.",
        { forcePipe: !!event.detail?.forcePipe }
      );
      return;
    }

    if (state === "active") {
      if (typeof addConsoleLog === "function") {
        addConsoleLog("[Ağ] WebRTC kanalı açık — sunucu oturumu bekleniyor...", "ok");
      }
      return;
    }

    if (state === "non-retryable") {
      BrowserCSReconnect.nonRetryable(
        event.detail?.reason || ""
      );
    }
  }
);

window.addEventListener(
  "xash3d-ws-closed",
  () => {
    if (!window._browserCSAssetsReady) return;
    BrowserCSReconnect.start(
      "Ağ bağlantısı beklenmedik şekilde kapandı."
    );
  }
);

window.addEventListener("browsercs-gameui-blocked", (event) => {
  const action = event.detail?.action || "menu";

  // Sadece kullanıcı bilinçli çıkış yaptığında lobiye dön.
  // set-active-menu / main-menu bağlantı akışında da tetiklenir — reconnect BAŞLATMA.
  if (action === "quit") {
    if (typeof window.leaveBrowserCSServer === "function") {
      window.leaveBrowserCSServer({ message: "BrowserCS menüsüne dönülüyor..." });
    } else {
      location.reload();
    }
  }
});

function addLoadingLog(msg, cls = '') {
  // exposed for game/engine.js
  const p = document.createElement('p');
  if (cls) p.className = cls;
  p.textContent = msg;
  loadingLog.appendChild(p);
  loadingLog.scrollTop = loadingLog.scrollHeight;
}

function setProgress(pct, msg) {
  if (loadingProgress) loadingProgress.style.width = `${pct}%`;
  const pctEl = document.getElementById('loading-pct-text');
  if (pctEl) pctEl.textContent = `${Math.round(pct)}%`;

  const titleEl = document.getElementById('loading-title');
  const statusEl = document.getElementById('loading-status');
  const phaseEl = document.getElementById('loading-phase');
  const overlay = document.getElementById('loading-overlay');
  const text = String(msg || '');
  const lower = text.toLowerCase();

  const isNetwork =
    pct >= 92 ||
    /webrtc|ağ|sunucu|bağlan/i.test(lower);
  const isReady = pct >= 100 || /tamamlandı|hazır/i.test(lower);

  if (overlay) {
    overlay.classList.toggle('phase-network', isNetwork && !isReady);
    overlay.classList.toggle('phase-ready', isReady);
  }
  if (titleEl) {
    titleEl.textContent = isReady
      ? 'HAZIR'
      : (isNetwork ? 'SUNUCUYA BAĞLANILIYOR' : 'DOSYALAR İNDİRİLİYOR');
  }
  if (phaseEl) {
    phaseEl.textContent = isReady ? 'HAZIR' : (isNetwork ? 'AĞ' : 'PAKET');
  }
  if (statusEl && text) {
    statusEl.textContent = text;
  }

  if (msg) addLoadingLog(msg, pct >= 90 || isReady ? 'ok' : '');
}

window.ensureMapBspInVfs = ensureMapBspInVfs;
// ─── FPS Sayacı ───────────────────────────────────────────────────────────────

/** Mobilde telefon ekranının otomatik kararmasını engelle (Screen Wake Lock). */
let _bcsWakeLock = null;
let _bcsWakeLockWanted = false;

async function requestBrowserCSWakeLock() {
  _bcsWakeLockWanted = true;
  if (typeof navigator === 'undefined' || !navigator.wakeLock?.request) return;
  if (document.visibilityState !== 'visible') return;
  try {
    if (_bcsWakeLock) return;
    _bcsWakeLock = await navigator.wakeLock.request('screen');
    _bcsWakeLock.addEventListener('release', () => {
      _bcsWakeLock = null;
    });
  } catch (_) {
    // Kullanıcı izni / güç tasarrufu — sessizce yoksay
    _bcsWakeLock = null;
  }
}

async function releaseBrowserCSWakeLock() {
  _bcsWakeLockWanted = false;
  try {
    await _bcsWakeLock?.release?.();
  } catch (_) { /* ignore */ }
  _bcsWakeLock = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && _bcsWakeLockWanted && state.engineRunning) {
    requestBrowserCSWakeLock();
  }
});

window.__bcsRequestWakeLock = requestBrowserCSWakeLock;
window.__bcsReleaseWakeLock = releaseBrowserCSWakeLock;

let _fpsCounterStarted = false;
function startFPSCounter() {
  if (_fpsCounterStarted) return;
  _fpsCounterStarted = true;
  requestBrowserCSWakeLock();

  let rafCount = 0;
  let rafLast = performance.now();
  function rafLoop() {
    if (!state.engineRunning) {
      _fpsCounterStarted = false;
      releaseBrowserCSWakeLock();
      return;
    }
    if (!document.hidden) {
      rafCount++;
      const now = performance.now();
      if (now - rafLast >= 1000) {
        if (fpsDisplay) fpsDisplay.textContent = `${rafCount} FPS`;
        const ramDisplay = document.getElementById('ram-display');
        if (ramDisplay && performance && performance.memory) {
          const mb = Math.round(performance.memory.usedJSHeapSize / (1024 * 1024));
          ramDisplay.textContent = `${mb} MB RAM`;
        }
        rafCount = 0;
        rafLast = now;
      }
    } else {
      rafLast = performance.now();
      rafCount = 0;
    }
    requestAnimationFrame(rafLoop);
  }
  requestAnimationFrame(rafLoop);
}

window.toggleConsole = toggleConsole;
window.openConsolePanel = () => toggleConsole(true);
window.closeConsolePanel = () => toggleConsole(false);
function updateTeamSizes() {
  const maxP = maxPlayersSelect ? parseInt(maxPlayersSelect.value) : 16;
  const half = Math.floor(maxP / 2);
  const ctTeamName = document.getElementById('ct-team-capacity') || document.querySelector('.team-card.ct .team-name');
  const tTeamName = document.getElementById('t-team-capacity') || document.querySelector('.team-card.t .team-name');
  const vsBadge = document.getElementById('vs-badge-text') || document.querySelector('.vs-badge');

  if (ctTeamName) ctTeamName.textContent = `${half} Oyuncu`;
  if (tTeamName) tTeamName.textContent = `${half} Oyuncu`;
  if (vsBadge) vsBadge.textContent = `${half}v${half}`;
}
// --- MOCK AUTHENTICATION SYSTEM (Supabase öncesi) ---
const btnLogin = $('btn-login');
const btnRegister = $('btn-register');
const btnLogout = $('btn-logout');
const btnBuyPremium = $('btn-buy-premium');
const authSection = $('auth-section');
const userProfileSection = $('user-profile-section');
const userDisplayName = $('user-display-name');
const badgePremium = $('badge-premium');
const premiumModal = $('premium-modal');

// Removed dummy login and logout logic (handled by auth.js)
if (btnBuyPremium) {
  btnBuyPremium.addEventListener('click', async () => {
    const user = getCurrentUser();
    if (!user) {
      if (premiumModal) premiumModal.style.display = 'none';
      window.openAuthGate('Premium sunucu almak i\u00e7in kay\u0131t olman\u0131z veya giri\u015f yapman\u0131z gerekmektedir.');
      return;
    }

    const btn = btnBuyPremium;
    const origText = btn.textContent;
    btn.textContent = 'HAZIRLANIYOR...';
    btn.disabled = true;

    try {
      if (isUserAdmin()) {
        const sName = (await window.customPrompt('Sunucu Adı Girin:', 'CS 1.5 Özel Sunucu', 'SUNUCU ADI')) || 'CS 1.5 Özel Sunucu';
        const sMap = (await window.customPrompt('Harita Seçin:', 'de_dust2', 'HARİTA SEÇ')) || 'de_dust2';
        const sRcon = (await window.customPrompt('RCON Şifresi Belirleyin:', 'admin123', 'RCON ŞİFRESİ')) || 'admin';

        notify('Admin: AWS üzerinde sunucunuz başlatılıyor...', 'success');

        const token = await getSessionToken();
        const res = await fetch(`${API_URL}/api/start-server`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ map: sMap, maxplayers: 16, name: sName, host: 'bymTL', rconPassword: sRcon })
        });

        const d = await res.json();
        if (d.success && d.port) {
          notify(`AWS Sunucunuz aktif edildi! Port: ${d.port}`, 'success');
          if (premiumModal) premiumModal.style.display = 'none';
          if (window.refreshDashboard) window.refreshDashboard();
          if (window.loadServerList) window.loadServerList();
        } else {
          notify('AWS Sunucusu açılamadı! ' + (d.error || ''), 'error');
        }
        return;
      }

      if (typeof window.promptAndCreateRentalOrder === 'function') {
        await window.promptAndCreateRentalOrder();
        if (premiumModal) premiumModal.style.display = 'none';
        if (window.refreshDashboard) window.refreshDashboard();
      } else {
        const { data, error } = await buyServer(user.id, 'CS 1.5 Sunucu Kiralama', 'de_dust2', 16);
        if (error) throw error;
        if (window.showIbanPaymentModal) {
          window.showIbanPaymentModal(data.order, data.payment, data.instruction);
        }
        if (premiumModal) premiumModal.style.display = 'none';
      }
    } catch (err) {
      notify('Hata: ' + (err?.message || err), 'error');
    } finally {
      btn.textContent = origText;
      btn.disabled = false;
    }
  });
}
// ---------------------------------------------------
if (maxPlayersSelect) {
  maxPlayersSelect.addEventListener('change', updateTeamSizes);
}

// ── Hızlı Katıl ──────────────────────────────────────────────────────────────
const btnQuickJoin = document.getElementById('btn-quick-join');
if (btnQuickJoin) {
  btnQuickJoin.addEventListener('click', async () => {
    if (!currentMap) { notify('Önce bir harita seçin!', 'error'); return; }

    btnQuickJoin.disabled = true;
    btnQuickJoin.textContent = 'SUNUCU ARANIYOR...';

    try {
      // Mevcut sunucuları listele
      const res = await fetch(`${API_URL}/api/servers`);
      const data = await res.json();
      const servers = data.servers || [];

      // Seçili haritayla eşleşen aktif sunucu ara
      let target = servers.find(s => s.map === currentMap && s.state === 'running');
      if (!target) {
        // Harita yoksa herhangi bir aktif sunucuya katıl
        target = servers.find(s => s.state === 'running');
      }

      if (target) {
        notify(`"${target.name}" sunucusuna bağlanıyor...`, 'success');
        // Sifre gerekiyorsa once sor
        if (target.hasPassword) {
          const pw = await window.openServerJoinPasswordModal(target.port, target.name);
          if (pw === null) { btnQuickJoin.disabled = false; btnQuickJoin.textContent = '▶ SUNUCUYA KATIL'; return; }
          window._pendingServerPassword = pw;
          sessionStorage.setItem('_csLastPw_' + target.port, pw);
        }
        if (!getCurrentUser()) {
          const guestNick = await window.openGuestNameModal(target.port, target.map);
          if (!guestNick) { btnQuickJoin.disabled = false; btnQuickJoin.textContent = '▶ SUNUCUYA KATIL'; return; }
        }
        window._motdServerMeta = { serverName: target.name, mapName: target.map };
        window.connectToServer(target.port, target.map, false);
      } else {
        // Hiç sunucu yoksa — varsayılan port 27015'e bağlan
        notify(`${currentMap} için sunucu bulunamadı. Varsayılan porta bağlanılıyor...`, 'warn');
        window._motdServerMeta = { serverName: 'BrowserCS Official', mapName: currentMap };
        window.connectToServer(27015, currentMap, false);
      }
    } catch (e) {
      console.error(e);
      // API hatası — doğrudan 27015'e bağlan
      notify('Sunucu listesi alınamadı. Doğrudan bağlanılıyor...', 'warn');
      window.connectToServer(27015, currentMap, false);
    } finally {
      btnQuickJoin.disabled = false;
      btnQuickJoin.textContent = '▶ SUNUCUYA KATIL';
    }
  });
}

btnLaunch.addEventListener('click', async () => {
  if (!currentMap) { notify('Önce bir harita seçin!', 'error'); return; }

  if (!getCurrentUser()) {
    const loginModal = document.getElementById('login-modal');
    if (loginModal) loginModal.style.display = 'flex';
    notify('Oda kurmak için önce üye girişi yapmalısınız!', 'error');
    return;
  }

  if (!isUserPremium()) {
    if (premiumModal) premiumModal.style.display = 'flex';
    return;
  }

  // Arayüz butonunu dondur
  btnLaunch.disabled = true;
  const originalText = btnLaunch.textContent;
  btnLaunch.textContent = 'SUNUCU OLUŞTURULUYOR...';

  const sName = (serverNameInput && serverNameInput.value.trim()) ? serverNameInput.value.trim() : 'CS 1.5 Web Oda';
  const nickname = (userNicknameInput && userNicknameInput.value.trim()) ? userNicknameInput.value.trim() : '';
  if (!nickname) {
    notify('Sunucu kurmadan önce bir oyuncu adı yazın!', 'error');
    btnLaunch.disabled = false;
    btnLaunch.textContent = originalText;
    return;
  }
  const maxP = maxPlayersSelect ? parseInt(maxPlayersSelect.value) : 16;

  try {
    const token = await getSessionToken();
    const res = await fetch(`${API_URL}/api/start-server`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ map: currentMap, maxplayers: maxP, name: sName, host: nickname })
    });
    const data = await res.json();

    if (data.success) {
      notify(`"${data.name || sName}" kuruldu! Port: ${data.port}`, 'success');
      if (window.refreshDashboard) window.refreshDashboard();
      if (window.loadServerList) loadServerList();
      window.connectToServer(data.port, data.map || currentMap, false);
    } else {
      notify('Sunucu başlatılamadı: ' + (data.error || ''), 'error');
      btnLaunch.disabled = false;
      btnLaunch.textContent = originalText;
    }
  } catch (e) {
    console.error(e);
    notify('Sunucu kurma hatası!', 'error');
    btnLaunch.disabled = false;
    btnLaunch.textContent = originalText;
  }
});

// Sunucu Listesi Yükleme (Hem Mini Liste hem Tam Sayfa Grid)
async function loadServerList() {
  try {
    if (activeServersContainer) {
      activeServersContainer.innerHTML = '<div style="font-family: var(--font-hud); font-size:0.7rem; color: var(--text-dim); padding: 20px; text-align: center; width: 100%; grid-column: 1 / -1;">Sunucu aranıyor...</div>';
    }
    if (fullServersGrid) {
      fullServersGrid.innerHTML = '<div style="font-family: var(--font-hud); font-size:0.9rem; color: var(--text-dim); padding: 40px; text-align: center; width: 100%; grid-column: 1 / -1;">Sunucular yükleniyor...</div>';
    }

    const res = await fetch(`${API_URL}/api/servers`);
    const data = await res.json();

    window.__loadedServers = data.servers || [];

    if (onlineServersCount) {
      const runningCount = (data.servers || []).filter(s => s.state === 'running').length;
      onlineServersCount.textContent = `(${runningCount} Açık Oda)`;
    }

    if (data.servers && data.servers.length > 0) {
      if (activeServersContainer) activeServersContainer.innerHTML = '';
      if (fullServersGrid) fullServersGrid.innerHTML = '';

      const officialServers = [];
      const rentalServers = [];

      data.servers.forEach(server => {
        let displayName = server.name;
        let displayHost = server.host || 'Anonim';
        let badgeText = '🟢 CANLI P2P';
        let playersCount = server.players !== undefined ? server.players : '?';
        let isOfficialFinal = false;
        let isDeathmatchFinal = isDeathmatchServer(server);
        const isOnline = server.state === 'running' && !!server.port;

        if (isDeathmatchFinal) {
          displayName = server.name?.replace(/^BROWSERCS\s*\|\s*/i, '') || 'Deathmatch';
          displayHost = 'BrowserCS (Resmi)';
          badgeText = isOnline ? '⭐ RESMİ SUNUCU' : '⏸ KAPALI';
          isOfficialFinal = true;
        } else if (server.isOfficial === true) {
          displayName = server.name?.replace(/^BROWSERCS\s*\|\s*/i, '') || 'BrowserCS';
          displayHost = 'BrowserCS (Resmi)';
          if (server.vipOnly) {
            badgeText = isOnline ? '♛ VIP ODA' : '⏸ KAPALI';
            displayHost = 'VIP ODA · Gold/Platinum';
          } else {
            badgeText = isOnline ? '⭐ RESMİ SUNUCU' : '⏸ KAPALI';
          }
          isOfficialFinal = true;
        } else if (server.isOfficial === false) {
          displayHost = server.host || 'Kiralık Sunucu';
          badgeText = isOnline ? '🏠 KİRALIK' : '⏸ KAPALI';
        } else if (displayName.startsWith('CS Server') && (!server.host || server.host === 'Anonim')) {
          displayName = 'BrowserCS';
          displayHost = 'BrowserCS (Resmi)';
          badgeText = isOnline ? '⭐ RESMİ SUNUCU' : '⏸ KAPALI';
          isOfficialFinal = true;
        } else if (!isOnline) {
          badgeText = '⏸ KAPALI';
        }

        const srvObj = { ...server, displayName, displayHost, badgeText, playersCount, isOfficialFinal, isDeathmatchFinal, isOnline };
        if (isOfficialFinal) officialServers.push(srvObj);
        else rentalServers.push(srvObj);
      });

      officialServers.sort((a, b) => {
        if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
        const aVip = !!a.vipOnly;
        const bVip = !!b.vipOnly;
        if (aVip !== bVip) return aVip ? -1 : 1;
        if (a.isDeathmatchFinal && !b.isDeathmatchFinal) return -1;
        if (!a.isDeathmatchFinal && b.isDeathmatchFinal) return 1;
        return (a.port || 0) - (b.port || 0);
      });
      rentalServers.sort((a, b) => {
        if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
        return (a.port || 0) - (b.port || 0);
      });

      const appendCategoryHeader = (container, title, color, marginTop = '0') => {
        const header = document.createElement('div');
        header.className = 'server-category-header';
        header.style.gridColumn = '1 / -1';
        header.style.alignSelf = 'start';
        header.style.fontFamily = 'var(--font-hud)';
        header.style.fontSize = '0.85rem';
        header.style.color = color;
        header.style.borderBottom = `2px solid ${color}`;
        header.style.paddingBottom = '0.5rem';
        header.style.marginTop = marginTop;
        header.style.marginBottom = '0.25rem';
        header.style.letterSpacing = '0.05em';
        header.style.textTransform = 'uppercase';
        header.textContent = title;
        container.appendChild(header);
      };

      const renderGridItem = (server, container, isMini) => {
        const mapImgUrl = `${ASSET_URL}/assets/maps/${server.map}.jpg`;
        const defaultImgUrl = `${ASSET_URL}/cs-assets/cs_bg.png`;

        if (isMini) {
          const div = document.createElement('div');
          div.className = 'map-item';
          div.style.flexDirection = 'column';
          div.style.alignItems = 'stretch';
          div.style.background = 'var(--bg-card)';
          div.style.border = '1px solid var(--border-bright)';
          div.style.padding = '0.6rem';
          div.style.marginBottom = '0.6rem';
          div.style.boxShadow = '0 2px 8px rgba(0,0,0,0.4)';
          if (!server.isOnline) {
            div.style.opacity = '0.55';
            div.style.filter = 'grayscale(0.35)';
          }
          const miniModePill = buildModePill(server, true);
          const miniLockPill = server.hasPassword
            ? '<span style="background:rgba(255,204,0,0.15);border:1px solid rgba(255,204,0,0.4);color:#ffcc00;font-size:0.5rem;font-weight:700;letter-spacing:0.08em;padding:1px 5px;border-radius:3px;text-transform:uppercase;">🔒 ŞİFRELİ</span>'
            : '';
          const miniVipPill = server.vipOnly
            ? '<span style="background:rgba(255,215,0,0.16);border:1px solid rgba(255,215,0,0.45);color:#ffd700;font-size:0.5rem;font-weight:700;letter-spacing:0.08em;padding:1px 5px;border-radius:3px;text-transform:uppercase;">♛ VIP ODA</span>'
            : '';
          const miniStatus = server.isOnline
            ? `<div style="position:absolute; bottom:4px; right:4px; background:rgba(0,0,0,0.8); padding:2px 6px; border-radius:4px; font-size:0.75rem; color:#4caf50; font-weight:bold; border: 1px solid #4caf50; z-index:5;">👤 ${server.playersCount}/${server.maxplayers}</div>`
            : `<div style="position:absolute; bottom:4px; right:4px; background:rgba(0,0,0,0.85); padding:2px 6px; border-radius:4px; font-size:0.7rem; color:#f87171; font-weight:bold; border: 1px solid #f87171; z-index:5;">KAPALI</div>`;
          div.innerHTML = `
            <div style="position: relative; width: 100%; height: 80px; overflow: hidden; border-radius: 4px; border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; background: var(--bg-deep);">
              <img crossorigin="anonymous" src="${mapImgUrl}" alt="Server" style="position:absolute; inset:0; width: 100%; height: 100%; object-fit: cover; opacity: 0.5;" onerror="this.onerror=null; this.src='${defaultImgUrl}';" />
              <div style="position:absolute; inset:0; background:linear-gradient(to bottom,rgba(10,16,26,0.1),var(--bg-card)); pointer-events:none;"></div>
              <span class="server-thumb-map-text" style="z-index:5; font-size: 0.95rem;">${server.map}</span>
              ${miniStatus}
            </div>
            <div style="font-weight: bold; color: var(--text-bright); text-align: center; margin-top: 6px; font-size: 0.85rem;">${server.displayName}</div>
            <div style="display:flex;flex-wrap:wrap;gap:3px;justify-content:center;margin-top:4px;">
              ${miniModePill}${miniVipPill}${miniLockPill}
            </div>
          `;
          div.addEventListener('click', async () => {
            if (!server.isOnline) {
              notify('Bu sunucu şu an kapalı.', 'error');
              return;
            }
            if (!(await window.ensureVipRoomAccess(server))) return;
            window._motdServerMeta = { serverName: server.name || server.displayName, mapName: server.map, serverId: server.serverId || server.id, owner_id: server.owner_id, mode: server.mode, gameMode: server.gameMode };
            window._browserCSIsDeathmatch = isDeathmatchServer(server);
            // Sifre gerekiyorsa modal aç
            if (server.hasPassword) {
              const pw = await window.openServerJoinPasswordModal(server.port, server.name || server.displayName);
              if (pw === null) return;
              window._pendingServerPassword = pw;
              sessionStorage.setItem('_csLastPw_' + server.port, pw);
            }
            if (!getCurrentUser()) {
              const guestNick = await window.openGuestNameModal(server.port, server.map);
              if (!guestNick) return;
              window.connectToServer(server.port, server.map, false);
            } else {
              window.connectToServer(server.port, server.map, false);
            }
            if (typeof fullServerBrowser !== 'undefined' && fullServerBrowser) fullServerBrowser.classList.remove('active');
          });
          container.appendChild(div);
        } else {
          const card = document.createElement('div');
          card.className = 'server-card-box anim-fade-in';
          if (!server.isOnline) {
            card.style.opacity = '0.6';
            card.style.filter = 'grayscale(0.3)';
          }
          // Mode pill: match=red, normal=green
          const modePill = buildModePill(server, false);
          const lockPill = server.hasPassword
            ? `<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(255,204,0,0.12);border:1px solid rgba(255,204,0,0.35);color:#ffcc00;font-family:var(--font-hud);font-size:0.55rem;font-weight:700;letter-spacing:0.1em;padding:2px 7px;border-radius:3px;text-transform:uppercase;">🔒 ŞİFRELİ</span>`
            : '';
          const vipPill = server.vipOnly
            ? `<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(255,215,0,0.14);border:1px solid rgba(255,215,0,0.4);color:#ffd700;font-family:var(--font-hud);font-size:0.55rem;font-weight:700;letter-spacing:0.1em;padding:2px 7px;border-radius:3px;text-transform:uppercase;">♛ VIP ODA</span>`
            : '';
          const joinLabel = server.isOnline ? '▶ ODAYA KATIL' : '⏸ KAPALI';
          const joinStyle = server.isOnline
            ? 'flex:1;'
            : 'flex:1;background:var(--bg-deep);border:1px solid var(--border);color:var(--text-dim);cursor:not-allowed;opacity:0.85;';
          card.innerHTML = `
            <div class="server-card-thumb" style="position: relative;">
              <img crossorigin="anonymous" src="${mapImgUrl}" style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover; opacity:0.6; z-index:0;" onerror="this.onerror=null; this.src='${defaultImgUrl}';" />
              <span class="server-badge-live" style="z-index:2;${server.isOnline ? '' : 'background:rgba(120,20,20,0.85);border-color:#f87171;'}">${server.badgeText}</span>
              <span class="server-thumb-map-text" style="z-index:2;">${server.map}</span>
            </div>
            <div class="server-card-body">
              <div class="server-card-name">${server.displayName}</div>
              <div style="display:flex;flex-wrap:wrap;gap:4px;margin:4px 0 6px;">
                ${modePill}${vipPill}${lockPill}
              </div>
              <div class="server-card-meta">
                <span>🗺️ ${server.map}</span>
                <span>${server.isOnline ? `👤 ${server.playersCount}/${server.maxplayers} Oyuncu` : '⏸ Kapalı'}</span>
              </div>
              <div style="font-size:0.72rem; color:var(--text-dim); margin-top:3px;">👑 Kurucu: <b>${server.displayHost}</b></div>
              <div style="display:flex; gap:0.4rem; margin-top:0.4rem;">
                <button class="btn-join-room" style="${joinStyle}" ${server.isOnline ? '' : 'disabled'}>${joinLabel}</button>
                ${(server.owner_id && getCurrentUser() && server.owner_id === getCurrentUser().id) ?
              `<button class="btn-join-room" style="background:var(--bg-deep); border:1px solid var(--border-bright); color:var(--text-bright); padding:0 0.8rem; font-size:1rem;" title="Sunucu Ayarları" onclick="openServerSettings('${server.serverId || server.id}')">⚙️</button>`
              : ''}
              </div>
            </div>
          `;
          const joinBtn = card.querySelector('.btn-join-room');
          joinBtn.addEventListener('click', async () => {
            if (!server.isOnline) {
              notify('Bu sunucu şu an kapalı.', 'error');
              return;
            }
            if (!(await window.ensureVipRoomAccess(server))) return;
            window._motdServerMeta = { serverName: server.name, mapName: server.map, serverId: server.serverId || server.id, owner_id: server.owner_id, mode: server.mode, gameMode: server.gameMode };
            window._browserCSIsDeathmatch = isDeathmatchServer(server);

            // Sifre gerekiyorsa temali modal goster
            if (server.hasPassword) {
              const pw = await window.openServerJoinPasswordModal(server.port, server.name);
              if (pw === null) return; // iptal veya 3 yanlis deneme
              // Engine hazir olunca inject edilecek
              window._pendingServerPassword = pw;
            }

            if (!getCurrentUser()) {
              const guestNick = await window.openGuestNameModal(server.port, server.map);
              if (!guestNick) return;
              window.connectToServer(server.port, server.map, false);
            } else {
              window.connectToServer(server.port, server.map, false);
            }
            if (typeof fullServerBrowser !== 'undefined' && fullServerBrowser) fullServerBrowser.classList.remove('active');
          });
          container.appendChild(card);
        }
      };

      if (activeServersContainer) {
        officialServers.forEach(s => renderGridItem(s, activeServersContainer, true));
        rentalServers.forEach(s => renderGridItem(s, activeServersContainer, true));
      }

      if (fullServersGrid) {
        if (officialServers.length > 0) {
          appendCategoryHeader(fullServersGrid, '⭐ BrowserCS Resmi Sunucuları', 'var(--cs-yellow)');
          officialServers.forEach(s => renderGridItem(s, fullServersGrid, false));
        }

        if (rentalServers.length > 0) {
          appendCategoryHeader(fullServersGrid, '🏠 Kiralık Sunucular', 'var(--text-dim)', officialServers.length > 0 ? '2rem' : '0');
          rentalServers.forEach(s => renderGridItem(s, fullServersGrid, false));
        }
      }

    } else {
      if (activeServersContainer) {
        activeServersContainer.innerHTML = '<div style="font-family: var(--font-hud); font-size:0.7rem; color: var(--text-dim); padding: 20px; text-align: center; width: 100%; grid-column: 1 / -1;">Açık sunucu bulunamadı.</div>';
      }
      if (fullServersGrid) {
        fullServersGrid.innerHTML = `
          <div style="font-family: var(--font-hud); font-size:0.9rem; color: var(--text-dim); padding: 60px 20px; text-align: center; width: 100%; grid-column: 1 / -1; background: var(--bg-card); border-radius: 8px; border: 1px dashed var(--border-bright);">
            <div style="font-size: 2.5rem; margin-bottom: 10px;">🌐</div>
            <div style="color: var(--text-bright); font-size: 1.2rem; font-weight: bold; margin-bottom: 8px;">Henüz Açık Sunucu Yok</div>
            <div>Harita seçerek kendi odanızı kurabilir ve arkadaşlarınızı çağırabilirsiniz!</div>
          </div>
        `;
      }
    }
  } catch (e) {
    console.error('Server list error:', e);
    if (activeServersContainer) activeServersContainer.innerHTML = '<div style="color: var(--cs-red); font-size: 0.7rem; padding: 20px; text-align: center;">Sunucular yüklenemedi.</div>';
  }
}

window.loadServerList = loadServerList;

function setSidebarTab(which) {
  if (tabServers) tabServers.classList.toggle('active', which === 'servers');
  if (tabMaps) tabMaps.classList.toggle('active', which === 'maps');
  if (tabRank) tabRank.classList.toggle('active', which === 'rank');
  if (mapList) mapList.style.display = which === 'maps' ? 'block' : 'none';
  if (serverList) serverList.style.display = which === 'servers' ? 'block' : 'none';
  if (rankPanel) rankPanel.style.display = which === 'rank' ? 'block' : 'none';
  if (typeof mapSearch !== 'undefined' && mapSearch) {
    mapSearch.style.display = which === 'maps' ? 'block' : 'none';
  }
  if (fullServerBrowser) {
    if (which === 'servers') fullServerBrowser.classList.add('active');
    else fullServerBrowser.classList.remove('active');
  }
  if (which !== 'rank' && _rankTakipUnmount) {
    _rankTakipUnmount();
    _rankTakipUnmount = null;
  }
}

if (tabServers && tabMaps) {
  tabServers.addEventListener('click', () => {
    setSidebarTab('servers');
    loadServerList();
  });

  tabMaps.addEventListener('click', () => {
    setSidebarTab('maps');
  });
}

if (tabRank && rankPanel) {
  tabRank.addEventListener('click', async () => {
    setSidebarTab('rank');
    if (!_rankTakipUnmount) {
      const { mountRankTakipPanel } = await import('./rank-takip/rankTakip.js');
      _rankTakipUnmount = mountRankTakipPanel({
        selectEl: $('rank-server-select'),
        tableEl: $('rank-table'),
        statusEl: $('rank-status'),
        pollMs: 10000,
      });
    }
  });
}

if (btnCloseServerBrowser) {
  btnCloseServerBrowser.addEventListener('click', () => {
    if (fullServerBrowser) fullServerBrowser.classList.remove('active');
    if (tabServers && tabMaps) {
      tabServers.classList.add('active');
      tabMaps.classList.remove('active');
      mapList.style.display = 'none';
      serverList.style.display = 'flex';
      mapSearch.style.display = 'none';
    }
  });
}

// ─── SERVER SETTINGS (lazy-loaded) ───────────────────────────────────────────
let _serverSettingsPromise = null;
async function ensureServerSettings() {
  if (!_serverSettingsPromise) _serverSettingsPromise = import('./ui/serverSettings.js');
  return _serverSettingsPromise;
}
window.openServerSettings = async function (...args) {
  const mod = await ensureServerSettings();
  return mod.openServerSettings(...args);
};

// ─── MASTER ADMIN (lazy-loaded) ──────────────────────────────────────────────
// Extracted to ./admin/masterAdmin.js — loaded only when ?admin=1 or #csadmin

async function maybeInitMasterAdmin() {
  if (!(window.location.search.includes('admin=1') || window.location.hash === '#csadmin')) return;
  const { initMasterAdmin } = await import('./admin/masterAdmin.js');
  initMasterAdmin({ API_URL, $, notify, supabase, getSessionToken });
}

document.addEventListener('DOMContentLoaded', () => {
  maybeInitMasterAdmin();
});

// ── Sidebar Admin Panel Butonları (Gerçek RCON) ─────────────────────────────
const btnAdminChangeMap = $('btn-admin-changemap');
const btnAdminSetPass = $('btn-admin-setpass');
const btnAdminRestart = $('btn-admin-restart');
const btnAdminStop = $('btn-admin-stop');

// Helper: aktif container ID bul
async function getActiveContainerId() {
  try {
    const res = await fetch(`${API_URL}/api/servers`);
    const data = await res.json();
    // Çalışan sunuculardan ilkini döndür (resmi olmayan, eğer varsa kendi sunucusu)
    const activeServers = (data.servers || []).filter(s => s.state === 'running');
    return activeServers.length > 0 ? activeServers[0].id : null;
  } catch (e) { return null; }
}

if (btnAdminChangeMap) {
  btnAdminChangeMap.addEventListener('click', async () => {
    const mapSelect = $('admin-map-select');
    const map = mapSelect ? mapSelect.value : 'de_dust2';
    const rconPass = await window.customPrompt('RCON Şifresi girin:', 'RCON Gerekli');
    if (!rconPass) return;
    const containerId = await getActiveContainerId();
    if (!containerId) { notify('Aktif sunucu bulunamadı!', 'error'); return; }
    try {
      notify(`Harita indiriliyor: ${map}...`, 'info');
      const bspOk = await ensureMapBspInVfs(map);
      if (!bspOk) {
        notify(`Harita indirilemedi, map change iptal: ${map}`, 'error');
        return;
      }
      const token = await getSessionToken();
      const r = await fetch(`${API_URL}/api/servers/${containerId}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
        body: JSON.stringify({ rconPassword: rconPass, command: `changelevel ${map}` })
      });
      const d = await r.json();
      if (d.success) notify(`Harita değiştirildi: ${map}`, 'success');
      else notify('RCON hatası: ' + d.error, 'error');
    } catch (e) { notify('Bağlantı hatası!', 'error'); }
  });
}

if (btnAdminSetPass) {
  btnAdminSetPass.addEventListener('click', async () => {
    const passInput = $('admin-rcon-pass');
    const pass = passInput ? passInput.value : '';
    const rconPass = await window.customPrompt('Mevcut RCON Şifresi girin:', 'RCON Gerekli');
    if (!rconPass) return;
    const containerId = await getActiveContainerId();
    if (!containerId) { notify('Aktif sunucu bulunamadı!', 'error'); return; }
    try {
      const token = await getSessionToken();
      const cmd = pass ? `sv_password "${pass}"` : 'sv_password ""';
      const r = await fetch(`${API_URL}/api/servers/${containerId}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
        body: JSON.stringify({ rconPassword: rconPass, command: cmd })
      });
      const d = await r.json();
      if (d.success) notify(`Sunucu şifresi ayarlandı: ${pass ? pass : '(Şifresiz)'}`, 'success');
      else notify('RCON hatası: ' + d.error, 'error');
    } catch (e) { notify('Bağlantı hatası!', 'error'); }
  });
}

if (btnAdminRestart) {
  btnAdminRestart.addEventListener('click', async () => {
    if (!await window.customConfirm('Sunucu yeniden başlatılsın mı?', 'ONAY')) return;
    const rconPass = await window.customPrompt('RCON Şifresi girin:', 'RCON Gerekli');
    if (!rconPass) return;
    const containerId = await getActiveContainerId();
    if (!containerId) { notify('Aktif sunucu bulunamadı!', 'error'); return; }
    try {
      const token = await getSessionToken();
      const r = await fetch(`${API_URL}/api/servers/${containerId}/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) }
      });
      const d = await r.json();
      if (d.success) notify('Sunucu yeniden başlatılıyor...', 'warn');
      else notify('Yeniden başlatma hatası: ' + d.error, 'error');
    } catch (e) { notify('Bağlantı hatası!', 'error'); }
  });
}

if (btnAdminStop) {
  btnAdminStop.addEventListener('click', async () => {
    if (!await window.customConfirm('Sunucuyu durdurmak istediğine emin misin? Bu işlem geri alınamaz!', 'DİKKAT')) return;
    const containerId = await getActiveContainerId();
    if (!containerId) { notify('Aktif sunucu bulunamadı!', 'error'); return; }
    try {
      const token = await getSessionToken();
      const adminTok = sessionStorage.getItem('cs_master_admin_token');
      const r = await fetch(`${API_URL}/api/admin/servers/${containerId}`, {
        method: 'DELETE',
        headers: { 'x-admin-token': adminTok || '', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) }
      });
      const d = await r.json();
      if (d.success) { notify('Sunucu kapatıldı!', 'error'); loadServerList(); }
      else notify('Kapatma hatası: ' + d.error, 'error');
    } catch (e) { notify('Bağlantı hatası!', 'error'); }
  });
}

if (btnRefreshServers) {
  btnRefreshServers.addEventListener('click', () => {
    loadServerList();
    notify('Sunucu listesi yenilendi.', 'info');
  });
}

if (btnCreateServer) {
  btnCreateServer.addEventListener('click', async () => {
    if (!getCurrentUser()) {
      window.openAuthGate('\u00d6zel sunucu olu\u015fturmak i\u00e7in kay\u0131t olman\u0131z veya giri\u015f yapman\u0131z gerekmektedir.');
      return;
    }
    if (!isUserPremium()) {
      if (premiumModal) premiumModal.style.display = 'flex';
      return;
    }

    try {
      const mapToPlay = currentMap || 'de_dust2';
      btnCreateServer.disabled = true;
      btnCreateServer.textContent = 'KURULUYOR...';

      const sName = (serverNameInput && serverNameInput.value.trim()) ? serverNameInput.value.trim() : 'CS 1.5 Web Oda';
      const nickname = (userNicknameInput && userNicknameInput.value.trim()) ? userNicknameInput.value.trim() : '';
      if (!nickname) {
        notify('Lütfen bir oyuncu adı belirleyin!', 'error');
        btnCreateServer.disabled = false;
        btnCreateServer.textContent = 'ODA KUR';
        return;
      }
      const maxP = maxPlayersSelect ? parseInt(maxPlayersSelect.value) : 16;

      const token = await getSessionToken();
      const res = await fetch(`${API_URL}/api/start-server`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ map: mapToPlay, maxplayers: maxP, name: sName, host: nickname })
      });
      const data = await res.json();

      if (data.success) {
        notify(`"${data.name}" kuruldu!`, 'success');
        loadServerList();
        if (fullServerBrowser) fullServerBrowser.classList.remove('active');
        // Otomatik bağlan
        setTimeout(() => window.connectToServer(data.port, data.map || mapToPlay, true), 500);
      } else {
        notify('Sunucu kurulamadı!', 'error');
      }
    } catch (e) {
      console.error(e);
      notify('Sunucu kurma hatası!', 'error');
    } finally {
      btnCreateServer.disabled = false;
      btnCreateServer.textContent = '+ YENİ SUNUCU KUR';
    }
  });
}

window.__bcsAddLoadingLog = (msg, cls) => addLoadingLog(msg, cls);
window.__bcsAddConsoleLog = (msg, cls) => addConsoleLog(msg, cls);
window.__bcsSetEngineStatus = (msg, st) => setEngineStatus(msg, st);
window.__bcsSetProgress = (pct, msg) => setProgress(pct, msg);
window.__bcsFetchWithProgress = (url, label) => fetchWithProgress(url, label);
window.__bcsAppendPerfConfig = (buf) => appendBrowserCSPerfConfig(buf);
window.__bcsStartFPSCounter = () => startFPSCounter();
window.__bcsRunEngineCommandRaw = (cmd) => runEngineCommandRaw(cmd);
window.__bcsDebugLog = (...args) => browserCSDebugLog(...args);

// ─── INIT ─────────────────────────────────────────────────────────────────────

async function checkWasmFiles() {
  return true;
}

async function runSplash() {
  setSplash('Sistem başlatılıyor...', 5);
  // Safety: after 6 seconds force splash away even if something failed
  const splashTimeout = setTimeout(() => {
    if (splashEl && splashEl.parentNode) {
      splashEl.style.opacity = '0';
      setTimeout(() => { if (splashEl && splashEl.parentNode) splashEl.remove(); }, 500);
    }
  }, 6000);
  await new Promise(r => setTimeout(r, 200));

  // Grafik desteği kontrolü
  setSplash('Tarayıcı kontrol ediliyor...', 20);
  const testCanvas = document.createElement('canvas');
  const hasWebGL2 = !!testCanvas.getContext('webgl2');
  if (!hasWebGL2) {
    notify('⚠ Tarayıcınız oyunu desteklemiyor. Chrome veya Firefox’un güncel sürümünü kullanın.', 'error');
  }

  // SharedArrayBuffer kontrolü
  setSplash('Tarayıcı güvenliği kontrol ediliyor...', 35);
  const hasSAB = typeof SharedArrayBuffer !== 'undefined';
  const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
  const wantNetWorker = netWorkerEnabled();
  const sabBridgeOk = wantNetWorker ? await workerWebRtcAvailable() : false;
  const useNetWorker = wantNetWorker && sabBridgeOk;
  window._browserCSNetMode = useNetWorker ? 'sab' : 'classic';
  window._browserCSIsolated = !!isolated;
  if (!hasSAB || !isolated) {
    notify('⚠ SharedArrayBuffer / isolation yok — SAB köprüsü kapalı, klasik WebRTC.', 'warn');
  } else if (wantNetWorker && !sabBridgeOk) {
    browserCSDebugLog('[Net] isolation OK — SAB bridge unavailable, klasik path');
    console.info('[Net] SAB bridge unavailable — classic path');
  } else if (useNetWorker) {
    browserCSDebugLog('[Net] crossOriginIsolated OK — inbound worker AÇIK');
    console.info('[Net] inbound worker enabled (main-thread DataChannel)');
  } else {
    browserCSDebugLog('[Net] isolation OK — SAB bridge kullanıcı tarafından kapalı (networker=0)');
  }


  // Asset server bağlantısı
  setSplash('Sunucuya bağlanılıyor...', 50);
  const serverOk = await loadMapList();

  setSplash('Oyun dosyaları kontrol ediliyor...', 75);
  // WASM dosyaları /wasm/ altında — public/ statik olarak serve edilir
  // const wasmOk = await checkWasmFiles();
  const wasmOk = true;

  if (serverOk && wasmOk) {
    setSplash('Her şey hazır!', 100);
    clearTimeout(splashTimeout);
    setTimeout(() => {
      splashEl.style.opacity = '0';
      setTimeout(() => { if (splashEl && splashEl.parentNode) splashEl.remove(); }, 500);
      renderMapList();
      // Site açılınca sunucu menüsünü otomatik göster
      setTimeout(() => {
        if (tabServers) tabServers.click();
      }, 600);
    }, 800);
  } else {
    clearTimeout(splashTimeout);
    splashStatus.innerHTML = '<span style="color:var(--cs-red);">Hata: Eksik dosyalar veya bağlantı sorunu var!</span>';
    // Still allow users to use the site after 3s even if something failed
    setTimeout(() => {
      if (splashEl && splashEl.parentNode) {
        splashEl.style.opacity = '0';
        setTimeout(() => { if (splashEl && splashEl.parentNode) splashEl.remove(); }, 500);
      }
    }, 3000);
  }
}
// ── WELCOME MOTD OVERLAY ───────────────────────────────────────────────────
let _motdTimer = null;
window.showWelcomeMOTD = function (serverName, mapName) {
  const overlay = document.getElementById('welcome-motd');
  if (!overlay) return;
  // Alanları doldur
  const svEl = document.getElementById('motd-server-name');
  const mapEl = document.getElementById('motd-map-name');
  if (svEl) svEl.textContent = serverName || 'BrowserCS Official';
  if (mapEl) mapEl.textContent = mapName || '—';
  // Göster
  overlay.classList.remove('hiding');
  overlay.classList.add('visible');
  // Progress bar animasyonu
  const bar = document.getElementById('motd-progress-bar');
  const cd = document.getElementById('motd-countdown');
  if (bar) { bar.style.transition = 'none'; bar.style.width = '100%'; setTimeout(() => { bar.style.transition = 'width 15s linear'; bar.style.width = '0%'; }, 30); }
  // Countdown
  let sec = 15;
  if (cd) cd.textContent = `${sec} sn`;
  clearInterval(_motdTimer);
  _motdTimer = setInterval(() => {
    sec--;
    if (cd) cd.textContent = `${sec} sn`;
    if (sec <= 0) { clearInterval(_motdTimer); window.dismissWelcomeMOTD(); }
  }, 1000);
};
window.dismissWelcomeMOTD = function () {
  clearInterval(_motdTimer);
  const overlay = document.getElementById('welcome-motd');
  if (!overlay) return;
  overlay.classList.add('hiding');
  setTimeout(() => { overlay.classList.remove('visible', 'hiding'); }, 420);
};

/** VIP ODA join gate — Gold/Platinum required (web UX; AMXX also kicks). */
window.ensureVipRoomAccess = async function ensureVipRoomAccess(server) {
  const need = String(server?.vipOnly || '').toLowerCase();
  if (!need || !['silver', 'gold', 'platinum'].includes(need)) return true;

  const rank = { none: 0, silver: 1, gold: 2, platinum: 3 };
  const needRank = rank[need] || 2;

  if (!getCurrentUser()) {
    notify('VIP ODA için giriş yapıp Gold veya Platinum VIP olmalısın.', 'error');
    if (typeof window.customAlert === 'function') {
      window.customAlert(
        'Bu oda sadece Gold ve Platinum VIP üyeler içindir.\nGiriş yapıp VIP paketini al, sonra tekrar dene.',
        'VIP ODA'
      );
    }
    return false;
  }

  try {
    const token = await getSessionToken();
    const res = await fetch(`${API_URL}/api/me/vip`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = await res.json();
    const tier = String(data?.vip?.tier || 'none').toLowerCase();
    const active = !!data?.vip?.active;
    if (active && (rank[tier] || 0) >= needRank) return true;
  } catch (_) {
    /* fall through */
  }

  notify('VIP ODA — Gold veya Platinum gerekli.', 'error');
  if (typeof window.customAlert === 'function') {
    window.customAlert(
      'VIP ODA’ya sadece aktif Gold veya Platinum VIP girebilir.\nPaketler: /vip',
      'VIP ODA'
    );
  }
  return false;
};

window.connectToServer = async function (port, mapName, isHost = false) {
  const banMsg = getBanBlockMessage();
  if (banMsg) {
    if (typeof window.customAlert === 'function') window.customAlert(banMsg, 'HESAP YASAKLI');
    else alert(banMsg);
    return;
  }
  if (state.engineRunning) {
    // WebRTC relay kapanmis olabilir. En guvenilir cozum:
    // baglanti bilgisini sessionStorage'a kaydet + sayfayi yenile.
    if (!isHost && port) {
      const pw = window._pendingServerPassword || sessionStorage.getItem('_csLastPw_' + port);
      sessionStorage.setItem('_csAutoConnect', JSON.stringify({
        port: port,
        map: mapName || 'de_dust2',
        password: pw || ''
      }));
      if (typeof notify === 'function') notify('Sunucuya bağlanmak için yeniden yükleniyor...', 'ok');
      setTimeout(function() { window.location.reload(); }, 800);
    } else {
      window.customAlert('Oyun zaten açık! Lütfen sayfayı yenileyip tekrar deneyin.');
    }
    return;
  }

  // AMXX helpers live in lazy serverSettings module
  await ensureServerSettings();

  // Misafirse tüm eski admin / rank cache'ini sil
  if (!getCurrentUser()) {
    if (typeof window.clearAmxPasswordCache === 'function') window.clearAmxPasswordCache();
    if (typeof window.clearRankTicketCache === 'function') window.clearRankTicketCache();
  }

  // Admin badge + _pw: sadece üye oturumunda /api/me/server-admin ile
  if (port && !isHost) {
    try {
      if (typeof window.prefetchAmxAdminsForPort === 'function') {
        await window.prefetchAmxAdminsForPort(port);
      }
    } catch (e) { /* ignore */ }
  }

  // Hesap bazlı rank bileti (JWT → kısa ömürlü ticket → setinfo _bcs_rank)
  // VIP bileti paralel (aktif abone → setinfo _bcs_vip)
  if (port && !isHost && getCurrentUser()) {
    try {
      const rankP =
        typeof window.prefetchRankTicketForPort === 'function'
          ? window.prefetchRankTicketForPort(port)
          : Promise.resolve(null);
      const vipP =
        typeof window.ensureVipTicketForPort === 'function'
          ? window.ensureVipTicketForPort(port)
          : Promise.resolve(null);
      await Promise.all([rankP, vipP]);
    } catch (e) { /* ignore — misafir gibi devam */ }
  } else if (port) {
    if (typeof window.clearRankTicketCache === 'function') {
      window.clearRankTicketCache(port);
    }
    if (typeof window.clearVipTicketCache === 'function') {
      window.clearVipTicketCache(port);
    }
  }

  // Voice/mic kapalı: getUserMedia açma. SDL capture ScriptProcessor (512)
  // main-thread wake üretir; voice_enable zaten 0 (engine.js).

  // Açık modalları kapat (maç modu modalını koru)
  document.querySelectorAll('.modal, .modal-overlay, #login-modal, #premium-modal, #guest-name-modal, #welcome-motd').forEach(el => {
    if (el.id === 'match-pass-modal') return;
    el.style.display = 'none';
  });

  // Arayüzü gizle, oyunu göster
  const sidebar = $('sidebar');
  const header = $('header');
  if (sidebar) sidebar.style.display = 'none';
  if (header) header.style.display = 'none';
  if (gameWrapper) gameWrapper.classList.add('active'); // .hidden değil, .active kullanılmalı!

  const engineText = document.getElementById('engine-status-text');
  if (engineText) {
    engineText.innerHTML = `Engine hazırlanıyor... <br/><span style="color:var(--cs-yellow); font-size: 0.75rem; letter-spacing:0.05em; margin-top:5px; display:inline-block;">⚠️ İlk yükleme (harita ve modeller) internet hızınıza bağlı olarak uzun sürebilir. Lütfen bekleyin.</span>`;
  }

  // ── Toolbar: kullanıcı adı + sunucu adı + VIP "Yönet" butonu ───────────────
  const toolbarUserInfo = $('toolbar-user-info');
  const toolbarUsername = $('toolbar-username');
  const btnGameManage = $('btn-game-manage');
  const toolbarSvName = $('toolbar-server-name');

  if (toolbarUserInfo && toolbarUsername) {
    const currentUsername = getCurrentUsername();
    const currentUsr = getCurrentUser();
    if (currentUsername && currentUsr) {
      toolbarUsername.textContent = '👤 ' + currentUsername;
      toolbarUserInfo.style.display = 'flex';

      // VIP kullanıcı mı? Bu porta sahip sunucu var mı?
      if (isUserPremium()) {
        try {
          const srvRes = await fetch(`${API_URL}/api/servers`);
          const srvData = await srvRes.json();
          const myServer = (srvData.servers || []).find(s =>
            s.port == port && s.owner_id && s.owner_id === currentUsr.id
          );
          if (myServer) {
            // Sunucu adını toolbar'da göster
            if (toolbarSvName) {
              toolbarSvName.textContent = '🖥 ' + myServer.name;
              toolbarSvName.style.display = 'inline';
            }
            if (btnGameManage) {
              btnGameManage.style.display = 'inline-flex';
              btnGameManage.onclick = () => window.openServerSettings(myServer.id || myServer.containerId, myServer);
            }
          } else {
            if (toolbarSvName) toolbarSvName.style.display = 'none';
            if (btnGameManage) btnGameManage.style.display = 'none';
          }
        } catch (e) {
          if (toolbarSvName) toolbarSvName.style.display = 'none';
          if (btnGameManage) btnGameManage.style.display = 'none';
        }
      } else {
        if (toolbarSvName) toolbarSvName.style.display = 'none';
        if (btnGameManage) btnGameManage.style.display = 'none';
      }
    } else {
      toolbarUserInfo.style.display = 'none';
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  // initEngine'i çağır
  initEngine(mapName, port, isHost);
};

// --- INIT ---
runSplash();
initAuth();
initRankGiftPopup();
// Auth sonrası admin-şifre bildirimlerini kontrol et
setTimeout(() => {
  if (typeof checkAdminPasswordNotices === 'function') {
    checkAdminPasswordNotices();
  }
}, 1800);
setTimeout(() => {
  if (typeof checkAdminPasswordNotices === 'function') {
    checkAdminPasswordNotices();
  }
}, 5000);

(function openPremiumModalFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('modal') === 'premium') {
    const modal = document.getElementById('premium-modal');
    if (modal) modal.style.display = 'flex';
    window.history.replaceState({}, '', '/oyna/');
  }
})();

/** VIP paket sayfasından /oyna/?vip=silver|gold|platinum|1 — panel veya giriş */
(function openVipFlowFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const vipRaw = String(params.get('vip') || '').toLowerCase();
  const tierMatch = ['silver', 'gold', 'platinum'].includes(vipRaw) ? vipRaw : null;
  const wantVip =
    vipRaw === '1' ||
    !!tierMatch ||
    params.get('modal') === 'vip' ||
    params.get('modal') === 'login' ||
    params.get('login') === '1';
  if (!wantVip) return;

  if (tierMatch) {
    try { sessionStorage.setItem('bcs_vip_intent', tierMatch); } catch (_) { /* ignore */ }
  } else if (vipRaw === '1') {
    try { sessionStorage.setItem('bcs_vip_intent', 'gold'); } catch (_) { /* ignore */ }
  }

  window.history.replaceState({}, '', '/oyna/');

  let attempts = 0;
  const maxAttempts = 20;
  const tick = () => {
    attempts += 1;
    const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
    const loginModal = document.getElementById('login-modal');
    const dashBtn = document.getElementById('btn-dashboard');

    if (user) {
      if (typeof window.openVipPurchasePanel === 'function') {
        window.openVipPurchasePanel(sessionStorage.getItem('bcs_vip_intent') || tierMatch || 'gold');
      } else if (dashBtn) {
        dashBtn.click();
      } else {
        const dashModal = document.getElementById('dashboard-modal');
        if (dashModal) dashModal.style.display = 'flex';
      }
      return;
    }

    if (attempts >= maxAttempts) {
      // Oturum yok — giriş; bcs_vip_intent login sonrası paneli açar
      if (loginModal) loginModal.style.display = 'flex';
      return;
    }
    setTimeout(tick, 200);
  };
  setTimeout(tick, 150);
})();

// ── AUTO-CONNECT: sayfa yenilendikten sonra bekleyen baglanti varsa otomatik baglan ──
(function checkAutoConnect() {
  var raw = sessionStorage.getItem('_csAutoConnect');
  if (!raw) return;
  try {
    var info = JSON.parse(raw);
    sessionStorage.removeItem('_csAutoConnect');
    if (!info.port) return;
    // Auth y&#252;klenmesini bekle (1.5sn), sonra baglan
    setTimeout(function() {
      if (info.password) {
        window._pendingServerPassword = info.password;
        sessionStorage.setItem('_csLastPw_' + info.port, info.password);
      }
      window.connectToServer(info.port, info.map || 'de_dust2', false);
    }, 1500);
  } catch(e) { sessionStorage.removeItem('_csAutoConnect'); }
})();

// Direct listeners - module scripts run after DOM is ready
(async () => {
  const btnRandomJoin = document.getElementById('btn-random-join');
  if (btnRandomJoin) {
    btnRandomJoin.addEventListener('click', async () => {
      btnRandomJoin.disabled = true;
      const originalText = btnRandomJoin.textContent;
      btnRandomJoin.textContent = '🎲 ARANIYOR...';

      try {
        const res = await fetch(`${API_URL}/api/servers`);
        const data = await res.json();
        const servers = data.servers || [];
        const onlineServers = servers.filter(s => s.state === 'running');

        if (onlineServers.length === 0) {
          window.customAlert('Şu anda aktif bir oda bulunamadı. Lütfen sayfayı yenileyin.', 'BİLGİ');
        } else {
          const target = onlineServers[Math.floor(Math.random() * onlineServers.length)];

          if (!getCurrentUser()) {
            const guestNick = await window.openGuestNameModal(target.port, target.map);
            if (!guestNick) return;
            window.connectToServer(target.port, target.map, false);
          } else {
            window.connectToServer(target.port, target.map, false);
          }
        }
      } catch (err) {
        console.error(err);
      }

      btnRandomJoin.disabled = false;
      btnRandomJoin.textContent = originalText;
    });
  }

  const btnSidebarBuyServer = document.getElementById('btn-sidebar-buy-server');
  if (btnSidebarBuyServer) {
    btnSidebarBuyServer.addEventListener('click', () => {
      const user = getCurrentUser();
      if (!user) {
        const loginModal = document.getElementById('login-modal');
        if (loginModal) loginModal.style.display = 'flex';
        window.customAlert('Sunucu kiralayabilmek için önce üye girişi yapmalısınız.', 'BİLGİ');
      } else {
        const modal = document.getElementById('premium-modal');
        if (modal) modal.style.display = 'flex';
      }
    });
  }

  // ── Online Oyuncu Sayıcısı ────────────────────────────────────
  async function updateOnlineCounter() {
    // Oyun açıkken fetch/JSON main thread'i gereksiz yormasın (FPS salınımı)
    if (state.engineRunning) return;
    try {
      const res = await fetch(`${API_URL}/api/stats`);
      const data = await res.json();
      if (!data.success) return;

      const counterEl = document.getElementById('online-player-count');
      const serverCountEl = document.getElementById('online-server-count');
      if (counterEl) counterEl.textContent = data.totalPlayers ?? 0;
      if (serverCountEl) serverCountEl.textContent = data.activeServers ?? 0;
    } catch (e) { /* sessiz hata */ }
  }

  // Sayfa açılınca ve her 30 saniyede güncelle
  updateOnlineCounter();
  setInterval(updateOnlineCounter, 30000);

})();


// ================================================================
// MATCH MODE PASSWORD MODAL
// ================================================================
(function initMatchModeModal() {
  const origBtn = document.getElementById('btn-match-mode');
  if (!origBtn) return;

  const passYes = document.getElementById('match-pass-yes');
  const passNo = document.getElementById('match-pass-no');
  const passConf = document.getElementById('match-pass-confirm');
  const passInp = document.getElementById('match-pass-input');
  const modal = document.getElementById('match-pass-modal');

  [passYes, passNo, passConf].forEach(btn => {
    if (btn) btn.type = 'button';
  });

  origBtn.addEventListener('click', () => {
    const rconPass = document.getElementById('rcon-auth-pass')?.value || '';
    if (!rconPass) {
      notify('RCON sekmesinde şifrenizi girin!', 'error');
      return;
    }
    if (!currentSettingsServerId) {
      notify('Sunucu ID bulunamadı!', 'error');
      return;
    }
    if (!showMatchPassModal()) {
      notify('Maç modu penceresi bulunamadı!', 'error');
    }
  });

  if (passYes) {
    passYes.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const choiceRow = document.getElementById('match-pass-choice-row');
      const confirmBtn = document.getElementById('match-pass-confirm');
      if (choiceRow) choiceRow.style.display = 'none';
      if (passInp) {
        passInp.style.display = 'block';
        passInp.focus();
      }
      if (confirmBtn) confirmBtn.style.display = 'block';
    });
  }

  async function startMatchMode(password) {
    hideMatchPassModal();
    if (passConf) {
      passConf.disabled = true;
      passConf.textContent = 'BAŞLATILIYOR...';
    }
    try {
      await window._execMatchCfgWithPass(password);
    } finally {
      if (passConf) {
        passConf.disabled = false;
        passConf.textContent = '⚔ MAÇ MODUNU BAŞLAT';
      }
    }
  }

  if (passNo) {
    passNo.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startMatchMode('');
    });
  }

  if (passConf) {
    passConf.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pw = (passInp?.value || '').trim();
      startMatchMode(pw);
    });
  }

  if (passInp) {
    passInp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const pw = (passInp.value || '').trim();
        startMatchMode(pw);
      }
      if (e.key === 'Escape') hideMatchPassModal();
    });
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) hideMatchPassModal();
    });
    const panel = document.getElementById('match-pass-panel');
    if (panel) {
      panel.addEventListener('click', (e) => e.stopPropagation());
    }
  }
})();

window._execMatchCfgWithPass = async function (svPassword) {
  const btn = document.getElementById('btn-match-mode');
  if (btn) { btn.textContent = 'MATCH.CFG YAZILIYOR...'; btn.disabled = true; }

  const safePassword = sanitizeCfgPassword(svPassword);
  const lines = [
    '// CS 1.5 Clan Match Config - BrowserCS',
    'hostname "CS 1.5 Clan Match Server"',
    'sv_password "' + safePassword + '"',
    'sv_cheats 0', 'sv_lan 0', 'sv_pausable 1',
    'sv_voiceenable 0', 'sv_alltalk 0',
    'sv_gravity 800', 'sv_maxspeed 320',
    'sv_airaccelerate 10', 'sv_aim 0',
    'mp_friendlyfire 1', 'mp_autoteambalance 0',
    'mp_limitteams 0', 'mp_autokick 0',
    'mp_tkpunish 0', 'mp_startmoney 800',
    'mp_buytime 0.25', 'mp_freezetime 6',
    'mp_roundtime 5', 'mp_c4timer 35',
    'mp_timelimit 0', 'mp_maxrounds 15',
    'mp_winlimit 0', 'mp_flashlight 1',
    'mp_footsteps 1', 'mp_fadetoblack 0',
    'mp_forcechasecam 2', 'allow_spectators 1',
    'log on', 'mp_logmessages 1', 'mp_logdetail 3',
    'browsercs_match 1', 'browsercs_match_maxplayers 10',
    'say "== CLAN MATCH CFG LOADED =="',
    'say "FF:ON | MONEY:800 | FREEZE:6 | ROUND:5 | C4:35"',
    'sv_restartround 3'
  ];
  const matchCfgContent = lines.join('\n') + '\n';

  try {
    const token = typeof getSessionToken === 'function' ? await getSessionToken() : null;
    if (!token) throw new Error('Oturum bulunamadı — lütfen tekrar giriş yapın.');
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
    const writeRes = await fetch(API_URL + '/api/servers/' + currentSettingsServerId + '/write-cfg', {
      method: 'POST', headers, body: JSON.stringify({ filename: 'match', content: matchCfgContent })
    });
    const writeData = await writeRes.json().catch(() => ({}));
    if (!writeRes.ok || !writeData.success) {
      throw new Error(writeData.error || ('CFG yazılamadı (HTTP ' + writeRes.status + ')'));
    }
    const execOk = await execModeCfg('match', writeData);
    if (execOk) {
      notify(safePassword ? ('Maç modu aktif! Şifre: ' + safePassword) : '5v5 Maç CFG yüklendi! Round 3 saniye içinde yeniden başlayacak.', 'success');
    }
  } catch (e) {
    notify('Maç modu hatası: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⚔ 5v5 MAÇ MODU'; }
  }
};

// ================================================================
// ESC PAUSE MENU
// ================================================================
(function initEscPauseMenu() {
  const escMenu = document.getElementById('esc-pause-menu');
  const btnResume = document.getElementById('esc-btn-resume');
  const btnRetry = document.getElementById('esc-btn-retry');
  const btnEscSet = document.getElementById('esc-btn-settings');
  const btnDisconn = document.getElementById('esc-btn-disconnect');
  const gCanvas = document.getElementById('canvas');
  if (!escMenu || !gCanvas) return;

  // Y/U (say / team say) pointer-lock'u düşürür — bunu ESC sanıp menü açma.
  let suppressPauseMenuUntil = 0;
  // Ctrl (+duck) gibi oyun tuşları bazı tarayıcılarda pointer-lock'u düşürebiliyor.
  // Bu pencere içinde kilit düşerse ESC değil kaza sayıp kilidi geri al.
  let relockAfterLossUntil = 0;

  const typingTarget = (el) => {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || el.isContentEditable;
  };

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.repeat) return;
      if (typingTarget(e.target) || typingTarget(document.activeElement)) return;

      // Klasik CS chat / menü — fare kilidi kalkar, pause menü açılmamalı
      const chatOrMenu =
        e.code === 'KeyY' ||
        e.code === 'KeyU' ||
        e.code === 'KeyB' ||
        e.code === 'KeyM' ||
        e.key === 'y' ||
        e.key === 'Y' ||
        e.key === 'u' ||
        e.key === 'U' ||
        e.key === 'b' ||
        e.key === 'B' ||
        e.key === 'm' ||
        e.key === 'M';
      if (chatOrMenu) {
        suppressPauseMenuUntil = Date.now() + 2500;
        return;
      }

      // Esc, pointer-lock sırasında sayfaya keydown göndermez (tarayıcı yutar).
      // O yüzden Esc DIŞINDA bir tuş basılıp hemen ardından kilit düşerse,
      // bu kaza kaynaklı bir kilit kaybıdır (ör. Ctrl/+duck) → menü açma, kilidi geri al.
      if (e.key !== 'Escape') {
        relockAfterLossUntil = Date.now() + 400;
      }
    },
    true
  );

  document.addEventListener('pointerlockchange', () => {
    if (!state.engineRunning) return;
    // Mobil dokunmatikte pointer-lock yok — ESC menüyü açma
    if (window._browserCSTouchControls) {
      escMenu.classList.remove('show');
      return;
    }
    const consoleOpenNow = document.getElementById('console-panel')?.classList.contains('open');
    if (document.pointerLockElement === gCanvas) {
      escMenu.classList.remove('show');
    } else if (!consoleOpenNow) {
      setTimeout(() => {
        // Kalite / toolbar tıklaması geçici unlock — ESC menüyü açma
        if (window._browserCSIgnorePointerLockLoss) return;
        if (window._browserCSTouchControls) return;
        // Chat (Y/U) veya buy/team menüsü — pause menüyü bastır
        if (Date.now() < suppressPauseMenuUntil) return;
        // Ctrl/+duck gibi oyun tuşu kaynaklı kaza kilit kaybı — menü açma, kilidi geri al
        if (Date.now() < relockAfterLossUntil) {
          try { gCanvas.requestPointerLock(); } catch (e) { /* ignore */ }
          return;
        }
        const kickEl = document.getElementById('kick-overlay');
        const reconEl = document.getElementById('reconnect-overlay');
        const kickOpen = kickEl && kickEl.classList.contains('show');
        const reconOpen = reconEl && reconEl.classList.contains('show');
        const reconActive =
          window.BrowserCSReconnect &&
          window.BrowserCSReconnect.reconnecting;
        const tm = document.getElementById('custom-textmenu');
        const tmOpen = tm && tm.style.display !== 'none';
        const sb = document.getElementById('custom-scoreboard');
        const sbOpen = sb && sb.style.display !== 'none' && sb.style.display !== '';
        const motd = document.getElementById('welcome-motd');
        const motdOpen = motd && motd.classList.contains('visible');
        const localMenuOpen = !!window._browserCSLocalMenu;
        if (
          !kickOpen &&
          !reconOpen &&
          !reconActive &&
          !tmOpen &&
          !sbOpen &&
          !motdOpen &&
          !localMenuOpen &&
          state.engineRunning
        ) {
          escMenu.classList.add('show');
        }
      }, 80);
    }
  });

  if (btnResume) btnResume.addEventListener('click', () => {
    escMenu.classList.remove('show');
    if (!window._browserCSTouchControls) {
      try { gCanvas.requestPointerLock(); } catch (e) { }
    }
    gCanvas.focus();
  });

  if (btnRetry) btnRetry.addEventListener('click', () => {
    escMenu.classList.remove('show');
    if (window.BrowserCSReconnect && typeof window.BrowserCSReconnect.retryNow === 'function') {
      window.BrowserCSReconnect.retryNow();
      notify('Sunucuya yeniden bağlanılıyor...', 'info');
    } else if (typeof window.executeEngineCommand === 'function') {
      window.executeEngineCommand('setinfo _vgui_menus 0');
      window.executeEngineCommand('retry');
      notify('retry komutu gönderildi.', 'info');
      if (!window._browserCSTouchControls) {
        try { gCanvas.requestPointerLock(); } catch (e) { }
      }
    }
  });

  if (btnEscSet) btnEscSet.addEventListener('click', () => {
    escMenu.classList.remove('show');
    if (typeof window.openConsolePanel === 'function') {
      window.openConsolePanel();
    } else if (typeof window.toggleConsole === 'function') {
      window.toggleConsole(true);
    }
  });

  if (btnDisconn) {
    btnDisconn.addEventListener('click', () => {
      if (confirm('Sunucudan çıkmak istediğinize emin misiniz?')) {
        window.leaveBrowserCSServer({ message: 'Sunucudan çıkılıyor...' });
      }
    });
  }
})();

/**
 * Sunucudan düzgün çıkış:
 * 1) reconnect'i durdur
 * 2) engine disconnect
 * 3) WebRTC üzerinden disconnect paketi + kanalı kapat (sunucu oyuncuyu düşürür)
 * 4) sunucu listesine dön
 */
window.leaveBrowserCSServer = function leaveBrowserCSServer(opts = {}) {
  if (window._browserCSLeaving) {
    return;
  }
  window._browserCSLeaving = true;
  window._browserCSInGameFlag = false;
  window._browserCSScoreboardSeen = false;
  window._browserCSDidJoinFullupdate = false;
  window._browserCSScoreDomSig = '';
  window._browserCSLocalTeam = null;
  releaseBrowserCSWakeLock();

  try {
    window.stopBrowserCSPromoLoop?.();
    window._browserCSPendingAdminBanner = null;
    document.getElementById('admin-join-banner')?.classList.remove('show', 'hiding');
    document.getElementById('browsercs-promo-banner')?.classList.remove('show', 'hiding');
  } catch (e) { /* ignore */ }

  try {
    if (window.BrowserCSReconnect?.nonRetryable) {
      window.BrowserCSReconnect.nonRetryable('Oyuncu sunucudan ayrıldı');
    }
  } catch (e) { /* ignore */ }

  try {
    document.getElementById('esc-pause-menu')?.classList.remove('show');
    document.getElementById('reconnect-overlay')?.classList.remove('show');
    document.getElementById('kick-overlay')?.classList.remove('show');
    document.exitPointerLock?.();
  } catch (e) { /* ignore */ }

  if (typeof notify === 'function') {
    notify(opts.message || 'Sunucu listesine dönülüyor...', 'info');
  }

  // 1) Engine'e normal disconnect (netchan) — OOB 0xff disconnect KULLANMA
  // OOB disconnect tüm 127.0.0.1 WebRTC oyuncularını düşürebiliyordu.
  try {
    if (state.xash) {
      state.xash._suppressDisconnectEvent = true;
    }
    if (typeof window.executeEngineCommand === 'function') {
      window.executeEngineCommand('disconnect');
    }
  } catch (e) { /* ignore */ }

  const goLobby = () => {
    try {
      const url = new URL(window.location.href);
      url.search = '';
      url.hash = '';
      if (url.pathname.includes('/oyna')) {
        window.location.replace(url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`);
      } else {
        window.location.replace('/oyna/');
      }
    } catch (e) {
      window.location.href = '/oyna/';
    }
  };

  // 2) Kısa bekle → sadece kendi WebRTC kanalını kapat → lobi
  const delay = typeof opts.delayMs === 'number' ? opts.delayMs : 350;
  setTimeout(() => {
    try {
      if (state.xash) {
        state.xash._suppressDisconnectEvent = true;
        try { state.xash.dc?.close?.(); } catch (e) { /* ignore */ }
        if (typeof state.xash._resetWebRTCConnection === 'function') {
          state.xash._resetWebRTCConnection();
        } else if (typeof state.xash._cleanupWebRTC === 'function') {
          try { state.xash._cleanupWebRTC(); } catch (e) { /* ignore */ }
        }
      }
    } catch (e) { /* ignore */ }

    setTimeout(goLobby, 200);
  }, delay);
};

assertEngineBridges();

// Sekme/kapanış: mümkünse engine disconnect, sonra WebRTC kapat.
// Asıl sunucu-side leave: DataChannel close → port-scoped OOB disconnect.
window.addEventListener('pagehide', () => {
  if (window._browserCSLeaving) return;
  try {
    if (typeof window.executeEngineCommand === 'function' && state.engineRunning) {
      try { window.executeEngineCommand('disconnect'); } catch (_) { /* ignore */ }
    }
  } catch (_) { /* ignore */ }
  try {
    if (state.xash?._netBridge) {
      try { state.xash._netBridge.disconnect(); } catch (_) { /* ignore */ }
    }
    if (state.xash?.dc?.readyState === 'open') {
      try { state.xash.dc.close(); } catch (_) { /* ignore */ }
    }
  } catch (_) { /* ignore */ }
});

// Toolbar: Sunuculara Dön → sunucu listesi
(function initToolbarLeaveButtons() {
  const btnQuit = document.getElementById('btn-quit');
  if (btnQuit) {
    btnQuit.addEventListener('click', (e) => {
      e.preventDefault();
      window.leaveBrowserCSServer();
    });
  }
})();

// ================================================================
// KICK / DISCONNECT OVERLAY
// ================================================================
(function initKickDetection() {
  const kickOverlay = document.getElementById('kick-overlay');
  const kickReasonEl = document.getElementById('kick-reason');
  const kickTitleEl = document.getElementById('kick-title');
  const kickIconEl = document.getElementById('kick-icon');
  const btnKickRecon = document.getElementById('btn-kick-reconnect');
  if (!kickOverlay) return;

  // Sadece "sen atıldın" mesajları — üçüncü şahıs kick logları overlay açmamalı.
  // (Örn. AMXX "Kick: Admin kick Player" veya "kicked due to invalid password" başkasının logu)
  const KICK_PATTERNS = [
    { r: /you were kicked from the game/i, title: 'SUNUCUDAN ATILDINIZ', reason: 'Sunucu sizi baglantidan kesti.' },
    { r: /you have been kicked/i, title: 'SUNUCUDAN ATILDINIZ', reason: 'Yonetici tarafindan sunucudan atildiniz.' },
    { r: /browsercs anti-cheat/i, title: 'ANTI-CHEAT', reason: 'Sunucu anti-cheat korumasi baglantinizi kesti.' },
    { r: /\byou\b.*\bkicked by server\b|\bkicked by server\b.*\byou\b/i, title: 'SUNUCUDAN ATILDINIZ', reason: 'Sunucu sizi baglantidan kesti.' },
    { r: /^kicked by server\.?$/i, title: 'SUNUCUDAN ATILDINIZ', reason: 'Sunucu sizi baglantidan kesti.' },
    { r: /you.*(idle|afk).*kick|(idle|afk).*kick.*you/i, title: 'HAREKETSIZLIK', reason: 'Uzun sure hareketsizlik nedeniyle sunucudan otomatik atildiniz.' },
    { r: /you (are|have been) banned|\bbanned from (this )?server\b/i, title: 'SUNUCU ERISIMI REDDEDILDI', reason: 'Bu sunucuya girisiniz engellenmis.' },
    { r: /server is full/i, title: 'SUNUCU DOLU', reason: 'Sunucuda yer kalmadigi icin baglantiniz reddedildi.' },
    { r: /\bbad (server )?password\b/i, title: 'HATALI SIFRE', reason: 'Sunucu sifresi hatali.' },
  ];

  function isThirdPartyKickLog(msg) {
    const s = String(msg || '');
    // AMXX plmenu / admincmd: "Kick: "X" kick "Y"" — admin aksiyonu, kendini atılmamış
    if (/\[plmenu\.amxx\]|\[admincmd\.amxx\]/i.test(s) && /\bkick\b/i.test(s)) return true;
    if (/^Kick:\s*".+"\s+kick\s+"/i.test(s)) return true;
    if (/kicked due to invalid password/i.test(s)) return true;
    if (/\bkick\s+".+"\b/i.test(s) && !/you have been kicked/i.test(s)) return true;
    return false;
  }

  window._showKickOverlay = function (title, reason) {
    if (kickTitleEl) kickTitleEl.textContent = title;
    if (kickReasonEl) kickReasonEl.textContent = reason;
    if (kickIconEl) kickIconEl.textContent = title.includes('SIFRE') ? '🔒' : title.includes('DOLU') ? '🚫' : '⛔';
    kickOverlay.classList.add('show');
    const ep = document.getElementById('esc-pause-menu');
    if (ep) ep.classList.remove('show');
  };

  // Wrap addConsoleLog to detect kick messages
  if (typeof window.addConsoleLog === 'function') {
    const _origAdd = window.addConsoleLog;
    window.addConsoleLog = function (msg, type) {
      _origAdd(msg, type);
      if (!state.engineRunning || !msg) return;
      if (isThirdPartyKickLog(msg)) return;
      const lower = msg.toLowerCase();
      for (const p of KICK_PATTERNS) {
        if (p.r.test(lower)) {
          if (window.BrowserCSReconnect) {
            window.BrowserCSReconnect.nonRetryable(msg);
          }
          setTimeout(function () { window._showKickOverlay(p.title, p.reason); }, 500);
          break;
        }
      }
    };
  }
  if (btnKickRecon) btnKickRecon.addEventListener('click', async () => {
    kickOverlay.classList.remove('show');
    if (state.xash && state.engineRunning) {
      try {
        if (state.xash?.ensureDcReady) {
          await state.xash.ensureDcReady(120000);
        }
        if (typeof window.executeEngineCommand === 'function') {
          window.executeEngineCommand('setinfo _vgui_menus 0');
          const port = window._browserCSConnectPort || '27015';
          window.executeEngineCommand(`connect 10.0.0.1:${port}`);
        }
      } catch (err) {
        console.warn('[Kick] WebRTC reconnect failed:', err);
        if (window.BrowserCSReconnect?.retryNow) window.BrowserCSReconnect.retryNow();
      }
    } else { location.reload(); }
  });
})();

// ================================================================
// MODAL INPUT KEYBOARD FIX
// Engine/WASM keyboard capture handlers steal keys from inputs.
// This window capture-phase listener runs first and blocks propagation
// when a modal input is focused, so typing works correctly.
// ================================================================
(function () {
  var MODAL_IDS = ['match-pass-modal', 'esc-pause-menu', 'kick-overlay'];
  function isInsideModal(el) {
    if (!el) return false;
    for (var i = 0; i < MODAL_IDS.length; i++) {
      var m = document.getElementById(MODAL_IDS[i]);
      if (m && m.contains(el)) return true;
    }
    return false;
  }
  function modalKeyGuard(e) {
    var active = document.activeElement;
    if (!active) return;
    var tag = active.tagName ? active.tagName.toLowerCase() : '';
    if ((tag === 'input' || tag === 'textarea') && isInsideModal(active)) {
      e.stopImmediatePropagation();
      if (e.key !== 'Escape') e.stopPropagation();
    }
  }
  window.addEventListener('keydown', modalKeyGuard, { capture: true });
  window.addEventListener('keyup', modalKeyGuard, { capture: true });
  window.addEventListener('keypress', modalKeyGuard, { capture: true });
})();

// ================================================================
// THEMED SERVER JOIN PASSWORD MODAL
// ================================================================
window.openServerJoinPasswordModal = function (port, serverName) {
  return new Promise(function (resolve) {
    var modal = document.getElementById('server-join-pass-modal');
    var input = document.getElementById('sjp-input');
    var errEl = document.getElementById('sjp-error');
    var attEl = document.getElementById('sjp-attempts');
    var confirm = document.getElementById('sjp-confirm');
    var cancel = document.getElementById('sjp-cancel');
    if (!modal) { resolve(null); return; }

    // Ebeveyn gizliyse (game-wrapper display:none) modal gorunmez.
    // Guvence icin body'ye tasiyoruz - position:fixed ile tam ekran kaplar.
    if (modal.parentElement !== document.body) {
      modal.style.position = 'fixed';
      document.body.appendChild(modal);
    }

    var attempts = 0;
    var maxAttempts = 3;

    function resetUI() {
      input.value = '';
      errEl.textContent = '';
      attEl.textContent = '';
      input.classList.remove('error');
    }

    function showError(msg) {
      errEl.textContent = msg;
      input.classList.add('error');
      setTimeout(function () { input.classList.remove('error'); }, 400);
    }

    function updateAttempts() {
      if (attempts > 0) {
        attEl.textContent = attempts + '/' + maxAttempts + ' yanlis deneme';
      }
    }

    async function tryConfirm() {
      var pw = (input.value || '').trim();
      if (!pw) { showError('Sifre bos olamaz!'); input.focus(); return; }

      // Verify against server
      try {
        var vRes = await fetch(API_URL + '/api/servers/' + port + '/verify-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pw })
        });
        var vData = await vRes.json();
        if (vData.valid) {
          modal.classList.remove('show');
          cleanup();
          resolve(pw);
          return;
        }
      } catch (e) {
        // API error - allow through
        modal.classList.remove('show');
        cleanup();
        resolve(pw);
        return;
      }

      attempts++;
      updateAttempts();
      if (attempts >= maxAttempts) {
        showError('3 yanlis deneme! Erisim reddedildi.');
        setTimeout(function () {
          modal.classList.remove('show');
          cleanup();
          resolve(null);
        }, 1500);
        return;
      }
      showError('Yanlis sifre! Tekrar deneyin.');
      input.value = '';
      input.focus();
    }

    function cleanup() {
      confirm.removeEventListener('click', tryConfirm);
      cancel.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKeydown);
    }

    function onCancel() {
      modal.classList.remove('show');
      cleanup();
      resolve(null);
    }

    function onKeydown(e) {
      if (e.key === 'Enter') { e.preventDefault(); tryConfirm(); }
      if (e.key === 'Escape') { onCancel(); }
    }

    resetUI();
    confirm.addEventListener('click', tryConfirm);
    cancel.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKeydown);
    modal.classList.add('show');
    setTimeout(function () { input.focus(); }, 80);
  });
};

// ================================================================
// ESC PAUSE MENU: show Yonet button for server owner (premium)
// ================================================================
(function () {
  var btnManage = document.getElementById('esc-btn-manage');
  var escMenu = document.getElementById('esc-pause-menu');
  if (!btnManage || !escMenu) return;

  // Show/hide Yonet button when ESC menu opens
  var obs = new MutationObserver(function () {
    if (escMenu.classList.contains('show')) {
      var meta = window._motdServerMeta || {};
      var user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
      var isPremium = typeof isUserPremium === 'function' ? isUserPremium() : false;
      if (user && isPremium && meta.owner_id && meta.owner_id === user.id && meta.serverId) {
        btnManage.style.display = 'block';
      } else {
        btnManage.style.display = 'none';
      }
    }
  });
  obs.observe(escMenu, { attributes: true, attributeFilter: ['class'] });

  btnManage.addEventListener('click', function () {
    escMenu.classList.remove('show');
    var meta = window._motdServerMeta || {};
    if (meta.serverId && typeof openServerSettings === 'function') {
      openServerSettings(meta.serverId);
    }
  });
})();

// ================================================================
// AUTH GATE: shows when unauthenticated user tries premium action
// ================================================================
window.openAuthGate = function (msgOverride) {
  var modal = document.getElementById('auth-gate-modal');
  var msgEl = document.getElementById('auth-gate-msg');
  if (!modal) {
    // Fallback: just open login modal
    var lm = document.getElementById('login-modal');
    if (lm) lm.style.display = 'flex';
    return;
  }
  if (msgEl && msgOverride) msgEl.textContent = msgOverride;
  modal.style.display = 'flex';
};

(function () {
  var gateModal = document.getElementById('auth-gate-modal');
  var loginBtn = document.getElementById('auth-gate-login');
  var registerBtn = document.getElementById('auth-gate-register');
  var loginModal = document.getElementById('login-modal');
  var registerModal = document.getElementById('register-modal');
  if (!gateModal) return;

  if (loginBtn) loginBtn.addEventListener('click', function () {
    gateModal.style.display = 'none';
    if (loginModal) loginModal.style.display = 'flex';
  });

  if (registerBtn) registerBtn.addEventListener('click', function () {
    gateModal.style.display = 'none';
    if (registerModal) registerModal.style.display = 'flex';
  });
})();

// ================================================================
// CS MENU BACKGROUND OVERLAY: hide when player connects in-game
// ================================================================
(function() {
  var menuBg = document.getElementById('cs-menu-bg');
  if (!menuBg) return;

  function hideMenuBg() {
    if (menuBg) { menuBg.style.opacity = '0'; setTimeout(function() { menuBg.style.display = 'none'; }, 650); }
  }
  function showMenuBg() {
    // Uzak sunucuya bağlanırken / bağlanmışken menü splash gösterme
    if (window.BrowserCSReconnect?.reconnecting) return;
    if (window.BrowserCSReconnect?.sessionJoined) return;
    if (window._browserCSInGameFlag) return;
    if (window._browserCSConnectPort && !window._browserCSLeaving) {
      // Join akışı sürüyor — engine "menu" event'i gelse bile splash yok
      if (!window.BrowserCSReconnect?.exhausted) return;
    }
    if (menuBg) { menuBg.style.display = 'block'; setTimeout(function() { menuBg.style.opacity = '1'; }, 10); }
  }

  // Hide when game connects (player enters a server)
  window.addEventListener('xash3d-connected', hideMenuBg);
  window.addEventListener('xash3d-ingame', hideMenuBg);

  // Show again when player goes back to menu (disconnected)
  window.addEventListener('xash3d-ws-closed', function() {
    setTimeout(showMenuBg, 1000);
  });
  window.addEventListener('xash3d-menu', showMenuBg);

  // Also hide when engine starts loading (loading overlay is shown)
  var origInit = window.initEngine;
  document.addEventListener('DOMContentLoaded', function() {
    var loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) {
      var obs = new MutationObserver(function() {
        if (loadingOverlay.classList.contains('active')) hideMenuBg();
      });
      obs.observe(loadingOverlay, { attributes: true, attributeFilter: ['class'] });
    }
  });

  // Expose for manual control
  window.hideMenuBackground = hideMenuBg;
  window.showMenuBackground = showMenuBg;
})();

// --- BROWSERCS: Sniper Scope JS Overlay + quick-scope input buffer ---
let browserCSSniperScopeOpen = false;
let browserCSSniperScopeOpenedAt = 0;
let browserCSSniperQuickClickAt = 0;
let browserCSSniperBufferTimers = [];

function clearSniperInputBuffer() {
  browserCSSniperBufferTimers.forEach((timer) => clearTimeout(timer));
  browserCSSniperBufferTimers = [];
  browserCSSniperQuickClickAt = 0;
}

function pulseBufferedSniperAttack() {
  if (
    !browserCSSniperScopeOpen ||
    !state.engineRunning ||
    typeof window.executeEngineCommand !== 'function'
  ) return;

  window.executeEngineCommand('+attack');
  setTimeout(() => {
    if (typeof window.executeEngineCommand === 'function') {
      window.executeEngineCommand('-attack');
    }
  }, 34);
}

window.toggleSniperScope = function(isOpen) {
  const nextOpen = Boolean(isOpen);
  if (nextOpen && !browserCSSniperScopeOpen) {
    browserCSSniperScopeOpenedAt = performance.now();
  } else if (!nextOpen) {
    clearSniperInputBuffer();
  }
  browserCSSniperScopeOpen = nextOpen;

  const scope = document.getElementById('custom-sniperscope');
  if (scope) {
    scope.style.display = nextOpen ? 'block' : 'none';
  }
};

document.addEventListener('mousedown', (event) => {
  if (
    event.button !== 0 ||
    !browserCSSniperScopeOpen ||
    window._browserCSTouchControls
  ) return;

  const canvas = document.getElementById('canvas');
  if (document.pointerLockElement !== canvas) return;

  const sinceScopeOpened = performance.now() - browserCSSniperScopeOpenedAt;
  if (sinceScopeOpened >= 0 && sinceScopeOpened <= 240) {
    browserCSSniperQuickClickAt = performance.now();
  }
}, true);

document.addEventListener('mouseup', (event) => {
  if (event.button !== 0 || !browserCSSniperQuickClickAt) return;

  const clickDuration = performance.now() - browserCSSniperQuickClickAt;
  browserCSSniperQuickClickAt = 0;
  if (clickDuration > 220 || !browserCSSniperScopeOpen) return;

  // İlk tekrar çoğu aynı-kare kaybını çözer. İkinci tekrar, weapon cooldown
  // daha uzun sürdüyse devreye girer; başarılı atış scope'u kapatınca iptal olur.
  [90, 320].forEach((offset) => {
    const wait = Math.max(0, browserCSSniperScopeOpenedAt + offset - performance.now());
    const timer = setTimeout(pulseBufferedSniperAttack, wait);
    browserCSSniperBufferTimers.push(timer);
  });
}, true);

// --- BROWSERCS: Text Menu Keyboard Shortcuts Removed ---
// The text menu relies completely on the engine's native key handlers now.
// This prevents the "double press" bug where JS intercepted keys.

document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.querySelector("canvas");
  if (!canvas) return;

  document.addEventListener("pointerlockchange", () => {
    browserCSDebugLog(
      "[Browser] Pointer lock:",
      document.pointerLockElement === canvas
        ? "aktif"
        : "kapandı"
    );
  });

  document.addEventListener("fullscreenchange", () => {
    browserCSDebugLog(
      "[Browser] Fullscreen:",
      document.fullscreenElement
        ? "aktif"
        : "kapandı"
    );
  });

  canvas.addEventListener("click", async () => {
    canvas.focus();
    if (window._browserCSTouchControls) return;
    if (document.pointerLockElement !== canvas) {
      try {
        await canvas.requestPointerLock();
      } catch (error) {
        console.warn("Pointer lock alınamadı:", error);
      }
    }
  });
});

// --- BROWSERCS: Damage Indicator Overlay (pooled — no createElement per hit) ---
const _dmgIndicatorPool = [];
const _DMG_POOL_MAX = 6;

function _acquireDmgEl() {
  let el = _dmgIndicatorPool.pop();
  if (!el) {
    el = document.createElement('div');
    el.className = 'damage-indicator';
  }
  return el;
}

function _releaseDmgEl(el) {
  if (!el) return;
  el.className = 'damage-indicator';
  el.textContent = '';
  el.style.removeProperty('--dx');
  el.style.removeProperty('--dy');
  if (_dmgIndicatorPool.length < _DMG_POOL_MAX) _dmgIndicatorPool.push(el);
}

window.onDamageInfoReceived = function (damage, hitgroup, flags) {
  const container = document.getElementById('damage-indicator-container');
  if (!container) return;

  while (container.childElementCount >= _DMG_POOL_MAX) {
    const old = container.firstElementChild;
    if (!old) break;
    container.removeChild(old);
    _releaseDmgEl(old);
  }

  const dmgEl = _acquireDmgEl();
  dmgEl.className = 'damage-indicator' + (hitgroup === 1 ? ' headshot' : '');
  dmgEl.textContent = '-' + damage;
  dmgEl.style.setProperty('--dx', (Math.random() * 60 - 30) + 'px');
  dmgEl.style.setProperty('--dy', (Math.random() * 60 - 30) + 'px');
  container.appendChild(dmgEl);

  setTimeout(() => {
    if (dmgEl.parentNode === container) container.removeChild(dmgEl);
    _releaseDmgEl(dmgEl);
  }, 1000);
};
