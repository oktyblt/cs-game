/**
 * BrowserCS FPS overlay — SAFE mode v2 (multiplayer stutter).
 * Does NOT touch canvas size / DPR / WebGL attrs (that caused flicker).
 * Reinforces client net + light render cvars after engine boot.
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
    // Keep rates aligned with AWS sv_* (100 / 25000). Avoid canvas/gl context changes.
    // r_dynamic/gl_fog/himodels cut GPU spikes when other players shoot/move.
    var cmds = [
      'fps_max 100',
      'fps_override 1',
      'gl_vsync 0',
      'cl_updaterate 100',
      'cl_cmdrate 100',
      'rate 25000',
      'ex_interp 0.031',
      'cl_lw 1',
      'cl_lc 1',
      'cl_nopred 0',
      'gl_fog 0',
      'r_dynamic 0',
      'cl_himodels 0',
      'r_decals 200',
      'mp_decals 200',
      'violence_ablood 0',
      'violence_hblood 0',
      'cl_corpsestay 3',
      'fastsprites 1'
    ];
    var ok = 0;
    for (var i = 0; i < cmds.length; i++) {
      if (sendCmd(eng, cmds[i])) ok++;
    }
    if (ok > 0) {
      CVARS_SENT = true;
      try { console.info('[BCS-FPS] safe multipayer cvars applied (' + ok + ')'); } catch (e) {}
    }
  }

  function watchEngine() {
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      var eng = engineRef();
      if (eng) applyPerfCvars(eng);
      if (CVARS_SENT || tries > 120) clearInterval(t);
    }, 500);
  }

  // Re-apply once after connect — some servers rewrite client cvars on join
  function hookConnect() {
    try {
      var orig = window.connectToServer;
      if (typeof orig !== 'function' || orig.__bcsFpsHooked) return;
      function wrapped() {
        CVARS_SENT = false;
        var ret = orig.apply(this, arguments);
        setTimeout(function () { applyPerfCvars(engineRef()); }, 2500);
        setTimeout(function () { CVARS_SENT = false; applyPerfCvars(engineRef()); }, 6000);
        return ret;
      }
      wrapped.__bcsFpsHooked = true;
      window.connectToServer = wrapped;
    } catch (e) { /* ignore */ }
  }

  window.BCSFPS = {
    applyCvars: function () { CVARS_SENT = false; applyPerfCvars(engineRef()); },
    status: function () {
      return { mode: 'safe-v2', cvarsSent: CVARS_SENT, dpr: window.devicePixelRatio };
    }
  };

  function boot() {
    hookConnect();
    watchEngine();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
