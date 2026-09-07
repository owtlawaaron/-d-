import * as THREE from 'three';

/**
 * 文房具の武器モデル。銃口が -Z を向くように作る。
 * 一人称のビューモデルと、NPC が手に持つモデルの両方で使う。
 */
const matCache = new Map<number, THREE.MeshStandardMaterial>();
function mat(color: number, roughness = 0.6, metalness = 0.15): THREE.MeshStandardMaterial {
  const key = color * 1000 + roughness * 10 + metalness;
  const hit = matCache.get(key);
  if (hit) return hit;
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
  matCache.set(key, m);
  return m;
}

function add(g: THREE.Group, w: number, h: number, d: number, m: THREE.Material,
             x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = true;
  g.add(mesh);
  return mesh;
}

const DARK = 0x5b6470;
const STEEL = 0x8d949c;

export function makeWeaponModel(id: string): THREE.Group {
  const g = new THREE.Group();
  switch (id) {
    case 'chalk_smg': {
      add(g, 0.07, 0.085, 0.28, mat(DARK, 0.55, 0.35), 0, 0, -0.02);          // 本体
      add(g, 0.052, 0.052, 0.24, mat(0xf6f2e8, 0.9, 0), 0, 0.005, -0.26);       // チョークの銃身
      add(g, 0.055, 0.14, 0.09, mat(0x39404a, 0.7), 0, -0.10, 0.02);          // グリップ
      add(g, 0.06, 0.11, 0.07, mat(0xe8e2d2, 0.85), 0, -0.06, -0.11);         // チョーク箱マガジン
      add(g, 0.02, 0.035, 0.05, mat(STEEL, 0.4, 0.6), 0, 0.065, -0.13);       // フロントサイト
      add(g, 0.035, 0.02, 0.09, mat(0x39404a, 0.5, 0.4), 0, 0.055, 0.06);         // レール
      break;
    }
    case 'eraser_launcher': {
      add(g, 0.10, 0.11, 0.26, mat(0x394250, 0.6, 0.3), 0, 0, 0);
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.09, 12), mat(0xf2f0ea, 0.85));
      drum.rotation.z = Math.PI / 2;
      drum.position.set(0, 0.02, -0.10);
      g.add(drum);
      add(g, 0.085, 0.085, 0.16, mat(0xdcdad2, 0.9), 0, 0.01, -0.26);         // 消しゴムの砲身
      add(g, 0.05, 0.02, 0.06, mat(0x3f6fbf, 0.8), 0, 0.055, -0.26);          // 消しゴムの帯
      add(g, 0.06, 0.15, 0.09, mat(0x2c333d, 0.7), 0, -0.11, 0.04);
      break;
    }
    case 'compass_bow': {
      add(g, 0.04, 0.05, 0.20, mat(STEEL, 0.35, 0.7), 0, 0, -0.02);
      const legL = add(g, 0.022, 0.30, 0.022, mat(STEEL, 0.3, 0.75), -0.02, 0.02, -0.16);
      legL.rotation.z = 0.42;
      const legR = add(g, 0.022, 0.30, 0.022, mat(STEEL, 0.3, 0.75), 0.02, 0.02, -0.16);
      legR.rotation.z = -0.42;
      add(g, 0.016, 0.06, 0.016, mat(0x22262b, 0.8), -0.085, -0.11, -0.16);   // 針
      add(g, 0.02, 0.05, 0.02, mat(0x8a5a2a, 0.9), 0.085, -0.11, -0.16);      // 鉛筆
      add(g, 0.005, 0.005, 0.30, mat(0xe6e2d6, 1, 0), 0, -0.10, -0.16);       // 弦
      add(g, 0.05, 0.13, 0.08, mat(0x343a43, 0.7), 0, -0.09, 0.05);
      break;
    }
    case 'ruler_boomerang': {
      const tri = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.16, 0.012, 3),
        new THREE.MeshStandardMaterial({
          color: 0x9fd8e8, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.62,
        }),
      );
      tri.rotation.x = Math.PI / 2;
      tri.position.z = -0.16;
      g.add(tri);
      add(g, 0.05, 0.11, 0.09, mat(0x3a4049, 0.7), 0, -0.06, 0.02);
      break;
    }
    case 'correction_tape': {
      add(g, 0.09, 0.13, 0.16, mat(0xf0f2f4, 0.5, 0.05), 0, 0, -0.06);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 14), mat(0x3f8fd0, 0.5));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(0, 0.02, -0.06);
      g.add(wheel);
      add(g, 0.03, 0.05, 0.13, mat(0xdfe3e6, 0.6), 0, -0.03, -0.19);          // ヘッド
      add(g, 0.05, 0.11, 0.08, mat(0x2f7ab5, 0.6), 0, -0.10, 0.02);
      break;
    }
    case 'roster_bash':
    default: {
      add(g, 0.20, 0.02, 0.28, mat(0x7b4a2c, 0.85), 0, 0, -0.10);             // 表紙
      add(g, 0.19, 0.02, 0.26, mat(0xf2eee2, 0.95), 0, 0.022, -0.10);         // 紙束
      add(g, 0.20, 0.02, 0.28, mat(0x8b5734, 0.85), 0, 0.045, -0.10);
      add(g, 0.03, 0.055, 0.28, mat(0x5a3520, 0.8), -0.10, 0.022, -0.10);     // 背表紙
      add(g, 0.10, 0.006, 0.05, mat(0xd8b45a, 0.4, 0.6), 0.02, 0.058, -0.16); // 金の箔押し
      break;
    }
  }
  return g;
}

/** 一人称の手（右手＝グリップ、左手＝銃身を支える）。 */
export function makeHands(skin = 0xf0cba8): THREE.Group {
  const g = new THREE.Group();
  const skinMat = mat(skin, 0.85, 0);
  const sleeveMat = mat(0x15171d, 0.85, 0);
  // 右手
  add(g, 0.055, 0.075, 0.085, skinMat, 0.005, -0.085, 0.03);
  add(g, 0.062, 0.075, 0.13, sleeveMat, 0.005, -0.10, 0.13);
  // 左手（銃身を支える）
  add(g, 0.05, 0.07, 0.09, skinMat, -0.045, -0.055, -0.16);
  add(g, 0.058, 0.07, 0.14, sleeveMat, -0.075, -0.075, -0.06, 0, 0.35, 0);
  return g;
}
