/**
 * @module game/renderStability
 * Stabilize GPU frame time.
 * - Lock devicePixelRatio to 1 (xash reads global DPR; Retina 2x causes fillrate swings)
 * - Canvas buffer === CSS size × quality scale (low-end GPUs: 0.65–0.8)
 */
let SCALE = (() => {
  try {
    const s = +localStorage.getItem('bcs_q_scale');
    if (s >= 0.55 && s <= 1) return s;
  } catch (_) { /* ignore */ }
  return 1;
})();

let _locked = false;
let _ro = null;
let _canvas = null;
let _resizeTimer = 0;
let _lastW = 0;
let _lastH = 0;

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
  if (Math.abs(w - _lastW) <= 1 && Math.abs(h - _lastH) <= 1 && canvas.width === _lastW && canvas.height === _lastH) {
    return;
  }
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  _lastW = w;
  _lastH = h;
}

function scheduleApply(canvas) {
  if (_resizeTimer) clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    _resizeTimer = 0;
    applyCanvasBuffer(canvas);
  }, 150);
}

export function setRenderScale(scale) {
  SCALE = Math.max(0.55, Math.min(1, Number(scale) || 1));
  try { localStorage.setItem('bcs_q_scale', String(SCALE)); } catch (_) { /* ignore */ }
  if (_canvas) applyCanvasBuffer(_canvas);
  return SCALE;
}

export function getRenderScale() {
  return SCALE;
}

export function startRenderStability(canvas) {
  if (!canvas) return;
  _canvas = canvas;
  lockDevicePixelRatio();
  applyCanvasBuffer(canvas);

  if (typeof ResizeObserver !== 'undefined') {
    if (_ro) _ro.disconnect();
    _ro = new ResizeObserver(() => scheduleApply(canvas));
    _ro.observe(canvas.parentElement || canvas);
  } else {
    window.addEventListener('resize', () => scheduleApply(canvas));
  }
}

export function stopRenderStability() {
  if (_resizeTimer) {
    clearTimeout(_resizeTimer);
    _resizeTimer = 0;
  }
  if (_ro) {
    try { _ro.disconnect(); } catch (_) { /* ignore */ }
    _ro = null;
  }
  _canvas = null;
}

window.__bcsSetRenderScale = setRenderScale;
window.BrowserCSRenderStability = {
  start: startRenderStability,
  stop: stopRenderStability,
  apply: () => applyCanvasBuffer(_canvas),
  setScale: setRenderScale,
  getScale: getRenderScale,
};
