import * as THREE from 'three';
import type { WeaponDef } from '../data/types';

export interface Projectile {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  gravity: number;
  damage: number;
  ownerId: number;
  def: WeaponDef;
  life: number;
  mesh: THREE.Mesh;
}

/** 弾のオブジェクトプール。毎フレームの new をゼロにするため使い回す。 */
export class ProjectilePool {
  private readonly items: Projectile[] = [];

  constructor(private readonly scene: THREE.Scene, size = 48) {
    const geo = new THREE.SphereGeometry(0.11, 8, 6);
    for (let i = 0; i < size; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffe9b0 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.items.push({
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        gravity: 0,
        damage: 0,
        ownerId: -1,
        def: null as unknown as WeaponDef,
        life: 0,
        mesh,
      });
    }
  }

  spawn(def: WeaponDef, origin: THREE.Vector3, dir: THREE.Vector3, damage: number, ownerId: number, color: number): Projectile | null {
    const p = this.items.find((x) => !x.active);
    if (!p) return null;
    p.active = true;
    p.def = def;
    p.pos.copy(origin);
    p.vel.copy(dir).multiplyScalar(def.projectileSpeed ?? 30);
    p.gravity = def.projectileGravity ?? 0;
    p.damage = damage;
    p.ownerId = ownerId;
    p.life = 3.0;
    p.mesh.visible = true;
    p.mesh.position.copy(origin);
    (p.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    return p;
  }

  get all(): readonly Projectile[] { return this.items; }

  release(p: Projectile): void {
    p.active = false;
    p.mesh.visible = false;
  }

  clear(): void {
    for (const p of this.items) this.release(p);
  }

  dispose(): void {
    for (const p of this.items) {
      this.scene.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
    }
  }
}
