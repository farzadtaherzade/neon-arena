import { Rng } from '../core/rng';

/**
 * Procedural sound effects — oscillators and filtered noise, no asset files.
 *
 * The context starts suspended until a user gesture, so `init()` is called from
 * a click handler and resumes an already-created context afterwards.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private baseGain = 0.32;
  muted = false;
  /** One second of white noise, reused for every noise burst. */
  private noiseBuf: AudioBuffer | null = null;

  constructor(private readonly rng: Rng = new Rng(7)) {}

  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    if (!globalThis.AudioContext) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.baseGain;
    this.master.connect(this.ctx.destination);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : this.baseGain;
  }

  /** No-op until the audio context exists, so callers never have to check. */
  private guard(fn: (t: number) => void): void {
    if (this.ctx) fn(this.ctx.currentTime);
  }

  private env(g: GainNode, t0: number, peak: number, dur: number): void {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  private osc(type: OscillatorType, f0: number, f1: number, t0: number, dur: number, peak: number): void {
    if (!this.ctx || !this.master) return;
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

  private noise(t0: number, dur: number, peak: number, cutoff: number): void {
    if (!this.ctx || !this.master) return;
    // The old code built and filled an AudioBuffer on every shot, kill and
    // hit. One second of noise is generated once and played from an offset.
    if (!this.noiseBuf) {
      const len = Math.ceil(this.ctx.sampleRate * 1);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = this.rng.next() * 2 - 1;
    }

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = this.ctx.createGain();
    this.env(g, t0, peak, dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t0, 0, dur);
  }

  shoot(): void {
    this.guard((t) => {
      this.noise(t, 0.09, 0.5, 3200);
      this.osc('square', 165, 55, t, 0.09, 0.28);
    });
  }

  empty(): void {
    this.guard((t) => this.osc('square', 950, 700, t, 0.045, 0.12));
  }

  /** The knife: a short whoosh with a metallic edge — no gunshot. */
  slash(): void {
    this.guard((t) => {
      this.noise(t, 0.16, 0.4, 5200);
      this.osc('sawtooth', 900, 220, t, 0.12, 0.14);
    });
  }

  reloadStart(): void {
    this.guard((t) => {
      this.osc('square', 420, 380, t, 0.05, 0.16);
      this.osc('square', 300, 260, t + 0.12, 0.05, 0.12);
    });
  }

  reloadEnd(): void {
    this.guard((t) => this.osc('square', 620, 760, t, 0.06, 0.16));
  }

  hit(): void {
    this.guard((t) => this.osc('sine', 1450, 1250, t, 0.05, 0.16));
  }

  kill(): void {
    this.guard((t) => {
      this.osc('sawtooth', 320, 42, t, 0.3, 0.3);
      this.noise(t, 0.2, 0.22, 900);
    });
  }

  hurt(): void {
    this.guard((t) => {
      this.osc('sine', 115, 55, t, 0.2, 0.5);
      this.noise(t, 0.12, 0.28, 500);
    });
  }

  wave(): void {
    this.guard((t) => {
      this.osc('sine', 520, 520, t, 0.13, 0.2);
      this.osc('sine', 784, 784, t + 0.15, 0.2, 0.2);
    });
  }

  /** Bomb planted nearby — a two-tone alert, not the "took damage" sting. */
  alarm(): void {
    this.guard((t) => {
      this.osc('square', 880, 880, t, 0.09, 0.22);
      this.osc('square', 620, 620, t + 0.13, 0.11, 0.22);
    });
  }

  explode(): void {
    this.guard((t) => {
      this.noise(t, 0.5, 0.65, 700);
      this.osc('sine', 170, 28, t, 0.55, 0.5);
    });
  }

  /** Soft rising chime on collecting an XP orb. */
  xpCollect(): void {
    this.guard((t) => {
      this.osc('sine', 1100, 1400, t, 0.07, 0.12);
    });
  }
}
