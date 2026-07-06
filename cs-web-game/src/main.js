import { initAuth, getCurrentUsername, getCurrentUser, getSessionToken } from "./auth.js";
import { unzipSync } from 'fflate';

const ASSET_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:3000'
  : 'https://browsercs.com';

const API_URL = 'https://backend.browsercs.com';

// Fix for Xash3D Emscripten Black Sky Bug: Force WebGL alpha to false
// This prevents the browser from making the canvas transparent where alpha=0
const originalGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function(type, attributes) {
  if (type === 'webgl' || type === 'experimental-webgl' || type === 'webgl2') {
    attributes = attributes || {};
    attributes.alpha = false;
  }
  return originalGetContext.call(this, type, attributes);
};

// Fix for Browser AudioContext Autoplay Policy that silences game sounds.
// Browsers suspend AudioContext until a user gesture happens.
// We track all AudioContext instances and resume them on first click/keydown.
(function() {
  const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
  if (!OriginalAudioContext) return;
  const allAudioContexts = [];

  // Patch AudioContext constructor to track all instances
  const PatchedAudioContext = function(options) {
    const ctx = new OriginalAudioContext(options);
    allAudioContexts.push(ctx);
    return ctx;
  };
  PatchedAudioContext.prototype = OriginalAudioContext.prototype;
  window.AudioContext = PatchedAudioContext;
  if (window.webkitAudioContext) window.webkitAudioContext = PatchedAudioContext;

  // On first user gesture, resume all suspended AudioContexts
  const resumeAll = () => {
    allAudioContexts.forEach(ctx => {
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    });
  };

  document.addEventListener('mousedown', resumeAll, { capture: true });
  document.addEventListener('keydown', resumeAll, { capture: true });
  document.addEventListener('touchstart', resumeAll, { capture: true });

  // Also poll every 2s to resume any late-created AudioContexts (SDL2 creates its own)
  setInterval(resumeAll, 2000);
})();

// Fix for Emscripten SOCKFS Mixed Content (ws:// blocked on HTTPS).
// Xash3D's net layer maps all hostnames to 101.101.x.x virtual IPs.
// SOCKFS then tries to open ws://101.101.x.x/ which Chrome blocks on HTTPS.
// Solution: intercept 101.101.x.x WebSocket attempts and return a fake WS
// that fires onerror immediately so the engine can handle the failure gracefully.
// Real relay connections (wss://backend.browsercs.com) pass through unchanged.
(function() {
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
      send() {},
      close() {},
      addEventListener(type, fn) { if (type === 'error') setTimeout(() => fn && fn({ type: 'error' }), 0); },
      removeEventListener() {},
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
    if (protocols !== undefined) {
      return new OriginalWebSocket(url, protocols);
    }
    return new OriginalWebSocket(url);
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
window.addEventListener('error', (event) => {
  if (event.error instanceof WebAssembly.RuntimeError) {
    originalError && originalError.call(console, '[WASM Crash]', event.error.message);
    if (typeof addConsoleLog === 'function') {
      addConsoleLog(`[WASM Crash] ${event.error.message} — Yeniden bağlanmak için sayfayı yenileyiniz.`, 'err');
    }
    // Kullanıcıya UI mesajı göster
    const overlay = document.getElementById('fatal-error-overlay');
    if (overlay) {
      overlay.style.display = 'flex';
      const msg = document.getElementById('fatal-error-msg');
      if (msg) msg.textContent = `Engine crash: ${event.error.message}`;
    }
    event.preventDefault(); // default crash davranışını engelle
  }
});

// Tab tuşunun tarayıcı odaklanmasını bozmasını engelle (Skorbord için)
window.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
  }
});
// ----------------------------------------

// --- OVERRIDE window.alert (Xash3D engine alert suppress) ---
// Xash3D WASM, hata durumunda window.alert() çağırıyor.
// Bu tarayıcı diyaloglarını göstermek yerine kendi UI sistemimize yönlendirelim.
const _origAlert = window.alert;
window.alert = function(msg) {
  // "Xash Error" veya "Host_ErrorInit" gibi engine mesajlarını engelle
  const s = String(msg || '');
  if (s.includes('Xash Error') || s.includes('Host_ErrorInit') || s.includes('c0a0') || s.includes('Could not load model')) {
    // Sessizce log'a yaz, alert dialog gösterme
    originalError && originalError.call(console, '[Xash Alert - Suppressed]', s);
    // Sadece kritik hataları console'a yaz
    if (typeof addConsoleLog === 'function') {
      addConsoleLog(`[Engine] ${s}`, 'warn');
    }
    return;
  }
  // Diğer alertler için orijinal davranış
  _origAlert.call(window, msg);
};
window.confirm = function(msg) {
  // Engine onay diyaloglarını otomatik onayla
  return true;
};
// ----------------------------------------

