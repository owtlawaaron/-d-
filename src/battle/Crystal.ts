import * as THREE from 'three';
import type { BattleRules } from '../data/types';

/** 座席権クリスタル。攻め側はこれを壊せば勝ち。 */
export class Crystal {
  readonly group = new THREE.Group();
  readonly core: THREE.Mesh;
  private readonly shell: THREE.Mesh;
  private readonly light: THREE.PointLight;
  hp: number;
  readonly maxHp: number;
  readonly radius: number;
  destroyed = false;
  private t = 0;
  private flash = 0;
  scaleAnim = 1;

  constructor(private readonly rules: BattleRules, position: THREE.Vector3) {
    this.maxHp = rules.crystal.hp;
    this.hp = this.maxHp;
    this.radius = rules.crystal.radius * 1.6;

    this.core = new THREE.Mesh(
      new THREE.OctahedronGeometry(this.radius, 0),
      new THREE.MeshStandardMaterial({
        color: 0x8fe4ff, emissive: 0x2aa8ff, emissiveIntensity: 2.2,
        metalness: 0.2, roughness: 0.15,
      }),
    );
    this.shell = new THREE.Mesh(
      new THREE.OctahedronGeometry(this.radius * 1.45, 0),
      new THREE.MeshBasicMaterial({ color: 0x64d2ff, wireframe: true, transparent: true, opacity: 0.45 }),
    );
    this.light = new THREE.PointLight(0x5ec8ff, 6, 12, 2);
    this.group.add(this.core, this.shell, this.light);
    this.group.position.copy(position);
  }

  get position(): THREE.Vector3 { return this.group.position; }
  get ratio(): number { return this.hp / this.maxHp; }

  /** ダメージ。倍率は BattleSession 側で計算済み。 */
  damage(amount: number): void {
    if (this.destroyed) return;
    this.hp = Math.max(0, this.hp - amount);
    this.flash = 1;
    if (this.hp === 0) {
      this.destroyed = true;
      this.group.visible = false;
    }
  }

  update(dt: number, remainingTime: number): void {
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 4);
    const late = remainingTime <= this.rules.crystal.lateGameWindow;
    const pulse = 1 + Math.sin(this.t * (late ? 7 : 2.5)) * 0.05;
    this.group.rotation.y += dt * 0.8;
    this.shell.rotation.y -= dt * 1.6;
    this.shell.rotation.x += dt * 0.5;
    this.core.scale.setScalar(pulse * this.scaleAnim);
    this.shell.scale.setScalar((late ? 0.92 : 1.0) * this.scaleAnim);
    this.shell.visible = !late; // 残り30秒でシールドが剥がれる

    const mat = this.core.material as THREE.MeshStandardMaterial;
    mat.emissive.setHex(this.flash > 0.05 ? 0xffffff : late ? 0xff5a3c : 0x2aa8ff);
    mat.emissiveIntensity = 1.6 + this.flash * 4 + (1 - this.ratio) * 1.2;
    this.light.intensity = 5 + this.flash * 12;
    this.light.color.setHex(late ? 0xff7a4a : 0x5ec8ff);
  }
}
