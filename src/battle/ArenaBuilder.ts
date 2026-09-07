import * as THREE from 'three';
import type { ArenaDef } from '../data/types';
import type { Seat } from '../meta/SeatValue';
import { ColliderSet } from './Colliders';
import {
  chairGeometries, deskGeometries, frameMaterial, makeBlackboard, makeCeilingLight, makeClock,
  makeDoor, makeLocker, makeTeacherDesk, makeWindow, wallMaterial, wallWithOpenings, woodMaterial,
} from '../render/Props';
import { floorTexture } from '../render/Textures';

const DESK_SIZE = new THREE.Vector3(1.3, 1.05, 0.9);
const CHAIR_SCALE = 1.75;
const CHAIR_OFFSET_Z = 0.92;
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
  const halfX = bx / 2;
  const halfZ = bz / 2;

  // --- 床 ---
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(bx, 1, bz),
    new THREE.MeshStandardMaterial({ map: floorTexture(9), roughness: 0.8 }),
  );
  floor.position.set(0, -0.5, 0);
  floor.receiveShadow = true;
  group.add(floor);
  world.add(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(bx, 1, bz), 'floor');

  // --- 壁 ---
  const wallMat = wallMaterial(5);
  const solidWall = (pos: THREE.Vector3, size: THREE.Vector3, tag: string) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), wallMat);
    mesh.position.copy(pos);
    mesh.receiveShadow = true;
    group.add(mesh);
    world.add(pos, size, tag);
    return mesh;
  };
  solidWall(new THREE.Vector3(0, by / 2, -halfZ - 0.2), new THREE.Vector3(bx, by, 0.4), 'wall_front');
  solidWall(new THREE.Vector3(0, by / 2, halfZ + 0.2), new THREE.Vector3(bx, by, 0.4), 'wall_back');

  // 窓側（+X）と廊下側（-X）は開口つき
  const winCenters = [-halfZ * 0.55, 0, halfZ * 0.55];
  const windowWall = wallWithOpenings({
    along: 'z', fixed: halfX + 0.2, from: -halfZ, to: halfZ, height: by, thickness: 0.4,
    openings: winCenters.map((c) => ({ center: c, width: 4.0, yMin: 1.9, yMax: 4.6 })),
  });
  const windowWallMesh = new THREE.Mesh(windowWall.geometry, wallMat);
  windowWallMesh.receiveShadow = true;
  group.add(windowWallMesh);
  for (const p of windowWall.pieces) world.add(p.center, p.size, 'wall_window');

  const doorCenters = [-halfZ * 0.35, halfZ * 0.45];
  const doorWall = wallWithOpenings({
    along: 'z', fixed: -halfX - 0.2, from: -halfZ, to: halfZ, height: by, thickness: 0.4,
    openings: doorCenters.map((c) => ({ center: c, width: 1.9, yMin: 0, yMax: 4.0 })),
  });
  const doorWallMesh = new THREE.Mesh(doorWall.geometry, wallMat);
  doorWallMesh.receiveShadow = true;
  group.add(doorWallMesh);
  for (const p of doorWall.pieces) world.add(p.center, p.size, 'wall_corridor');

  // 扉の向こうの廊下（開口から見える）
  const corridor = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, by, bz),
    new THREE.MeshStandardMaterial({ color: 0xa79f8e, roughness: 1 }),
  );
  corridor.position.set(-halfX - 3.2, by / 2, 0);
  group.add(corridor);
  world.add(corridor.position, new THREE.Vector3(0.3, by, bz), 'wall_corridor_far');

  const ceiling = new THREE.Mesh(
    new THREE.BoxGeometry(bx, 0.3, bz),
    new THREE.MeshStandardMaterial({ color: 0xf1eee6, roughness: 1, emissive: 0x24221c }),
  );
  ceiling.position.set(0, by + 0.15, 0);
  group.add(ceiling);
  world.add(ceiling.position, new THREE.Vector3(bx, 0.3, bz), 'ceiling');

  // --- 黒板・時計・教卓 ---
  const board = makeBlackboard(bx * 0.6, by * 0.34);
  board.position.set(0, by * 0.46, -halfZ + 0.02);
  group.add(board);
  risers.push({ object: board, baseY: board.position.y, delay: 0.05 });

  const clock = makeClock(0.42);
  clock.position.set(bx * 0.34, by * 0.78, -halfZ + 0.03);
  group.add(clock);

  // --- 窓と扉 ---
  for (const c of winCenters) {
    const win = makeWindow(3.9, 2.65);
    win.position.set(halfX, 3.25, c);
    win.rotation.y = -Math.PI / 2;
    group.add(win);
    for (const s of [-1, 1]) {
      const curtain = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 2.9, 0.55),
        new THREE.MeshStandardMaterial({ color: 0xf3ddb8, roughness: 1 }),
      );
      curtain.position.set(halfX - 0.3, 3.2, c + s * 1.8);
      curtain.castShadow = true;
      group.add(curtain);
      // カーテンは弾が抜ける
      world.add(curtain.position, new THREE.Vector3(0.14, 2.9, 0.55), 'curtain', { penetrable: true });
    }
  }
  for (const c of doorCenters) {
    const door = makeDoor(1.8, 3.9);
    door.position.set(-halfX, 0, c);
    door.rotation.y = Math.PI / 2;
    group.add(door);
    world.add(new THREE.Vector3(-halfX, 1.95, c), new THREE.Vector3(0.14, 3.9, 1.8), 'door');
  }

  // --- 天井の蛍光灯 ---
  for (let row = -1; row <= 1; row++) {
    for (const col of [-1, 1]) {
      const light = makeCeilingLight(4.2);
      light.position.set(col * bx * 0.26, by - 0.4, row * bz * 0.28);
      light.rotation.y = Math.PI / 2;
      group.add(light);
    }
  }

  // --- JSON 由来のプロップ（教卓・ロッカー） ---
  const skipTags = new Set(['wall_blackboard', 'wall_back', 'wall_corridor', 'wall_window', 'curtain']);
  for (const c of def.colliders ?? []) {
    if (skipTags.has(c.tag ?? '')) continue;
    const pos = new THREE.Vector3(...c.pos);
    const size = new THREE.Vector3(...c.size);
    let obj: THREE.Object3D;
    if (c.tag?.includes('locker')) {
      obj = makeLocker(size);
    } else if (c.tag === 'teacher_desk') {
      obj = makeTeacherDesk(size);
    } else {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, size.y, size.z),
        new THREE.MeshStandardMaterial({ color: 0xa8825a, roughness: 0.8 }),
      );
      mesh.castShadow = true;
      obj = mesh;
    }
    obj.position.copy(pos);
    group.add(obj);
    if (!c.penetrable) world.add(pos, size, c.tag ?? 'prop');
    risers.push({ object: obj, baseY: pos.y, delay: 0.1 + Math.random() * 0.2 });
  }

  // --- 机と椅子（カバー） ---
  const desk = deskGeometries(DESK_SIZE);
  const chair = chairGeometries(CHAIR_SCALE);
  const chairSeatY = 0.44 * CHAIR_SCALE;
  const deskWood = new THREE.InstancedMesh(desk.wood, woodMaterial(), seats.length);
  const deskFrame = new THREE.InstancedMesh(desk.frame, frameMaterial(), seats.length);
  const chairWood = new THREE.InstancedMesh(chair.wood, woodMaterial(), seats.length);
  const chairFrame = new THREE.InstancedMesh(chair.frame, frameMaterial(), seats.length);
  const wireMat = new THREE.MeshBasicMaterial({ color: 0x6fd8ff, wireframe: true, transparent: true, opacity: 0.9 });
  const wires = new THREE.InstancedMesh(new THREE.BoxGeometry(DESK_SIZE.x, DESK_SIZE.y, DESK_SIZE.z), wireMat, seats.length);
  for (const m of [deskWood, deskFrame, chairWood, chairFrame]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    group.add(m);
  }
  wires.frustumCulled = false;
  group.add(wires);

  const coverPoints: THREE.Vector3[] = [];
  const deskPositions: THREE.Vector3[] = [];
  const deskDelays: number[] = [];
  const maxCol = Math.max(...seats.map((s) => s.col));
  for (const seat of seats) {
    const p = seatToArena(seat);
    p.y = DESK_SIZE.y / 2;
    deskPositions.push(p);
    deskDelays.push((seat.col / Math.max(1, maxCol)) * 0.45 + seat.row * 0.03);
    world.add(p, DESK_SIZE, 'desk');
    // 椅子は低めの当たり判定にして、通路が詰まりすぎないようにする
    world.add(
      new THREE.Vector3(p.x, chairSeatY / 2, p.z + CHAIR_OFFSET_Z),
      new THREE.Vector3(0.68 * CHAIR_SCALE, chairSeatY, 0.68 * CHAIR_SCALE),
      'chair',
    );
    coverPoints.push(new THREE.Vector3(p.x, 0, p.z + DESK_SIZE.z * 1.15));
    coverPoints.push(new THREE.Vector3(p.x, 0, p.z - DESK_SIZE.z * 1.15));
  }

  // 机の上の小物（ノートと筆箱）。3席に1つ置く
  const clutter = new THREE.Group();
  seats.forEach((seat, i) => {
    if (i % 3 !== 0) return;
    const p = seatToArena(seat);
    const rot = (i * 1.7) % 1.2 - 0.6;
    const note = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.035, 0.26),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(((i * 37) % 360) / 360, 0.35, 0.72), roughness: 0.9,
      }),
    );
    note.position.set(p.x + (i % 2 ? 0.18 : -0.16), DESK_SIZE.y + 0.02, p.z + 0.04);
    note.rotation.y = rot;
    note.castShadow = true;
    clutter.add(note);
    if (i % 6 === 0) {
      const caseMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.07, 0.12),
        new THREE.MeshStandardMaterial({ color: 0x3c4a5e, roughness: 0.7 }),
      );
      caseMesh.position.set(p.x - 0.32, DESK_SIZE.y + 0.035, p.z - 0.16);
      caseMesh.rotation.y = -rot * 0.6;
      caseMesh.castShadow = true;
      clutter.add(caseMesh);
    }
  });
  group.add(clutter);

  const dummy = new THREE.Object3D();
  const applyInstances = (progress: number) => {
    for (let i = 0; i < deskPositions.length; i++) {
      const local = THREE.MathUtils.clamp((progress - deskDelays[i]) / 0.5, 0, 1);
      const ease = 1 - Math.pow(1 - local, 3);
      const p = deskPositions[i];
      const drop = (1 - ease) * 2.6;
      const s = 0.001 + ease;

      dummy.position.set(p.x, p.y - drop, p.z);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      deskWood.setMatrixAt(i, dummy.matrix);
      deskFrame.setMatrixAt(i, dummy.matrix);
      dummy.scale.setScalar(s * 1.03);
      dummy.updateMatrix();
      wires.setMatrixAt(i, dummy.matrix);

      dummy.position.set(p.x, -DESK_SIZE.y / 2 - drop, p.z + CHAIR_OFFSET_Z);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      chairWood.setMatrixAt(i, dummy.matrix);
      chairFrame.setMatrixAt(i, dummy.matrix);
    }
    for (const m of [deskWood, deskFrame, chairWood, chairFrame, wires]) m.instanceMatrix.needsUpdate = true;
    wireMat.opacity = Math.max(0, 1 - Math.max(0, progress - 0.45) / 0.4) * 0.9;
    wires.visible = wireMat.opacity > 0.02;
    clutter.visible = progress > 0.92;
  };

  const setGenesisProgress = (p: number) => {
    applyInstances(p);
    for (const r of risers) {
      const local = THREE.MathUtils.clamp((p - r.delay) / 0.5, 0, 1);
      const ease = 1 - Math.pow(1 - local, 3);
      r.object.position.y = r.baseY - (1 - ease) * 3.2;
      r.object.visible = local > 0.001;
    }
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
  defenderSpawn.z += flip ? -1.9 : 1.9;
  const crystalPos = seatToArena(defenderSeat);
  crystalPos.y = DESK_SIZE.y + 0.95;

  const dispose = () => {
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
  };

  return {
    group, world, attackerSpawns, defenderSpawn, crystalPos, coverPoints,
    setGenesisProgress, seatToArena, dispose,
  };
}
