/**
 * @module game/renderStability
 * Stabilize GPU frame time without quality-preset UI.
 * - Lock devicePixelRatio to 1 (xash reads global DPR; Retina 2x causes fillrate swings)
 * - Canvas buffer === CSS size (soft 0.85 scale reverted — caused 50–65 FPS)
 */
const SCALE = 1; // 0.85 soft-scale FPS'i 50-65'e düşürdü — geri alındı

let _locked = false;
let _ro = null;
let _canvas = null;

function lockDevicePixelRatio() {
  if (_locked) return;
  try {
    const desc = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    if (desc && desc.configurable === false) return;
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      enumerable: true,
      get() { return 1; },
    });
    _locked = true;
  } catch (_) { /* ignore */ }
}

function applyCanvasBuffer(canvas) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const cssW = Math.max(1, Math.round(rect.width || canvas.clientWidth || 1));
  const cssH = Math.max(1, Math.round(rect.height || canvas.clientHeight || 1));
  const w = Math.max(1, Math.round(cssW * SCALE));
  const h = Math.max(1, Math.round(cssH * SCALE));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

export function startRenderStability(canvas) {
  if (!canvas) return;
  _canvas = canvas;
  lockDevicePixelRatio();
  applyCanvasBuffer(canvas);

  if (typeof ResizeObserver !== 'undefined') {
    if (_ro) _ro.disconnect();
    _ro = new ResizeObserver(() => applyCanvasBuffer(canvas));
    _ro.observe(canvas.parentElement || canvas);
  } else {
    window.addEventListener('resize', () => applyCanvasBuffer(canvas));
  }
}

export function stopRenderStability() {
  if (_ro) {
    try { _ro.disconnect(); } catch (_) { /* ignore */ }
    _ro = null;
  }
  _canvas = null;
}

window.BrowserCSRenderStability = { start: startRenderStability, stop: stopRenderStability, apply: () => applyCanvasBuffer(_canvas) };
