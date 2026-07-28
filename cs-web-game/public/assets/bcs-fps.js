/**
 * BrowserCS FPS overlay — SAFE mode.
 * Live game bundle already has packet pool, DPR lock, renderStability, rates.
 * Previous overlay fought that code by resizing <canvas> every tick → black flicker.
 * This file intentionally does NOT touch canvas size, DPR, or WebGL context attrs.
 */
(function () {
  'use strict';

  var CVARS_SENT = false;

  function engineRef() {
    try {
      if (window.state && window.state.xash) return window.state.xash;
      if (window.Module && typeof window.Module.ccall === 'function') return window.Module;
    } catch (e) {}
    return null;
  }

  function sendCmd(eng, cmd) {
    if (!eng || !cmd) return false;
    try {
      if (typeof eng.EngineCmd === 'function') {
        eng.EngineCmd(cmd);
        return true;
      }
      if (typeof eng.ccall === 'function') {
        try {
          eng.ccall('Cmd_ExecuteString', null, ['string'], [cmd]);
          return true;
        } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function applyPerfCvars(eng) {
    if (CVARS_SENT || !eng) return;
    // Only reinforce cvars already present in live launch args — no gl_clear/r_dynamic
    // toggles that can cause visible flashing with the engine's own clear path.
    var cmds = [
      'fps_max 100',
      'fps_override 1',
      'gl_vsync 0',
      'cl_updaterate 100',
      'cl_cmdrate 100',
      'rate 25000',
      'ex_interp 0.031',
      'cl_lw 1'
    ];
    var ok = 0;
    for (var i = 0; i < cmds.length; i++) {
      if (sendCmd(eng, cmds[i])) ok++;
    }
    if (ok > 0) {
      CVARS_SENT = true;
      try { console.info('[BCS-FPS] safe cvars applied (' + ok + ')'); } catch (e) {}
    }
  }

  function watchEngine() {
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      var eng = engineRef();
      if (eng) applyPerfCvars(eng);
      if (CVARS_SENT || tries > 80) clearInterval(t);
    }, 500);
  }

  window.BCSFPS = {
    applyCvars: function () { CVARS_SENT = false; applyPerfCvars(engineRef()); },
    status: function () {
      return { mode: 'safe', cvarsSent: CVARS_SENT, dpr: window.devicePixelRatio };
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchEngine);
  } else {
    watchEngine();
  }
})();
