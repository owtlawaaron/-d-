import * as THREE from 'three';
import type { BattleRules } from '../data/types';
import type { DataRegistry } from '../data/registry';
import type { Student } from '../meta/Student';
import { CharacterController } from './CharacterController';
import type { ColliderSet } from './Colliders';
import { WeaponState } from './Weapons';

export type Team = 'ATTACK' | 'DEFEND';

const MELEE_ID = 'roster_bash';

/** プレイヤーと NPC の共通部分。HP・武器・向き・リスポーン。 */
export class Combatant {
  readonly controller: CharacterController;
  readonly weapons: WeaponState[] = [];
  current = 0;
  hp: number;
  readonly maxHp: number;
  alive = true;
  respawnsLeft: number;
  respawnTimer = 0;
  yaw = 0;
  pitch = 0;
  slowTimer = 0;
  slowAmount = 0;
  triggerHeld = false;
  lastDamageFrom: THREE.Vector3 | null = null;
  mesh: THREE.Group | null = null;

  constructor(
    readonly student: Student,
    readonly team: Team,
    readonly isPlayer: boolean,
    world: ColliderSet,
    private readonly rules: BattleRules,
    reg: DataRegistry,
  ) {
    this.controller = new CharacterController(world, rules);
    this.maxHp = student.maxHp;
    this.hp = this.maxHp;
    this.respawnsLeft = team === 'ATTACK' ? rules.attacker.respawns : rules.defender.respawns;

    const ids = [student.def.loadout?.primary, student.def.loadout?.secondary, MELEE_ID];
    for (const id of ids) {
      if (!id) continue;
      const def = reg.weapons.get(id);
      if (def) this.weapons.push(new WeaponState(def));
    }
    if (this.weapons.length === 0) this.weapons.push(new WeaponState(reg.weapon(MELEE_ID)));
  }

  get weapon(): WeaponState { return this.weapons[this.current]; }
  get position(): THREE.Vector3 { return this.controller.position; }
  get eye(): THREE.Vector3 {
    return new THREE.Vector3(this.position.x, this.controller.eyeY, this.position.z);
  }
  /** 胴体の中心。NPC の狙点にも使う。 */
  get chest(): THREE.Vector3 {
    return new THREE.Vector3(this.position.x, this.position.y + this.controller.height * 0.62, this.position.z);
  }

  get moveSpeed(): number {
    const mv = this.rules.movement;
    const base = mv.baseRunSpeed + this.student.stats.athletics * mv.runSpeedPerAthletics;
    const slow = this.slowTimer > 0 ? 1 - this.slowAmount : 1;
    return base * slow;
  }

  aimDirection(target = new THREE.Vector3()): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    return target.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp).normalize();
  }

  switchTo(index: number): void {
    if (index < 0 || index >= this.weapons.length || index === this.current) return;
    this.current = index;
  }

  applySlow(amount: number, duration: number): void {
    this.slowAmount = Math.max(this.slowAmount, amount);
    this.slowTimer = Math.max(this.slowTimer, duration);
  }

  /** ダメージを受ける。死んだら true。 */
  damage(amount: number, from?: THREE.Vector3): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    if (from) this.lastDamageFrom = from.clone();
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      return true;
    }
    return false;
  }

  startRespawn(): boolean {
    const delay = this.team === 'ATTACK' ? this.rules.attacker.respawnDelay : this.rules.defender.respawnDelay;
    if (this.respawnsLeft <= 0) return false;
    this.respawnsLeft--;
    this.respawnTimer = delay;
    return true;
  }

  revive(x: number, y: number, z: number): void {
    this.hp = this.maxHp;
    this.alive = true;
    this.slowTimer = 0;
    this.controller.teleport(x, y, z);
    for (const w of this.weapons) {
      w.ammo = w.def.magazine;
      w.reloadTimer = 0;
      w.cooldown = 0;
    }
  }

  update(dt: number): void {
    this.slowTimer = Math.max(0, this.slowTimer - dt);
    if (this.slowTimer === 0) this.slowAmount = 0;
    for (let i = 0; i < this.weapons.length; i++) {
      this.weapons[i].update(dt, this.student.reloadScale, this.triggerHeld && i === this.current);
    }
  }
}
