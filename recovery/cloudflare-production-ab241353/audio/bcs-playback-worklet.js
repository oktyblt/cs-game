/**
 * BrowserCS playback AudioWorklet.
 * Consumes SDL-sized PCM chunks (typically 1024 frames) from the main thread
 * and renders at the browser quantum (128 frames) — no buffer-size lie to SDL.
 */
class BcsPlaybackProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options.processorOptions || {};
    this.channels = Math.max(1, opts.channels | 0 || 2);
    this.chunkFrames = Math.max(128, opts.bufferSize | 0 || 1024);
    // Hold several SDL chunks ahead of the quantum
    this.capacity = this.chunkFrames * 8;
    this.rings = [];
    for (let c = 0; c < this.channels; c++) {
      this.rings.push(new Float32Array(this.capacity));
    }
    this.write = 0;
    this.read = 0;
    this.needSent = false;

    this.port.onmessage = (ev) => {
      const msg = ev.data;
      if (!msg || msg.type !== 'buf' || !msg.chans) return;
      const chans = msg.chans;
      const n = chans[0] ? chans[0].length : 0;
      if (n <= 0) return;
      for (let i = 0; i < n; i++) {
        const slot = this.write % this.capacity;
        for (let c = 0; c < this.channels; c++) {
          const src = chans[c];
          this.rings[c][slot] = src ? src[i] : 0;
        }
        this.write++;
      }
      this.needSent = false;
    };
  }

  available() {
    return this.write - this.read;
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || !out.length || !out[0]) return true;
    const frames = out[0].length;
    const lowWater = this.chunkFrames * 2;

    if (this.available() < lowWater && !this.needSent) {
      this.needSent = true;
      this.port.postMessage({ type: 'need', avail: this.available() });
    }

    if (this.available() < frames) {
      for (let c = 0; c < out.length; c++) out[c].fill(0);
      if (!this.needSent) {
        this.needSent = true;
        this.port.postMessage({ type: 'need', avail: this.available() });
      }
      return true;
    }

    for (let i = 0; i < frames; i++) {
      const slot = this.read % this.capacity;
      for (let c = 0; c < out.length; c++) {
        out[c][i] = c < this.channels ? this.rings[c][slot] : 0;
      }
      this.read++;
    }
    return true;
  }
}

registerProcessor('bcs-playback', BcsPlaybackProcessor);
