# OffscreenCanvas + Worker + SharedArrayBuffer — feasibility

## Constraint (2026-07-17)
**Must stay in browser.** Native GL / Tauri / desktop client is out of scope.

## Goal
Move work off the main thread so DOM/GC cannot create 60↔80 FPS oscillation, while keeping browsercs.com one-click play.

## Current stack
- Package: `xash3d-fwgs` (`Xash3D` class)
- Options type: `canvas?: HTMLCanvasElement` only (no OffscreenCanvas in typings)
- Renderer: `gl4es` → `/wasm/libref_webgl2.wasm`
- Grep of `node_modules/xash3d-fwgs`: **no** `OffscreenCanvas`, `ENVIRONMENT_IS_WORKER`, or Worker entry
- App wiring: `cs-web-game/src/game/engine.js` — engine on main thread
- COOP/COEP already on `/oyna` → SharedArrayBuffer available when isolated

## Verdict

| Item | Status |
|------|--------|
| Full engine on OffscreenCanvas Worker | **Blocked** without forking xash3d-fwgs (weeks) |
| **Net Worker + SAB packet ring** (engine stays main) | **Feasible now** — next step |
| AudioWorklet (less ScriptProcessor wakeups) | Partial, already using `latencyHint: 'playback'` |
| Native shell | **Rejected** — browser-only product |

## Roadmap (browser-only)

1. Done: packet pool, DPR=1, WebGL desync, PerfDiag, soft-scale reverted
2. **Next:** Dedicated Worker owns WebRTC DataChannel; SAB ring ↔ main `recvfrom`/`sendto` (zero-copy intent, less main-thread alloc)
3. Later: fork Xash for OffscreenCanvas only if (2) is not enough

## Expected gain from Net Worker
- Less GC / less main-thread networking → tighter FPS band (e.g. 60↔80 → ~70±8)
- Does **not** move WebGL/WASM render off main — so not a Krusher-level jump
- Full OffscreenCanvas engine move would be the larger stability jump, still in-browser, but needs Xash fork
