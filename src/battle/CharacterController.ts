import * as THREE from 'three';
import type { BattleRules } from '../data/types';
import type { Box, ColliderSet } from './Colliders';

const SKIN = 0.001;

/**
 * AABB による自前のキャラクター物理。
 *
 * 加速は Quake/Source 系の「希望方向への投影で足りない分だけ加速」方式。
 * 地上ではキビキビ止まって曲がり、空中では空中制御（エアストレイフ）で
 * 勢いを保ったまま向きを変えられる。スライディング中は摩擦をほぼ切る。
 */
export class CharacterController {
  readonly position = new THREE.Vector3();
  /** 直前の物理ステップの位置（描画の補間用） */
  readonly prevPosition = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  grounded = false;
  crouching = false;
  sliding = false;
  /** 直近の着地の衝撃（落下速度）。カメラの沈み込みに使い、読んだ側が 0 に戻す */
  landImpact = 0;
  private slideTimer = 0;
  private slideCooldown = 0;
  private coyote = 0;
  private jumpBuffer = 0;
  private scratch: Box[] = [];

  readonly radius: number;
  height: number;
  private readonly standHeight: number;
  private readonly crouchHeight: number;

  constructor(private readonly world: ColliderSet, private readonly rules: BattleRules) {
    const cap = rules.movement.capsule;
    this.radius = cap.radius;
    this.standHeight = cap.height;
    this.crouchHeight = rules.movement.slide.capsuleHeight + 0.2;
    this.height = this.standHeight;
  }

