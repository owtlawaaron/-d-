import * as THREE from 'three';
import type { Personality } from '../data/types';
import type { Combatant } from './Combatant';
import type { ColliderSet } from './Colliders';
import type { Crystal } from './Crystal';

export type NpcState = 'SEARCH' | 'ENGAGE' | 'RETREAT' | 'RUSH_CRYSTAL' | 'HOLD' | 'LAST_STAND';

export interface NpcContext {
  opponent: Combatant;
  /** クリスタルが直近で削られているか（守り側が動く理由になる） */
  crystalUnderAttack: boolean;
  crystal: Crystal;
  world: ColliderSet;
  remaining: number;
  coverPoints: THREE.Vector3[];
  /** 実際の発砲は BattleSession が処理する */
  requestFire: (npc: Combatant) => void;
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

/**
 * NPC の行動（docs/03 §3.7）。
 * 能力値から aimError / reactionMs / burstLength を導き、
 * 攻め・守りで別のステートマシンを回す。
 */
export class NpcAgent {
  state: NpcState;
  private aimOffset = new THREE.Vector3();
  private reactionTimer = 0;
  private burstLeft: number;
  private burstPause = 0;
  private target = new THREE.Vector3();
  private repathTimer = 0;
  private strafeDir = 1;
  private strafeTimer = 0;
  private stuckTimer = 0;
  private lastPos = new THREE.Vector3();
  private jumpCooldown = 0;
  /** 銃声や被弾から推定した敵の最後の位置 */
  private lastKnown: THREE.Vector3 | null = null;
  private alertTimer = 0;

  readonly aimError: number;
  readonly reactionSec: number;
  readonly burstLength: number;
  private readonly aggression: number;

  constructor(readonly self: Combatant, personality: Personality) {
    const st = self.student.stats;
    this.aimError = THREE.MathUtils.degToRad((9 - st.nerve) * 0.9);
    this.reactionSec = (420 - st.academics * 22) / 1000;
    this.burstLength = 3 + Math.floor(st.nerve / 3);
    this.burstLeft = this.burstLength;
    this.aggression = personality.npcCombat?.aggression ?? 1;
    this.state = self.team === 'ATTACK' ? 'SEARCH' : 'HOLD';
  }

  /** 銃声を聞いた（正確な位置ではなく、ぶれた推定を持つ）。 */
  notifyNoise(pos: THREE.Vector3, accuracy = 2.5): void {
    this.lastKnown = pos.clone().add(new THREE.Vector3(
      (Math.random() - 0.5) * accuracy, 0, (Math.random() - 0.5) * accuracy,
    ));
    this.alertTimer = 7;
  }

  update(dt: number, ctx: NpcContext): void {
    const self = this.self;
    if (!self.alive) return;

    const eye = self.eye;
    const canSee = ctx.opponent.alive && ctx.world.hasLineOfSight(eye, ctx.opponent.chest);
    this.alertTimer = Math.max(0, this.alertTimer - dt);
    if (canSee) {
      this.lastKnown = ctx.opponent.position.clone();
      this.alertTimer = 7;
    }
    const distToEnemy = ctx.opponent.position.distanceTo(self.position);
    const distToCrystal = ctx.crystal.position.distanceTo(self.position);
    const hpRatio = self.hp / self.maxHp;

    this.transition(ctx, canSee, hpRatio, distToCrystal);
    this.pickTarget(dt, ctx, canSee, distToEnemy, distToCrystal);
    this.aim(dt, ctx, canSee, distToCrystal);
    this.move(dt, ctx);
    this.shoot(dt, ctx, canSee, distToEnemy, distToCrystal);

    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
  }

  private transition(ctx: NpcContext, canSee: boolean, hpRatio: number, distToCrystal: number): void {
    if (this.self.team === 'ATTACK') {
      const desperate = ctx.remaining < 15 || (!ctx.opponent.alive && ctx.crystal.ratio > 0);
      if (desperate) this.state = 'RUSH_CRYSTAL';
      else if (hpRatio < 0.35 && canSee) this.state = 'RETREAT';
      else if (canSee) this.state = 'ENGAGE';
      else if (this.state === 'RETREAT' && hpRatio > 0.55) this.state = 'SEARCH';
      else if (this.state !== 'RETREAT') {
        this.state = ctx.crystal.ratio > 0 && distToCrystal < 9 && !ctx.opponent.alive
          ? 'RUSH_CRYSTAL' : 'SEARCH';
      }
    } else {
      if (ctx.crystal.ratio < 0.5 && distToCrystal > 5) this.state = 'LAST_STAND';
      else if (canSee) this.state = 'ENGAGE';
      else if (hpRatio < 0.3) this.state = 'RETREAT';
      // クリスタルが削られている / 銃声が聞こえたなら、守りも動いて撃ちに行く
      else if (this.lastKnown && this.alertTimer > 0 && (ctx.crystalUnderAttack || distToCrystal < 12)) {
        this.state = 'SEARCH';
      } else this.state = 'HOLD';
    }
  }

