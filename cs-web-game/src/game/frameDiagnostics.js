/**
 * @module game/frameDiagnostics
 * Runtime probe for FPS jitter (75↔45 style oscillation).
 * Uses rAF frame times + PerformanceObserver (longtask / measure) + heap samples.
 * Does NOT change render quality — diagnose only.
 *
 * Usage (console while in-game):
 *   BrowserCSPerfDiag.start()
 *   BrowserCSPerfDiag.report()   // after ~15–30s
 *   BrowserCSPerfDiag.stop()
 *
 * Or auto: ?bcsdiag=1 on /oyna URL, or localStorage bcs_perf_diag=1
 */
const RING = 300; // ~5s at 60fps, more at higher

function nowMs() {
  return performance.now();
}

function heapUsedMb() {
  try {
    if (performance.memory) {
      return Math.round(performance.memory.usedJSHeapSize / (1024 * 1024));
    }
  } catch (_) { /* Safari */ }
  return null;
}

function classifyRootCause(stats) {
  const reasons = [];
  if (stats.longTaskCount > 3 && stats.longTaskMsTotal > 80) {
    reasons.push('MAIN_THREAD_LONG_TASK');
  }
  if (stats.gcLikePauses >= 4) {
    reasons.push('GC_LIKE_FRAME_PAUSES');
  }
  if (stats.heapDeltaMb !== null && stats.heapDeltaMb > 40) {
    reasons.push('HEAP_GROWTH');
  }
  if (stats.fpsStdDev > 12 && stats.fpsMean > 55 && stats.fpsP01 < 50) {
    reasons.push('HIGH_FPS_JITTER');
  }
  if (stats.gpuSuspect) {
    reasons.push('GPU_FILLRATE_SUSPECT');
  }
  if (!reasons.length) reasons.push('INCONCLUSIVE');
  return reasons;
}

export const BrowserCSPerfDiag = {
  _running: false,
  _raf: 0,
  _frames: /** @type {number[]} */ ([]),
  _last: 0,
  _longTasks: /** @type {{duration:number,start:number}[]} */ ([]),
  _observers: /** @type {PerformanceObserver[]} */ ([]),
  _heapStart: null,
  _startedAt: 0,
  _lastReport: null,

  isEnabledByQuery() {
    try {
      if (typeof location !== 'undefined' && /[?&]bcsdiag=1(?:&|$)/.test(location.search)) {
        return true;
      }
      if (localStorage.getItem('bcs_perf_diag') === '1') return true;
    } catch (_) { /* ignore */ }
    return false;
  },

  start() {
    if (this._running) return this;
    this._running = true;
    this._frames = [];
    this._longTasks = [];
    this._startedAt = nowMs();
    this._heapStart = heapUsedMb();
    this._last = nowMs();

    const onFrame = (t) => {
      if (!this._running) return;
      const dt = t - this._last;
      this._last = t;
      if (dt > 0 && dt < 1000) {
        this._frames.push(dt);
        if (this._frames.length > RING) this._frames.shift();
      }
      this._raf = requestAnimationFrame(onFrame);
    };
    this._raf = requestAnimationFrame(onFrame);

    try {
      if (typeof PerformanceObserver !== 'undefined') {
        const lt = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            this._longTasks.push({ duration: e.duration, start: e.startTime });
            if (this._longTasks.length > 80) this._longTasks.shift();
          }
        });
        // longtask is Chromium-only
        try {
          lt.observe({ entryTypes: ['longtask'] });
          this._observers.push(lt);
        } catch (_) {
          try {
            lt.observe({ type: 'longtask', buffered: true });
            this._observers.push(lt);
          } catch (_) { /* unsupported */ }
        }
      }
    } catch (_) { /* ignore */ }

    console.info(
      '[BrowserCSPerfDiag] started — play 15–30s then run BrowserCSPerfDiag.report()'
    );
    return this;
  },

  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    for (const o of this._observers) {
      try { o.disconnect(); } catch (_) { /* ignore */ }
    }
    this._observers = [];
    return this;
  },

  /**
   * @returns {object}
   */
  report() {
    const frames = this._frames.slice();
    const fpsSamples = frames.map((dt) => 1000 / dt).filter((f) => f > 5 && f < 240);
    const sortedFps = fpsSamples.slice().sort((a, b) => a - b);
    const sortedDt = frames.slice().sort((a, b) => a - b);

    const mean = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);
    const std = (arr) => {
      if (arr.length < 2) return 0;
      const m = mean(arr);
      return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
    };
    const pct = (arr, p) => {
      if (!arr.length) return 0;
      const i = Math.min(arr.length - 1, Math.floor((p / 100) * arr.length));
      return arr[i];
    };

    const longTaskMsTotal = this._longTasks.reduce((s, t) => s + t.duration, 0);
    // Frames >33ms (~30fps) that cluster ~every second → GC-like
    const pauses = frames.filter((dt) => dt >= 28);
    const gcLikePauses = pauses.length;

    const heapNow = heapUsedMb();
    const heapDeltaMb =
      this._heapStart != null && heapNow != null ? heapNow - this._heapStart : null;

    // If FPS is low but stddev small → steady GPU limit; high stddev → jitter
    const fpsMean = mean(fpsSamples);
    const fpsStdDev = std(fpsSamples);
    const gpuSuspect = fpsMean < 58 && fpsStdDev < 6 && this._longTasks.length < 2;

    const stats = {
      sampleMs: Math.round(nowMs() - this._startedAt),
      frameCount: frames.length,
      fpsMean: Math.round(fpsMean * 10) / 10,
      fpsStdDev: Math.round(fpsStdDev * 10) / 10,
      fpsP01: Math.round(pct(sortedFps, 1) * 10) / 10,
      fpsP50: Math.round(pct(sortedFps, 50) * 10) / 10,
      fpsP99: Math.round(pct(sortedFps, 99) * 10) / 10,
      frameDtP99Ms: Math.round(pct(sortedDt, 99) * 10) / 10,
      longTaskCount: this._longTasks.length,
      longTaskMsTotal: Math.round(longTaskMsTotal),
      gcLikePauses,
      heapStartMb: this._heapStart,
      heapNowMb: heapNow,
      heapDeltaMb,
      gpuSuspect,
      sabAvailable: typeof SharedArrayBuffer !== 'undefined',
      crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : null,
    };

    stats.rootCauseHints = classifyRootCause(stats);
    stats.recommendation = stats.rootCauseHints.includes('GPU_FILLRATE_SUSPECT')
      ? 'Yedek yol: render scale / cvar (GPU bound). Worker birincil değil.'
      : 'Ana yol: OffscreenCanvas + Worker + SharedArrayBuffer (jitter/GC/main-thread).';

    this._lastReport = stats;
    console.info('[BrowserCSPerfDiag] report', stats);
    try {
      window.dispatchEvent(new CustomEvent('bcs-perf-diag', { detail: stats }));
    } catch (_) { /* ignore */ }
    return stats;
  },
};

window.BrowserCSPerfDiag = BrowserCSPerfDiag;

if (typeof document !== 'undefined') {
  const boot = () => {
    if (BrowserCSPerfDiag.isEnabledByQuery()) {
      BrowserCSPerfDiag.start();
      // Auto-report every 20s while enabled
      setInterval(() => {
        if (BrowserCSPerfDiag._running) BrowserCSPerfDiag.report();
      }, 20000);
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}
