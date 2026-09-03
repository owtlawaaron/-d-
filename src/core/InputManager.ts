/** キーボード・マウス・PointerLock をまとめる。 */
export class InputManager {
  readonly keys = new Set<string>();
  mouseDx = 0;
  mouseDy = 0;
  mouseDown = false;
  rightDown = false;
  private pressedThisFrame = new Set<string>();
  private clickedThisFrame = false;
  private locked = false;
  /** ポインタロックが使えない環境では、ロック無しの mousemove で視点を動かす。 */
  fallbackLook = false;
  private lockRequestedAt = 0;
  sensitivity = 0.0016;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onLockChange);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.keys.has(e.code)) this.pressedThisFrame.add(e.code);
    this.keys.add(e.code);
    if (['Space', 'Tab', 'KeyR', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked && !this.fallbackLook) return;
    this.mouseDx += e.movementX;
    this.mouseDy += e.movementY;
  };
  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) {
      this.mouseDown = true;
      this.clickedThisFrame = true;
    }
    if (e.button === 2) this.rightDown = true;
  };
  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.mouseDown = false;
    if (e.button === 2) this.rightDown = false;
  };
  private onBlur = () => {
    this.keys.clear();
    this.mouseDown = false;
    this.rightDown = false;
  };
  private onLockChange = () => {
    this.locked = document.pointerLockElement === this.canvas;
    if (this.locked) this.fallbackLook = false;
  };

  /** 視点操作を受け付けられる状態か。 */
  get canLook(): boolean {
    return this.locked || this.fallbackLook;
  }

  get isLocked(): boolean {
    return this.locked;
  }

  requestLock(): void {
    if (this.locked) return;
    this.lockRequestedAt = performance.now();
    try {
      const r = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === 'function') r.catch(() => { this.fallbackLook = true; });
    } catch {
      this.fallbackLook = true;
    }
    // 800ms 経ってもロックされなければ、ロック無しモードに切り替える
    window.setTimeout(() => {
      if (!this.locked && performance.now() - this.lockRequestedAt >= 750) this.fallbackLook = true;
    }, 800);
  }

  releaseLock(): void {
    if (this.locked) document.exitPointerLock();
  }

  /** このフレームで押された瞬間か（押しっぱなしでは false）。 */
  pressed(code: string): boolean {
    return this.pressedThisFrame.has(code);
  }

  clicked(): boolean {
    return this.clickedThisFrame;
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  /** 1フレームの入力を消費する。update の最後に必ず呼ぶ。 */
  endFrame(): void {
    this.mouseDx = 0;
    this.mouseDy = 0;
    this.pressedThisFrame.clear();
    this.clickedThisFrame = false;
  }
}