  get eyeY(): number {
    return this.position.y + this.height - 0.12;
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  private minOf(pos: THREE.Vector3): THREE.Vector3 {
    return new THREE.Vector3(pos.x - this.radius, pos.y, pos.z - this.radius);
  }
  private maxOf(pos: THREE.Vector3, height = this.height): THREE.Vector3 {
    return new THREE.Vector3(pos.x + this.radius, pos.y + height, pos.z + this.radius);
  }

  private collides(pos: THREE.Vector3, height = this.height): boolean {
    return this.world.overlapping(this.minOf(pos), this.maxOf(pos, height), this.scratch).length > 0;
  }

  setCrouch(want: boolean): void {
    if (this.sliding) want = true;
    if (want === this.crouching) return;
    if (!want && this.collides(this.position, this.standHeight)) return; // 天井があるので立てない
    this.crouching = want;
    this.height = want ? this.crouchHeight : this.standHeight;
  }

  /** 走っている最中にしゃがむとスライディング。成功したら true。 */
  tryStartSlide(runSpeed: number): boolean {
    const s = this.rules.movement.slide;
    if (this.sliding || !this.grounded || this.slideCooldown > 0) return false;
    const speed = this.horizontalSpeed;
    if (speed < runSpeed * 0.8) return false;
    const boost = Math.min(s.maxSpeed, Math.max(speed, runSpeed) * s.boost);
    this.velocity.x *= boost / speed;
    this.velocity.z *= boost / speed;
    this.sliding = true;
    this.slideTimer = s.duration;
    this.setCrouch(true);
    return true;
  }

  private endSlide(): void {
    this.sliding = false;
    this.slideCooldown = this.rules.movement.slide.cooldown;
  }

  /** ジャンプ入力（押した瞬間）を受け取る。着地直前に押しても一瞬だけ有効。 */
  queueJump(): void {
    this.jumpBuffer = this.rules.movement.jumpBuffer;
  }

  /** 1ステップ進める。wishDir は正規化済みの水平方向。 */
  step(dt: number, wishDir: THREE.Vector3, wishSpeed: number, jumpHeld = false): void {
    const mv = this.rules.movement;
    this.prevPosition.copy(this.position);
    this.slideCooldown = Math.max(0, this.slideCooldown - dt);
    if (jumpHeld && this.jumpBuffer <= 0 && this.grounded) this.queueJump();

    // --- 摩擦 ---
    if (this.grounded) {
      const speed = this.horizontalSpeed;
      if (speed > 1e-4) {
        const friction = this.sliding ? mv.slide.friction : mv.friction;
        const control = Math.max(speed, this.sliding ? 0 : mv.stopSpeed);
        const drop = control * friction * dt;
        const scale = Math.max(0, speed - drop) / speed;
        this.velocity.x *= scale;
        this.velocity.z *= scale;
      }
    }

    // --- 加速（希望方向への投影で足りない分だけ） ---
    const accel = this.grounded ? (this.sliding ? mv.slide.steer : mv.groundAccel) : mv.airAccel;
    if (wishSpeed > 0 && !(this.sliding && this.grounded && wishSpeed < 0.1)) {
      const current = this.velocity.x * wishDir.x + this.velocity.z * wishDir.z;
      const add = wishSpeed - current;
      if (add > 0) {
        const gain = Math.min(accel * dt * wishSpeed, add);
        this.velocity.x += wishDir.x * gain;
        this.velocity.z += wishDir.z * gain;
      }
    }

    // --- スライディングの減衰 ---
    if (this.sliding) {
      this.slideTimer -= dt;
      if (this.slideTimer <= 0 || this.horizontalSpeed < mv.crouchSpeed) this.endSlide();
    }

    // --- ジャンプ（コヨーテタイム＋先行入力） ---
    if (this.grounded) this.coyote = mv.coyoteTime;
    else this.coyote = Math.max(0, this.coyote - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.velocity.y = mv.jumpVelocity;
      this.grounded = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      if (this.sliding) this.endSlide(); // スライドジャンプで勢いを持ち越す
    }

    this.velocity.y += mv.gravity * dt;
    if (this.velocity.y < -40) this.velocity.y = -40;

    // --- 移動量を小分けにして解決（すり抜け防止） ---
    const fallSpeed = -this.velocity.y;
    const wasGrounded = this.grounded;
    const delta = this.velocity.clone().multiplyScalar(dt);
    const steps = Math.max(1, Math.ceil(delta.length() / 0.16));
    const inc = delta.divideScalar(steps);
    for (let i = 0; i < steps; i++) {
      this.moveAxis('x', inc.x);
      this.moveAxis('z', inc.z);
      this.moveAxisY(inc.y);
    }
    this.probeGround();
    if (!wasGrounded && this.grounded && fallSpeed > 2) this.landImpact = fallSpeed;
  }

  private moveAxis(axis: 'x' | 'z', amount: number): void {
    if (amount === 0) return;
    const before = this.position[axis];
    this.position[axis] += amount;
    if (!this.collides(this.position)) return;

    // 自動ステップ: 少し持ち上げて通れるなら段差として乗る。
    // 空中でも縁に足がかかれば乗れる（机への飛び乗りを気持ちよくするため）
    const lifted = this.position.clone();
    lifted.y += this.rules.movement.stepHeight;
    if (!this.collides(lifted)) {
      this.position.copy(lifted);
      if (this.velocity.y < 0) this.velocity.y = 0;
      return;
    }
    this.position[axis] = before;
    this.velocity[axis] = 0;
  }

  private moveAxisY(amount: number): void {
    if (amount === 0) return;
    const before = this.position.y;
    this.position.y += amount;
    if (!this.collides(this.position)) return;
    this.position.y = before;
    if (amount < 0) {
      // 床に着地: 接触面まで詰める
      const boxes = this.world.overlapping(
        this.minOf(this.position).setY(this.position.y + amount),
        this.maxOf(this.position),
        this.scratch,
      );
      let top = -Infinity;
      for (const b of boxes) if (b.max.y <= this.position.y + 0.6) top = Math.max(top, b.max.y);
      if (top > -Infinity) this.position.y = top + SKIN;
      this.grounded = true;
    }
    this.velocity.y = 0;
  }

  private probeGround(): void {
    const probe = this.position.clone();
    probe.y -= 0.06;
    this.grounded = this.collides(probe);
    if (this.position.y < 0) {
      this.position.y = 0;
      this.velocity.y = 0;
      this.grounded = true;
    }
  }

  teleport(x: number, y: number, z: number): void {
    this.position.set(x, y, z);
    this.prevPosition.copy(this.position);
    this.velocity.set(0, 0, 0);
    this.grounded = false;
    this.sliding = false;
  }
}
