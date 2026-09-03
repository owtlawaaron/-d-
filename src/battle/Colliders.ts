import * as THREE from 'three';

export interface Box {
  min: THREE.Vector3;
  max: THREE.Vector3;
  tag: string;
  /** 弾が貫通する（ダメージ半減）。カーテンや教科書シールド。 */
  penetrable: boolean;
  /** 破壊可能な設置物なら残りHP。undefined は不壊。 */
  hp?: number;
  mesh?: THREE.Object3D;
}

export interface RayHit {
  distance: number;
  box: Box;
  normal: THREE.Vector3;
}

const EPS = 1e-6;

/** 静的 AABB の集合。移動の衝突解決と弾のレイキャストの両方に使う。 */
export class ColliderSet {
  readonly boxes: Box[] = [];

  add(center: THREE.Vector3, size: THREE.Vector3, tag = 'world', opts: { penetrable?: boolean; hp?: number; mesh?: THREE.Object3D } = {}): Box {
    const half = size.clone().multiplyScalar(0.5);
    const box: Box = {
      min: center.clone().sub(half),
      max: center.clone().add(half),
      tag,
      penetrable: opts.penetrable ?? false,
      hp: opts.hp,
      mesh: opts.mesh,
    };
    this.boxes.push(box);
    return box;
  }

  remove(box: Box): void {
    const i = this.boxes.indexOf(box);
    if (i >= 0) this.boxes.splice(i, 1);
  }

  clear(): void {
    this.boxes.length = 0;
  }

  /** AABB と重なる箱を返す。 */
  overlapping(min: THREE.Vector3, max: THREE.Vector3, out: Box[] = []): Box[] {
    out.length = 0;
    for (const b of this.boxes) {
      if (min.x < b.max.x && max.x > b.min.x &&
          min.y < b.max.y && max.y > b.min.y &&
          min.z < b.max.z && max.z > b.min.z) {
        out.push(b);
      }
    }
    return out;
  }

  /** スラブ法によるレイキャスト。最も近いヒットを返す。 */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, includePenetrable = true): RayHit | null {
    let best: RayHit | null = null;
    for (const b of this.boxes) {
      if (!includePenetrable && b.penetrable) continue;
      const hit = rayBox(origin, dir, b, maxDist);
      if (hit && (!best || hit.distance < best.distance)) best = hit;
    }
    return best;
  }

  /** 2点間に遮蔽がないか（貫通可の物体は視線を通す）。 */
  hasLineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const dir = to.clone().sub(from);
    const dist = dir.length();
    if (dist < EPS) return true;
    dir.divideScalar(dist);
    const hit = this.raycast(from, dir, dist, false);
    return hit === null;
  }
}

export function rayBox(origin: THREE.Vector3, dir: THREE.Vector3, b: Box, maxDist: number): RayHit | null {
  let tmin = 0;
  let tmax = maxDist;
  let axis = 0;
  let sign = 1;

  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  const mn = [b.min.x, b.min.y, b.min.z];
  const mx = [b.max.x, b.max.y, b.max.z];

  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < EPS) {
      if (o[i] < mn[i] || o[i] > mx[i]) return null;
      continue;
    }
    const inv = 1 / d[i];
    let t1 = (mn[i] - o[i]) * inv;
    let t2 = (mx[i] - o[i]) * inv;
    let s = -1;
    if (t1 > t2) { [t1, t2] = [t2, t1]; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  const normal = new THREE.Vector3();
  normal.setComponent(axis, sign);
  return { distance: tmin, box: b, normal };
}

/** 中心と半径の球にレイが当たる距離（当たらなければ null）。 */
export function raySphere(origin: THREE.Vector3, dir: THREE.Vector3, center: THREE.Vector3, radius: number, maxDist: number): number | null {
  const oc = origin.clone().sub(center);
  const b = oc.dot(dir);
  const c = oc.lengthSq() - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = -b - sq;
  if (t < 0) t = -b + sq;
  if (t < 0 || t > maxDist) return null;
  return t;
}
