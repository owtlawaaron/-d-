import * as THREE from 'three';

interface Fading {
  mesh: THREE.Mesh;
  life: number;
  max: number;
  kind: 'tracer' | 'impact';
}

/** 曳光弾・着弾・マズルフラッシュ。すべてプールして毎フレームの new を避ける。 */
export class Vfx {
  private pool: Fading[] = [];
  private flash: THREE.PointLight;
  private flashLife = 0;

  constructor(private readonly scene: THREE.Scene) {
    const tracerGeo = new THREE.BoxGeometry(0.035, 0.035, 1);
    const impactGeo = new THREE.SphereGeometry(0.12, 8, 6);
    for (let i = 0; i < 26; i++) {
      const kind: 'tracer' | 'impact' = i < 16 ? 'tracer' : 'impact';
      const mesh = new THREE.Mesh(
        kind === 'tracer' ? tracerGeo : impactGeo,
        new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0 }),
      );
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.pool.push({ mesh, life: 0, max: 1, kind });
    }
    this.flash = new THREE.PointLight(0xffd9a0, 0, 6, 2);
    scene.add(this.flash);
  }

  private take(kind: 'tracer' | 'impact'): Fading | null {
    return this.pool.find((f) => f.kind === kind && f.life <= 0) ?? null;
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color = 0xfff0c0): void {
    const f = this.take('tracer');
    if (!f) return;
    const dist = from.distanceTo(to);
    f.mesh.position.copy(from).add(to).multiplyScalar(0.5);
    f.mesh.lookAt(to);
    f.mesh.scale.set(1, 1, Math.max(0.1, dist));
    f.mesh.visible = true;
    (f.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    (f.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85;
    f.life = f.max = 0.07;
  }

  impact(at: THREE.Vector3, color = 0xffd9a0): void {
    const f = this.take('impact');
    if (!f) return;
    f.mesh.position.copy(at);
    f.mesh.scale.setScalar(0.5);
    f.mesh.visible = true;
    (f.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    (f.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95;
    f.life = f.max = 0.22;
  }

  muzzle(at: THREE.Vector3): void {
    this.flash.position.copy(at);
    this.flash.intensity = 9;
    this.flashLife = 0.05;
  }

  update(dt: number): void {
    for (const f of this.pool) {
      if (f.life <= 0) continue;
      f.life -= dt;
      const k = Math.max(0, f.life / f.max);
      const mat = f.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = k * 0.9;
      if (f.kind === 'impact') f.mesh.scale.setScalar(0.5 + (1 - k) * 2.2);
      if (f.life <= 0) f.mesh.visible = false;
    }
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      this.flash.intensity = Math.max(0, (this.flashLife / 0.05) * 9);
    }
  }

  dispose(): void {
    for (const f of this.pool) {
      this.scene.remove(f.mesh);
      (f.mesh.material as THREE.Material).dispose();
    }
    this.scene.remove(this.flash);
  }
}