// --- MONKEY PATCH WEBASSEMBLY MEMORY ---
// Emscripten is hardcoded to 256MB (4096 pages) and ALLOW_MEMORY_GROWTH=0 causes 
// detached ArrayBuffers when it tries to grow. We force the initial memory to 512MB (8192 pages).
const OriginalWebAssemblyMemory = WebAssembly.Memory;
WebAssembly.Memory = function(descriptor) {
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

console.log = function(...args) {
  originalLog.apply(console, args);
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  if (!msg.includes('[Engine Output]') && typeof addConsoleLog === 'function') {
    addConsoleLog(`[Log] ${msg}`);
  }
};

console.warn = function(...args) {
  originalWarn.apply(console, args);
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  if (typeof addConsoleLog === 'function') {
    addConsoleLog(`[Warn] ${msg}`, 'warn');
  }
};

console.error = function(...args) {
  originalError.apply(console, args);
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  if (!msg.includes('[Engine Error]') && typeof addConsoleLog === 'function') {
    addConsoleLog(`[Error] ${msg}`, 'err');
  }
};

import { Xash3D, Net } from 'xash3d-fwgs';

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
        if (u8[i] === 0x4C && u8[i+1] === 0x5A && u8[i+2] === 0x53 && u8[i+3] === 0x53) {
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

const originalRecvfrom = Net.prototype.recvfrom;
Net.prototype.recvfrom = function(fd, bufPtr, bufLen, flags, sockaddrPtr, socklenPtr) {
    const packet = this.incoming.pull();
    if (!packet) {
        return originalRecvfrom.call(this, fd, bufPtr, bufLen, flags, sockaddrPtr, socklenPtr);
    }
    const buffer = window.wasmMemory.buffer;
    const data = packet.data;
    let u8 = data instanceof Uint8Array ? data : new Uint8Array(data.buffer || data);
    
    let finalData = u8;

    // Önce tam paket başı LZSS kontrolü (eski yöntem)
    if (finalData.length > 8) {
        const view = new DataView(finalData.buffer, finalData.byteOffset, finalData.byteLength);
        if (view.getUint32(0, true) === 0x53535A4C) { // LZSS
            // const decompressed = lzssDecompress(finalData);
            if (decompressed) {
                finalData = decompressed;
            }
        }
    }

    // Fragment paketi içindeki LZSS'i decompress et
    // finalData = decompressFragmentLzss(finalData);

    const copyLen = Math.min(bufLen, finalData.length);
    if (copyLen > 0) new Uint8Array(buffer).set(finalData.subarray(0, copyLen), bufPtr);

    if (sockaddrPtr) {
        const heap8 = new Int8Array(buffer);
        const heap16 = new Int16Array(buffer);
        const port = packet.port;
        heap16[sockaddrPtr >> 1] = 2; // AF_INET
        heap8[sockaddrPtr + 2] = (port >> 8) & 0xff;
        heap8[sockaddrPtr + 3] = port & 0xff;
        heap8[sockaddrPtr + 4] = packet.ip[0];
        heap8[sockaddrPtr + 5] = packet.ip[1];
        heap8[sockaddrPtr + 6] = packet.ip[2];
        heap8[sockaddrPtr + 7] = packet.ip[3];
    }
    if (socklenPtr) new Int32Array(buffer)[socklenPtr >> 2] = 16;
    return copyLen;
};

// Override sendto to avoid Detached ArrayBuffer on WebAssembly Memory Grow
Net.prototype.sendto = function(fd, bufPtr, bufLen, flags, sockaddrPtr, socklenPtr) {
    const buffer = window.wasmMemory.buffer;
    const heapU8 = new Uint8Array(buffer);
    const [ip, port] = this.readSockaddrFast(sockaddrPtr);
    
    // Slice so we hold a separate copy in JS memory
    const packetCopy = heapU8.slice(bufPtr, bufPtr + bufLen);
    this.sender.sendto({ data: packetCopy, ip, port });
    return bufLen;
};

// Override sendtoBatch to avoid Detached ArrayBuffer
Net.prototype.sendtoBatch = function(fd, bufsPtr, lensPtr, count, flags, sockaddrPtr, socklenPtr) {
    const buffer = window.wasmMemory.buffer;
    const heap32 = new Int32Array(buffer);
    const heapU8 = new Uint8Array(buffer);
    
    let totalSize = 0;
    const [ip, port] = this.readSockaddrFast(sockaddrPtr);
    for (let i = 0; i < count; ++i) {
        const size = heap32[(lensPtr >> 2) + i];
        const packetPtr = heap32[(bufsPtr >> 2) + i];
        const slice = heapU8.slice(packetPtr, packetPtr + size);
        this.sender.sendto({
            data: slice,
            port,
            ip
        });
        totalSize += slice.length;
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
    }

    async init() {
        await super.init();
        await this.connectWs();
    }

    async connectWs() {
        return new Promise(async (resolve) => {
            if (!this.connectPort || this.connectPort === 'listen') {
                resolve();
                return;
            }
            
            const role = this.isHost ? 'host' : 'client';
            console.log(`[DEBUG] Connecting Xash3D Net WebRTC to port ${this.connectPort} (${role})`);
            addConsoleLog(`[Ağ] WebRTC ile bağlanılıyor (${role.toUpperCase()}): port ${this.connectPort}`, 'warn');
            
            // WebRTC bağlantısı 8 saniye içinde kurulamazsa, bekleme!
            // Engine'in açılmasını (menüye girmesini) engellememek için resolve atıyoruz.
            let resolved = false;
            const safeResolve = () => {
                if (!resolved) {
                    resolved = true;
                    resolve();
                }
            };
            setTimeout(safeResolve, 8000);
            
            const pc = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun.cloudflare.com:3478' },
                    { urls: 'stun:stun.twilio.com:3478' },
                    { urls: 'stun:stun.services.mozilla.com:3478' }
                ]
            });
            this.pc = pc;

            // Gerçek UDP deneyimi: unordered ve maxRetransmits=0
            const dc = pc.createDataChannel('xash3d', {
                ordered: false,
                maxRetransmits: 0
            });
            this.dc = dc;
            dc.binaryType = 'arraybuffer';
            
            dc.onopen = () => {
                console.log('[DEBUG] Net WebRTC DataChannel connected!');
                addConsoleLog('[Ağ] WebRTC UDP-Kanalı bağlantısı başarılı!', 'ok');
                
                // Keep-alive ping
                this._keepAliveInterval = setInterval(() => {
                    if (this.dc && this.dc.readyState === 'open') {
                        try { this.dc.send(new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF, 0x69])); } catch(e){}
                    }
                }, 15000);
                
                safeResolve();
            };
            
            dc.onerror = (e) => {
                console.error('[DEBUG] Net WebRTC DataChannel error', e);
                addConsoleLog('[Ağ] WebRTC bağlantı hatası!', 'err');
                safeResolve();
            };
            
            dc.onclose = () => {
                if (this._keepAliveInterval) clearInterval(this._keepAliveInterval);
                console.log('[DEBUG] Net WebRTC DataChannel closed');
                addConsoleLog(`[Ağ] WebRTC bağlantısı kapandı!`, 'err');
            };
            
            dc.onmessage = async (e) => {
                let buffer;
                try {
                    if (e.data instanceof ArrayBuffer) {
                        buffer = e.data;
                    } else if (e.data && typeof e.data.arrayBuffer === 'function') {
                        buffer = await e.data.arrayBuffer();
                    } else if (typeof e.data === 'string') {
                        const enc = new TextEncoder();
                        buffer = enc.encode(e.data).buffer;
                    } else {
                        return;
                    }
                } catch (err) {
                    console.error('[Ağ Log] Veri işleme hatası:', err);
                    return;
                }

                if (!buffer || buffer.byteLength === 0) return;
                
                this.packetCountRecv++;
                if (this.packetCountRecv <= 20) {
                    console.log(`[Ağ Log - Alınan #${this.packetCountRecv}] ${buffer.byteLength} byte veri alındı.`);
                }

                const srcIp = this.isHost ? [10, 0, 0, 2] : [10, 0, 0, 1];
                const srcPort = this.isHost ? 27005 : 27015;
                
                const packet = {
                    ip: srcIp,
                    port: srcPort,
                    data: new Int8Array(buffer)
                };

                try {
                    this.net.incoming.enqueue(packet);
                } catch (err) {
                    console.error("[Ağ Log] Xash3D enqueue hatası:", err);
                }
            };

            pc.onicecandidate = async (e) => {
                if (e.candidate && this.peerId) {
                    fetch(`${API_URL}/webrtc/candidate/${this.peerId}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ candidate: e.candidate.candidate, mid: e.candidate.sdpMid })
                    }).then(res => {
                        if (res.status === 404) this.peerId = null; // stop trying
                    }).catch(() => {});
                }
            };

            try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);

                const res = await fetch(`${API_URL}/webrtc/offer`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ gamePort: this.connectPort, sdp: pc.localDescription.sdp })
                });
                
                if (!res.ok) throw new Error('Signaling server responded with ' + res.status);
                
                const data = await res.json();
                if (data.error) throw new Error(data.error);

                this.peerId = data.peerId;
                await pc.setRemoteDescription(new RTCSessionDescription({ type: data.type, sdp: data.sdp }));

                // Sunucudan gelen ICE adaylarını topla
                this._candidateInterval = setInterval(async () => {
                    if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed' || pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
                        clearInterval(this._candidateInterval);
                        return;
                    }
                    try {
                        if (!this.peerId) {
                            clearInterval(this._candidateInterval);
                            return;
                        }
                        const cRes = await fetch(`${API_URL}/webrtc/candidates/${this.peerId}`);
                        if (cRes.status === 404) {
                            clearInterval(this._candidateInterval);
                            return;
                        }
                        if (cRes.ok) {
                            const cands = await cRes.json();
                            for (let c of cands) {
                                await pc.addIceCandidate(new RTCIceCandidate({ candidate: c.candidate, sdpMid: c.mid })).catch(()=>{});
                            }
                        }
                    } catch(err){}
                }, 1000);

            } catch (err) {
                console.error('[WebRTC] Signaling Hatası:', err);
                addConsoleLog('[Ağ] WebRTC Signaling Hatası: ' + err.message, 'err');
                safeResolve();
            }
        });
    }

    sendto(packet) {
        if (packet.ip) this.lastTargetIp = packet.ip;
        if (packet.port) this.lastTargetPort = packet.port;

        if (!this.dc || this.dc.readyState !== 'open') return;

        const ip = packet.ip;

        if (this.isHost) {
            // HOST (Listen Server) mode
            if (!ip || ip[0] === 127) return;
        } else {
            // CLIENT mode
            if (!ip || ip[0] !== 10) return;
        }

        this.packetCountSend++;
        if (this.packetCountSend <= 20) {
            const dest = ip ? ip.join('.') : '?';
            console.log(`[Ağ Log - Gönderilen #${this.packetCountSend}] ${packet.data.byteLength} byte → ${dest}:${packet.port}`);
            addConsoleLog(`[Ağ] Paket #${this.packetCountSend} gönderiliyor: ${packet.data.byteLength} byte`, 'ok');
        }

        const cleanBuffer = new Uint8Array(packet.data).buffer;
        try {
            this.dc.send(cleanBuffer);
        } catch(e) {}
    }

}

// ─── Durum ───────────────────────────────────────────────────────────────────
let xash          = null;
let currentMap    = null;
let engineRunning = false;
let maps          = [];
let activeFilter  = 'all';
let consoleOpen   = false;

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
const $ = id => document.getElementById(id);
const splashEl        = $('splash');
const splashBar       = $('splash-bar');
const splashStatus    = $('splash-status');
const engineDot       = $('engine-dot');
const engineStatusTxt = $('engine-status-text');
const mapList         = $('map-list');
const mapSearch       = $('map-search');
const previewPanel    = $('preview-panel');
const noMapState      = $('no-map-state');
const mapCard         = $('map-card');
const cardMapName     = $('card-map-name');
const cardMapType     = $('card-map-type');
const cardMapDesc     = $('card-map-desc');
const btnLaunch       = $('btn-launch');
const gameWrapper     = $('game-wrapper');
const gameCanvas      = $('canvas');
const toolbarMapName  = $('toolbar-map-name');
const fpsDisplay      = $('fps-display');
const loadingOverlay  = $('loading-overlay');
const loadingMapName  = $('loading-map-name');
const loadingProgress = $('loading-progress-fill');
const loadingLog      = $('loading-log');
const consolePanel    = $('console-panel');
const consoleLog      = $('console-log');
const consoleInput    = $('console-input');
const btnConsole      = $('btn-console');
const btnCopyConsole  = $('btn-copy-console');
const btnDownloadQConsole = $('btn-download-qconsole');
const notifContainer  = $('notifications');
const mapCountInfo    = $('map-count-info');
const tabMaps         = $('tab-maps');
const tabServers      = $('tab-servers');
const tabAdmin        = $('tab-admin');
const serverList      = $('server-list');
const btnCreateServer = $('btn-create-server');
const adminPanel      = $('admin-panel');
const activeServersContainer = $('active-servers-container');

const userNicknameInput     = $('user-nickname');
const serverNameInput       = $('server-name-input');
const maxPlayersSelect      = $('max-players-select');
const fullServerBrowser     = $('full-server-browser');
const fullServersGrid       = $('full-active-servers-grid');
const btnCloseServerBrowser = $('btn-close-server-browser');
const btnRefreshServers     = $('btn-refresh-servers');
const onlineServersCount    = $('online-servers-count');

if (userNicknameInput) {
  userNicknameInput.value = localStorage.getItem('cs_nickname') || 'Player';
  userNicknameInput.addEventListener('input', () => {
    localStorage.setItem('cs_nickname', userNicknameInput.value.trim() || 'Player');
  });
}

// ─── Yardımcılar ─────────────────────────────────────────────────────────────

function notify(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `notif ${type === 'error' ? 'error' : type === 'success' ? 'success' : ''}`;
  el.textContent = msg;
  notifContainer.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

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
  try {
    if (typeof consoleLog === 'undefined' || !consoleLog) {
      originalLog.apply(console, [`[Erken Log] ${msg}`]);
      return;
    }
    const p = document.createElement('p');
    p.className = `log-line ${cls}`;
    p.textContent = msg;
    consoleLog.appendChild(p);
    consoleLog.scrollTop = consoleLog.scrollHeight;
  } catch (e) {
    originalError.apply(console, ['addConsoleLog hatası:', e]);
  }
}

// Güvenli konsol komutu çalıştırma yardımcısı (Doğrudan WASM _Cmd_ExecuteString çağrısı yapar)
function executeEngineCommand(cmd) {
  if (!xash || !xash.em) {
    console.warn('[Konsol] Komut gönderilemedi, engine hazır değil:', cmd);
    return;
  }
  
  const command = cmd.endsWith('\n') ? cmd : cmd + '\n';
  
  try {
    const em = xash.em;
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
          console.log(`[Konsol] direct-wasm-asm üzerinden komut çalıştırıldı: ${cmd}`);
          return;
        }
      }
    }
    
    // Fallback 1: C-style exports on em or em.Module
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
        console.log(`[Konsol] direct-wasm-export üzerinden komut çalıştırıldı: ${cmd}`);
        return;
      }
    }
    
    // Fallback 2: em.ccall
    if (typeof em.ccall === 'function') {
      em.ccall('Cmd_ExecuteString', null, ['string'], [command]);
      console.log(`[Konsol] Komut çalıştırıldı (em.ccall): ${cmd}`);
    } 
    // Fallback 3: em.Module.ccall
    else if (em.Module && typeof em.Module.ccall === 'function') {
      em.Module.ccall('Cmd_ExecuteString', null, ['string'], [command]);
      console.log(`[Konsol] Komut çalıştırıldı (em.Module.ccall): ${cmd}`);
    } 
    // Fallback 4: xash.Cmd_ExecuteString
    else {
      xash.Cmd_ExecuteString(command);
      console.log(`[Konsol] Komut çalıştırıldı (Cmd_ExecuteString): ${cmd}`);
    }
  } catch (e) {
    console.error('[Konsol] Komut çalıştırma hatası:', e);
  }
}

