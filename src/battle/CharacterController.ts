import * as THREE from 'three';
import type { BattleRules } from '../data/types';
import type { Box, ColliderSet } from './Colliders';

const SKIN = 0.001;

/**
 * AABB による自前のキャラクター物理（docs/04 §4.3）。
 * 軸分離で解決し、壁ずりと自動ステップ（椅子・机に乗る）を実現する。
 */
export class CharacterController {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  grounded = false;
  crouching = false;
  private coyote = 0;
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
    if (want === this.crouching) return;
    if (!want) {
      const probe = this.position.clone();
      if (this.collides(probe, this.standHeight)) return; // 天井があるので立てない
    }
    this.crouching = want;
    this.height = want ? this.crouchHeight : this.standHeight;
  }

  /** 1ステップ進める。wishDir は正規化済みの水平方向。 */
  step(dt: number, wishDir: THREE.Vector3, wishSpeed: number, jump: boolean): void {
    const mv = this.rules.movement;

    // --- 水平方向の加速 ---
    const accel = this.grounded ? 60 : 60 * mv.airControl;
    const target = wishDir.clone().multiplyScalar(wishSpeed);
    const dvx = target.x - this.velocity.x;
    const dvz = target.z - this.velocity.z;
    const maxDelta = accel * dt;
    const dlen = Math.hypot(dvx, dvz);
    if (dlen > 1e-5) {
      const s = Math.min(1, maxDelta / dlen);
      this.velocity.x += dvx * s;
      this.velocity.z += dvz * s;
    }
    if (this.grounded && wishSpeed < 0.01) {
      const friction = Math.max(0, 1 - 12 * dt);
      this.velocity.x *= friction;
      this.velocity.z *= friction;
    }

    // --- ジャンプ ---
    if (this.grounded) this.coyote = mv.coyoteTime;
    else this.coyote = Math.max(0, this.coyote - dt);
    if (jump && this.coyote > 0) {
      this.velocity.y = mv.jumpVelocity;
      this.grounded = false;
      this.coyote = 0;
    }

    this.velocity.y += mv.gravity * dt;
    if (this.velocity.y < -40) this.velocity.y = -40;

    // --- 移動量を小分けにして解決（すり抜け防止） ---
    const delta = this.velocity.clone().multiplyScalar(dt);
    const steps = Math.max(1, Math.ceil(delta.length() / 0.18));
    const inc = delta.divideScalar(steps);
    for (let i = 0; i < steps; i++) {
      this.moveAxis('x', inc.x);
      this.moveAxis('z', inc.z);
      this.moveAxisY(inc.y);
    }
    this.probeGround();
  }

  private moveAxis(axis: 'x' | 'z', amount: number): void {
    if (amount === 0) return;
    const before = this.position[axis];
    this.position[axis] += amount;
    if (!this.collides(this.position)) return;

    // 自動ステップ: 少し持ち上げて通れるなら段差として乗る
    const stepUp = this.rules.movement.stepHeight;
    const lifted = this.position.clone();
    lifted.y += stepUp;
    if (this.grounded && !this.collides(lifted)) {
      this.position.copy(lifted);
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
    this.velocity.set(0, 0, 0);
    this.grounded = false;
  }
}
