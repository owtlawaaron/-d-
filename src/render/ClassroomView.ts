import * as THREE from 'three';
import type { Classroom } from '../meta/Classroom';
import { createStudentMesh, poseStudentMesh, type StudentMesh } from './StudentMesh';
import {
  chairGeometries, deskGeometries, frameMaterial, makeBlackboard, makeCeilingLight,
  makeClock, makeDoor, makeLocker, makeTeacherDesk, makeWindow, wallMaterial, wallWithOpenings, woodMaterial,
} from './Props';
import { floorTexture } from './Textures';

const DESK = new THREE.Vector3(0.62, 0.7, 0.45);
const CHAIR_SCALE = 0.85;
const CHAIR_SEAT_Y = 0.44 * CHAIR_SCALE;
const CHAIR_OFFSET_Z = 0.44;

/** 席替えフェーズの俯瞰3D。教室と着席した30人を表示する。 */
export class ClassroomView {
  readonly group = new THREE.Group();
  private students = new Map<string, StudentMesh>();
  private highlights = new Map<number, THREE.Mesh>();
  private t = 0;
  private camZ = 5;
  private lookZ = -3;
  private camY = 2.3;

  constructor(private readonly room: Classroom) {
    this.build();
  }

  private build(): void {
    const seats = this.room.calc.seats;
    const minX = Math.min(...seats.map((s) => s.x));
    const maxX = Math.max(...seats.map((s) => s.x));
    const minZ = Math.min(...seats.map((s) => s.z));
    const maxZ = Math.max(...seats.map((s) => s.z));
    const w = maxX - minX + 3.4;
    const d = maxZ - minZ + 4.6;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const H = 3.0;
    const frontZ = minZ - 2.3;
    const backZ = maxZ + 2.3;
    const leftX = minX - 1.7;
    const rightX = maxX + 1.7;

    // --- 床 ---
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.2, d),
      new THREE.MeshStandardMaterial({ map: floorTexture(6), roughness: 0.82 }),
    );
    floor.position.set(cx, -0.1, cz);
    floor.receiveShadow = true;
    this.group.add(floor);

    // --- 壁と天井 ---
    const wallMat = wallMaterial(3);
    const addWall = (x: number, z: number, sx: number, sz: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, H, sz), wallMat);
      m.position.set(x, H / 2, z);
      m.receiveShadow = true;
      this.group.add(m);
      return m;
    };
    addWall(cx, frontZ, w, 0.16);
    addWall(cx, backZ, w, 0.16);

    // 窓側（右）と廊下側（左）は開口を持つ壁として組む
    const winCenters = [cz - 2.6, cz, cz + 2.6];
    const windowWall = wallWithOpenings({
      along: 'z', fixed: rightX, from: frontZ, to: backZ, height: H, thickness: 0.16,
      openings: winCenters.map((c) => ({ center: c, width: 2.24, yMin: 0.98, yMax: 2.46 })),
    });
    const windowWallMesh = new THREE.Mesh(windowWall.geometry, wallMat);
    windowWallMesh.receiveShadow = true;
    this.group.add(windowWallMesh);

    const doorCenters = [cz - 1.8, cz + 2.4];
    const doorWall = wallWithOpenings({
      along: 'z', fixed: leftX, from: frontZ, to: backZ, height: H, thickness: 0.16,
      openings: doorCenters.map((c) => ({ center: c, width: 1.0, yMin: 0, yMax: 2.02 })),
    });
    const doorWallMesh = new THREE.Mesh(doorWall.geometry, wallMat);
    doorWallMesh.receiveShadow = true;
    this.group.add(doorWallMesh);

    // 廊下（扉の向こうに見える空間）
    const corridor = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, H, d),
      new THREE.MeshStandardMaterial({ color: 0xb9b2a2, roughness: 1 }),
    );
    corridor.position.set(leftX - 1.9, H / 2, cz);
    this.group.add(corridor);

    const ceiling = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.16, d),
      new THREE.MeshStandardMaterial({ color: 0xf3f0e8, roughness: 1, emissive: 0x2a2822, emissiveIntensity: 1 }),
    );
    ceiling.position.set(cx, H, cz);
    this.group.add(ceiling);

    // 巾木
    const skirt = new THREE.MeshStandardMaterial({ color: 0x9b7a52, roughness: 0.8 });
    for (const [x, z, sx, sz] of [
      [cx, frontZ + 0.1, w, 0.05], [cx, backZ - 0.1, w, 0.05],
      [leftX + 0.1, cz, 0.05, d], [rightX - 0.1, cz, 0.05, d],
    ] as [number, number, number, number][]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.12, sz), skirt);
      m.position.set(x, 0.06, z);
      this.group.add(m);
    }

    // --- 黒板・教卓・時計 ---
    const board = makeBlackboard(w * 0.58, 1.25);
    board.position.set(cx, 1.55, frontZ + 0.1);
    this.group.add(board);

    const clock = makeClock(0.17);
    clock.position.set(cx + w * 0.36, 2.5, frontZ + 0.11);
    this.group.add(clock);

    const teacherDesk = makeTeacherDesk(new THREE.Vector3(1.5, 0.78, 0.62));
    teacherDesk.position.set(cx - 0.6, 0.39, frontZ + 1.0);
    this.group.add(teacherDesk);

    // --- 窓（右手＝窓側） ---
    for (const c of winCenters) {
      const win = makeWindow(2.2, 1.44);
      win.position.set(rightX, 1.72, c);
      win.rotation.y = -Math.PI / 2;
      this.group.add(win);
      // カーテン（開口の両脇）
      for (const s of [-1, 1]) {
        const curtain = new THREE.Mesh(
          new THREE.BoxGeometry(0.07, 1.62, 0.3),
          new THREE.MeshStandardMaterial({ color: 0xf3ddb8, roughness: 1 }),
        );
        curtain.position.set(rightX - 0.16, 1.74, c + s * 1.0);
        this.group.add(curtain);
      }
      // カーテンレール
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.05, 2.5),
        new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.4, metalness: 0.6 }),
      );
      rail.position.set(rightX - 0.16, 2.56, c);
      this.group.add(rail);
    }

    // --- 廊下側の扉 ---
    for (const c of doorCenters) {
      const door = makeDoor(0.95, 2.0);
      door.position.set(leftX, 0, c);
      door.rotation.y = Math.PI / 2;
      this.group.add(door);
    }

    // --- 後ろのロッカーと掲示板 ---
    const locker = makeLocker(new THREE.Vector3(w * 0.42, 1.75, 0.42));
    locker.position.set(cx - w * 0.22, 0.875, backZ - 0.32);
    this.group.add(locker);
    const boardBack = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.34, 1.0, 0.05),
      new THREE.MeshStandardMaterial({ color: 0xcfc09a, roughness: 1 }),
    );
    boardBack.position.set(cx + w * 0.24, 1.6, backZ - 0.12);
    this.group.add(boardBack);
    for (let i = 0; i < 6; i++) {
      const poster = new THREE.Mesh(
        new THREE.PlaneGeometry(0.32 + Math.random() * 0.2, 0.24 + Math.random() * 0.16),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color().setHSL(Math.random(), 0.35, 0.82), roughness: 1,
        }),
      );
      poster.position.set(
        cx + w * 0.24 + (Math.random() - 0.5) * w * 0.26,
        1.35 + Math.random() * 0.55,
        backZ - 0.14,
      );
      poster.rotation.z = (Math.random() - 0.5) * 0.08;
      this.group.add(poster);
    }

    // --- 天井の蛍光灯 ---
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        const light = makeCeilingLight(2.0);
        light.position.set(cx + (col - 0.5) * w * 0.42, H - 0.22, cz + (row - 0.5) * d * 0.34);
        light.rotation.y = Math.PI / 2;
        this.group.add(light);
      }
    }

    // --- 机と椅子（インスタンス描画） ---
    const desk = deskGeometries(DESK);
    const chair = chairGeometries(CHAIR_SCALE);
    const deskWood = new THREE.InstancedMesh(desk.wood, woodMaterial(), seats.length);
    const deskFrame = new THREE.InstancedMesh(desk.frame, frameMaterial(), seats.length);
    const chairWood = new THREE.InstancedMesh(chair.wood, woodMaterial(), seats.length);
    const chairFrame = new THREE.InstancedMesh(chair.frame, frameMaterial(), seats.length);
    for (const m of [deskWood, deskFrame, chairWood, chairFrame]) {
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }
    const dummy = new THREE.Object3D();
    seats.forEach((seat, i) => {
      dummy.position.set(seat.x, DESK.y / 2, seat.z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      deskWood.setMatrixAt(i, dummy.matrix);
      deskFrame.setMatrixAt(i, dummy.matrix);
      dummy.position.set(seat.x, 0, seat.z + CHAIR_OFFSET_Z);
      dummy.updateMatrix();
      chairWood.setMatrixAt(i, dummy.matrix);
      chairFrame.setMatrixAt(i, dummy.matrix);
    });
    for (const m of [deskWood, deskFrame, chairWood, chairFrame]) m.instanceMatrix.needsUpdate = true;

    // --- 生徒 ---
    for (const s of this.room.students) {
      const mesh = createStudentMesh(s.def, s.isPlayer ? 0x2aa8ff : undefined);
      this.group.add(mesh.group);
      this.students.set(s.id, mesh);
    }

    // --- 席のハイライト板 ---
    const hlGeo = new THREE.PlaneGeometry(DESK.x * 1.15, (DESK.z + CHAIR_OFFSET_Z) * 1.1);
    for (const seat of seats) {
      const mesh = new THREE.Mesh(hlGeo, new THREE.MeshBasicMaterial({
        color: 0x8fe4ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
      }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(seat.x, 0.015, seat.z + CHAIR_OFFSET_Z * 0.5);
      this.group.add(mesh);
      this.highlights.set(seat.index, mesh);
    }

    // --- 照明 ---
    const hemi = new THREE.HemisphereLight(0xeaf4ff, 0x8b7a62, 1.25);
    const sun = new THREE.DirectionalLight(0xfff0d2, 1.5);
    sun.position.set(rightX + 5, 6.5, cz + 1.5);
    sun.target.position.set(cx - 1, 0.6, cz);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -8;
    sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 8;
    sun.shadow.camera.bottom = -8;
    sun.shadow.camera.far = 32;
    sun.shadow.bias = -0.0012;
    const fill = new THREE.DirectionalLight(0xcfe0ff, 0.3);
    fill.position.set(leftX - 4, 4, cz - 3);
    // 天井を照らす間接光（蛍光灯の反射）
    const bounce = new THREE.PointLight(0xfff4dd, 12, 14, 2.0);
    bounce.position.set(cx, H - 0.5, cz);
    this.group.add(hemi, sun, sun.target, fill, bounce);

    // 教室の内側にカメラを置く（外に出ると壁しか見えない）
    this.camZ = backZ - 0.55;
    this.lookZ = frontZ + 0.6;
    this.camY = H - 0.72;

    this.syncSeats();
  }

  /** 生徒を今の席に座らせる。 */
  syncSeats(): void {
    for (const s of this.room.students) {
      const mesh = this.students.get(s.id);
      if (!mesh) continue;
      mesh.group.position.set(s.seat.x, 0, s.seat.z + CHAIR_OFFSET_Z);
      mesh.group.rotation.y = 0; // 黒板（-Z）を向く
      poseStudentMesh(mesh, 0, { seated: true, seatY: CHAIR_SEAT_Y });
    }
  }

  setHighlight(seatIndex: number, color: number, strength: number): void {
    const m = this.highlights.get(seatIndex);
    if (!m) return;
    const mat = m.material as THREE.MeshBasicMaterial;
    mat.color.setHex(color);
    mat.opacity = strength;
  }

  clearHighlights(): void {
    for (const m of this.highlights.values()) (m.material as THREE.MeshBasicMaterial).opacity = 0;
  }

  update(dt: number, camera: THREE.PerspectiveCamera): void {
    this.t += dt;
    // 教室のうしろから、ゆっくり首を振るように見る
    const sway = Math.sin(this.t * 0.13) * 1.3;
    camera.position.set(sway, this.camY + Math.sin(this.t * 0.21) * 0.08, this.camZ);
    camera.lookAt(sway * 0.25, 1.15, this.lookZ);
    for (const s of this.room.students) {
      const mesh = this.students.get(s.id);
      if (!mesh) continue;
      poseStudentMesh(mesh, this.t + s.seat.index * 0.7, { seated: true, seatY: CHAIR_SEAT_Y });
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose?.();
    });
  }
}