function addLoadingLog(msg, cls = '') {
  const p = document.createElement('p');
  if (cls) p.className = cls;
  p.textContent = msg;
  loadingLog.appendChild(p);
  loadingLog.scrollTop = loadingLog.scrollHeight;
}

function setProgress(pct, msg) {
  loadingProgress.style.width = `${pct}%`;
  if (msg) addLoadingLog(msg, pct >= 90 ? 'ok' : '');
}

function getMapType(name) {
  if (name.startsWith('de_')) return { prefix: 'de', label: 'BOMB DEFUSAL' };
  if (name.startsWith('cs_')) return { prefix: 'cs', label: 'HOSTAGE RESCUE' };
  if (name.startsWith('as_')) return { prefix: 'as', label: 'ASSASSINATION' };
  if (name.startsWith('es_')) return { prefix: 'es', label: 'ESCAPE' };
  return { prefix: '?', label: 'UNKNOWN' };
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

// ─── Harita Listesi ───────────────────────────────────────────────────────────

async function loadMapList() {
  try {
    const res = await fetch(`${ASSET_URL}/api/maps`);
    const data = await res.json();
    maps = (data && data.maps && data.maps.length > 0) ? data.maps : [
      { name: 'de_dust2', size: 2686884, description: 'Bomb Defusal' },
      { name: 'de_dust', size: 1986440, description: 'Bomb Defusal' },
      { name: 'cs_assault', size: 2100000, description: 'Hostage Rescue' },
      { name: 'de_inferno', size: 2450000, description: 'Bomb Defusal' },
      { name: 'cs_office', size: 2300000, description: 'Hostage Rescue' },
      { name: 'de_aztec', size: 2800000, description: 'Bomb Defusal' }
    ];
    mapCountInfo.textContent = `📁 ${maps.length} harita mevcut`;
    renderMapList();
    return true;
  } catch (err) {
    console.warn('Map list fetch warning, using defaults:', err);
    maps = [
      { name: 'de_dust2', size: 2686884, description: 'Bomb Defusal' },
      { name: 'de_dust', size: 1986440, description: 'Bomb Defusal' },
      { name: 'cs_assault', size: 2100000, description: 'Hostage Rescue' },
      { name: 'de_inferno', size: 2450000, description: 'Bomb Defusal' },
      { name: 'cs_office', size: 2300000, description: 'Hostage Rescue' },
      { name: 'de_aztec', size: 2800000, description: 'Bomb Defusal' }
    ];
    mapCountInfo.textContent = `📁 ${maps.length} harita mevcut (Varsayılan)`;
    renderMapList();
    return true;
  }
}

function renderMapList() {
  const query  = mapSearch.value.toLowerCase();
  const filter = activeFilter;

  const filtered = maps.filter(m => {
    const matchSearch = m.name.toLowerCase().includes(query);
    const matchFilter = filter === 'all' || m.name.startsWith(filter + '_');
    return matchSearch && matchFilter;
  });

  if (filtered.length === 0) {
    mapList.innerHTML = `<div style="padding:1rem;font-family:var(--font-hud);font-size:0.7rem;color:var(--text-dim);">Sonuç bulunamadı</div>`;
    return;
  }

  mapList.innerHTML = filtered.map(m => {
    const type      = getMapType(m.name);
    const isSelected = m.name === currentMap;
    return `
      <div class="map-item ${isSelected ? 'selected' : ''}" data-map="${m.name}">
        <span class="map-badge ${type.prefix}">${type.prefix.toUpperCase()}</span>
        <span class="map-name">${m.name}</span>
        <span class="map-size">${formatSize(m.size)}</span>
      </div>`;
  }).join('');

  mapList.querySelectorAll('.map-item').forEach(el => {
    el.addEventListener('click', () => selectMap(el.dataset.map));
  });
}

function selectMap(name) {
  currentMap = name;
  renderMapList();

  const map  = maps.find(m => m.name === name);
  const type = getMapType(name);
  const maxPl = parseInt(document.getElementById('max-players-select')?.value || '16');
  const half  = Math.floor(maxPl / 2);

  noMapState.style.display = 'none';
  mapCard.style.display    = 'block';
  cardMapName.textContent  = name;
  if (cardMapType) cardMapType.textContent = `${type.label} — COUNTER-STRIKE 1.5`;
  if (cardMapDesc) cardMapDesc.textContent = map?.description || 'CS 1.5 klasik haritası.';
  btnLaunch.disabled       = false;

  // Team capacities
  const ctCap = document.getElementById('ct-team-capacity');
  const tCap  = document.getElementById('t-team-capacity');
  const vsBadge = document.getElementById('vs-badge-text');
  if (ctCap) ctCap.textContent = `${half} Oyuncu`;
  if (tCap)  tCap.textContent  = `${half} Oyuncu`;
  if (vsBadge) vsBadge.textContent = `${half}v${half}`;

  // Thumbnail background
  const thumb = document.getElementById('map-thumb-hero');
  if (thumb) {
    const thumbUrl = `https://browsercs.com/cs-assets/thumbnails/${name}.jpg`;
    thumb.style.backgroundImage = 'none';
    fetch(thumbUrl, { mode: 'cors', cache: 'force-cache' }).then(r => r.blob()).then(blob => {
        thumb.style.backgroundImage = `url('${URL.createObjectURL(blob)}')`;
    }).catch(()=>{});
    thumb.style.backgroundSize = 'cover';
    thumb.style.backgroundPosition = 'center';
  }

  // Type badge
  const typeBadge = document.getElementById('map-type-badge');
  if (typeBadge) {
    typeBadge.textContent = type.label;
    typeBadge.className = 'map-thumb-badge';
    if (name.startsWith('de_')) typeBadge.classList.add('bomb');
    else if (name.startsWith('cs_')) typeBadge.classList.add('hostage');
    else typeBadge.classList.add('escape');
  }
}


// ─── EM FS Yardımcıları ───────────────────────────────────────────────────────

/**
 * Emscripten FS'de iç içe dizin oluşturur (mkdir -p benzeri).
 */
function fsMkdirP(em, fullPath) {
  const parts = fullPath.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current += '/' + part;
    try { em.FS.mkdir(current); } catch (e) { /* Zaten var */ }
  }
}

// ─── Engine Başlatma ──────────────────────────────────────────────────────────

