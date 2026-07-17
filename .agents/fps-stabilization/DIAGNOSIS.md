# FPS jitter diagnosis (static + runtime)

## Symptom
In-game FPS oscillates ~75 → 45–50 repeatedly (not only on fire). Feels like lag/stutter.

## Static root-cause findings (code)

| Source | Evidence | Class |
|--------|----------|--------|
| Per-packet `Uint8Array.slice` on sendto | `Net.prototype.sendto` copied HEAP every outbound packet | **GC_LIKE** |
| Extra `ArrayBuffer.slice` before `dc.send` | When view was not whole-buffer, second alloc per packet | **GC_LIKE** |
| Main-thread WASM + WebRTC + DOM HUD | `engine.js` gl4es on main; scoreboard/bridges on same thread | **MAIN_THREAD** |
| Periodic timers | audio poll, WebRTC keepalive, MOTD, promo interval | **MAIN_THREAD** (secondary) |
| 512MB WASM heap + grow notify | Less frequent than per-packet GC | **HEAP_GROWTH** (occasional) |

Fillrate/DPR is **not** the primary match for *oscillation*; it would look like a flat lower FPS.

## Runtime probe

`cs-web-game/src/game/frameDiagnostics.js` → `window.BrowserCSPerfDiag`

1. Open `/oyna?bcsdiag=1` (or `localStorage.setItem('bcs_perf_diag','1')`)
2. Join a server, play 20–30s
3. Console: `BrowserCSPerfDiag.report()`
4. Read `rootCauseHints`:
   - `GC_LIKE_FRAME_PAUSES` / `MAIN_THREAD_LONG_TASK` / `HIGH_FPS_JITTER` → Worker+SAB path
   - `GPU_FILLRATE_SUSPECT` only → then consider render scale (deprioritized)

Chrome Performance (manual): record 10s in-game → look for yellow **GC** bars and **Long Task** on Main; if those align with FPS dips, diagnosis confirmed.

## Mitigation applied with this diagnosis

Outbound net path now uses a **packet buffer pool** + direct `RTCDataChannel.send(TypedArray)` (no per-packet `slice`). This reduces GC pressure on the main thread while the Worker migration is evaluated.
