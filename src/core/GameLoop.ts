/** 固定タイムステップのゲームループ。物理と AI のブレを防ぐため update は 60Hz 固定。 */
export const FIXED_DT = 1 / 60;
const MAX_FRAME = 0.25; // スパイラル・オブ・デス防止
const MAX_STEPS = 8;

export class GameLoop {
  private last = 0;
  private accumulator = 0;
  private running = false;
  private rafId = 0;

  constructor(
    private readonly onUpdate: (dt: number) => void,
    private readonly onRender: (alpha: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now() / 1000;
    const tick = () => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(tick);
      const now = performance.now() / 1000;
      const frame = Math.min(now - this.last, MAX_FRAME);
      this.last = now;
      this.accumulator += frame;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < MAX_STEPS) {
        this.onUpdate(FIXED_DT);
        this.accumulator -= FIXED_DT;
        steps++;
      }
      // 処理しきれなかった分は捨てる。残すと補間係数が 1 を超え、
      // 描画が未来方向に外挿されてカメラが吹き飛ぶ（フレーム落ち時に画面が真っ黒になる）
      if (steps === MAX_STEPS) this.accumulator %= FIXED_DT;
      this.onRender(Math.min(1, this.accumulator / FIXED_DT));
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }
}
