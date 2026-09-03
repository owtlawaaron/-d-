import * as THREE from 'three';
import type { Classroom } from '../meta/Classroom';
import { createStudentMesh, type StudentMesh } from './StudentMesh';

/** 席替えフェーズの俯瞰3D。教室と着席した30人を表示する。 */
export class ClassroomView {
  readonly group = new THREE.Group();
  private students = new Map<string, StudentMesh>();
  private highlights = new Map<number, THREE.Mesh>();
  private t = 0;

  constructor(private readonly room: Classroom) {
    this.build();
  }

  private build(): void {
    const seats = this.room.calc.seats;
    const minX = Math.min(...seats.map((s) => s.x));
    const maxX = Math.max(...seats.map((s) => s.x));
    const minZ = Math.min(...seats.map((s) => s.z));
    const maxZ = Math.max(...seats.map((s) => s.z));
    const w = maxX - minX + 3.6;
    const d = maxZ - minZ + 5.0;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;

    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.2, d),
      new THREE.MeshStandardMaterial({ color: 0xc0a274, roughness: 0.95 }),
    );
    floor.position.set(cx, -0.1, cz);
    floor.receiveShadow = true;
    this.group.add(floor);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0xeae4d6, roughness: 1 });
    const addWall = (x: number, z: number, sx: number, sz: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 2.6, sz), wallMat);
      m.position.set(x, 1.3, z);
      this.group.add(m);
    };
    addWall(cx, minZ - 2.3, w, 0.16);
    addWall(cx, maxZ + 2.5, w, 0.16);
    addWall(minX - 1.7, cz, 0.16, d);
    addWall(maxX + 1.7, cz, 0.16, d);

    const board = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.6, 1.1, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x244a35, roughness: 0.9 }),
    );
    board.position.set(cx, 1.45, minZ - 2.2);
    this.group.add(board);

    const teacherDesk = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.75, 0.65),
      new THREE.MeshStandardMaterial({ color: 0x9a7448, roughness: 0.85 }),
    );
    teacherDesk.position.set(cx, 0.375, minZ - 1.5);
    this.group.add(teacherDesk);

    const deskGeo = new THREE.BoxGeometry(0.62, 0.72, 0.45);
    const deskMat = new THREE.MeshStandardMaterial({ color: 0xd8b98a, roughness: 0.8 });
    const desks = new THREE.InstancedMesh(deskGeo, deskMat, seats.length);
    desks.castShadow = true;
    const dummy = new THREE.Object3D();
    seats.forEach((seat, i) => {
      dummy.position.set(seat.x, 0.36, seat.z);
      dummy.updateMatrix();
      desks.setMatrixAt(i, dummy.matrix);
    });
    desks.instanceMatrix.needsUpdate = true;
    this.group.add(desks);

    for (const s of this.room.students) {
      const mesh = createStudentMesh(s.def, s.isPlayer ? 0x2aa8ff : 0x2f3d5c);
      mesh.group.scale.setScalar(0.86);
      this.group.add(mesh.group);
      this.students.set(s.id, mesh);
    }

    // 席のハイライト板（挑戦相手の選択に使う）
    const hlGeo = new THREE.PlaneGeometry(0.7, 0.55);
    for (const seat of seats) {
      const mesh = new THREE.Mesh(hlGeo, new THREE.MeshBasicMaterial({
        color: 0x8fe4ff, transparent: true, opacity: 0, side: THREE.DoubleSide,
      }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(seat.x, 0.02, seat.z);
      this.group.add(mesh);
      this.highlights.set(seat.index, mesh);
    }

    const hemi = new THREE.HemisphereLight(0xe8f4ff, 0x5c4a35, 1.2);
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.35);
    sun.position.set(6, 9, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    this.group.add(hemi, sun);
    this.syncSeats();
  }

  /** 生徒を今の席に座らせる。 */
  syncSeats(): void {
    for (const s of this.room.students) {
      const mesh = this.students.get(s.id);
      if (!mesh) continue;
      mesh.group.position.set(s.seat.x, 0, s.seat.z + 0.42);
      mesh.group.rotation.y = Math.PI;
      mesh.legL.rotation.x = -1.35;
      mesh.legR.rotation.x = -1.35;
      mesh.armL.rotation.x = -0.4;
      mesh.armR.rotation.x = -0.4;
      mesh.group.position.y = 0.42;
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
    const sway = Math.sin(this.t * 0.13) * 1.5;
    camera.position.set(sway, 3.9 + Math.sin(this.t * 0.21) * 0.14, 7.4);
    camera.lookAt(sway * 0.2, 0.85, -0.6);
    for (const s of this.room.students) {
      const mesh = this.students.get(s.id);
      if (!mesh) continue;
      mesh.group.position.y = 0.42 + Math.sin(this.t * 1.6 + s.seat.index) * 0.012;
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
  }
}