async function initEngine(mapName, connectPort = null, isHost = false) {
  if (engineRunning && xash) {
    if (connectPort) {
      // Zaten açıksa konsol komutu ile bağlan
      addConsoleLog(`connect wss://backend.browsercs.com/ws/${connectPort}`);
      // TODO: xash konsoluna komut gönderme
    } else {
      changeMap(mapName);
    }
    return;
  }

  // UI geçişi
  gameWrapper.classList.add('active');
  previewPanel.classList.add('hidden');
  loadingOverlay.classList.add('active');
  loadingMapName.textContent = mapName;
  toolbarMapName.textContent = mapName;
  loadingLog.innerHTML       = '';
  loadingProgress.style.width = '0%';
  btnLaunch.disabled = true;

  setEngineStatus('Oyun dosyaları indiriliyor...', 'orange');

  // Akıllı Önbellek (Cache API) - Her girişte 250MB indirmeyi engeller
  async function cachedFetch(url, noCache = false) {
    if (noCache) return fetch(url);
    try {
      const cache = await caches.open('cs-assets-v1');
      const req = new Request(url);
      let res = await cache.match(req);
      if (res) {
        console.log('[Cache] Yüklendi:', url);
        return res;
      }
      res = await fetch(url);
      if (res.ok && res.status === 200 && !(res.headers.get("content-type") || "").includes("text/html")) {
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
    const wasmRes = await cachedFetch('/wasm/xash.wasm');
    if (!wasmRes.ok) throw new Error('xash.wasm indirilemedi');
    const wasmBinary = await wasmRes.arrayBuffer();


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
      } catch(e) {}
      return dummySprBuffer;
    }

    const [
      gfxRes, fontsRes,
      csServerRes, csClientRes, csMenuRes,
      fsRes, glRes,
      vDeltaRes, vRcRes, cDeltaRes, cCfgRes, serverCfgRes, cmdMenuRes,
      dotSprBuffer, animglowSprBuffer, richoSprBuffer, shellchromeSprBuffer, crosshairsSprBuffer
    ] = await Promise.all([
      cachedFetch(`${ASSET_URL}/cs-assets/valve/gfx.wad`),
      cachedFetch(`${ASSET_URL}/cs-assets/valve/fonts.wad`),
      cachedFetch('/wasm/dlls/cs_emscripten_wasm32_v9.wasm'),
      cachedFetch('/wasm/cl_dlls/client_emscripten_wasm32_v9.wasm'),
      cachedFetch('/wasm/cl_dlls/menu_emscripten_wasm32_v9.wasm'),
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
      safeFetchSprite(`${ASSET_URL}/cs-assets/cstrike/sprites/crosshairs.spr`)
    ]);

    addLoadingLog(`✓ Sprite'lar yüklendi (Fallbacks aktif)`);

    setProgress(50, 'Ekstra harita dokuları (WAD) sırayla indiriliyor...');
    const wadsRes = await cachedFetch(`${ASSET_URL}/api/wads`, true);
    const { wads } = await wadsRes.json();
    
    const downloadedWads = [];
    for (const wad of wads) {
      const res = await cachedFetch(`${ASSET_URL}/cs-assets/cstrike/${wad}`);
      if (res.ok && !(res.headers.get("content-type") || "").includes("text/html")) {
        const wadData = new Uint8Array(await res.arrayBuffer());
        downloadedWads.push({ name: wad, data: wadData });
      }
    }

    const valveWadsList = ['halflife1.wad', 'halflife2.wad', 'cached.wad', 'decals.wad', 'liquids.wad', 'pldecal.wad', 'spraypaint.wad', 'xeno.wad', 'fonts.wad', 'gfx.wad'];
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
    const bspRes = await cachedFetch(`${ASSET_URL}/cs-assets/cstrike/maps/${mapName}.bsp`);
    if (!bspRes.ok) throw new Error(`${mapName}.bsp indirilemedi`);
    const bspBuffer = new Uint8Array(await bspRes.arrayBuffer());

    // ── Adım 2: Xash3D WASM instance oluştur ────────────────────────────────
    setProgress(65, 'Xash3D WASM instance oluşturuluyor...');

      // WebGL 2.0 desteği kontrolü
      const checkGL = gameCanvas.getContext('webgl2') || gameCanvas.getContext('webgl') || gameCanvas.getContext('experimental-webgl');
      if (!checkGL) {
        alert("Oyun motoru başlatılamadı! Bilgisayarınızın ekran kartı veya tarayıcınız WebGL teknolojisini desteklemiyor. \n\nLütfen Chrome/Edge ayarlarından 'Donanım Hızlandırma' (Hardware Acceleration) seçeneğinin AÇIK olduğundan emin olun veya ekran kartı sürücülerinizi güncelleyin.");
        throw new Error('WebGL desteklenmiyor.');
      }

      const nickname = (userNicknameInput && userNicknameInput.value.trim()) ? userNicknameInput.value.trim() : 'Player';

      let xashArgs = [
        '-windowed',
        '-game', 'cstrike',
        '+setinfo', '_vgui_menus 0',
        '+mp_consistency', '0',
        '+sv_lan', '0',
        '+sv_allow_download', '1',
        '+cl_allowdownload', '0',
        '+cl_download_ingame', '0',
        '+cl_lw', '0',
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
        '+cl_updaterate', '101',
        '+cl_cmdrate', '101',
        '+rate', '100000',
        '+ex_interp', '0.01',
        '+fps_max', '100',
        // In-game console error overlay'i kapat
        '+sensitivity', '3',
        '+zoom_sensitivity_ratio', '1.2',
        '+cl_bob', '0.01',
        '+cl_bobup', '0.5',
        '+r_drawviewmodel', '1',
        '+hud_fastswitch', '1',
        '+gl_clear', '1',
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

      xash = new Xash3DWebSocket({
        canvas: gameCanvas,
        arguments: xashArgs,
        connectPort: actualWsPort,
        isHost: isHost,
        renderer: 'gl4es',
        module: {
          INITIAL_MEMORY: 536870912 // 512 MB to prevent memory growth (which detaches ArrayBuffer)
        },

      libraries: {
        menu:   '/wasm/cl_dlls/menu_emscripten_wasm32_v9.wasm',
        client: '/wasm/cl_dlls/client_emscripten_wasm32_v9.wasm',
        server: '/wasm/dlls/cs_emscripten_wasm32_v9.wasm',
        render: {
          gl4es: '/wasm/libref_webgl2.wasm'
        }
      },

      filesMap: {
        'filesystem_stdio.wasm': '/wasm/filesystem_stdio.wasm',
        'cl_dlls/menu_emscripten_wasm32.wasm':   '/wasm/cl_dlls/menu_emscripten_wasm32_v9.wasm',
        'cl_dlls/client_emscripten_wasm32.wasm': '/wasm/cl_dlls/client_emscripten_wasm32_v9.wasm',
        'dlls/cs_emscripten_wasm32.wasm':        '/wasm/dlls/cs_emscripten_wasm32_v9.wasm',
        'dlls/hl_emscripten_wasm32.wasm':        '/wasm/dlls/cs_emscripten_wasm32_v9.wasm',
      },

      module: {
        keyboardListeningElement: gameCanvas,
        wasmBinary,
        INITIAL_MEMORY: 536870912, // 320 MB (to completely avoid memory growth and Detached ArrayBuffer issues)
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
                console.log(`[Memory] Büyütüldü: +${pages} page → ${Math.round(memRef.buffer.byteLength / 1048576)} MB`);
                
                // CRITICAL FIX: Notify Emscripten JS runtime about the memory growth
                // This updates HEAPU8, HEAP32 etc. globally so we don't get Detached ArrayBuffer!
                if (envObj['emscripten_notify_memory_growth']) {
                    envObj['emscripten_notify_memory_growth'](0);
                }
                
                return 1;
              } catch(e) {
                console.error('[Memory] grow() başarısız:', e.message, 'istenen:', Math.round(requestedSize/1048576)+'MB', 'mevcut:', Math.round(oldSize/1048576)+'MB');
                return 0;
              }
            };
          };

          if (imports.env) patchResize(imports.env);
          if (imports['wasi_snapshot_preview1']) patchResize(imports['wasi_snapshot_preview1']);

          WebAssembly.instantiate(wasmBinary, imports).then(output => {
            memRef = output.instance.exports.memory;
            window.wasmMemory = memRef; // Expose globally so Net.sendto can read the always-valid buffer!
            console.log('[Memory] WASM hafızası alındı:', Math.round(memRef.buffer.byteLength / 1048576), 'MB');
            successCallback(output.instance, output.module);
          }).catch(e => {
            console.error('[WASM] instantiate hatası:', e);
          });

          return {}; // async instantiation sinyali
        },
        preRun: [(em) => {
          addLoadingLog('Sanal dosya sistemi (FS) kuruluyor...');
          const safeMkdir = (dir) => { try { em.FS.mkdir(dir); } catch(e) {} };
          
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
          em.FS.open = function(path, flags, mode) {
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
                    try { em.FS.mkdir(current); } catch(err) {}
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
                   addLoadingLog(`İndiriliyor: ${file.split('/').pop()}...`);
                   const res = await cachedFetch(file);
                   if (res.ok) {
                       const buf = new Uint8Array(await res.arrayBuffer());
                       const filename = file.split('/').pop();
                       const targetPath = file.includes('valve_') ? `/valve/${filename}` : `/cstrike/${filename}`;
                       em.FS.writeFile(targetPath, buf);
                       loadedCount++;
                       setProgress(20 + Math.floor((loadedCount / pk3Files.length) * 60), `İndirildi: ${filename}`);
                   }
                } catch (e) {
                   console.error(`[Assets] Dosya indirilemedi: ${file}`, e);
                }
             }
             addLoadingLog(`📦 ${loadedCount} adet oyun paketi (.pk3) başarıyla sisteme yazıldı.`, 'ok');
             console.log("[DEBUG VFS] /cstrike/ contents:", em.FS.readdir('/cstrike'));
             console.log("[DEBUG VFS] /valve/ contents:", em.FS.readdir('/valve'));
             
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
                      try { em.FS.writeFile(path, buf); } catch(e) {
                         // Fallback create dir
                         if (path.includes('/resource/')) {
                            const isValve = path.startsWith('/valve');
                            try { em.FS.mkdir(isValve ? '/valve/resource' : '/cstrike/resource'); } catch(e2) {}
                            em.FS.writeFile(path, buf);
                         }
                      }
                   }
                } catch (e) {}
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

          downloadedValveWads.forEach(wad => {
            if (wad.name === 'halflife1.wad') {
              halflife1Data = wad.data;
            } else if (wad.name === 'halflife2.wad') {
              halflife2Data = wad.data;
            } else {
              em.FS.writeFile(`/valve/${wad.name}`, wad.data);
            }
          });

          if (halflife1Data && halflife2Data) {
            const combined = new Uint8Array(halflife1Data.length + halflife2Data.length);
            combined.set(halflife1Data);
            combined.set(halflife2Data, halflife1Data.length);
            em.FS.writeFile(`/valve/halflife.wad`, combined);
          }

          addLoadingLog(`📦 Dosyalar RAM dosya sistemine yazıldı. (+${downloadedWads.length + downloadedValveWads.length} WAD)`, 'ok');

          // ─── KRİTİK: WASM crash'e neden olan sprite'lar ─────────────────────
          // CS 1.5 kurulumunda cstrike/sprites/ dizininde bulunmuyorlar.
          // Bunlar asset server'ın dmc/sprites fallback'inden gerçek dosyalar olarak
          // yüklendi ve şimdi VFS'e yazılıyor. Bu eksiklik WASM memory crash'ine neden oluyordu.
          em.FS.writeFile('/cstrike/sprites/dot.spr',         dotSprBuffer);
          em.FS.writeFile('/cstrike/sprites/animglow01.spr',  animglowSprBuffer);
          em.FS.writeFile('/cstrike/sprites/richo1.spr',      richoSprBuffer);
          em.FS.writeFile('/cstrike/sprites/shellchrome.spr', shellchromeSprBuffer);
          em.FS.writeFile('/cstrike/sprites/crosshairs.spr',  crosshairsSprBuffer);
          // valve/sprites dizinine de yaz (bazı CS sürümleri oradan okur)
          try { em.FS.mkdir('/valve/sprites'); } catch(e) {}
          em.FS.writeFile('/valve/sprites/dot.spr',         dotSprBuffer);
          em.FS.writeFile('/valve/sprites/animglow01.spr',  animglowSprBuffer);
          em.FS.writeFile('/valve/sprites/richo1.spr',      richoSprBuffer);
          em.FS.writeFile('/valve/sprites/shellchrome.spr', shellchromeSprBuffer);
          em.FS.writeFile('/valve/sprites/crosshairs.spr',  crosshairsSprBuffer);
          // ─────────────────────────────────────────────────────────────────────

          // CS 1.6 missing sprites (for CS 1.5 compatibility)
          const missingSprites = [
            '/cstrike/sprites/shadow_circle.spr',
            '/cstrike/sprites/gas_puff_01.spr',
            '/cstrike/sprites/voiceicon.spr',
            '/cstrike/sprites/radaropaque.spr',
            '/cstrike/sprites/radio.spr',
            '/cstrike/sprites/sniper_scope.spr'
          ];
          missingSprites.forEach(path => em.FS.writeFile(path, dummySprBuffer));

          // CS 1.6 Sniper Scope dummy TGA files (CS 1.5 assets lack these, causing client.dll to crash)
          const tgaWidth = 16, tgaHeight = 16;
          const tgaHeader = new Uint8Array([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, tgaWidth & 0xFF, (tgaWidth >> 8) & 0xFF, tgaHeight & 0xFF, (tgaHeight >> 8) & 0xFF, 32, 8]);
          const tgaData = new Uint8Array(tgaWidth * tgaHeight * 4);
          const dummyTga = new Uint8Array(tgaHeader.length + tgaData.length);
          dummyTga.set(tgaHeader);
          dummyTga.set(tgaData, tgaHeader.length);
          
          em.FS.writeFile('/cstrike/sprites/scope_arc_nw.tga', dummyTga);
          em.FS.writeFile('/cstrike/sprites/scope_arc_ne.tga', dummyTga);
          em.FS.writeFile('/cstrike/sprites/scope_arc_sw.tga', dummyTga);
          em.FS.writeFile('/cstrike/sprites/scope_arc_se.tga', dummyTga);
          em.FS.writeFile('/cstrike/sprites/scope_arc.tga', dummyTga);

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
          em.FS.writeFile('/cstrike/config.cfg', cCfgBuffer);
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
          } catch(e) {
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
          } catch(e) {
            addLoadingLog('SOCKFS override uyarısı: ' + e.message, 'warn');
          }
          // ─────────────────────────────────────────────────────────────────────

        }],
        print: (log) => {
          if (log.includes('Could not get TCP/IPv6 address')) return;
          if (log.includes('File exists from loopback')) return;
          if (log.includes('ScriptProcessorNode')) return;
          // İZLEM: Disconnect/kick sebebini bul
          if (log.includes('Disconnect') || log.includes('disconnect') ||
              log.includes('CRC') || log.includes('differ') ||
              log.includes('reject') || log.includes('kick') ||
              log.includes('resource') || log.includes('Resource') ||
              log.includes('spawn') || log.includes('Spawn') ||
              log.includes('begin') || log.includes('new\n') ||
              log.includes('team') || log.includes('inconsistent')) {
            console.warn('[ENGINE KEY]', log);
            addConsoleLog('>>> ' + log, 'warn');
          } else {
            console.log('[Engine Output]', log);
            addConsoleLog(log);
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
          console.error('[Engine Error]', log);
          addConsoleLog(log, !log.includes('WARNING') ? 'err' : 'warn');
        },
      },
    });

    setProgress(80, 'Engine init (boot) ediliyor...');
    await xash.init();
    console.log('[DEBUG] xash.init() completed successfully!');

    // ── Adım 4: Engine main loop başlat ─────────────────────────────
    setProgress(88, 'Engine ana döngüsü başlatılıyor...');
    xash.main();
    console.log('[DEBUG] xash.main() completed successfully!');
    engineRunning = true;

    setProgress(100, 'Oyun başladı! 🎮');
    setEngineStatus('Engine çalışıyor — WebGL2', 'green');
    notify('Oyun başladı! Canvas\'a tıkla → mouse yakala', 'success');

    // İstemci +connect argümanı ile başladığı için ekstra komut göndermeye gerek yok.
    // Motor otomatik olarak sunucuya bağlanacak.

    // Loading overlay'i gizle
    setTimeout(async () => {
      if (window.pk3Promise) {
        setProgress(95, 'Oyun assetlerinin indirilmesi bekleniyor...');
        await window.pk3Promise;
      }
      setProgress(100, 'Tamamlandı!');
      
      // Delay before hiding so user sees 100%
      setTimeout(() => {
        loadingOverlay.classList.remove('active');
        gameCanvas.focus();
        startFPSCounter();

        // Eğer istemciysek ve uzak sunucuya bağlanmamız gerekiyorsa:
        if (!isHost && connectPort && connectPort !== 'listen' && connectPort !== true) {
          console.log('[DEBUG] Assetler yüklendi, uzak sunucuya bağlanılıyor...');
          if (typeof addConsoleLog === 'function') addConsoleLog('Assetler tamamlandı. Sunucuya bağlanılıyor...', 'ok');
          executeEngineCommand('connect 10.0.0.1:27015');
        }

        // ── Keybind overlay: oyuna girilince 9 saniye göster ─────────
        const keybindOverlay = document.getElementById('keybind-overlay');
        if (keybindOverlay) {
          keybindOverlay.style.display = 'block';
          setTimeout(() => { keybindOverlay.style.display = 'none'; }, 9000);
        }
      }, 500);
    }, 1500);

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

    // ── Reconnect butonu ─────────────────────────────────────────
    const reconnectOverlay = document.getElementById('reconnect-overlay');
    const btnReconnect = document.getElementById('btn-reconnect');
    if (btnReconnect) {
      btnReconnect.addEventListener('click', () => {
        if (reconnectOverlay) reconnectOverlay.classList.remove('show');
        // Motora yeniden bağlan komutu gönder
        if (xash && engineRunning) {
          executeEngineCommand('connect 10.0.0.1:27015');
        }
      });
    }

    // WebSocket kapanınca reconnect overlay göster
    window.addEventListener('xash3d-ws-closed', () => {
      if (reconnectOverlay) reconnectOverlay.classList.add('show');
    });

    // Focus canvas automatically on click
    gameCanvas.addEventListener('click', () => {
      if (document.activeElement !== gameCanvas) {
        gameCanvas.focus();
      }
      if (engineRunning && !document.pointerLockElement) {
        // Tarayıcı kilit reddettiğinde ESC vb basılırsa oyun menüye düşüyor.
        // Ekrana tıkladığında zorla kilidi geri isteyelim.
        try { gameCanvas.requestPointerLock(); } catch(e) {}
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
      if (msg) msg.textContent = 'Engine iç hatası (WASM assert/crash). Sayfayı yenileyin.';
      engineRunning = false;
      return;
    }
    console.error('Engine hatası:', err);
    addLoadingLog(`⚠ HATA: ${errMsg}`, 'warn');
    addConsoleLog(`Engine başlatma hatası: ${errMsg}`, 'err');
    notify(`Engine hatası: ${errMsg}`, 'error');
    setEngineStatus('Engine hatası', 'red');

    if (errMsg.includes('magic word')) {
      addLoadingLog('→ WASM dosyası yanlış yüklenmiş.', 'warn');
    }
    if (errMsg.includes('SharedArrayBuffer')) {
      addLoadingLog('→ COOP/COEP headers eksik.', 'warn');
    }

    engineRunning = false;
    xash = null;
    btnLaunch.disabled = false;

    setTimeout(() => {
      loadingOverlay.classList.remove('active');
      gameWrapper.classList.remove('active');
      previewPanel.classList.remove('hidden');
    }, 4000);
  }
}

