/** 固定タイムステップのゲームループ。物理と AI のブレを防ぐため update は 60Hz 固定。 */
export const FIXED_DT = 1 / 60;
const MAX_FRAME = 0.25; // スパイラル・オブ・デス防止

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
      while (this.accumulator >= FIXED_DT && steps < 8) {
        this.onUpdate(FIXED_DT);
        this.accumulator -= FIXED_DT;
        steps++;
      }
      this.onRender(this.accumulator / FIXED_DT);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }
}
