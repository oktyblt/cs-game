/**
 * Scaffold only — documents how a future engine worker would boot.
 * Stock xash3d-fwgs does not accept OffscreenCanvas; this file is not wired into production.
 *
 * Enable later via: new Worker(new URL('./engineWorker.spike.js', import.meta.url), { type: 'module' })
 */
/* eslint-disable no-undef */
self.onmessage = async (ev) => {
  const msg = ev.data || {};
  if (msg.type === 'ping') {
    self.postMessage({
      type: 'pong',
      sab: typeof SharedArrayBuffer !== 'undefined',
      offscreen: typeof OffscreenCanvas !== 'undefined',
      note: 'Xash Module must be forked before canvas transfer is usable',
    });
    return;
  }
  if (msg.type === 'init-offscreen') {
    // msg.canvas would be OffscreenCanvas from transferControlToOffscreen()
    self.postMessage({
      type: 'init-rejected',
      reason: 'xash3d-fwgs requires HTMLCanvasElement + DOM; worker bootstrap not in upstream',
    });
  }
};