function changeMap(mapName) {
  if (!xash || !engineRunning) return;
  loadingMapName.textContent  = mapName;
  toolbarMapName.textContent  = mapName;
  loadingLog.innerHTML        = '';
  loadingOverlay.classList.add('active');
  loadingProgress.style.width = '20%';
  addLoadingLog(`Harita değişiyor: ${mapName}`, 'ok');

  // Önce yeni BSP'yi EM FS'ye yaz
  const em = xash.em;
  fetch(`/cs-assets/maps/${mapName}.bsp`)
    .then(r => r.arrayBuffer())
    .then(buf => {
      fsMkdirP(em, '/cstrike/maps');
      em.FS.writeFile(`/cstrike/maps/${mapName}.bsp`, new Uint8Array(buf));
      setProgress(70, `${mapName}.bsp yüklendi`);
      executeEngineCommand(`map ${mapName}`);
      setProgress(90, 'Harita yükleniyor...');
      setTimeout(() => {
        setProgress(100, 'Hazır!');
        setTimeout(() => {
          loadingOverlay.classList.remove('active');
          currentMap = mapName;
        }, 800);
      }, 2000);
    })
    .catch(err => {
      addLoadingLog(`Harita yüklenemedi: ${err.message}`, 'warn');
      setTimeout(() => loadingOverlay.classList.remove('active'), 2000);
    });
}

