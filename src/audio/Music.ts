/**
 * Minimal procedural background track - a repeating synth arpeggio.
 *
 * No asset files: the context and oscillators are created lazily, like Sfx.
 */
export class Music {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private timer: number | null = null;
  private step = 0;
  private readonly notes = [220, 261.63, 329.63, 440, 329.63, 261.63, 196, 220];

  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    if (!globalThis.AudioContext) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.06;
    this.master.connect(this.ctx.destination);
  }

  start(): void {
    if (!this.ctx || !this.master) return;
    this.stop();
    this.step = 0;
    const tick = (): void => {
      const ctx = this.ctx;
      const master = this.master;
      if (!ctx || !master) return;
      const t = ctx.currentTime;
      const freq = this.notes[this.step % this.notes.length]!;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.5, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g);
      g.connect(master);
      o.start(t);
      o.stop(t + 0.25);
      this.step++;
    };
    tick();
    this.timer = setInterval(tick, 240) as unknown as number;
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
