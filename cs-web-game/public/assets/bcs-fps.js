/**
 * BrowserCS FPS overlay — MAX SAFE mode v3
 * No canvas resize / no WebGL context patch (those caused flicker).
 * Applies strongest safe engine cvars for multiplayer + GPU fillrate.
 *
 * Optional:
 *   ?bcsperf=max   or localStorage bcs_perf_mode=max
 *   ?bcsdiag=1     PerfDiag (already in game bundle)
 */
(function () {
  'use strict';

  var CVARS_SENT = false;
  var MODE = 'max';

  function readMode() {
    try {
      if (/[?&]bcsperf=low\b/.test(location.search)) return 'low';
      if (/[?&]bcsperf=max\b/.test(location.search)) return 'max';
      var ls = localStorage.getItem('bcs_perf_mode');
      if (ls === 'low' || ls === 'max') return ls;
    } catch (e) {}
    return 'max';
  }

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

  function cvarList(mode) {
    // Shared net alignment with AWS (sv_maxupdaterate 100 / rate 25000)
    var base = [
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
      'voice_enable 0',
      'sv_voiceenable 0'
    ];
    // GPU / draw cost — safe, no canvas mutation
    var gpu = [
      'gl_fog 0',
      'r_dynamic 0',
      'cl_himodels 0',
      'r_detailtextures 0',
      'gl_wateramp 0',
      'gl_flashblend 0',
      'gl_polyoffset 0.1',
      'gl_max_size 512',
      'gl_texturemode GL_LINEAR_MIPMAP_NEAREST',
      'r_decals 100',
      'mp_decals 100',
      'violence_ablood 0',
      'violence_hblood 0',
      'cl_corpsestay 2',
      'fastsprites 1',
      'cl_shadows 0',
      'r_shadows 0',
      'gl_clear 0',
      'cl_weather 0'
    ];
    if (mode === 'low') {
      gpu = gpu.concat([
        'gl_max_size 256',
        'r_decals 50',
        'mp_decals 50',
        'cl_updaterate 80',
        'cl_cmdrate 80',
        'ex_interp 0.04',
        'rate 20000'
      ]);
    }
    return base.concat(gpu);
  }

  function applyPerfCvars(eng) {
    if (CVARS_SENT || !eng) return;
    MODE = readMode();
    var cmds = cvarList(MODE);
    var ok = 0;
    for (var i = 0; i < cmds.length; i++) {
      if (sendCmd(eng, cmds[i])) ok++;
    }
    if (ok > 0) {
      CVARS_SENT = true;
      try {
        console.info('[BCS-FPS] mode=' + MODE + ' cvars=' + ok +
          ' isolated=' + !!(typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated) +
          ' sab=' + (typeof SharedArrayBuffer !== 'undefined'));
      } catch (e) {}
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

  function hookConnect() {
    try {
      var orig = window.connectToServer;
      if (typeof orig !== 'function' || orig.__bcsFpsHooked) return;
      function wrapped() {
        CVARS_SENT = false;
        var ret = orig.apply(this, arguments);
        setTimeout(function () { applyPerfCvars(engineRef()); }, 2500);
        setTimeout(function () { CVARS_SENT = false; applyPerfCvars(engineRef()); }, 7000);
        return ret;
      }
      wrapped.__bcsFpsHooked = true;
      window.connectToServer = wrapped;
    } catch (e) { /* ignore */ }
  }

  function startDiag() {
    try {
      if (!/[?&]bcsdiag=1/.test(location.search) && localStorage.getItem('bcs_perf_diag') !== '1') return;
      if (window.BrowserCSPerfDiag && typeof window.BrowserCSPerfDiag.start === 'function') {
        window.BrowserCSPerfDiag.start();
      }
    } catch (e) {}
  }

  window.BCSFPS = {
    applyCvars: function () { CVARS_SENT = false; applyPerfCvars(engineRef()); },
    setMode: function (m) {
      try { localStorage.setItem('bcs_perf_mode', m); } catch (e) {}
      CVARS_SENT = false;
      MODE = m;
      applyPerfCvars(engineRef());
    },
    status: function () {
      return {
        mode: MODE,
        cvarsSent: CVARS_SENT,
        dpr: window.devicePixelRatio,
        crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : null,
        sab: typeof SharedArrayBuffer !== 'undefined'
      };
    }
  };

  function boot() {
    MODE = readMode();
    hookConnect();
    startDiag();
    watchEngine();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