// ─── FPS Sayacı ───────────────────────────────────────────────────────────────

function startFPSCounter() {
  let frameCount = 0;
  let lastTime   = performance.now();

  // Canvas her frame'de render edildiğinde sayacı artır
  const observer = new PerformanceObserver(() => frameCount++);
  try { observer.observe({ entryTypes: ['frame'] }); } catch (e) { /* desteklenmiyor */ }

  setInterval(() => {
    if (!engineRunning) return;
    const now     = performance.now();
    const elapsed = (now - lastTime) / 1000;
    if (elapsed >= 1) {
      // Alternatif FPS hesaplama — requestAnimationFrame bazlı
      lastTime   = now;
      frameCount = 0;
    }
  }, 1000);

  // requestAnimationFrame ile basit FPS counter
  let rafCount   = 0;
  let rafLast    = performance.now();
  function rafLoop() {
    if (!engineRunning) return;
    rafCount++;
    const now = performance.now();
    const ramDisplay = document.getElementById('ram-display');
    if (now - rafLast >= 1000) {
      fpsDisplay.textContent = `${rafCount} FPS`;
      if (ramDisplay && performance && performance.memory) {
        const mb = Math.round(performance.memory.usedJSHeapSize / (1024 * 1024));
        ramDisplay.textContent = `${mb} MB RAM`;
      }
      rafCount = 0;
      rafLast  = now;
    }
    requestAnimationFrame(rafLoop);
  }
  requestAnimationFrame(rafLoop);
}

// ─── Konsol ───────────────────────────────────────────────────────────────────

function toggleConsole() {
  consoleOpen = !consoleOpen;
  consolePanel.classList.toggle('open', consoleOpen);
  if (consoleOpen) {
    consoleInput.focus();
  } else {
    consoleInput.blur();
    if (engineRunning) gameCanvas.focus();
  }
}

consoleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const cmd = consoleInput.value.trim();
    if (cmd && xash) {
      addConsoleLog(`] ${cmd}`, 'ok');
      executeEngineCommand(cmd);
      consoleInput.value = '';
    }
  } else if (e.key === 'Escape') {
    toggleConsole();
  }
});

btnConsole.addEventListener('click', () => {
  toggleConsole();
});

btnCopyConsole.addEventListener('click', () => {
  const lines = Array.from(consoleLog.querySelectorAll('.log-line'))
    .map(el => el.textContent)
    .join('\n');
  navigator.clipboard.writeText(lines)
    .then(() => notify('Konsol logları panoya kopyalandı!', 'success'))
    .catch(() => notify('Loglar kopyalanamadı!', 'error'));
});

