import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { blackboardTexture, deskTopTexture, lockerTexture, skyTexture, wallTexture } from './Textures';

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

export interface PartGeometries {
  wood: THREE.BufferGeometry;
  frame: THREE.BufferGeometry;
}

/**
 * 学校机。天板・物入れ（木）と、脚・フック（金属）を別ジオメトリにして
 * それぞれ InstancedMesh にする（30台で4ドローコール）。
 * size は [幅, 高さ, 奥行き]。原点は箱の中心。
 */
export function deskGeometries(size: THREE.Vector3): PartGeometries {
  const [w, h, d] = [size.x, size.y, size.z];
  const top = h / 2;
  const wood = mergeGeometries([
    box(w, 0.085, d, 0, top - 0.043, 0),                    // 天板
    box(w * 0.88, h * 0.28, d * 0.82, 0, top - 0.24, 0.02), // 物入れ
  ])!;
  const legT = Math.max(0.045, w * 0.05);
  const lx = w / 2 - legT;
  const lz = d / 2 - legT;
  const legH = h - 0.09;
  const frame = mergeGeometries([
    box(legT, legH, legT, -lx, -h / 2 + legH / 2, -lz),
    box(legT, legH, legT, lx, -h / 2 + legH / 2, -lz),
    box(legT, legH, legT, -lx, -h / 2 + legH / 2, lz),
    box(legT, legH, legT, lx, -h / 2 + legH / 2, lz),
    box(w * 0.9, legT * 0.7, legT * 0.7, 0, -h / 2 + 0.14, -lz),  // 貫
    box(legT * 0.6, 0.13, legT * 0.6, lx, top - 0.42, lz + 0.02), // 手提げフック
  ])!;
  return { wood, frame };
}

/** 学校椅子。座面・背もたれ（木）と脚（金属）。 */
export function chairGeometries(scale: number): PartGeometries {
  const seatH = 0.44 * scale;
  const w = 0.40 * scale;
  const d = 0.40 * scale;
  const legT = 0.035 * scale;
  const wood = mergeGeometries([
    box(w, 0.05 * scale, d, 0, seatH, 0),                                   // 座面
    box(w, 0.26 * scale, 0.05 * scale, 0, seatH + 0.30 * scale, d / 2 - 0.02 * scale), // 背もたれ
  ])!;
  const lx = w / 2 - legT;
  const lz = d / 2 - legT;
  const frame = mergeGeometries([
    box(legT, seatH, legT, -lx, seatH / 2, -lz),
    box(legT, seatH, legT, lx, seatH / 2, -lz),
    box(legT, seatH, legT, -lx, seatH / 2, lz),
    box(legT, seatH, legT, lx, seatH / 2, lz),
    box(legT * 0.8, 0.32 * scale, legT * 0.8, -lx, seatH + 0.16 * scale, lz),
    box(legT * 0.8, 0.32 * scale, legT * 0.8, lx, seatH + 0.16 * scale, lz),
  ])!;
  return { wood, frame };
}

export const woodMaterial = (): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ map: deskTopTexture(), color: 0xf0e2cc, roughness: 0.72 });

export const frameMaterial = (): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color: 0x99a0a8, roughness: 0.42, metalness: 0.55 });

/** 黒板（枠・チョーク受け・チョーク付き）。 */
export function makeBlackboard(width: number, height: number): THREE.Group {
  const g = new THREE.Group();
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshStandardMaterial({ map: blackboardTexture(), roughness: 0.95 }),
  );
  g.add(board);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xa9814f, roughness: 0.7 });
  const t = 0.07;
  const bars: [number, number, number, number][] = [
    [width + t * 2, t, 0, height / 2 + t / 2],
    [width + t * 2, t, 0, -height / 2 - t / 2],
    [t, height, -width / 2 - t / 2, 0],
    [t, height, width / 2 + t / 2, 0],
  ];
  for (const [bw, bh, bx, by] of bars) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.06), frameMat);
    bar.position.set(bx, by, 0.01);
    g.add(bar);
  }
  // チョーク受け
  const tray = new THREE.Mesh(new THREE.BoxGeometry(width * 0.98, 0.05, 0.13), frameMat);
  tray.position.set(0, -height / 2 - 0.06, 0.07);
  g.add(tray);
  const chalkMat = new THREE.MeshStandardMaterial({ color: 0xf6f2e6, roughness: 1 });
  for (let i = 0; i < 4; i++) {
    const chalk = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.10, 6), chalkMat);
    chalk.rotation.z = Math.PI / 2;
    chalk.position.set(-width * 0.3 + i * 0.14, -height / 2 - 0.02, 0.09);
    g.add(chalk);
  }
  return g;
}

/** 窓（サッシ・ガラス・外の風景）。plane は -Z 向きに作り、呼び出し側で回す。 */
export function makeWindow(width: number, height: number): THREE.Group {
  const g = new THREE.Group();
  const outside = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 1.5, height * 1.5),
    new THREE.MeshBasicMaterial({ map: skyTexture(), toneMapped: false }),
  );
  outside.position.z = -0.6;
  g.add(outside);
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshPhysicalMaterial({
      color: 0xdff0ff, transparent: true, opacity: 0.16,
      roughness: 0.06, metalness: 0, transmission: 0,
    }),
  );
  g.add(glass);
  const sashMat = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.4, metalness: 0.5 });
  const t = 0.055;
  const add = (w: number, h: number, x: number, y: number) => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.07), sashMat);
    bar.position.set(x, y, 0.02);
    g.add(bar);
  };
  add(width + t, t, 0, height / 2);
  add(width + t, t, 0, -height / 2);
  add(t, height, -width / 2, 0);
  add(t, height, width / 2, 0);
  add(t * 0.8, height, 0, 0);           // 縦桟
  add(width, t * 0.7, 0, 0);            // 横桟
  return g;
}

