import type { WeaponDef } from '../data/types';

/** 1丁ぶんの弾数・リロード・拡散・チャージの状態。 */
export class WeaponState {
  ammo: number;
  cooldown = 0;
  reloadTimer = 0;
  spread: number;
  charge = 0;

  constructor(readonly def: WeaponDef) {
    this.ammo = def.magazine;
    this.spread = def.spread?.base ?? 0;
  }

  get reloading(): boolean { return this.reloadTimer > 0; }
  get isMelee(): boolean { return this.def.kind === 'melee'; }
  get isCharge(): boolean { return this.def.kind === 'charge'; }
  get needsReload(): boolean { return this.ammo <= 0 && !this.isMelee; }

  update(dt: number, reloadScale: number, holdingTrigger: boolean): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this.ammo = this.def.magazine;
        this.spread = this.def.spread?.base ?? 0;
      }
    }
    const sp = this.def.spread;
    if (sp) {
      this.spread = Math.max(sp.base, this.spread - sp.recoverPerSec * dt);
    }
    if (this.isCharge && !this.reloading) {
      this.charge = holdingTrigger && this.ammo > 0
        ? Math.min(1, this.charge + dt / (this.def.chargeTime ?? 1))
        : 0;
    }
    void reloadScale;
  }

  startReload(reloadScale: number): boolean {
    if (this.isMelee || this.reloading || this.ammo >= this.def.magazine) return false;
    this.reloadTimer = this.def.reloadTime * reloadScale;
    return true;
  }

  canFire(): boolean {
    return this.cooldown <= 0 && !this.reloading && (this.isMelee || this.ammo > 0);
  }

  /** 発射を確定させ、ダメージ量を返す。 */
  fire(recoilScale: number): number {
    this.cooldown = 1 / this.def.fireRate;
    if (!this.isMelee) this.ammo = Math.max(0, this.ammo - 1);
    const sp = this.def.spread;
    if (sp) this.spread = Math.min(sp.max, this.spread + sp.perShot * recoilScale);
    let damage = this.def.damage;
    if (this.isCharge) {
      const max = this.def.damageMax ?? this.def.damage;
      damage = this.def.damage + (max - this.def.damage) * this.charge;
      this.charge = 0;
    }
    return damage;
  }
}