btnDownloadQConsole.addEventListener('click', () => {
  if (!xash || !xash.em) {
    notify('Oyun henüz başlatılmadı!', 'error');
    return;
  }
  try {
    const em = xash.em;
    let logContent = null;
    const pathsToTry = [
      '/cstrike/qconsole.log',
      '/rwdir/cstrike/qconsole.log',
      '/qconsole.log',
      '/valve/qconsole.log',
      '/rwdir/valve/qconsole.log'
    ];
    for (const p of pathsToTry) {
      try {
        logContent = em.FS.readFile(p, { encoding: 'utf8' });
        if (logContent) {
          console.log(`[Console Log] Found qconsole.log at ${p}`);
          break;
        }
      } catch (e) {}
    }
    if (!logContent) {
      const FS = em.FS || (em.Module && em.Module.FS);
      if (FS) {
        for (const p of pathsToTry) {
          try {
            logContent = FS.readFile(p, { encoding: 'utf8' });
            if (logContent) break;
          } catch (e) {}
        }
      }
    }
    if (!logContent) {
      notify('qconsole.log bulunamadı veya henüz yazılmadı!', 'error');
      return;
    }
    
    const blob = new Blob([logContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'qconsole.log';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    notify('qconsole.log başarıyla indirildi!', 'success');
  } catch (e) {
    console.error(e);
    notify('Log indirme hatası: ' + e.message, 'error');
  }
});

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
// Removed local currentUser, using auth.js instead
let isPremium = false;

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
  btnBuyPremium.addEventListener('click', () => {
    if (!getCurrentUser()) {
      notify('Önce giriş yapmalısınız!', 'error');
      return;
    }
    isPremium = true;
    if (premiumModal) premiumModal.style.display = 'none';
    if (badgePremium) badgePremium.style.display = 'inline-block';
    notify('Premium satın alındı! Artık sunucu kurabilirsiniz.', 'success');
  });
}
// ---------------------------------------------------
if (maxPlayersSelect) {
  maxPlayersSelect.addEventListener('change', updateTeamSizes);
}

// ── Hızlı Katıl: Giriş gerektirmez, mevcut açık sunucuya bağlanır ──────────
const btnQuickJoin = document.getElementById('btn-quick-join');
if (btnQuickJoin) {
  btnQuickJoin.addEventListener('click', async () => {
    if (!currentMap) { notify('Önce bir harita seçin!', 'error'); return; }
    const nickname = (userNicknameInput && userNicknameInput.value.trim()) ? userNicknameInput.value.trim() : 'Player';

    btnQuickJoin.disabled = true;
    btnQuickJoin.textContent = 'SUNUCU ARANIYORY...';

    try {
      // Mevcut sunucuları listele
      const res = await fetch(`${API_URL}/api/servers`);
      const data = await res.json();
      const servers = data.servers || [];

      // Seçili haritayla eşleşen aktif sunucu ara
      let target = servers.find(s => s.map === currentMap && s.online);
      if (!target) {
        // Harita yoksa herhangi bir aktif sunucuya katıl
        target = servers.find(s => s.online);
      }

      if (target) {
        notify(`"${target.name}" sunucusuna bağlanıyor...`, 'success');
        window.connectToServer(target.port, target.map, false);
      } else {
        // Hiç sunucu yoksa — varsayılan port 27015'e bağlan
        notify(`${currentMap} için sunucu bulunamadı. Varsayılan porta bağlanılıyor...`, 'warn');
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
    notify('Sunucu kurmak için giriş yapmalısınız!', 'error');
    return;
  }
  
  if (!isPremium) {
    if (premiumModal) premiumModal.style.display = 'flex';
    return;
  }
  
  // Arayüz butonunu dondur
  btnLaunch.disabled = true;
  const originalText = btnLaunch.textContent;
  btnLaunch.textContent = 'SUNUCU OLUŞTURULUYOR...';

  const sName = (serverNameInput && serverNameInput.value.trim()) ? serverNameInput.value.trim() : 'CS 1.5 Web Oda';
  const nickname = (userNicknameInput && userNicknameInput.value.trim()) ? userNicknameInput.value.trim() : 'Player';
  const maxP = maxPlayersSelect ? parseInt(maxPlayersSelect.value) : 16;

  try {
    const res = await fetch(`${API_URL}/api/start-server`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ map: currentMap, maxplayers: maxP, name: sName, host: nickname })
    });
    const data = await res.json();
    
    if (data.success) {
      notify(`"${data.name}" kuruldu! (Tarayıcı İçi Host P2P)`, 'success');
      
      // Heartbeat: sunucuyu her 5 dakikada bir yeniden kaydet (KV TTL'yi canlı tut)
      if (window._serverHeartbeat) clearInterval(window._serverHeartbeat);
      window._serverHeartbeat = setInterval(async () => {
        try {
          const token = await getSessionToken();
          await fetch(`${API_URL}/api/start-server`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            },
            body: JSON.stringify({
              map: data.map || currentMap,
              maxplayers: maxP,
              name: sName,
              host: nickname,
              roomId: data.port  // Aynı room ID ile güncelle
            })
          });
          console.log('[Sunucu] Heartbeat gönderildi - kayıt yenilendi');
        } catch(e) {
          console.warn('[Sunucu] Heartbeat hatası:', e.message);
        }
      }, 5 * 60 * 1000); // 5 dakika
      
      // Motoru tarayıcı içi host (listen server) modunda ve relay ile başlat
      window.connectToServer(data.port, data.map || currentMap, true);
    } else {
      notify('Sunucu başlatılamadı!', 'error');
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
    
    if (onlineServersCount) {
      onlineServersCount.textContent = `(${data.servers ? data.servers.length : 0} Açık Oda)`;
    }

    if (data.servers && data.servers.length > 0) {
      if (activeServersContainer) activeServersContainer.innerHTML = '';
      if (fullServersGrid) fullServersGrid.innerHTML = '';

      data.servers.forEach(server => {
        let displayName = server.name;
        let displayHost = server.host || 'Anonim';
        let badgeText = '🟢 CANLI P2P';
        let playersCount = server.players !== undefined ? server.players : '?';
        
        // Resmi / Kullanıcı Sunucu Kontrolü
        if (server.isOfficial === true) {
          displayName = 'BrowserCS';
          displayHost = 'BrowserCS (Resmi)';
          badgeText = '⭐ RESMİ SUNUCU';
        } else if (server.isOfficial === false) {
          displayHost = 'Oyuncu Sunucusu';
          badgeText = '🚀 DEDICATED';
        } else if (displayName.startsWith('CS Server') && (!server.host || server.host === 'Anonim')) {
          // Fallback for older API format if isOfficial is undefined but it matches pattern
          displayName = 'BrowserCS';
          displayHost = 'BrowserCS (Resmi)';
          badgeText = '⭐ RESMİ SUNUCU';
        }

        // Soldaki Mini Liste
        if (activeServersContainer) {
          const div = document.createElement('div');
          div.className = 'map-item';
          div.innerHTML = `
            <div style="position: relative; width: 100%; height: 80px; overflow: hidden; border-radius: 4px; border: 1px solid var(--border);">
              <img crossorigin="anonymous" src="${ASSET_URL}/maps/${server.map}.jpg" alt="${server.map}" style="width: 100%; height: 100%; object-fit: cover;" onerror="if(!this.dataset.err){this.dataset.err='1';this.src='${ASSET_URL}/maps/de_dust2.jpg';}else{this.style.display='none';}" />
              <div style="position:absolute; bottom:4px; right:4px; background:rgba(0,0,0,0.8); padding:2px 6px; border-radius:4px; font-size:0.75rem; color:#4caf50; font-weight:bold; border: 1px solid #4caf50;">
                👤 ${playersCount}/${server.maxplayers}
              </div>
            </div>
            <div style="font-weight: bold; color: var(--text-bright); text-align: center; margin-top: 6px; font-size: 0.85rem;">${displayName}</div>
            <div style="font-size: 0.75rem; color: var(--text-dim); text-align: center;">${server.map}</div>
          `;
          div.addEventListener('click', () => {
            window.connectToServer(server.port, server.map, false);
            if (fullServerBrowser) fullServerBrowser.classList.remove('active');
          });
          activeServersContainer.appendChild(div);
        }

        // Sağdaki Tam Ekran Box Box Grid Kartı
        if (fullServersGrid) {
          const defaultImgUrl = `${ASSET_URL}/cs-assets/cs_bg.png`;
          const card = document.createElement('div');
          card.className = 'server-card-box anim-fade-in';
          card.innerHTML = `
            <div class="server-card-thumb" style="position: relative;">
              <img crossorigin="anonymous" src="${defaultImgUrl}" style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover; opacity:0.6; z-index:0;" onerror="this.style.display='none'" />
              <span class="server-badge-live" style="z-index:2;">${badgeText}</span>
              <span class="server-thumb-map-text" style="z-index:2;">${server.map}</span>
            </div>
            <div class="server-card-body">
              <div class="server-card-name">${displayName}</div>
              <div class="server-card-meta">
                <span>🗺️ ${server.map}</span>
                <span>👤 ${playersCount}/${server.maxplayers} Oyuncu</span>
              </div>
              <div style="font-size:0.72rem; color:var(--text-dim); margin-top:3px;">👑 Kurucu: <b>${displayHost}</b></div>
              <div style="display:flex; gap:0.4rem; margin-top:0.4rem;">
                <button class="btn-join-room" style="flex:1;">▶ ODAYA KATIL</button>
                ${(server.owner_id && getCurrentUser() && server.owner_id === getCurrentUser().id) ? 
                  `<button class="btn-join-room" style="background:var(--bg-deep); border:1px solid var(--border-bright); color:var(--text-bright); padding:0 0.8rem; font-size:1rem;" title="Sunucu Ayarları" onclick="openServerSettings('${server.id}')">⚙️</button>`
                  : ''}
              </div>
            </div>
          `;
          card.querySelector('.btn-join-room').addEventListener('click', () => {
            window.connectToServer(server.port, server.map, false);
            if (fullServerBrowser) fullServerBrowser.classList.remove('active');
          });
          fullServersGrid.appendChild(card);
        }
      });
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

if (tabServers && tabMaps) {
  tabServers.addEventListener('click', () => {
    tabServers.classList.add('active');
    tabMaps.classList.remove('active');
    if (tabAdmin) tabAdmin.classList.remove('active');
    if (fullServerBrowser) fullServerBrowser.classList.add('active');
    loadServerList();
  });

  tabMaps.addEventListener('click', () => {
    tabMaps.classList.add('active');
    tabServers.classList.remove('active');
    if (tabAdmin) tabAdmin.classList.remove('active');
    if (fullServerBrowser) fullServerBrowser.classList.remove('active');
    mapList.style.display = 'flex';
    serverList.style.display = 'none';
    if (adminPanel) adminPanel.style.display = 'none';
    mapSearch.style.display = 'block';
  });

  if (tabAdmin) {
    tabAdmin.addEventListener('click', () => {
      tabAdmin.classList.add('active');
      tabMaps.classList.remove('active');
      tabServers.classList.remove('active');
      if (fullServerBrowser) fullServerBrowser.classList.remove('active');
      mapList.style.display = 'none';
      serverList.style.display = 'none';
      if (adminPanel) adminPanel.style.display = 'block';
      mapSearch.style.display = 'none';
    });
  }
}

if (btnCloseServerBrowser) {
  btnCloseServerBrowser.addEventListener('click', () => {
    if (fullServerBrowser) fullServerBrowser.classList.remove('active');
    if (tabMaps && tabServers) {
      tabMaps.classList.add('active');
      tabServers.classList.remove('active');
      if (tabAdmin) tabAdmin.classList.remove('active');
      mapList.style.display = 'flex';
      serverList.style.display = 'none';
      if (adminPanel) adminPanel.style.display = 'none';
      mapSearch.style.display = 'block';
    }
  });
}

// ─── MASTER ADMIN LOGIC ────────────────────────────────────────────────────────
const btnMasterAdmin = $('btn-master-admin');
const adminLoginModal = $('admin-login-modal');
const btnAdminLoginCancel = $('btn-admin-login-cancel');
const btnAdminLoginSubmit = $('btn-admin-login-submit');
const adminPasswordInput = $('admin-password-input');
const masterAdminPanel = $('master-admin-panel');
const btnAdminPanelClose = $('btn-admin-panel-close');
const masterAdminTableBody = $('master-admin-table-body');

let adminToken = localStorage.getItem('cs_admin_token') || null;

if (btnMasterAdmin) {
  btnMasterAdmin.addEventListener('click', () => {
    if (adminToken) {
      openMasterAdminPanel();
    } else {
      adminLoginModal.style.display = 'flex';
    }
  });
}

if (btnAdminLoginCancel) {
  btnAdminLoginCancel.addEventListener('click', () => {
    adminLoginModal.style.display = 'none';
  });
}

if (btnAdminLoginSubmit) {
  btnAdminLoginSubmit.addEventListener('click', async () => {
    const password = adminPasswordInput.value;
    if (!password) return notify('Şifre giriniz', 'error');
    try {
      const res = await fetch(`${API_URL}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (data.success && data.token) {
        adminToken = data.token;
        localStorage.setItem('cs_admin_token', adminToken);
        adminLoginModal.style.display = 'none';
        notify('Admin girişi başarılı!', 'success');
        openMasterAdminPanel();
      } else {
        notify('Hatalı şifre!', 'error');
      }
    } catch (e) {
      notify('Sunucu bağlantı hatası', 'error');
    }
  });
}

if (btnAdminPanelClose) {
  btnAdminPanelClose.addEventListener('click', () => {
    masterAdminPanel.style.display = 'none';
  });
}

async function openMasterAdminPanel() {
  masterAdminPanel.style.display = 'flex';
  masterAdminTableBody.innerHTML = '<tr><td colspan="6" style="padding:1rem;text-align:center;">Yükleniyor...</td></tr>';
  
  try {
    const res = await fetch(`${API_URL}/api/servers`);
    const data = await res.json();
    if (!data.success) throw new Error('API Hatası');
    
    const servers = data.servers || [];
    masterAdminTableBody.innerHTML = servers.map(s => `
      <tr style="border-bottom:1px solid var(--border);transition:all 0.2s;">
        <td style="padding:0.5rem;font-weight:bold;color:var(--text-bright);">${s.name}</td>
        <td style="padding:0.5rem;">
          <span style="background:${s.isOfficial ? 'rgba(33,150,243,0.1)' : 'rgba(255,152,0,0.1)'};color:${s.isOfficial ? '#2196f3' : '#ff9800'};padding:2px 6px;border-radius:3px;font-size:0.65rem;">
            ${s.isOfficial ? 'RESMİ' : 'OYUNCU'}
          </span>
        </td>
        <td style="padding:0.5rem;color:var(--cs-yellow);">${s.map || '?'}</td>
        <td style="padding:0.5rem;">${s.players}/${s.maxplayers}</td>
        <td style="padding:0.5rem;">${s.port || 'Bekliyor'}</td>
        <td style="padding:0.5rem;display:flex;gap:0.4rem;">
          <button class="toolbar-btn" style="border-color:var(--cs-green);color:var(--cs-green);" onclick="openServerSettings('${s.id}')">AYARLAR</button>
          <button class="toolbar-btn" style="border-color:var(--cs-yellow);color:var(--cs-yellow);" onclick="masterAdminAction('restart', '${s.id}')">RESTART</button>
          <button class="toolbar-btn danger" onclick="masterAdminAction('delete', '${s.id}')">SİL</button>
        </td>
      </tr>
    `).join('');
    
    if (servers.length === 0) {
      masterAdminTableBody.innerHTML = '<tr><td colspan="6" style="padding:1rem;text-align:center;">Aktif sunucu bulunamadı.</td></tr>';
    }
  } catch (e) {
    masterAdminTableBody.innerHTML = `<tr><td colspan="6" style="padding:1rem;text-align:center;color:var(--cs-red);">Bağlantı Hatası</td></tr>`;
  }
}

window.masterAdminAction = async function(action, id) {
  if (!adminToken) return notify('Yetkisiz işlem!', 'error');
  
  if (action === 'delete') {
    if (!confirm('Bu sunucuyu tamamen silmek istediğine emin misin?')) return;
    try {
      const res = await fetch(`${API_URL}/api/admin/servers/${id}`, {
        method: 'DELETE',
        headers: { 'x-admin-token': adminToken }
      });
      const data = await res.json();
      if (data.success) {
        notify('Sunucu silindi!', 'success');
        openMasterAdminPanel(); // yenile
      } else {
        notify('Silinemedi: ' + data.error, 'error');
      }
    } catch(e) { notify('Silme hatası', 'error'); }
  } 
  else if (action === 'restart') {
    if (!confirm('Bu sunucuyu yeniden başlatmak istediğine emin misin?')) return;
    try {
      // Mevcut restart endpoint'i (şimdilik tokensız da çalışıyor backend'de)
      const token = await getSessionToken();
      const res = await fetch(`${API_URL}/api/servers/${id}/restart`, {
        method: 'POST',
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      const data = await res.json();
      if (data.success) {
        notify('Sunucu yeniden başlatılıyor...', 'success');
        setTimeout(() => openMasterAdminPanel(), 2000); // 2 saniye sonra yenile
      } else {
        notify('Restart başarısız: ' + data.error, 'error');
      }
    } catch(e) { notify('Restart hatası', 'error'); }
  }
};

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

window.openServerSettings = function(id) {
  currentSettingsServerId = id;
  serverSettingsModal.style.display = 'flex';
  // Reset tabs to RCON
  tabRcon.click();
  $('rcon-console-output').textContent = 'Bağlantı hazır. RCON şifresini girip komut gönderin.';
  $('rcon-auth-pass').value = '';
  $('rcon-command-input').value = '';
};

if (btnSettingsClose) {
  btnSettingsClose.addEventListener('click', () => {
    serverSettingsModal.style.display = 'none';
  });
}

// Tab Switching
if (tabRcon && tabGeneral && tabAmx) {
  function switchTab(activeBtn, activeView) {
    [tabRcon, tabGeneral, tabAmx].forEach(t => { t.classList.remove('active'); t.style.borderBottom = 'none'; });
    [settingsRconView, settingsGeneralView, settingsAmxView].forEach(v => v.style.display = 'none');
    activeBtn.classList.add('active');
    activeBtn.style.borderBottom = '2px solid var(--cs-yellow)';
    activeView.style.display = 'flex';
  }
  tabRcon.addEventListener('click', () => switchTab(tabRcon, settingsRconView));
  tabGeneral.addEventListener('click', () => switchTab(tabGeneral, settingsGeneralView));
  tabAmx.addEventListener('click', () => switchTab(tabAmx, settingsAmxView));
}

// RCON SEND
if ($('btn-rcon-send')) {
  $('btn-rcon-send').addEventListener('click', async () => {
    const password = $('rcon-auth-pass').value;
    const command = $('rcon-command-input').value;
    const out = $('rcon-console-output');
    
    if (!password) { notify('RCON Şifresi gerekli!', 'error'); return; }
    if (!command) return;
    
    out.textContent += `\n] ${command}\nİşleniyor...`;
    $('rcon-command-input').value = '';
    
    try {
      const res = await fetch(`${API_URL}/api/servers/${currentSettingsServerId}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rconPassword: password, command })
      });
      const data = await res.json();
      if (data.success) {
        out.textContent += `\n${data.response || 'OK'}`;
      } else {
        out.textContent += `\nHATA: ${data.error}`;
      }
    } catch(e) {
      out.textContent += `\nBağlantı hatası!`;
    }
    out.scrollTop = out.scrollHeight;
  });
}

