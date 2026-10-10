/**
 * Procedural sound effects — oscillators and filtered noise, no asset files.
 *
 * The context starts suspended until a user gesture, so `init()` is called
 * from a click handler and resumes an already-created context afterwards.
 */
export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
  }

  init() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.32;
    this.master.connect(this.ctx.destination);
  }

  /** No-op until the audio context exists, so callers never have to check. */
  guard(fn) {
    if (this.ctx) fn(this.ctx.currentTime);
  }

  env(g, t0, peak, dur) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  osc(type, f0, f1, t0, dur, peak) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + dur);
    this.env(g, t0, peak, dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  noise(t0, dur, peak, cutoff) {
    const len = Math.ceil(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = this.ctx.createGain();
    this.env(g, t0, peak, dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t0);
  }

  shoot() {
    this.guard(t => {
      this.noise(t, 0.09, 0.5, 3200);
      this.osc('square', 165, 55, t, 0.09, 0.28);
    });
  }

  empty() {
    this.guard(t => this.osc('square', 950, 700, t, 0.045, 0.12));
  }

  reloadStart() {
    this.guard(t => {
      this.osc('square', 420, 380, t, 0.05, 0.16);
      this.osc('square', 300, 260, t + 0.12, 0.05, 0.12);
    });
  }

  reloadEnd() {
    this.guard(t => this.osc('square', 620, 760, t, 0.06, 0.16));
  }

  hit() {
    this.guard(t => this.osc('sine', 1450, 1250, t, 0.05, 0.16));
  }

  kill() {
    this.guard(t => {
      this.osc('sawtooth', 320, 42, t, 0.3, 0.3);
      this.noise(t, 0.2, 0.22, 900);
    });
  }

  hurt() {
    this.guard(t => {
      this.osc('sine', 115, 55, t, 0.2, 0.5);
      this.noise(t, 0.12, 0.28, 500);
    });
  }

  wave() {
    this.guard(t => {
      this.osc('sine', 520, 520, t, 0.13, 0.2);
      this.osc('sine', 784, 784, t + 0.15, 0.2, 0.2);
    });
  }
}