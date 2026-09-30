/**
 * 移動の手触りを数値で固定する回帰テスト。
 * npx esbuild を使ってバンドルし node で実行する（npm run test:movement）。
 */
import * as THREE from 'three';
import rules from '../data/battle_rules.json';
import type { BattleRules } from '../src/data/types';
import { ColliderSet } from '../src/battle/Colliders';
import { CharacterController } from '../src/battle/CharacterController';

const R = rules as unknown as BattleRules;
const DT = 1 / 60;
let failed = 0;
function check(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);
  if (!ok) failed++;
}

function world(withDesk: boolean): ColliderSet {
  const w = new ColliderSet();
  w.add(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(60, 1, 60), 'floor');
  if (withDesk) w.add(new THREE.Vector3(0, 0.525, -3), new THREE.Vector3(1.3, 1.05, 0.9), 'desk');
  return w;
}
const fwd = new THREE.Vector3(0, 0, -1);
const run = R.movement.baseRunSpeed + 5 * R.movement.runSpeedPerAthletics;

// 1) 立ち上がりの速さ: 何秒で走速度の 90% に届くか
{
  const c = new CharacterController(world(false), R);
  c.teleport(0, 0.01, 0);
  for (let i = 0; i < 5; i++) c.step(DT, fwd, 0);
  let t = 0;
  while (c.horizontalSpeed < run * 0.9 && t < 2) { c.step(DT, fwd, run); t += DT; }
  check('加速: 0.25秒以内に走速度90%', t <= 0.25, `${(t * 1000).toFixed(0)}ms, run=${run.toFixed(2)}m/s`);
  let s = 0;
  while (c.horizontalSpeed > 0.2 && s < 2) { c.step(DT, fwd, 0); s += DT; }
  check('停止: 0.3秒以内に止まる', s <= 0.3, `${(s * 1000).toFixed(0)}ms`);
}

// 2) 机に飛び乗れる
{
  const c = new CharacterController(world(true), R);
  c.teleport(0, 0.01, 0);
  for (let i = 0; i < 5; i++) c.step(DT, fwd, 0);
  let jumped = false;
  let maxY = 0;
  for (let i = 0; i < 90; i++) {
    const z = c.position.z;
    if (!jumped && z < -1.6) { c.queueJump(); jumped = true; }
    c.step(DT, fwd, i < 60 ? run : 0);
    maxY = Math.max(maxY, c.position.y);
    if (c.grounded && c.position.y > 1.0 && Math.abs(c.position.z + 3) < 0.6) break;
  }
  check('机(1.05m)に飛び乗れる', c.position.y > 1.0, `y=${c.position.y.toFixed(2)} 最高=${maxY.toFixed(2)}`);
}

// 3) スライディングで一瞬加速し、滑走距離が出る
{
  const c = new CharacterController(world(false), R);
  c.teleport(0, 0.01, 0);
  for (let i = 0; i < 5; i++) c.step(DT, fwd, 0);
  for (let i = 0; i < 40; i++) c.step(DT, fwd, run);
  const before = c.horizontalSpeed;
  const ok = c.tryStartSlide(run);
  const peak = c.horizontalSpeed;
  const z0 = c.position.z;
  while (c.sliding) c.step(DT, fwd, R.movement.crouchSpeed);
  check('スライド: 開始できて初速が上がる', ok && peak > before * 1.15, `${before.toFixed(1)} → ${peak.toFixed(1)}m/s`);
  check('スライド: 3m 以上滑る', Math.abs(c.position.z - z0) >= 3, `${Math.abs(c.position.z - z0).toFixed(2)}m`);
}

// 4) 空中で勢いが死なない（ジャンプで減速しない）
{
  const c = new CharacterController(world(false), R);
  c.teleport(0, 0.01, 0);
  for (let i = 0; i < 5; i++) c.step(DT, fwd, 0);
  for (let i = 0; i < 40; i++) c.step(DT, fwd, run);
  const v0 = c.horizontalSpeed;
  c.queueJump();
  for (let i = 0; i < 20; i++) c.step(DT, fwd, run);
  check('ジャンプ中も速度を維持', c.horizontalSpeed >= v0 * 0.97, `${v0.toFixed(2)} → ${c.horizontalSpeed.toFixed(2)}m/s`);
}

console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
if (failed) process.exit(1);