/** 廊下側の引き戸（すりガラス付き）。 */
export function makeDoor(width: number, height: number): THREE.Group {
  const g = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xb08b58, roughness: 0.75 });
  const panel = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.07), frameMat);
  panel.position.y = height / 2;
  g.add(panel);
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 0.72, height * 0.42),
    new THREE.MeshStandardMaterial({ color: 0xd6e6ea, roughness: 0.9, transparent: true, opacity: 0.85 }),
  );
  glass.position.set(0, height * 0.66, 0.045);
  g.add(glass);
  const handle = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.22, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x6f7780, roughness: 0.35, metalness: 0.7 }),
  );
  handle.position.set(width * 0.35, height * 0.45, 0.06);
  g.add(handle);
  return g;
}

/** 天井の蛍光灯。 */
export function makeCeilingLight(length: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(length, 0.09, 0.24),
    new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.55 }),
  );
  g.add(body);
  const tube = new THREE.Mesh(
    new THREE.BoxGeometry(length * 0.94, 0.05, 0.16),
    new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xfff6dd, emissiveIntensity: 2.6, roughness: 1,
    }),
  );
  tube.position.y = -0.06;
  g.add(tube);
  return g;
}

/** 壁掛け時計。 */
export function makeClock(radius: number): THREE.Group {
  const g = new THREE.Group();
  const face = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 0.05, 24),
    new THREE.MeshStandardMaterial({ color: 0xf7f5ef, roughness: 0.6 }),
  );
  face.rotation.x = Math.PI / 2;
  g.add(face);
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(radius, radius * 0.09, 8, 24),
    new THREE.MeshStandardMaterial({ color: 0x3d4249, roughness: 0.5, metalness: 0.3 }),
  );
  g.add(rim);
  const handMat = new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.6 });
  const hour = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.1, radius * 0.55, 0.02), handMat);
  hour.position.set(0, radius * 0.26, 0.04);
  hour.rotation.z = -0.6;
  const minute = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.07, radius * 0.85, 0.02), handMat);
  minute.position.set(0, radius * 0.4, 0.04);
  minute.rotation.z = 2.4;
  g.add(hour, minute);
  for (let i = 0; i < 12; i++) {
    const tick = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.07, radius * 0.16, 0.015), handMat);
    const a = (i / 12) * Math.PI * 2;
    tick.position.set(Math.sin(a) * radius * 0.82, Math.cos(a) * radius * 0.82, 0.04);
    tick.rotation.z = -a;
    g.add(tick);
  }
  return g;
}

/** ロッカー / 掃除用具入れ。 */
export function makeLocker(size: THREE.Vector3): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({ map: lockerTexture(), roughness: 0.5, metalness: 0.35 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** 教卓。 */
export function makeTeacherDesk(size: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ map: deskTopTexture(), color: 0xd5b489, roughness: 0.75 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y * 0.1, size.z), woodMat);
  top.position.y = size.y / 2 - size.y * 0.05;
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xb08b58, roughness: 0.8 });
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(size.x * 0.92, size.y * 0.82, size.z * 0.86),
    bodyMat,
  );
  body.position.y = -size.y * 0.06;
  g.add(top, body);
  for (const m of g.children) { m.castShadow = true; m.receiveShadow = true; }
  return g;
}

export interface WallOpening {
  /** 開口の中心（壁が伸びる軸上の座標） */
  center: number;
  width: number;
  yMin: number;
  yMax: number;
}

export interface WallPiece {
  center: THREE.Vector3;
  size: THREE.Vector3;
}

/**
 * 窓や扉の開口を持つ壁を、板の集合に分解する。
 * 描画用のマージ済みジオメトリと、当たり判定用の箱リストを返す。
 */
export function wallWithOpenings(opts: {
  along: 'x' | 'z';
  fixed: number;
  from: number;
  to: number;
  height: number;
  thickness: number;
  openings: WallOpening[];
}): { geometry: THREE.BufferGeometry; pieces: WallPiece[] } {
  const { along, fixed, from, to, height, thickness } = opts;
  const openings = [...opts.openings].sort((a, b) => a.center - b.center);
  const pieces: WallPiece[] = [];

  const push = (start: number, end: number, yMin: number, yMax: number) => {
    if (end - start < 1e-4 || yMax - yMin < 1e-4) return;
    const mid = (start + end) / 2;
    const yMid = (yMin + yMax) / 2;
    const len = end - start;
    const h = yMax - yMin;
    pieces.push(along === 'x'
      ? { center: new THREE.Vector3(mid, yMid, fixed), size: new THREE.Vector3(len, h, thickness) }
      : { center: new THREE.Vector3(fixed, yMid, mid), size: new THREE.Vector3(thickness, h, len) });
  };

  let cursor = from;
  for (const o of openings) {
    const oStart = o.center - o.width / 2;
    const oEnd = o.center + o.width / 2;
    push(cursor, oStart, 0, height);            // 開口の手前の壁
    push(oStart, oEnd, 0, o.yMin);              // 腰壁
    push(oStart, oEnd, o.yMax, height);         // 垂れ壁
    cursor = oEnd;
  }
  push(cursor, to, 0, height);

  const geos = pieces.map((p) => box(p.size.x, p.size.y, p.size.z, p.center.x, p.center.y, p.center.z));
  return { geometry: mergeGeometries(geos)!, pieces };
}

export const wallMaterial = (repeat = 4): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ map: wallTexture(repeat), color: 0xf2ede1, roughness: 0.95 });
