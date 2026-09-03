import * as THREE from 'three';
import type { StudentDef } from '../data/types';

const HAIR_SHAPES: Record<string, [number, number, number]> = {
  short: [0.30, 0.10, 0.30],
  spike: [0.32, 0.20, 0.32],
  bob: [0.34, 0.22, 0.34],
  long: [0.32, 0.34, 0.30],
  ponytail: [0.30, 0.16, 0.30],
  buzz: [0.28, 0.06, 0.28],
};

export interface StudentMesh {
  group: THREE.Group;
  head: THREE.Mesh;
  torso: THREE.Mesh;
  armL: THREE.Mesh;
  armR: THREE.Mesh;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  height: number;
}

/**
 * P0 の「箱人間」（docs/04 §4.4）。
 * モデル制作をクリティカルパスに置かないため、プリミティブだけで組む。
 */
export function createStudentMesh(def: StudentDef, teamColor?: number): StudentMesh {
  const group = new THREE.Group();
  const height = def.appearance?.height ?? 1.65;
  const skin = new THREE.Color(def.appearance?.skin ?? '#f0cba8');
  const hairColor = new THREE.Color(def.appearance?.hairColor ?? '#221a12');
  const uniform = new THREE.Color(teamColor ?? 0x2f3d5c);

  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.8 });
  const hairMat = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.9 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: uniform, roughness: 0.75 });
  const legMat = new THREE.MeshStandardMaterial({ color: uniform.clone().multiplyScalar(0.6), roughness: 0.8 });

  const torsoH = height * 0.34;
  const legH = height * 0.44;
  const headS = height * 0.16;

  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.13, legH, 0.16), legMat);
  legL.position.set(-0.09, legH / 2, 0);
  const legR = legL.clone();
  legR.position.x = 0.09;

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.40, torsoH, 0.22), bodyMat);
  torso.position.y = legH + torsoH / 2;

  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.10, torsoH * 0.92, 0.14), bodyMat);
  armL.position.set(-0.26, legH + torsoH * 0.52, 0);
  const armR = armL.clone();
  armR.position.x = 0.26;

  const head = new THREE.Mesh(new THREE.BoxGeometry(headS * 1.6, headS * 1.6, headS * 1.55), skinMat);
  head.position.y = legH + torsoH + headS * 0.85;

  const hairDims = HAIR_SHAPES[def.appearance?.hair ?? 'short'] ?? HAIR_SHAPES.short;
  const hair = new THREE.Mesh(
    new THREE.BoxGeometry(headS * 1.68 * (hairDims[0] / 0.3), headS * 1.7 * (hairDims[1] / 0.1) * 0.35, headS * 1.62 * (hairDims[2] / 0.3)),
    hairMat,
  );
  hair.position.y = head.position.y + headS * 0.72;
  head.add(new THREE.Mesh(new THREE.BoxGeometry(headS * 0.2, headS * 0.2, 0.02), new THREE.MeshBasicMaterial({ color: 0x1a1a1a })));
  const eyeL = head.children[0] as THREE.Mesh;
  eyeL.position.set(-headS * 0.34, headS * 0.12, -headS * 0.79);
  const eyeR = eyeL.clone();
  eyeR.position.x = headS * 0.34;
  head.add(eyeR);

  for (const m of [legL, legR, torso, armL, armR, head, hair]) {
    m.castShadow = true;
    group.add(m);
  }
  return { group, head, torso, armL, armR, legL, legR, height };
}

/** 歩行・射撃の簡易アニメ（ボーン無し）。 */
export function animateStudentMesh(m: StudentMesh, t: number, speed: number, firing: number): void {
  const swing = Math.sin(t * 9) * Math.min(1, speed / 4) * 0.6;
  m.legL.rotation.x = swing;
  m.legR.rotation.x = -swing;
  m.armL.rotation.x = -swing * 0.5;
  m.armR.rotation.x = firing > 0 ? -1.35 : swing * 0.5;
  m.torso.position.y += 0;
  m.group.position.y += 0;
}
