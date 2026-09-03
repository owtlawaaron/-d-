/**
 * 音声アセットを一切持たずに効果音を鳴らす簡易シンセ。
 * WebAudio のオシレータとノイズだけで銃声・着弾・チャイムを作る。
 */
type SfxName =
  | 'chalk' | 'eraser' | 'bow' | 'melee' | 'reload'
  | 'hit' | 'hitCrystal' | 'death' | 'chime' | 'scan' | 'crystal' | 'ui' | 'win' | 'lose';

export class AudioSys {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  enabled = true;

  /** ブラウザの自動再生制限があるので、ユーザー操作の中で呼ぶ。 */
  resume(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.4);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    void this.ctx.resume();
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, gain: number, filterHz: number, q = 1): void {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterHz;
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  play(name: SfxName): void {
    if (!this.enabled || !this.ctx) return;
    switch (name) {
      case 'chalk': this.noise(0.07, 0.30, 2200, 1.5); this.tone(320, 0.05, 'square', 0.06, 180); break;
      case 'eraser': this.tone(160, 0.18, 'sine', 0.32, 60); this.noise(0.12, 0.16, 700); break;
      case 'bow': this.tone(900, 0.14, 'triangle', 0.22, 300); break;
      case 'melee': this.noise(0.16, 0.34, 480, 0.7); this.tone(120, 0.14, 'square', 0.18, 50); break;
      case 'reload': this.noise(0.05, 0.16, 3000); window.setTimeout(() => this.noise(0.05, 0.16, 1800), 130); break;
      case 'hit': this.tone(1400, 0.05, 'square', 0.16, 900); break;
      case 'hitCrystal': this.tone(1900, 0.09, 'sine', 0.16, 1300); break;
      case 'death': this.tone(300, 0.5, 'sawtooth', 0.24, 60); break;
      case 'chime': [523, 659, 784, 1047].forEach((f, i) => window.setTimeout(() => this.tone(f, 0.5, 'sine', 0.2), i * 130)); break;
      case 'scan': this.tone(90, 0.7, 'sawtooth', 0.14, 1400); break;
      case 'crystal': this.tone(200, 0.8, 'sine', 0.26, 1600); this.noise(0.5, 0.10, 2600); break;
      case 'ui': this.tone(660, 0.06, 'square', 0.10); break;
      case 'win': [523, 659, 784, 1047, 1319].forEach((f, i) => window.setTimeout(() => this.tone(f, 0.35, 'triangle', 0.2), i * 90)); break;
      case 'lose': [440, 392, 330, 262].forEach((f, i) => window.setTimeout(() => this.tone(f, 0.45, 'sine', 0.2), i * 150)); break;
    }
  }
}

export const audio = new AudioSys();
