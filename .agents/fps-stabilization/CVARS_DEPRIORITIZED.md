# Render scale / aggressive cvars — deprioritized

Per Stabil FPS plan: oscillation is treated as **frame jitter** (GC / main thread / GPU variance), not steady GPU fillrate.

## Do not implement as primary
- Soft internal scale 0.75
- Mass cvar cuts as the main FPS project
- Quality preset UI

## Allowed stability-only measures (not quality presets)
- **DPR lock = 1** (`renderStability.js`) — kills Retina 2× overdraw swings
- WebGL `desynchronized` + `high-performance`
- Audio `latencyHint: 'playback'`
- Net packet pools / fewer allocs

## When soft scale/cvars become allowed
Only if `BrowserCSPerfDiag.report()` returns `GPU_FILLRATE_SUSPECT` as the dominant hint (low mean FPS, **low** stddev, few long tasks).