  private pickTarget(dt: number, ctx: NpcContext, canSee: boolean, distToEnemy: number, distToCrystal: number): void {
    this.repathTimer -= dt;
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeTimer = 1.0 + Math.random() * 1.2;
      this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    }
    if (this.repathTimer > 0 && this.state !== 'ENGAGE') return;
    this.repathTimer = 0.5;

    const self = this.self;
    switch (this.state) {
      case 'RUSH_CRYSTAL':
        this.target.set(ctx.crystal.position.x, 0, ctx.crystal.position.z);
        break;
      case 'ENGAGE': {
        // 適正距離を保ちつつ横に動く
        const ideal = self.weapon.def.kind === 'melee' ? 1.4 : 7.0 * this.aggression;
        const toEnemy = tmpA.copy(ctx.opponent.position).sub(self.position).setY(0);
        const d = toEnemy.length() || 1;
        toEnemy.divideScalar(d);
        const side = tmpB.set(-toEnemy.z, 0, toEnemy.x).multiplyScalar(this.strafeDir * 2.6);
        const advance = toEnemy.clone().multiplyScalar(d - ideal);
        this.target.copy(self.position).add(advance).add(side).setY(0);
        break;
      }
      case 'RETREAT': {
        const away = tmpA.copy(self.position).sub(ctx.opponent.position).setY(0).normalize();
        this.target.copy(self.position).add(away.multiplyScalar(6)).setY(0);
        const cover = this.nearestCover(ctx, ctx.opponent.position, 9);
        if (cover) this.target.copy(cover);
        break;
      }
      case 'HOLD': {
        const cover = this.nearestCover(ctx, ctx.crystal.position, 5.5);
        this.target.copy(cover ?? ctx.crystal.position).setY(0);
        break;
      }
      case 'LAST_STAND':
        this.target.set(ctx.crystal.position.x, 0, ctx.crystal.position.z + 1.2);
        break;
      case 'SEARCH':
      default: {
        if (canSee || distToEnemy < 6) {
          this.target.copy(ctx.opponent.position).setY(0);
        } else if (this.lastKnown && this.alertTimer > 0) {
          // 銃声のした方へ詰める（守り側はクリスタルから離れすぎないよう制限）
          this.target.copy(this.lastKnown).setY(0);
          if (self.team === 'DEFEND') {
            const fromCrystal = tmpA.copy(this.target).sub(ctx.crystal.position).setY(0);
            const maxLeash = 11;
            if (fromCrystal.length() > maxLeash) {
              this.target.copy(ctx.crystal.position).add(fromCrystal.normalize().multiplyScalar(maxLeash)).setY(0);
            }
          }
        } else {
          const cover = this.nearestCover(ctx, ctx.crystal.position, Math.max(4, distToCrystal * 0.55));
          this.target.copy(cover ?? ctx.crystal.position).setY(0);
        }
        break;
      }
    }
  }

  /** 目標点の近くにある遮蔽ポイントを選ぶ。 */
  private nearestCover(ctx: NpcContext, anchor: THREE.Vector3, radius: number): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null;
    let bestScore = Infinity;
    for (const c of ctx.coverPoints) {
      const dAnchor = c.distanceTo(anchor);
      if (dAnchor > radius) continue;
      const score = c.distanceTo(this.self.position) * 0.6 + dAnchor * 0.4;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  private aim(dt: number, ctx: NpcContext, canSee: boolean, distToCrystal: number): void {
    const self = this.self;
    this.reactionTimer -= dt;
    if (this.reactionTimer <= 0) {
      this.reactionTimer = this.reactionSec;
      this.aimOffset.set(
        (Math.random() - 0.5) * 2 * this.aimError,
        (Math.random() - 0.5) * 2 * this.aimError,
        0,
      );
    }

    let aimAt: THREE.Vector3 | null = null;
    if (canSee) aimAt = ctx.opponent.chest;
    else if (this.lastKnown && this.alertTimer > 0 && !this.target.equals(this.lastKnown)) aimAt = null;
    else if (self.team === 'ATTACK' && !ctx.crystal.destroyed && distToCrystal < 26
      && ctx.world.hasLineOfSight(self.eye, ctx.crystal.position)) {
      aimAt = ctx.crystal.position;
    }

    const look = aimAt ?? tmpA.copy(this.target).setY(self.eye.y);
    const dir = tmpB.copy(look).sub(self.eye);
    const wantYaw = Math.atan2(-dir.x, -dir.z) + this.aimOffset.x;
    const wantPitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z)) + this.aimOffset.y;

