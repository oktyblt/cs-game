# OffscreenCanvas + Worker + SharedArrayBuffer — feasibility

## Goal
Move Xash/WebGL off the main thread so DOM/GC cannot create 75↔45 FPS oscillation.

## Current stack
- Package: `xash3d-fwgs` (`Xash3D` class)
- Options type: `canvas?: HTMLCanvasElement` only (no OffscreenCanvas in typings)
- Renderer: `gl4es` → `/wasm/libref_webgl2.wasm`
- Grep of `node_modules/xash3d-fwgs`: **no** `OffscreenCanvas`, `ENVIRONMENT_IS_WORKER`, or Worker entry
- App wiring: [`cs-web-game/src/game/engine.js`](../../cs-web-game/src/game/engine.js) constructs `Xash3DWebSocket({ canvas: gameCanvas, ... })` on main
- COOP/COEP already on `/oyna` → `SharedArrayBuffer` / `crossOriginIsolated` often available (splash already checks SAB)

## Verdict

| Item | Status |
|------|--------|
| Drop-in Worker migrate | **Not feasible** without forking/rebuilding xash3d-fwgs + Emscripten |
| SAB for net ring buffer | **Feasible now** (headers exist); best with Worker |
| OffscreenCanvas + stock xash3d-fwgs 0.2.x | **Blocked** — canvas assumed DOM/`HTMLCanvasElement`, JS glue uses window/document |
| Effort if forking Xash WASM | **High** (weeks): PROXY_TO_PTHREAD or custom worker bootstrap, input bridge, audio, pointer-lock proxy |

## Required work for full Worker path (if pursued)

1. Rebuild `xash.wasm` / `libref_webgl2.wasm` with worker-friendly Emscripten settings (or run entire Module inside Dedicated Worker with `OffscreenCanvas`)
2. Main thread: `transferControlToOffscreen()`, forward keyboard/mouse via SAB ring + `Atomics`
3. Move `Net` / WebRTC datachannel handling either:
   - into the same worker, or
   - main WebRTC ↔ SAB queue ↔ worker recvfrom/sendto
4. Keep pointer lock + DOM HUD on main; scoreboard already JS-side

## Spike recommendation (next engineering sprint)

Do **not** attempt full migrate in one PR. Order:

1. Keep packet pool GC fix (done) + PerfDiag validation
2. Prototype **SAB packet ring** between a Net Worker and main (engine still main) — proves zero-copy path
3. Separately spike empty WebGL on OffscreenCanvas in a worker (no Xash) to validate browser path
4. Only then fork xash3d-fwgs worker bootstrap

## Compatibility matrix (target browsers)

- Chrome/Edge: OffscreenCanvas WebGL + SAB — OK when COOP/COEP set
- Firefox: OK recent
- Safari: OffscreenCanvas OK recent; SAB needs isolation — verify `/oyna` headers

## Decision for BrowserCS

**Primary tech remains Worker+SAB**, but **blocked on Xash packaging**. Until fork exists, ship GC mitigations on main + evaluate **native shell fallback** in parallel.