// GENERAL SETTINGS SAVE
if ($('btn-cfg-save')) {
  $('btn-cfg-save').addEventListener('click', async () => {
    const rconPass = $('cfg-rcon-pass').value;
    const startMoney = $('cfg-startmoney').value;
    const gravity = $('cfg-gravity').value;
    const roundTime = $('cfg-roundtime').value;
    
    $('btn-cfg-save').disabled = true;
    $('btn-cfg-save').textContent = 'KAYDEDİLİYOR...';
    try {
      const res = await fetch(`${API_URL}/api/servers/${currentSettingsServerId}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rconPassword: rconPass, startMoney, gravity, roundTime })
      });
      const data = await res.json();
      if (data.success) {
        notify('Ayarlar kaydedildi ve sunucu yeniden başlatıldı!', 'success');
        serverSettingsModal.style.display = 'none';
      } else {
        notify('Hata: ' + data.error, 'error');
      }
    } catch(e) { notify('Bağlantı hatası', 'error'); }
    $('btn-cfg-save').disabled = false;
    $('btn-cfg-save').textContent = 'AYARLARI KAYDET VE SUNUCUYU YENİDEN BAŞLAT';
  });
}

// AMX MOD ADMIN SAVE
if ($('btn-amx-save')) {
  $('btn-amx-save').addEventListener('click', async () => {
    const adminName = $('amx-admin-name').value;
    const adminPassword = $('amx-admin-pass').value;
    
    if (!adminName) { notify('Admin ismi gerekli!', 'error'); return; }
    
    $('btn-amx-save').disabled = true;
    $('btn-amx-save').textContent = 'EKLENİYOR...';
    try {
      const res = await fetch(`${API_URL}/api/servers/${currentSettingsServerId}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminName, adminPassword })
      });
      const data = await res.json();
      if (data.success) {
        notify(`${adminName} başarıyla admin yapıldı!`, 'success');
        serverSettingsModal.style.display = 'none';
      } else {
        notify('Hata: ' + data.error, 'error');
      }
    } catch(e) { notify('Bağlantı hatası', 'error'); }
    $('btn-amx-save').disabled = false;
    $('btn-amx-save').textContent = 'ADMİNİ EKLE VE SUNUCUYU YENİDEN BAŞLAT';
  });
}

// Admin Panel Mock Listeners (eski)
const btnAdminChangeMap = $('btn-admin-changemap');
const btnAdminSetPass = $('btn-admin-setpass');
const btnAdminRestart = $('btn-admin-restart');
const btnAdminStop = $('btn-admin-stop');

if (btnAdminChangeMap) {
  btnAdminChangeMap.addEventListener('click', () => {
    const map = $('admin-map-select').value;
    notify(`RCON komutu gönderildi: map ${map}`, 'info');
  });
}
if (btnAdminSetPass) {
  btnAdminSetPass.addEventListener('click', () => {
    const pass = $('admin-rcon-pass').value;
    notify(`Sunucu şifresi ayarlandı: ${pass ? pass : '(Şifresiz)'}`, 'info');
  });
}
if (btnAdminRestart) {
  btnAdminRestart.addEventListener('click', () => {
    notify('Sunucu yeniden başlatılıyor...', 'warn');
  });
}
if (btnAdminStop) {
  btnAdminStop.addEventListener('click', () => {
    notify('Sunucu kapatıldı!', 'error');
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
      notify('Sunucu kurmak için giriş yapmalısınız!', 'error');
      return;
    }
    if (!isPremium) {
      if (premiumModal) premiumModal.style.display = 'flex';
      return;
    }

    try {
      const mapToPlay = currentMap || 'de_dust2';
      btnCreateServer.disabled = true;
      btnCreateServer.textContent = 'KURULUYOR...';

      const sName = (serverNameInput && serverNameInput.value.trim()) ? serverNameInput.value.trim() : 'CS 1.5 Web Oda';
      const nickname = (userNicknameInput && userNicknameInput.value.trim()) ? userNicknameInput.value.trim() : 'Player';
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

// ─── INIT ─────────────────────────────────────────────────────────────────────

async function checkWasmFiles() {
  return true;
}

async function runSplash() {
  setSplash('Sistem başlatılıyor...', 5);
  await new Promise(r => setTimeout(r, 200));

  // WebGL2 kontrolü
  setSplash('WebGL2 desteği kontrol ediliyor...', 20);
  const testCanvas = document.createElement('canvas');
  const hasWebGL2  = !!testCanvas.getContext('webgl2');
  if (!hasWebGL2) {
    notify('⚠ WebGL2 desteklenmiyor! Chrome veya Firefox güncel sürüm gerekli.', 'error');
  }

  // SharedArrayBuffer kontrolü
  setSplash('WASM SharedArrayBuffer kontrol ediliyor...', 35);
  const hasSAB = typeof SharedArrayBuffer !== 'undefined';
  if (!hasSAB) {
    notify('⚠ SharedArrayBuffer yok — COOP/COEP headers eksik olabilir.', 'error');
  }

  
  // Asset server bağlantısı
  setSplash('Asset server\'a bağlanılıyor...', 50);
  const serverOk = await loadMapList();

  setSplash('WASM dosyaları kontrol ediliyor...', 75);
  // WASM dosyaları /wasm/ altında — public/ statik olarak serve edilir
  // const wasmOk = await checkWasmFiles();
  const wasmOk = true;

  if (serverOk && wasmOk) {
    setSplash('Her şey hazır!', 100);
    setTimeout(() => {
      splashEl.style.opacity = '0';
      setTimeout(() => splashEl.remove(), 500);
      // boot(); // We will call renderMaps instead if boot doesn't exist
      renderMapList();
    }, 800);
  } else {
    splashStatus.innerHTML = '<span style="color:var(--cs-red);">Hata: Eksik dosyalar veya bağlantı sorunu var!</span>';
  }
}
window.connectToServer = async function(port, mapName, isHost = false) {
  if (engineRunning) {
    alert("Oyun zaten açık! Lütfen sayfayı yenileyip tekrar deneyin.");
    return;
  }
  
  // Mikrofon izni iste (Xash3D voice support için)
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('[Audio] Microphone permission granted.');
    }
  } catch(err) {
    console.warn('[Audio] Microphone permission denied or not available:', err);
    if (typeof notify === 'function') notify('Mikrofon erişimi reddedildi, sesli iletişim çalışmayacak.', 'warn');
  }

  // Açık modalları kapat
  document.querySelectorAll('.modal, .modal-overlay, [id$="-modal"]').forEach(el => el.style.display = 'none');

  // Arayüzü gizle, oyunu göster
  const sidebar = $('sidebar');
  const header = $('header');
  if (sidebar) sidebar.style.display = 'none';
  if (header) header.style.display = 'none';
  if (gameWrapper) gameWrapper.classList.add('active'); // .hidden değil, .active kullanılmalı!

  // initEngine'i çağır
  initEngine(mapName, port, isHost);
};

// --- INIT ---
runSplash();
initAuth();
