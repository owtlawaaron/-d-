import * as THREE from 'three';
import type { ArenaDef, ColliderDef } from '../data/types';
import type { Seat } from '../meta/SeatValue';
import { ColliderSet } from './Colliders';

const DESK_SIZE = new THREE.Vector3(1.3, 1.05, 0.9);
/** 席のワールド座標（等倍）→ アリーナ座標への変換 */
const Z_OFFSET = -1.0;

export interface Arena {
  group: THREE.Group;
  world: ColliderSet;
  attackerSpawns: THREE.Vector3[];
  defenderSpawn: THREE.Vector3;
  crystalPos: THREE.Vector3;
  coverPoints: THREE.Vector3[];
  setGenesisProgress(p: number): void;
  seatToArena(seat: Seat): THREE.Vector3;
  dispose(): void;
}

interface Riser {
  object: THREE.Object3D;
  baseY: number;
  delay: number;
}

/**
 * 席の配置からバトルアリーナ（拡張教室）を組み立てる。
 * 生成演出は「床下からせり上がる」アニメーションで、
 * setGenesisProgress(0→1) で駆動する（docs/05）。
 */
export function buildArena(def: ArenaDef, seats: Seat[], defenderSeat: Seat): Arena {
  const group = new THREE.Group();
  const world = new ColliderSet();
  const risers: Riser[] = [];
  const scale = def.scale;
  const seatToArena = (seat: Seat) =>
    new THREE.Vector3(seat.x * scale, 0, seat.z * scale + Z_OFFSET);

  const bx = def.bounds.x;
  const by = def.bounds.y;
  const bz = def.bounds.z;

  // --- 床（当たり判定つき） ---
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xb99a6b, roughness: 0.9, metalness: 0 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(bx, 1, bz), floorMat);
  floor.position.set(0, -0.5, 0);
  floor.receiveShadow = true;
  group.add(floor);
  world.add(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(bx, 1, bz), 'floor');

  // 床のライン（教室の板目）
  const grid = new THREE.GridHelper(Math.max(bx, bz), 24, 0x8a6f4a, 0x8a6f4a);
  (grid.material as THREE.Material).opacity = 0.25;
  (grid.material as THREE.Material).transparent = true;
  grid.position.y = 0.01;
  group.add(grid);

  // --- 壁・天井 ---
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xcdc6b6, roughness: 0.95 });
  const addWall = (pos: THREE.Vector3, size: THREE.Vector3, tag: string, mat = wallMat) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat);
    mesh.position.copy(pos);
    mesh.receiveShadow = true;
    group.add(mesh);
    world.add(pos, size, tag);
    return mesh;
  };
  addWall(new THREE.Vector3(0, by / 2, -bz / 2 - 0.2), new THREE.Vector3(bx, by, 0.4), 'wall_front');
  addWall(new THREE.Vector3(0, by / 2, bz / 2 + 0.2), new THREE.Vector3(bx, by, 0.4), 'wall_back');
  addWall(new THREE.Vector3(-bx / 2 - 0.2, by / 2, 0), new THREE.Vector3(0.4, by, bz), 'wall_corridor');
  addWall(new THREE.Vector3(bx / 2 + 0.2, by / 2, 0), new THREE.Vector3(0.4, by, bz), 'wall_window',
    new THREE.MeshStandardMaterial({ color: 0xcfe6f5, roughness: 0.4, metalness: 0.1 }));
  const ceiling = new THREE.Mesh(
    new THREE.BoxGeometry(bx, 0.3, bz),
    new THREE.MeshStandardMaterial({ color: 0xdedbd2, roughness: 1 }),
  );
  ceiling.position.set(0, by + 0.15, 0);
  group.add(ceiling);
  world.add(new THREE.Vector3(0, by + 0.15, 0), new THREE.Vector3(bx, 0.3, bz), 'ceiling');

  // 黒板
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(bx * 0.62, by * 0.32, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x244a35, roughness: 0.85 }),
  );
  board.position.set(0, by * 0.42, -bz / 2 + 0.06);
  group.add(board);

  // 窓（見た目だけ）
  for (let i = -1; i <= 1; i++) {
    const win = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, by * 0.42, bz * 0.24),
      new THREE.MeshStandardMaterial({
        color: 0xbfe9ff, emissive: 0x88ccee, emissiveIntensity: 0.5,
        transparent: true, opacity: 0.55, roughness: 0.1,
      }),
    );
    win.position.set(bx / 2 - 0.05, by * 0.5, i * bz * 0.28);
    group.add(win);
  }

  // --- JSON 由来の静的オブジェクト（教卓・ロッカー・カーテン） ---
  const propMat = new THREE.MeshStandardMaterial({ color: 0xa8825a, roughness: 0.8 });
  const lockerMat = new THREE.MeshStandardMaterial({ color: 0x8d99a6, roughness: 0.6, metalness: 0.35 });
  const skipTags = new Set(['wall_blackboard', 'wall_back', 'wall_corridor', 'wall_window']);
  for (const c of def.colliders ?? []) {
    if (skipTags.has(c.tag ?? '')) continue;
    const pos = new THREE.Vector3(...c.pos);
    const size = new THREE.Vector3(...c.size);
    const mat = c.tag === 'curtain'
      ? new THREE.MeshStandardMaterial({ color: 0xf3d9b1, roughness: 1, transparent: true, opacity: 0.75 })
      : c.tag?.includes('locker') ? lockerMat : propMat;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat);
    mesh.position.copy(pos);
    mesh.castShadow = true;
    group.add(mesh);
    if (!c.penetrable) world.add(pos, size, c.tag ?? 'prop');
    risers.push({ object: mesh, baseY: pos.y, delay: 0.1 + Math.random() * 0.2 });
  }

  // --- 机（カバー） ---
  const deskGeo = new THREE.BoxGeometry(DESK_SIZE.x, DESK_SIZE.y, DESK_SIZE.z);
  const deskMat = new THREE.MeshStandardMaterial({ color: 0xd8b98a, roughness: 0.75 });
  const wireMat = new THREE.MeshBasicMaterial({ color: 0x6fd8ff, wireframe: true, transparent: true, opacity: 0.9 });
  const desks = new THREE.InstancedMesh(deskGeo, deskMat, seats.length);
  const wires = new THREE.InstancedMesh(deskGeo, wireMat, seats.length);
  desks.castShadow = true;
  desks.frustumCulled = false;
  wires.frustumCulled = false;
  group.add(desks, wires);

  const coverPoints: THREE.Vector3[] = [];
  const deskPositions: THREE.Vector3[] = [];
  const deskDelays: number[] = [];
  const maxCol = Math.max(...seats.map((s) => s.col));
  seats.forEach((seat, i) => {
    const p = seatToArena(seat);
    p.y = DESK_SIZE.y / 2;
    deskPositions.push(p);
    deskDelays.push((seat.col / Math.max(1, maxCol)) * 0.45 + seat.row * 0.03);
    world.add(p, DESK_SIZE, 'desk');
    // 机の手前を遮蔽ポイントとして NPC に使わせる
    coverPoints.push(new THREE.Vector3(p.x, 0, p.z + DESK_SIZE.z * 0.9));
    coverPoints.push(new THREE.Vector3(p.x, 0, p.z - DESK_SIZE.z * 0.9));
    void i;
  });

  const dummy = new THREE.Object3D();
  const applyDesks = (progress: number) => {
    for (let i = 0; i < deskPositions.length; i++) {
      const local = THREE.MathUtils.clamp((progress - deskDelays[i]) / 0.5, 0, 1);
      const ease = 1 - Math.pow(1 - local, 3);
      const p = deskPositions[i];
      dummy.position.set(p.x, p.y - (1 - ease) * 2.6, p.z);
      dummy.scale.setScalar(0.001 + ease);
      dummy.updateMatrix();
      desks.setMatrixAt(i, dummy.matrix);
      dummy.scale.setScalar(0.001 + ease * 1.03);
      dummy.updateMatrix();
      wires.setMatrixAt(i, dummy.matrix);
    }
    desks.instanceMatrix.needsUpdate = true;
    wires.instanceMatrix.needsUpdate = true;
    // 実体化しきったらワイヤーフレームを消す
    wireMat.opacity = Math.max(0, 1 - Math.max(0, progress - 0.45) / 0.4) * 0.9;
    wires.visible = wireMat.opacity > 0.02;
  };

  const setGenesisProgress = (p: number) => {
    applyDesks(p);
    for (const r of risers) {
      const local = THREE.MathUtils.clamp((p - r.delay) / 0.5, 0, 1);
      const ease = 1 - Math.pow(1 - local, 3);
      r.object.position.y = r.baseY - (1 - ease) * 3.2;
      r.object.visible = local > 0.001;
    }
    const shown = p > 0.05;
    board.visible = shown;
    ceiling.visible = p > 0.5;
  };
  setGenesisProgress(1);

  // --- スポーン地点 ---
  const flip = def.spawnFlipWhenDefenderRow?.gte !== undefined
    && defenderSeat.row >= def.spawnFlipWhenDefenderRow.gte;
  const attackerSpawns = def.attackerSpawns.map((s) => {
    const v = new THREE.Vector3(s[0], s[1], s[2]);
    if (flip) v.z = -v.z;
    return v;
  });
  const defenderSpawn = seatToArena(defenderSeat);
  defenderSpawn.z += flip ? -1.6 : 1.6; // 机の手前に立たせる
  const crystalPos = seatToArena(defenderSeat);
  crystalPos.y = DESK_SIZE.y + 0.95;

  const dispose = () => {
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
  };

  return {
    group, world, attackerSpawns, defenderSpawn, crystalPos, coverPoints,
    setGenesisProgress, seatToArena, dispose,
  };
}

export function colliderDefsToBoxes(defs: ColliderDef[] | undefined): ColliderDef[] {
  return defs ?? [];
}
