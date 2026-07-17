# Render scale / aggressive cvars — deprioritized

Per Stabil FPS plan: oscillation 75↔45 is treated as **frame jitter** (GC / main thread), not steady GPU fillrate.

## Do not implement as primary
- DPR lock + 0.75 internal scale
- Mass cvar cuts (`r_dynamic 0`, decals, smoke caps) as the main FPS project

## When they become allowed
Only if `BrowserCSPerfDiag.report()` returns `GPU_FILLRATE_SUSPECT` as the dominant hint (low mean FPS, **low** stddev, few long tasks).

## Current status
Deprioritized. Engineering focus: diagnosis probe + GC packet pool + Worker/SAB feasibility + native fallback eval.
