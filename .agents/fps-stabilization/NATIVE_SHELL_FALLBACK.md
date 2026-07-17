# Native shell fallback (Tauri / Electron) — evaluation

## When to use
If Worker+SAB cannot land because `xash3d-fwgs` has no OffscreenCanvas/Worker support (see WORKER_SAB_FEASIBILITY.md), and jitter remains after GC mitigations.

## Options

### A) Tauri 2 + system WebView (same WASM)
- Reuse BrowserCS web build inside WebView
- **Does not remove** Chromium/WebKit main-thread WASM cost unless WebView differs
- Gains: installable app, fewer browser extensions, controlled flags
- **Weak** for FPS jitter if still WASM+WebGL on UI thread

### B) Tauri/Electron + native Xash / HLDS client
- Real OpenGL/Vulkan client; browser only for account/server browser
- **Best** frame stability (matches “PC Krusher 100 FPS” class)
- Cost: dual client maintenance, update channel, anti-cheat/surface differences
- Product: browsercs.com becomes launcher, not the game runtime

### C) Electron + same WASM (not recommended)
- Heavier than Tauri; same GC/WebGL issues as Chrome

## Recommendation
1. Short term: stay in browser; GC pool + PerfDiag; push Xash worker fork research
2. If product requires stable competitive FPS in <1 month and Worker fork slips → **B (native client)** for gameplay, web for lobby
3. Do not invest in Electron-only wrapper expecting FPS miracles

## Exit criteria to trigger native track
- PerfDiag still shows `HIGH_FPS_JITTER` / `GC_LIKE` after packet pool + no Worker ETA
- Or Xash worker spike fails (canvas/audio/input blockers)
