import * as THREE from 'three';
import type { StudentDef } from '../data/types';

/**
 * 生徒の3Dモデル。glTF を使わず、階層化したプリミティブで組む。
 *
 * 肩・肘・股・膝にピボット（空の Group）を置いてあるので、
 * ボーン無しでも歩行・構え・射撃・気絶のポーズが作れる。
 */

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: number | string, roughness = 0.8, metalness = 0): THREE.MeshStandardMaterial {
  const key = `${color}_${roughness}_${metalness}`;
  const hit = matCache.get(key);
  if (hit) return hit;
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
  matCache.set(key, m);
  return m;
}

function part(
  parent: THREE.Object3D, geo: THREE.BufferGeometry, material: THREE.Material,
  x = 0, y = 0, z = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function pivot(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

export type UniformKind = 'gakuran' | 'sailor';

export interface Limb {
  root: THREE.Group;   // 肩 / 股のピボット
  joint: THREE.Group;  // 肘 / 膝のピボット
}

export interface StudentMesh {
  group: THREE.Group;
  height: number;
  hips: THREE.Group;
  torso: THREE.Group;
  neck: THREE.Group;
  head: THREE.Group;
  armL: Limb;
  armR: Limb;
  legL: Limb;
  legR: Limb;
  /** 右手に持たせる武器の取り付け先 */
  hand: THREE.Group;
  /** 足裏から腰までの高さ */
  legLen: number;
  /** 膝から足首まで（着席時に足を床へ着けるのに使う） */
  shinLen: number;
}

const HAIR_COLORS = ['#221a12', '#2f2318', '#151515', '#4a3524', '#5c4630'];

function uniformOf(def: StudentDef): UniformKind {
  const explicit = (def.appearance as { uniform?: UniformKind } | undefined)?.uniform;
  if (explicit === 'gakuran' || explicit === 'sailor') return explicit;
  // 指定が無ければ id から決める（見た目が毎回変わらないように）
  let h = 0;
  for (let i = 0; i < def.id.length; i++) h = (h * 31 + def.id.charCodeAt(i)) >>> 0;
  return h % 2 === 0 ? 'gakuran' : 'sailor';
}

/**
 * 生徒メッシュを組み立てる。
 * accent は所属（攻め/守り、あなた）を示す腕章の色。制服そのものは学校のまま。
 */
export function createStudentMesh(def: StudentDef, accent?: number): StudentMesh {
  const group = new THREE.Group();
  const H = def.appearance?.height ?? 1.65;
  const skin = def.appearance?.skin ?? '#f0cba8';
  const hairColor = def.appearance?.hairColor ?? HAIR_COLORS[0];
  const kind = uniformOf(def);

  const skinMat = mat(skin, 0.85);
  const hairMat = mat(hairColor, 0.92);
  const jacketMat = kind === 'gakuran' ? mat('#15171d', 0.85) : mat('#243250', 0.85);
  const trouserMat = kind === 'gakuran' ? mat('#1a1d24', 0.88) : mat('#1f2a44', 0.88);
  const whiteMat = mat('#f2f0ea', 0.85);
  const shoeMat = mat('#e8e6df', 0.75);
  const soleMat = mat('#7d848c', 0.8);

  // --- 寸法 ---
  const legLen = H * 0.455;
  const thighLen = legLen * 0.52;
  const shinLen = legLen - thighLen;
  const torsoLen = H * 0.295;
  const neckLen = H * 0.035;
  const headSize = H * 0.135;
  const shoulderW = H * 0.115;
  const hipW = H * 0.052;
  const armLen = H * 0.36;
  const upperArmLen = armLen * 0.52;
  const foreArmLen = armLen - upperArmLen;
  const torsoW = H * 0.185;
  const torsoD = H * 0.098;
  const limbT = H * 0.052;

  // ジオメトリはこの生徒の中で使い回す
  const thighGeo = new THREE.BoxGeometry(limbT * 1.15, thighLen, limbT * 1.15);
  const shinGeo = new THREE.BoxGeometry(limbT, shinLen, limbT);
  const upperArmGeo = new THREE.BoxGeometry(limbT * 0.92, upperArmLen, limbT * 0.92);
  const foreArmGeo = new THREE.BoxGeometry(limbT * 0.8, foreArmLen, limbT * 0.8);

  // --- 腰 ---
  const hips = pivot(group, 0, legLen, 0);
  part(hips, new THREE.BoxGeometry(torsoW * 0.92, H * 0.055, torsoD * 0.95), trouserMat, 0, H * 0.02, 0);

  // --- 脚 ---
  const makeLeg = (side: number): Limb => {
    const root = pivot(hips, side * hipW, 0, 0);
    part(root, thighGeo, trouserMat, 0, -thighLen / 2, 0);
    const joint = pivot(root, 0, -thighLen, 0);
    // セーラー服は靴下、学ランは裾まで濃色
    part(joint, shinGeo, kind === 'sailor' ? whiteMat : trouserMat, 0, -shinLen / 2, 0);
    const foot = pivot(joint, 0, -shinLen, 0);
    part(foot, new THREE.BoxGeometry(limbT * 1.1, H * 0.026, limbT * 2.0), shoeMat, 0, H * 0.013, -limbT * 0.35);
    part(foot, new THREE.BoxGeometry(limbT * 1.15, H * 0.012, limbT * 2.05), soleMat, 0, H * 0.004, -limbT * 0.35);
    // 上履きのつま先ゴム
    part(foot, new THREE.BoxGeometry(limbT * 1.12, H * 0.022, limbT * 0.5), mat(side < 0 ? '#5aa0d8' : '#5aa0d8', 0.8),
      0, H * 0.014, -limbT * 1.1);
    return { root, joint };
  };
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  // --- 胴 ---
  const torso = pivot(hips, 0, 0, 0);
  const chest = part(torso, new THREE.BoxGeometry(torsoW, torsoLen, torsoD), jacketMat, 0, torsoLen / 2, 0);
  chest.name = 'chest';

  // 顔と同じ -Z が正面。制服の前身頃はすべて -Z 側に置く
  const FRONT = -1;
  if (kind === 'gakuran') {
    // 学ラン: 立ち襟の白ライン と 金ボタン
    part(torso, new THREE.BoxGeometry(torsoW * 0.62, H * 0.022, torsoD * 1.02), whiteMat, 0, torsoLen * 0.97, 0.001);
    for (let i = 0; i < 4; i++) {
      part(torso, new THREE.BoxGeometry(H * 0.014, H * 0.014, H * 0.008), mat('#d8b45a', 0.4, 0.6),
        0, torsoLen * 0.82 - i * torsoLen * 0.19, FRONT * (torsoD / 2 + 0.004));
    }
    // 前立て
    part(torso, new THREE.BoxGeometry(H * 0.006, torsoLen * 0.9, H * 0.004), mat('#0a0b0e', 0.9),
      0, torsoLen * 0.5, FRONT * (torsoD / 2 + 0.002));
  } else {
    // セーラー: 背中の白い襟（+Z）と 胸当て・赤スカーフ（-Z）
    part(torso, new THREE.BoxGeometry(torsoW * 1.02, torsoLen * 0.36, H * 0.012), whiteMat,
      0, torsoLen * 0.8, torsoD / 2 + 0.006);
    part(torso, new THREE.BoxGeometry(torsoW * 0.5, torsoLen * 0.2, H * 0.01), whiteMat,
      0, torsoLen * 0.86, FRONT * (torsoD / 2 + 0.004));
    const scarf = part(torso, new THREE.BoxGeometry(torsoW * 0.24, torsoLen * 0.3, H * 0.012), mat('#b8323c', 0.85),
      0, torsoLen * 0.66, FRONT * (torsoD / 2 + 0.008));
    scarf.rotation.z = Math.PI / 4;
    scarf.scale.set(0.72, 0.72, 1);
    // スカート（腰から）
    const skirt = part(hips, new THREE.CylinderGeometry(torsoW * 0.44, torsoW * 0.72, H * 0.13, 10, 1, true),
      mat('#1f2a44', 0.88), 0, -H * 0.03, 0);
    (skirt.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  }

  // 腕章（所属を示す）
  const accentMat = accent !== undefined ? mat(accent, 0.6) : null;

  // --- 腕 ---
  const makeArm = (side: number): Limb => {
    const root = pivot(torso, side * shoulderW, torsoLen * 0.88, 0);
    part(root, upperArmGeo, jacketMat, 0, -upperArmLen / 2, 0);
    if (accentMat && side < 0) {
      part(root, new THREE.BoxGeometry(limbT * 0.98, H * 0.032, limbT * 0.98), accentMat, 0, -upperArmLen * 0.36, 0);
    }
    const joint = pivot(root, 0, -upperArmLen, 0);
    part(joint, foreArmGeo, kind === 'sailor' ? jacketMat : jacketMat, 0, -foreArmLen / 2, 0);
    // 手
    part(joint, new THREE.BoxGeometry(limbT * 0.78, limbT * 0.7, limbT * 0.78), skinMat, 0, -foreArmLen - limbT * 0.3, 0);
    return { root, joint };
  };
  const armL = makeArm(-1);
  const armR = makeArm(1);
  const hand = pivot(armR.joint, 0, -foreArmLen - limbT * 0.35, 0);

  // --- 首と頭 ---
  const neck = pivot(torso, 0, torsoLen, 0);
  part(neck, new THREE.BoxGeometry(H * 0.045, neckLen * 1.4, H * 0.045), skinMat, 0, neckLen * 0.4, 0);
  const head = pivot(neck, 0, neckLen + headSize * 0.5, 0);
  part(head, new THREE.BoxGeometry(headSize * 0.94, headSize, headSize * 0.9), skinMat);
  // 耳
  part(head, new THREE.BoxGeometry(headSize * 0.07, headSize * 0.24, headSize * 0.16), skinMat, -headSize * 0.5, -headSize * 0.02, 0);
  part(head, new THREE.BoxGeometry(headSize * 0.07, headSize * 0.24, headSize * 0.16), skinMat, headSize * 0.5, -headSize * 0.02, 0);

  // 顔（-Z が正面）
  const faceZ = -headSize * 0.46;
  const eyeWhite = mat('#f7f7f5', 0.7);
  const pupil = mat('#1c1a19', 0.5);
  for (const sx of [-1, 1]) {
    part(head, new THREE.BoxGeometry(headSize * 0.2, headSize * 0.13, 0.004), eyeWhite,
      sx * headSize * 0.21, headSize * 0.04, faceZ);
    part(head, new THREE.BoxGeometry(headSize * 0.1, headSize * 0.11, 0.004), pupil,
      sx * headSize * 0.21, headSize * 0.035, faceZ - 0.003);
    // 眉
    part(head, new THREE.BoxGeometry(headSize * 0.22, headSize * 0.045, 0.004), hairMat,
      sx * headSize * 0.21, headSize * 0.19, faceZ - 0.002);
  }
  // 口
  part(head, new THREE.BoxGeometry(headSize * 0.16, headSize * 0.035, 0.004), mat('#9c5a54', 0.7),
    0, -headSize * 0.22, faceZ - 0.002);

  buildHair(head, def.appearance?.hair ?? 'short', headSize, hairMat);

  group.userData.height = H;
  return {
    group, height: H, hips, torso, neck, head,
    armL, armR, legL, legR, hand,
    legLen, shinLen,
  };
}

function buildHair(head: THREE.Group, style: string, s: number, hairMat: THREE.Material): void {
  const cap = (h: number, y: number, z = 0, w = 1.02, d = 1.0) =>
    part(head, new THREE.BoxGeometry(s * 0.96 * w, s * h, s * 0.92 * d), hairMat, 0, s * y, s * z);

  switch (style) {
    case 'buzz':
      cap(0.16, 0.44);
      break;
    case 'spike':
      cap(0.2, 0.46);
      for (let i = 0; i < 5; i++) {
        const spike = part(head, new THREE.BoxGeometry(s * 0.13, s * 0.28, s * 0.13), hairMat,
          (i - 2) * s * 0.18, s * 0.62, s * (Math.random() - 0.5) * 0.3);
        spike.rotation.z = (i - 2) * 0.16;
        spike.rotation.x = -0.22;
      }
      break;
    case 'bob':
      cap(0.3, 0.42, 0.02, 1.06, 1.06);
      // 横の垂れ
      for (const sx of [-1, 1]) {
        part(head, new THREE.BoxGeometry(s * 0.13, s * 0.5, s * 0.9), hairMat, sx * s * 0.5, s * 0.06, s * 0.02);
      }
      part(head, new THREE.BoxGeometry(s * 1.02, s * 0.5, s * 0.14), hairMat, 0, s * 0.06, s * 0.48);
      // 前髪
      part(head, new THREE.BoxGeometry(s * 0.94, s * 0.2, s * 0.1), hairMat, 0, s * 0.32, -s * 0.46);
      break;
    case 'long':
      cap(0.28, 0.43, 0.02, 1.05, 1.05);
      part(head, new THREE.BoxGeometry(s * 1.0, s * 1.35, s * 0.2), hairMat, 0, -s * 0.36, s * 0.5);
      for (const sx of [-1, 1]) {
        part(head, new THREE.BoxGeometry(s * 0.14, s * 0.85, s * 0.85), hairMat, sx * s * 0.5, -s * 0.12, s * 0.04);
      }
      part(head, new THREE.BoxGeometry(s * 0.94, s * 0.22, s * 0.1), hairMat, 0, s * 0.31, -s * 0.46);
      break;
    case 'ponytail': {
      cap(0.24, 0.44, 0.02);
      const tie = part(head, new THREE.BoxGeometry(s * 0.16, s * 0.1, s * 0.16), mat('#c8465c', 0.7),
        0, s * 0.42, s * 0.56);
      tie.name = 'tie';
      const tail = part(head, new THREE.BoxGeometry(s * 0.26, s * 0.9, s * 0.26), hairMat, 0, s * 0.0, s * 0.66);
      tail.rotation.x = -0.28;
      part(head, new THREE.BoxGeometry(s * 0.94, s * 0.2, s * 0.1), hairMat, 0, s * 0.32, -s * 0.46);
      break;
    }
    case 'short':
    default:
      cap(0.26, 0.43, 0.02);
      part(head, new THREE.BoxGeometry(s * 0.94, s * 0.19, s * 0.1), hairMat, 0, s * 0.3, -s * 0.46);
      for (const sx of [-1, 1]) {
        part(head, new THREE.BoxGeometry(s * 0.1, s * 0.3, s * 0.7), hairMat, sx * s * 0.49, s * 0.2, s * 0.06);
      }
      break;
  }
}

export interface PoseOptions {
  /** 水平速度 [m/s] */
  speed?: number;
  /** 構えているか（0〜1） */
  aim?: number;
  /** 直近に撃ったか（0〜1、反動） */
  fire?: number;
  /** 倒れているか（0〜1） */
  down?: number;
  /** 着席ポーズ。椅子の座面のワールド高さを渡す */
  seated?: boolean;
  seatY?: number;
  /** 机の天板の高さ（腕を載せる） */
  deskY?: number;
  /** 上下の視線（ラジアン） */
  pitch?: number;
}

const lerp = THREE.MathUtils.lerp;

/** 歩行・構え・射撃・気絶・着席のポーズを毎フレーム作る。 */
export function poseStudentMesh(m: StudentMesh, t: number, opts: PoseOptions = {}): void {
  const speed = opts.speed ?? 0;
  const aim = opts.aim ?? 0;
  const fire = opts.fire ?? 0;
  const down = opts.down ?? 0;
  const pitch = opts.pitch ?? 0;

  if (opts.seated) {
    // 腰を座面の高さに置き、脛の角度を解いて足を床に着ける
    const seatY = opts.seatY ?? m.shinLen;
    m.group.position.y = seatY - m.legLen;
    m.hips.position.y = m.legLen;
    const theta = Math.acos(THREE.MathUtils.clamp(seatY / Math.max(0.01, m.shinLen), 0, 1));
    m.legL.root.rotation.set(1.5, 0, 0.03);
    m.legR.root.rotation.set(1.5, 0, -0.03);
    m.legL.joint.rotation.set(-1.5 + theta, 0, 0);
    m.legR.joint.rotation.set(-1.5 + theta, 0, 0);

    const idle = Math.sin(t * 1.4 + m.height * 7) * 0.06;
    // 机に腕を載せる（机が無ければ膝の上）
    m.armL.root.rotation.set(0.55 + idle * 0.3, 0, 0.16);
    m.armR.root.rotation.set(0.55 - idle * 0.3, 0, -0.16);
    m.armL.joint.rotation.set(0.95, 0, 0);
    m.armR.joint.rotation.set(0.95, 0, 0);
    m.torso.rotation.set(0.07 + idle * 0.05, 0, 0);
    m.head.rotation.set(0.06 + Math.sin(t * 0.7 + m.height) * 0.05, Math.sin(t * 0.4 + m.height * 3) * 0.2, 0);
    return;
  }

  if (down > 0.01) {
    // 気絶: 前のめりに崩れて突っ伏す
    m.group.rotation.x = lerp(m.group.rotation.x, -1.48, 0.22);
    m.group.rotation.z = lerp(m.group.rotation.z, 0.12, 0.15);
    m.group.position.y = lerp(m.group.position.y, 0.06, 0.18);
    m.hips.position.y = lerp(m.hips.position.y, m.legLen * 0.82, 0.2);
    // 腕は体の脇に流れる
    m.armL.root.rotation.set(-0.55, 0, 0.28);
    m.armR.root.rotation.set(-0.35, 0, -0.22);
    m.armL.joint.rotation.set(0.9, 0, 0);
    m.armR.joint.rotation.set(0.55, 0, 0);
    m.legL.root.rotation.set(-0.25, 0, 0.06);
    m.legR.root.rotation.set(-0.1, 0, -0.06);
    m.legL.joint.rotation.set(0.5, 0, 0);
    m.legR.joint.rotation.set(0.32, 0, 0);
    m.torso.rotation.set(-0.18, 0, 0);
    m.head.rotation.set(-0.35, 0.2, 0);
    return;
  }
  m.group.rotation.z = lerp(m.group.rotation.z, 0, 0.2);
  m.group.rotation.x = lerp(m.group.rotation.x, 0, 0.2);
  m.group.position.y = lerp(m.group.position.y, 0, 0.2);
  m.hips.position.y = m.legLen;

  const gait = Math.min(1, speed / 4.6);
  const cycle = t * (6.5 + gait * 4.5);
  const swing = Math.sin(cycle) * gait * 0.72;
  const knee = Math.max(0, -Math.cos(cycle)) * gait * 0.95;
  const kneeAlt = Math.max(0, Math.cos(cycle)) * gait * 0.95;

  m.legL.root.rotation.set(swing, 0, 0);
  m.legR.root.rotation.set(-swing, 0, 0);
  m.legL.joint.rotation.set(-knee, 0, 0);
  m.legR.joint.rotation.set(-kneeAlt, 0, 0);

  // 上下動と体の捻り
  m.hips.position.y += Math.abs(Math.sin(cycle)) * gait * 0.035 * m.height;
  m.hips.rotation.y = -Math.sin(cycle) * gait * 0.12;
  m.torso.rotation.y = Math.sin(cycle) * gait * 0.16;
  m.torso.rotation.x = gait * 0.1 + Math.sin(t * 1.6) * 0.012;

  // 腕: 構えていなければ振る、構えていれば前に出す
  // -Z が正面。+X 回転で腕・脚が前に出る
  const walkArmL = -swing * 0.62;
  const walkArmR = swing * 0.62;
  const kick = fire * 0.40;
  m.armR.root.rotation.x = lerp(walkArmR, 1.40 - kick, aim);
  m.armR.root.rotation.z = lerp(0, 0.14, aim);
  m.armR.joint.rotation.x = lerp(0.25 + Math.max(0, swing) * 0.3, 0.18 - kick * 0.6, aim);
  m.armL.root.rotation.x = lerp(walkArmL, 1.26 - kick * 0.7, aim);
  m.armL.root.rotation.z = lerp(0, -0.40, aim);
  m.armL.joint.rotation.x = lerp(0.25 + Math.max(0, -swing) * 0.3, 0.58, aim);

  m.head.rotation.x = lerp(Math.sin(t * 0.9) * 0.03, pitch * 0.55, aim);
  m.head.rotation.y = lerp(Math.sin(t * 0.6) * 0.12, 0, aim);
  m.head.rotation.z = 0;
}

/** 旧API互換のラッパ（歩行と射撃のみ）。 */
export function animateStudentMesh(m: StudentMesh, t: number, speed: number, firing: number): void {
  poseStudentMesh(m, t, { speed, aim: 1, fire: firing });
}

export function disposeStudentMesh(m: StudentMesh): void {
  m.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
  });
}
