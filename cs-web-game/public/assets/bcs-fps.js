/**
 * BrowserCS FPS boost overlay — runs on LIVE Cloudflare build without replacing game bundle.
 * Safe additive patches:
 *  - DPR lock (Retina fillrate)
 *  - WebGL high-performance + desynchronized
 *  - Post-engine cvar tune (dynamic lights/fog/himodels)
 *  - PerfDiag helper (?bcsdiag=1 already in bundle; this reinforces)
 */
(function () {
  'use strict';

  var APPLIED = false;
  var CVARS_SENT = false;

  function lockDPR() {
    try {
      var desc = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
      if (desc && desc.configurable === false) return;
      Object.defineProperty(window, 'devicePixelRatio', {
        configurable: true,
        enumerable: true,
        get: function () { return 1; }
      });
    } catch (e) { /* ignore */ }
  }

  function patchWebGL() {
    try {
      var original = HTMLCanvasElement.prototype.getContext;
      if (original.__bcsFpsPatched) return;
      function wrapped(type, attrs) {
        if (type === 'webgl' || type === 'experimental-webgl' || type === 'webgl2') {
          attrs = attrs || {};
          attrs.alpha = false;
          attrs.antialias = false;
          attrs.powerPreference = 'high-performance';
          // Prefer low-latency presentation when browser supports it
          attrs.desynchronized = true;
          attrs.preserveDrawingBuffer = false;
        }
        return original.call(this, type, attrs);
      }
      wrapped.__bcsFpsPatched = true;
      HTMLCanvasElement.prototype.getContext = wrapped;
    } catch (e) { /* ignore */ }
  }

  function fitCanvas(canvas) {
    if (!canvas) return;
    try {
      var rect = canvas.getBoundingClientRect();
      var w = Math.max(1, Math.round(rect.width || canvas.clientWidth || 1));
      var h = Math.max(1, Math.round(rect.height || canvas.clientHeight || 1));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.imageRendering = 'pixelated';
    } catch (e) { /* ignore */ }
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
      if (typeof eng.emscripten_run_script === 'function') return false;
      // Some builds expose Cmd_ExecuteString via ccall
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
    var cmds = [
      'fps_max 100',
      'fps_override 1',
      'gl_vsync 0',
      'gl_fog 0',
      'gl_clear 0',
      'r_dynamic 0',
      'cl_himodels 0',
      'r_decals 200',
      'mp_decals 200',
      'cl_updaterate 100',
      'cl_cmdrate 100',
      'rate 25000',
      'ex_interp 0.031',
      'cl_lw 1',
      'cl_showfps 1'
    ];
    var ok = 0;
    for (var i = 0; i < cmds.length; i++) {
      if (sendCmd(eng, cmds[i])) ok++;
    }
    if (ok > 0) {
      CVARS_SENT = true;
      try { console.info('[BCS-FPS] perf cvars applied (' + ok + ')'); } catch (e) {}
    }
  }

  function startDiagIfRequested() {
    try {
      var want = /[?&]bcsdiag=1/.test(location.search) || localStorage.getItem('bcs_perf_diag') === '1';
      if (!want) return;
      if (window.BrowserCSPerfDiag && typeof window.BrowserCSPerfDiag.start === 'function') {
        window.BrowserCSPerfDiag.start();
        console.info('[BCS-FPS] PerfDiag started — call BrowserCSPerfDiag.report() after 20-30s');
      }
    } catch (e) { /* ignore */ }
  }

  function watchEngine() {
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      var eng = engineRef();
      var canvas = document.getElementById('canvas');
      if (canvas) fitCanvas(canvas);
      if (eng) applyPerfCvars(eng);
      if ((CVARS_SENT && canvas) || tries > 80) clearInterval(t);
    }, 500);
  }

  function boot() {
    if (APPLIED) return;
    APPLIED = true;
    lockDPR();
    patchWebGL();
    startDiagIfRequested();
    var canvas = document.getElementById('canvas');
    if (canvas) {
      fitCanvas(canvas);
      if (typeof ResizeObserver !== 'undefined') {
        var ro = new ResizeObserver(function () { fitCanvas(canvas); });
        ro.observe(canvas.parentElement || canvas);
      }
    }
    watchEngine();
    window.BCSFPS = {
      refit: function () { fitCanvas(document.getElementById('canvas')); },
      applyCvars: function () { CVARS_SENT = false; applyPerfCvars(engineRef()); },
      status: function () {
        return { applied: APPLIED, cvarsSent: CVARS_SENT, dpr: window.devicePixelRatio };
      }
    };
  }

  // Run ASAP so DPR/WebGL patches precede engine module
  lockDPR();
  patchWebGL();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