    const turn = (aimAt ? 9 : 5) * dt;
    self.yaw += wrapAngle(wantYaw - self.yaw) * Math.min(1, turn);
    self.pitch += (wantPitch - self.pitch) * Math.min(1, turn);
    self.pitch = THREE.MathUtils.clamp(self.pitch, -1.2, 1.2);
  }

  private move(dt: number, ctx: NpcContext): void {
    const self = this.self;
    const wish = tmpA.copy(this.target).sub(self.position).setY(0);
    const dist = wish.length();
    if (dist < 0.35) {
      self.controller.step(dt, tmpB.set(0, 0, 0), 0, false);
      return;
    }
    wish.divideScalar(dist);

    // 前方が塞がっていれば横にずれる
    const probe = self.eye.clone();
    probe.y = self.position.y + 0.55;
    const blocked = ctx.world.raycast(probe, wish, 1.4, false);
    let jump = false;
    if (blocked) {
      const left = tmpB.set(-wish.z, 0, wish.x);
      const right = tmpB.clone().negate();
      const lFree = !ctx.world.raycast(probe, left, 1.4, false);
      wish.copy(lFree ? left : right).normalize();
      if (blocked.box.tag === 'desk' && this.jumpCooldown <= 0) {
        jump = true;
        this.jumpCooldown = 1.2;
      }
    }

    // 詰まり検知（角に嵌ったら向きを変える）
    if (self.position.distanceToSquared(this.lastPos) < 0.0004) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 0.7) {
        this.stuckTimer = 0;
        this.strafeDir *= -1;
        this.repathTimer = 0;
        jump = this.jumpCooldown <= 0;
        this.jumpCooldown = 1.0;
      }
    } else {
      this.stuckTimer = 0;
    }
    this.lastPos.copy(self.position);

    const speed = self.moveSpeed * (this.state === 'RUSH_CRYSTAL' ? 1.0 : 0.92);
    self.controller.step(dt, wish, speed, jump);
  }

  private shoot(dt: number, ctx: NpcContext, canSee: boolean, distToEnemy: number, distToCrystal: number): void {
    const self = this.self;
    this.burstPause = Math.max(0, this.burstPause - dt);

    // 近距離では近接に持ち替え、クリスタルを殴る時も同様
    const meleeIndex = self.weapons.findIndex((w) => w.isMelee);
    const rangedIndex = self.weapons.findIndex((w) => !w.isMelee && !w.needsReload);
    const wantMelee = (canSee && distToEnemy < 2.2)
      || (self.team === 'ATTACK' && this.state === 'RUSH_CRYSTAL' && distToCrystal < 2.6);
    if (wantMelee && meleeIndex >= 0) self.switchTo(meleeIndex);
    else if (!wantMelee && self.weapon.isMelee && rangedIndex >= 0) self.switchTo(rangedIndex);

    const w = self.weapon;
    self.triggerHeld = false;
    if (w.needsReload && !w.reloading) {
      w.startReload(self.student.reloadScale);
      return;
    }
    if (this.burstPause > 0 || !w.canFire()) return;

    const targetIsCrystal = !canSee && self.team === 'ATTACK' && !ctx.crystal.destroyed
      && distToCrystal < (w.def.range ?? 30)
      && ctx.world.hasLineOfSight(self.eye, ctx.crystal.position);
    if (!canSee && !targetIsCrystal) return;
    if (canSee && distToEnemy > (w.def.range ?? 30)) return;

    if (w.isCharge) {
      self.triggerHeld = true;
      if (w.charge < 0.85) return;
    }

    ctx.requestFire(self);
    this.burstLeft--;
    if (this.burstLeft <= 0) {
      this.burstLeft = this.burstLength;
      this.burstPause = 0.35 + Math.random() * 0.35;
    }
  }
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
