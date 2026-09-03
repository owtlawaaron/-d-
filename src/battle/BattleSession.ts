import * as THREE from 'three';
import type { ArenaDef, BattleRules } from '../data/types';
import type { DataRegistry } from '../data/registry';
import type { InputManager } from '../core/InputManager';
import type { Seat } from '../meta/SeatValue';
import type { Student } from '../meta/Student';
import { audio } from '../core/Audio';
import { animateStudentMesh, createStudentMesh, type StudentMesh } from '../render/StudentMesh';
import { buildArena, type Arena } from './ArenaBuilder';
import { Combatant, type Team } from './Combatant';
import { rayBox, raySphere, type Box } from './Colliders';
import { Crystal } from './Crystal';
import { NpcAgent } from './Npc';
import { ProjectilePool } from './Projectiles';
import { Vfx } from './Vfx';
import type { Hud } from '../ui/Hud';
import { Genesis } from './Genesis';

export type BattlePhase = 'GENESIS' | 'PREPARE' | 'FIGHT' | 'OVER';

export interface BattleConfig {
  attacker: Student;
  defender: Student;
  defenderSeat: Seat;
  playerRole: Team;
}

export interface BattleResult {
  attackerWon: boolean;
  reason: string;
}

interface Shot {
  kind: 'world' | 'enemy' | 'crystal' | 'none';
  point: THREE.Vector3;
  distance: number;
  box?: Box;
  head?: boolean;
  low?: boolean;
  penetrated: boolean;
}

const DEG = Math.PI / 180;
const ATTACK_COLOR = 0x8c2f22;
const DEFEND_COLOR = 0x23406e;

/** 1試合ぶんのライフサイクル（docs/03 / docs/04 §4.3）。 */
export class BattleSession {
  phase: BattlePhase = 'GENESIS';
  paused = false;
  private arena!: Arena;
  private crystal!: Crystal;
  private player!: Combatant;
  private npc!: Combatant;
  private npcMesh!: StudentMesh;
  private agent!: NpcAgent;
  private projectiles!: ProjectilePool;
  private vfx!: Vfx;
  private genesis!: Genesis;
  private group = new THREE.Group();
  private lights: THREE.Object3D[] = [];
  private viewModel!: THREE.Group;

  private timeLeft = 0;
  private phaseTime = 0;
  private overTimer = 0;
  private result: BattleResult | null = null;
  private resolveFn: ((r: BattleResult) => void) | null = null;
  private cfg!: BattleConfig;

  private pendingRecover = 0;
  private sinceFire = 0;
  private deployLeft = new Map<string, number>();
  private deployedBoxes: { box: Box; mesh: THREE.Mesh }[] = [];
  private traps: { pos: THREE.Vector3; mesh: THREE.Mesh; damage: number; slow: number; slowDur: number; radius: number }[] = [];
  private prevTriggerHeld = false;
  private anim = 0;
  /** クリスタルが直近で削られたか（守りNPCの反応に使う） */
  private crystalAlert = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly input: InputManager,
    private readonly reg: DataRegistry,
    private readonly rules: BattleRules,
    private readonly hud: Hud,
    private readonly arenaDef: ArenaDef,
    private readonly seats: Seat[],
  ) {}

  get debugTimeLeft(): number { return this.timeLeft; }
  /** デバッグ/自動テスト用: 照準をクリスタル（または敵）に向ける。 */
  debugAimAt(what: 'crystal' | 'enemy'): boolean {
    const target = what === 'crystal' ? this.crystal.position : this.npc.chest;
    if (!target) return false;
    const eye = this.player.eye;
    const d = target.clone().sub(eye);
    this.player.yaw = Math.atan2(-d.x, -d.z);
    this.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    return true;
  }

  get debugPlayerHp(): number { return Math.round(this.player.hp); }
  get debugNpcHp(): number { return Math.round(this.npc.hp); }
  get debugNpcState(): string { return this.agent?.state ?? '-'; }

  /** デバッグ/自動テスト用に即決着させる。 */
  forceFinish(attackerWon: boolean): void {
    this.finish(attackerWon, attackerWon ? '（デバッグ）クリスタル破壊' : '（デバッグ）守り切り');
  }
  get debugCrystal(): number { return this.crystal ? Math.round(this.crystal.hp) : -1; }

  // ------------------------------------------------------------------ setup

  start(cfg: BattleConfig): Promise<BattleResult> {
    this.cfg = cfg;
    this.scene.add(this.group);
    this.arena = buildArena(this.arenaDef, this.seats, cfg.defenderSeat);
    this.group.add(this.arena.group);

    this.crystal = new Crystal(this.rules, this.arena.crystalPos);
    this.group.add(this.crystal.group);

    const playerStudent = cfg.playerRole === 'ATTACK' ? cfg.attacker : cfg.defender;
    const npcStudent = cfg.playerRole === 'ATTACK' ? cfg.defender : cfg.attacker;
    const npcTeam: Team = cfg.playerRole === 'ATTACK' ? 'DEFEND' : 'ATTACK';

    this.player = new Combatant(playerStudent, cfg.playerRole, true, this.arena.world, this.rules, this.reg);
    this.npc = new Combatant(npcStudent, npcTeam, false, this.arena.world, this.rules, this.reg);
    this.agent = new NpcAgent(this.npc, this.reg.personality(npcStudent.def.personality));

    this.npcMesh = createStudentMesh(npcStudent.def, npcTeam === 'ATTACK' ? ATTACK_COLOR : DEFEND_COLOR);
    this.group.add(this.npcMesh.group);

    this.spawn(this.player, true);
    this.spawn(this.npc, true);

    this.projectiles = new ProjectilePool(this.group as unknown as THREE.Scene, 48);
    this.vfx = new Vfx(this.group as unknown as THREE.Scene);
    this.setupLights();
    this.setupViewModel();

    for (const d of this.rules.deployables) this.deployLeft.set(d.id, d.count);

    this.genesis = new Genesis(this.camera, this.arena, this.crystal, this.group, this.arenaDef.bounds);
    this.genesis.begin({
      attacker: cfg.attacker,
      defender: cfg.defender,
      defenderSeat: cfg.defenderSeat,
      playerRole: cfg.playerRole,
    });

    this.phase = 'GENESIS';
    this.phaseTime = 0;
    this.timeLeft = this.rules.matchDuration;
    this.result = null;
    this.hud.clear();
    this.hud.show(false); // 演出が終わってから出す
    this.hud.setRole(cfg.playerRole);
    this.hud.setTimer(this.rules.matchDuration, false);
    this.hud.setCrystal(this.crystal);
    this.hud.syncPlayer(this.player);

    return new Promise<BattleResult>((resolve) => {
      this.resolveFn = resolve;
    });
  }

  private setupLights(): void {
    const hemi = new THREE.HemisphereLight(0xdfefff, 0x8a7a62, 0.9);
    const sun = new THREE.DirectionalLight(0xfff0d6, 1.1);
    sun.position.set(9, 14, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -14;
    sun.shadow.camera.right = 14;
    sun.shadow.camera.top = 14;
    sun.shadow.camera.bottom = -14;
    sun.shadow.camera.far = 46;
    const fill = new THREE.DirectionalLight(0xbcd8ff, 0.3);
    fill.position.set(-8, 9, -6);
    this.lights = [hemi, sun, fill];
    for (const l of this.lights) this.group.add(l);
  }

  private setupViewModel(): void {
    this.viewModel = new THREE.Group();
    // 文房具っぽく見えるよう、暗い本体＋白いチョークの銃身にする
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.075, 0.085, 0.30),
      new THREE.MeshStandardMaterial({ color: 0x424a55, roughness: 0.55, metalness: 0.3 }),
    );
    body.position.set(0.24, -0.21, -0.72);
    const barrel = new THREE.Mesh(
      new THREE.BoxGeometry(0.036, 0.036, 0.22),
      new THREE.MeshStandardMaterial({ color: 0xf4efe2, roughness: 0.9 }),
    );
    barrel.position.set(0.24, -0.20, -0.93);
    const grip = new THREE.Mesh(
      new THREE.BoxGeometry(0.055, 0.13, 0.075),
      new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.9 }),
    );
    grip.position.set(0.24, -0.29, -0.61);
    this.viewModel.add(body, barrel, grip);
    this.viewModel.rotation.set(0.02, 0.10, 0.03);
    this.camera.add(this.viewModel);
    this.scene.add(this.camera);
  }

  private spawnPointFor(c: Combatant): THREE.Vector3 {
    if (c.team === 'ATTACK') {
      const list = this.arena.attackerSpawns;
      const i = c.isPlayer ? Math.floor(list.length / 2) : Math.floor(Math.random() * list.length);
      return list[i];
    }
    return this.arena.defenderSpawn;
  }

  private spawn(c: Combatant, initial = false): void {
    const p = this.spawnPointFor(c);
    c.revive(p.x, 0.05, p.z);
    // 相手（またはクリスタル）の方を向かせる
    const look = c.team === 'ATTACK' ? this.crystal.position : this.arena.attackerSpawns[1];
    c.yaw = Math.atan2(-(look.x - p.x), -(look.z - p.z));
    c.pitch = 0;
    if (!initial) this.hud.log(`${c.student.name} 復帰`);
  }

  // ----------------------------------------------------------------- update

  update(dt: number): void {
    if (this.paused) return;
    this.anim += dt;
    switch (this.phase) {
      case 'GENESIS': this.updateGenesis(dt); break;
      case 'PREPARE': this.updatePrepare(dt); break;
      case 'FIGHT': this.updateFight(dt); break;
      case 'OVER': this.updateOver(dt); break;
    }
    this.vfx.update(dt);
    this.hud.update(dt);
  }

  private updateGenesis(dt: number): void {
    this.phaseTime += dt;
    const skip = this.input.pressed('Space') || this.input.pressed('Escape') || this.input.pressed('Enter');
    const done = this.genesis.update(dt, skip && this.phaseTime > 0.5);
    this.crystal.update(dt, this.timeLeft);
    this.syncNpcMesh(0);
    if (done) this.enterPrepare();
  }

  private enterPrepare(): void {
    this.phase = 'PREPARE';
    this.phaseTime = this.rules.prepareDuration;
    this.genesis.finish();
    this.hud.show(true);
    this.placeNpcDeployables();
    audio.play('chime');
    if (this.cfg.playerRole === 'DEFEND') {
      this.hud.message('準備フェーズ', '机で射線を切れ', 2.2);
    } else {
      this.hud.message('準備フェーズ', 'クリスタルの位置を確認しろ', 2.2);
    }
  }

  private updatePrepare(dt: number): void {
    this.phaseTime -= dt;
    this.updatePlayerLook();
    this.updatePlayerMove(dt);
    this.player.update(dt);
    this.syncCamera();
    this.syncNpcMesh(dt);
    this.crystal.update(dt, this.timeLeft);
    this.hud.setTimer(this.phaseTime, this.phaseTime < 5);
    this.hud.syncPlayer(this.player);
    this.hud.setPrepare(this.prepareHint());

    if (this.cfg.playerRole === 'DEFEND') this.handleDeployInput();
    if (this.input.pressed('Enter') || this.phaseTime <= 0) this.enterFight();
    this.input.endFrame();
  }

  private prepareHint(): string {
    const t = Math.ceil(Math.max(0, this.phaseTime));
    if (this.cfg.playerRole === 'DEFEND') {
      const b = this.deployLeft.get('desk_barricade') ?? 0;
      const s = this.deployLeft.get('textbook_shield') ?? 0;
      const k = this.deployLeft.get('thumbtack_trap') ?? 0;
      return `準備 ${t}秒　<span class="kbd">左クリック</span> 机バリケード ×${b}　`
        + `<span class="kbd">右クリック</span> 教科書シールド ×${s}　`
        + `<span class="kbd">T</span> 画鋲トラップ ×${k}　<span class="kbd">Enter</span> 開始`;
    }
    return `準備 ${t}秒　射線と遮蔽を確認しろ　<span class="kbd">Enter</span> 開始`;
  }

  private enterFight(): void {
    this.phase = 'FIGHT';
    this.timeLeft = this.rules.matchDuration;
    this.hud.setPrepare(null);
    this.hud.message('CLASS START!', '', 1.4);
    audio.play('chime');
  }

  private updateFight(dt: number): void {
    const prevLeft = this.timeLeft;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    this.crystalAlert = Math.max(0, this.crystalAlert - dt);
    if (prevLeft > 30 && this.timeLeft <= 30) {
      this.hud.message('残り30秒', 'クリスタルのシールドが剥がれた', 1.8);
      audio.play('scan');
    }

    // --- プレイヤー ---
    if (this.player.alive) {
      this.updatePlayerLook();
      this.updatePlayerMove(dt);
      this.handlePlayerCombat(dt);
    } else {
      this.player.respawnTimer -= dt;
      if (this.player.respawnTimer <= 0) this.spawn(this.player);
    }
    this.player.update(dt);

    // --- NPC ---
    if (this.npc.alive) {
      this.agent.update(dt, {
        opponent: this.player,
        crystal: this.crystal,
        crystalUnderAttack: this.crystalAlert > 0,
        world: this.arena.world,
        remaining: this.timeLeft,
        coverPoints: this.arena.coverPoints,
        requestFire: (c) => this.fire(c),
      });
    } else if (this.npc.respawnTimer > 0) {
      this.npc.respawnTimer -= dt;
      if (this.npc.respawnTimer <= 0) this.spawn(this.npc);
    }
    this.npc.update(dt);

    this.updateProjectiles(dt);
    this.updateTraps();
    this.crystal.update(dt, this.timeLeft);
    this.syncCamera();
    this.syncNpcMesh(dt);

    this.hud.setTimer(this.timeLeft, this.timeLeft <= 10);
    this.hud.setCrystal(this.crystal);
    this.hud.syncPlayer(this.player);
    this.checkVictory();
    this.input.endFrame();
  }

  private updateOver(dt: number): void {
    this.overTimer -= dt;
    this.syncCamera();
    this.syncNpcMesh(dt);
    this.crystal.update(dt, 0);
    this.updateProjectiles(dt);
    if (this.overTimer <= 0 && this.resolveFn && this.result) {
      const fn = this.resolveFn;
      this.resolveFn = null;
      fn(this.result);
    }
    this.input.endFrame();
  }

  // ---------------------------------------------------------- player control

  private updatePlayerLook(): void {
    const p = this.player;
    p.yaw -= this.input.mouseDx * this.input.sensitivity;
    p.pitch -= this.input.mouseDy * this.input.sensitivity;
    // 矢印キーでも視点を動かせる（マウスが使えない環境の保険）
    const KEY_TURN = 1.9 / 60;
    if (this.input.down('ArrowLeft')) p.yaw += KEY_TURN;
    if (this.input.down('ArrowRight')) p.yaw -= KEY_TURN;
    if (this.input.down('ArrowUp')) p.pitch += KEY_TURN * 0.6;
    if (this.input.down('ArrowDown')) p.pitch -= KEY_TURN * 0.6;
    // リコイルの復帰
    if (this.pendingRecover > 0 && this.sinceFire > 0.14) {
      const back = Math.min(this.pendingRecover, 2.4 * DEG * 60 * (1 / 60));
      p.pitch -= back;
      this.pendingRecover -= back;
    }
    p.pitch = THREE.MathUtils.clamp(p.pitch, -1.45, 1.45);
  }

  private updatePlayerMove(dt: number): void {
    const p = this.player;
    const mv = this.rules.movement;
    const fwd = (this.input.down('KeyW') ? 1 : 0) - (this.input.down('KeyS') ? 1 : 0);
    const strafe = (this.input.down('KeyD') ? 1 : 0) - (this.input.down('KeyA') ? 1 : 0);
    const dir = new THREE.Vector3(
      -Math.sin(p.yaw) * fwd + Math.cos(p.yaw) * strafe,
      0,
      -Math.cos(p.yaw) * fwd - Math.sin(p.yaw) * strafe,
    );
    if (dir.lengthSq() > 0) dir.normalize();

    p.controller.setCrouch(this.input.down('ControlLeft') || this.input.down('KeyC'));
    let speed = p.moveSpeed;
    if (p.controller.crouching) speed = mv.crouchSpeed;
    else if (this.input.down('ShiftLeft')) speed = mv.walkSpeed;
    if (dir.lengthSq() === 0) speed = 0;

    p.controller.step(dt, dir, speed, this.input.down('Space'));
  }

  private handlePlayerCombat(dt: number): void {
    const p = this.player;
    this.sinceFire += dt;

    for (let i = 0; i < p.weapons.length && i < 4; i++) {
      if (this.input.pressed(`Digit${i + 1}`)) p.switchTo(i);
    }
    if (this.input.pressed('KeyR')) {
      if (p.weapon.startReload(p.student.reloadScale)) audio.play('reload');
    }
    if (this.input.pressed('KeyQ')) p.switchTo((p.current + 1) % p.weapons.length);

    const held = this.input.mouseDown;
    p.triggerHeld = held;
    const w = p.weapon;

    if (w.isCharge) {
      // チャージ武器は離した瞬間に撃つ
      if (this.prevTriggerHeld && !held && w.charge > 0.15) this.fire(p);
    } else if (held) {
      this.fire(p);
    }
    if (w.needsReload && !w.reloading) {
      if (w.startReload(p.student.reloadScale)) audio.play('reload');
    }
    this.prevTriggerHeld = held;
  }

  private handleDeployInput(): void {
    if (this.input.clicked()) this.tryDeploy('desk_barricade');
    if (this.input.rightDown) this.tryDeploy('textbook_shield');
    if (this.input.pressed('KeyT')) this.tryDeploy('thumbtack_trap');
  }

  private tryDeploy(id: string): void {
    const left = this.deployLeft.get(id) ?? 0;
    if (left <= 0) return;
    const def = this.rules.deployables.find((d) => d.id === id);
    if (!def) return;
    const eye = this.player.eye;
    const dir = this.player.aimDirection();
    const hit = this.arena.world.raycast(eye, dir, 9, false);
    if (!hit) return;
    const point = eye.clone().add(dir.clone().multiplyScalar(hit.distance - 0.05));
    if (point.distanceTo(this.player.position) < 1.2) return;
    point.y = 0;
    this.deployLeft.set(id, left - 1);
    audio.play('ui');

    if (id === 'thumbtack_trap') {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(def.radius ?? 0.8, def.radius ?? 0.8, 0.04, 16),
        new THREE.MeshStandardMaterial({ color: 0xc0c6cf, emissive: 0x333a44, roughness: 0.5 }),
      );
      mesh.position.set(point.x, 0.03, point.z);
      this.group.add(mesh);
      this.traps.push({
        pos: mesh.position.clone(), mesh,
        damage: def.damage ?? 20, slow: def.slowAmount ?? 0.4,
        slowDur: def.slowDuration ?? 3, radius: def.radius ?? 0.8,
      });
      return;
    }

    const size = new THREE.Vector3(...(def.size ?? [1.3, 1.2, 0.9]));
    // プレイヤーの向きに合わせて板を回す
    const facing = Math.abs(Math.sin(this.player.yaw)) > Math.abs(Math.cos(this.player.yaw));
    const dims = facing ? new THREE.Vector3(size.z, size.y, size.x) : size.clone();
    const center = new THREE.Vector3(point.x, dims.y / 2, point.z);
    const penetrable = id === 'textbook_shield';
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(dims.x, dims.y, dims.z),
      new THREE.MeshStandardMaterial({
        color: penetrable ? 0xe4c98a : 0xc79a63,
        roughness: 0.85,
        transparent: penetrable, opacity: penetrable ? 0.85 : 1,
      }),
    );
    mesh.position.copy(center);
    mesh.castShadow = true;
    this.group.add(mesh);
    const box = this.arena.world.add(center, dims, id, { penetrable, hp: def.hp, mesh });
    this.deployedBoxes.push({ box, mesh });
  }

  /** NPC が守り側なら、クリスタルの周囲に自動でバリケードを置く。 */
  private placeNpcDeployables(): void {
    if (this.npc.team !== 'DEFEND') return;
    const def = this.rules.deployables.find((d) => d.id === 'desk_barricade');
    if (!def) return;
    const size = new THREE.Vector3(...(def.size ?? [1.3, 1.2, 0.9]));
    const c = this.crystal.position;
    const offsets = [
      new THREE.Vector3(2.0, 0, 1.7), new THREE.Vector3(-2.0, 0, 1.7), new THREE.Vector3(0, 0, 2.6),
    ];
    for (const off of offsets) {
      const center = new THREE.Vector3(c.x + off.x, size.y / 2, c.z + off.z);
      if (Math.abs(center.x) > this.arenaDef.bounds.x / 2 - 1) continue;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, size.y, size.z),
        new THREE.MeshStandardMaterial({ color: 0xc79a63, roughness: 0.85 }),
      );
      mesh.position.copy(center);
      mesh.castShadow = true;
      this.group.add(mesh);
      const box = this.arena.world.add(center, size, 'desk_barricade', { hp: def.hp, mesh });
      this.deployedBoxes.push({ box, mesh });
    }
  }

  // ------------------------------------------------------------------ combat

  private fire(shooter: Combatant): void {
    const w = shooter.weapon;
    if (!w.canFire()) return;
    if (this.phase !== 'FIGHT') return;

    const damage = w.fire(shooter.student.recoilScale);
    const eye = shooter.eye;
    const dir = shooter.aimDirection();

    if (shooter.isPlayer) {
      const kick = (w.def.recoil?.vertical ?? 0) * 2.2 * DEG * shooter.student.recoilScale;
      shooter.pitch += kick;
      this.pendingRecover += kick * 0.65;
      this.sinceFire = 0;
      this.viewModel.position.z += 0.035;
    }

    // 拡散
    const spreadRad = w.spread * DEG;
    if (spreadRad > 0) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spreadRad;
      const up = new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(dir, up).normalize();
      const realUp = new THREE.Vector3().crossVectors(right, dir).normalize();
      dir.add(right.multiplyScalar(Math.sin(a) * r)).add(realUp.multiplyScalar(Math.cos(a) * r)).normalize();
    }

    // 銃声は相手に聞こえる（正確な位置ではなく推定が伝わる）
    if (shooter.isPlayer && this.npc.alive) {
      const d = this.npc.position.distanceTo(shooter.position);
      if (d < 26) this.agent.notifyNoise(shooter.position, 1.5 + d * 0.12);
    }

    const sfx = w.def.kind === 'melee' ? 'melee'
      : w.def.id === 'eraser_launcher' ? 'eraser'
      : w.def.kind === 'charge' ? 'bow' : 'chalk';
    audio.play(sfx);
    this.vfx.muzzle(eye.clone().add(dir.clone().multiplyScalar(0.5)));

    if (w.def.kind === 'projectile' || w.def.kind === 'charge') {
      this.projectiles.spawn(w.def, eye.clone().add(dir.clone().multiplyScalar(0.4)), dir, damage,
        shooter.isPlayer ? 0 : 1, shooter.isPlayer ? 0xffe9b0 : 0xffb08a);
      return;
    }

    const range = w.def.range ?? 30;
    const shot = this.castShot(eye, dir, range, shooter);
    const end = shot.kind === 'none' ? eye.clone().add(dir.clone().multiplyScalar(range)) : shot.point;
    if (w.def.kind !== 'melee') this.vfx.tracer(eye.clone().add(dir.clone().multiplyScalar(0.45)), end, shooter.isPlayer ? 0xfff0c0 : 0xffb08a);
    this.resolveShot(shooter, shot, damage, w.def.headshotMultiplier ?? 2, w.def.crystalMultiplier ?? 0.6, w.def.kind === 'melee');
  }

  private bodyBox(c: Combatant): Box {
    const h = c.controller.height;
    const r = c.controller.radius;
    return {
      min: new THREE.Vector3(c.position.x - r, c.position.y, c.position.z - r),
      max: new THREE.Vector3(c.position.x + r, c.position.y + h * 0.84, c.position.z + r),
      tag: 'body', penetrable: false,
    };
  }

  private headBox(c: Combatant): Box {
    const h = c.controller.height;
    const r = 0.17;
    return {
      min: new THREE.Vector3(c.position.x - r, c.position.y + h * 0.84, c.position.z - r),
      max: new THREE.Vector3(c.position.x + r, c.position.y + h, c.position.z + r),
      tag: 'head', penetrable: false,
    };
  }

  /** 壁・敵・クリスタルをまとめてレイキャストし、最も近いヒットを返す。 */
  private castShot(origin: THREE.Vector3, dir: THREE.Vector3, range: number, shooter: Combatant): Shot {
    const enemy = shooter === this.player ? this.npc : this.player;
    let cur = origin.clone();
    let remaining = range;
    let penetrated = false;

    for (let pass = 0; pass < 2; pass++) {
      const worldHit = this.arena.world.raycast(cur, dir, remaining, true);
      let best: Shot = { kind: 'none', point: cur.clone(), distance: Infinity, penetrated };

      if (worldHit) {
        best = {
          kind: 'world', distance: worldHit.distance, box: worldHit.box, penetrated,
          point: cur.clone().add(dir.clone().multiplyScalar(worldHit.distance)),
        };
      }
      if (enemy.alive) {
        const head = rayBox(cur, dir, this.headBox(enemy), remaining);
        const body = rayBox(cur, dir, this.bodyBox(enemy), remaining);
        const near = head && (!body || head.distance <= body.distance) ? head : body;
        if (near && near.distance < best.distance) {
          const point = cur.clone().add(dir.clone().multiplyScalar(near.distance));
          best = {
            kind: 'enemy', distance: near.distance, point, penetrated,
            head: near === head,
            low: point.y < enemy.position.y + 0.45,
          };
        }
      }
      if (shooter.team === 'ATTACK' && !this.crystal.destroyed) {
        const t = raySphere(cur, dir, this.crystal.position, this.crystal.radius * 1.15, remaining);
        if (t !== null && t < best.distance) {
          best = { kind: 'crystal', distance: t, point: cur.clone().add(dir.clone().multiplyScalar(t)), penetrated };
        }
      }

      if (best.kind === 'world' && best.box?.penetrable && pass === 0) {
        penetrated = true;
        const advance = best.distance + 0.12;
        cur = cur.clone().add(dir.clone().multiplyScalar(advance));
        remaining -= advance;
        if (remaining <= 0) return { ...best, kind: 'none' };
        continue;
      }
      return best;
    }
    return { kind: 'none', point: cur, distance: Infinity, penetrated };
  }

  private resolveShot(shooter: Combatant, shot: Shot, damage: number, headMul: number, crystalMul: number, melee: boolean): void {
    const dmgCfg = this.rules.damage;
    if (shot.kind === 'enemy') {
      const victim = shooter === this.player ? this.npc : this.player;
      let amount = damage;
      if (shot.head) amount *= headMul;
      else if (shot.low) amount *= dmgCfg.legMultiplier;
      if (shot.penetrated) amount *= dmgCfg.penetrationMultiplier;
      this.vfx.impact(shot.point, 0xff6a5a);
      if (shooter.isPlayer) { this.hud.hit(); audio.play('hit'); }
      else { this.hud.damaged(); }
      if (!victim.isPlayer) this.agent.notifyNoise(shooter.position, 1.0);
      const died = victim.damage(amount, shooter.position);
      if (died) this.onDeath(victim, shooter);
      return;
    }
    if (shot.kind === 'crystal') {
      let amount = damage * (melee ? dmgCfg.crystalMeleeMultiplier : crystalMul);
      if (this.timeLeft <= this.rules.crystal.lateGameWindow) amount *= this.rules.crystal.lateGameDamageMultiplier;
      const defender = this.player.team === 'DEFEND' ? this.player : this.npc;
      if (!defender.alive) amount *= this.rules.defender.crystalShieldWhileDead;
      this.crystal.damage(amount);
      this.crystalAlert = 4;
      if (this.npc.team === 'DEFEND' && this.npc.alive) this.agent.notifyNoise(shooter.position, 3.0);
      this.vfx.impact(shot.point, 0x8fe4ff);
      if (shooter.isPlayer) { this.hud.hit(); audio.play('hitCrystal'); }
      return;
    }
    if (shot.kind === 'world' && shot.box) {
      this.vfx.impact(shot.point, 0xd8d0c0);
      this.damageBox(shot.box, damage);
    }
  }

  private damageBox(box: Box, amount: number): void {
    if (box.hp === undefined) return;
    box.hp -= amount;
    if (box.hp <= 0) {
      const entry = this.deployedBoxes.find((d) => d.box === box);
      if (entry) {
        this.group.remove(entry.mesh);
        entry.mesh.geometry.dispose();
        (entry.mesh.material as THREE.Material).dispose();
        this.deployedBoxes.splice(this.deployedBoxes.indexOf(entry), 1);
      }
      this.arena.world.remove(box);
    }
  }

  private onDeath(victim: Combatant, killer: Combatant): void {
    audio.play('death');
    this.hud.log(`${killer.student.name} ▶ ${victim.student.name}`);
    if (victim.isPlayer) this.hud.message('DOWN', '', 1.2);
    const canRespawn = victim.startRespawn();
    if (!canRespawn) {
      if (victim.team === 'ATTACK') {
        this.finish(false, '攻め側のリスポーンが尽きた');
      } else {
        this.hud.log(`${victim.student.name} は復帰できない — クリスタルが無防備`);
        victim.respawnTimer = Infinity;
      }
    }
  }

  private updateProjectiles(dt: number): void {
    for (const p of this.projectiles.all) {
      if (!p.active) continue;
      p.life -= dt;
      p.vel.y += p.gravity * dt;
      const step = p.vel.clone().multiplyScalar(dt);
      const dist = step.length();
      const dir = dist > 1e-6 ? step.clone().divideScalar(dist) : new THREE.Vector3(0, 0, 1);
      const shooter = p.ownerId === 0 ? this.player : this.npc;
      const shot = this.castShot(p.pos, dir, dist, shooter);
      if (shot.kind !== 'none' && shot.distance <= dist) {
        this.resolveShot(shooter, shot, p.damage, p.def.headshotMultiplier ?? 2, p.def.crystalMultiplier ?? 0.6, false);
        if (p.def.knockback && shot.kind === 'enemy') {
          const victim = shooter === this.player ? this.npc : this.player;
          victim.controller.velocity.add(dir.clone().multiplyScalar(p.def.knockback));
        }
        this.projectiles.release(p);
        continue;
      }
      p.pos.add(step);
      p.mesh.position.copy(p.pos);
      if (p.life <= 0) this.projectiles.release(p);
    }
  }

  private updateTraps(): void {
    for (let i = this.traps.length - 1; i >= 0; i--) {
      const t = this.traps[i];
      for (const c of [this.player, this.npc]) {
        if (!c.alive) continue;
        if (c.position.distanceTo(t.pos) > t.radius + 0.3) continue;
        c.damage(t.damage, t.pos);
        c.applySlow(t.slow, t.slowDur);
        if (c.isPlayer) this.hud.damaged();
        this.hud.log(`${c.student.name} が画鋲を踏んだ`);
        this.group.remove(t.mesh);
        this.traps.splice(i, 1);
        break;
      }
    }
  }

  private checkVictory(): void {
    if (this.result) return;
    if (this.crystal.destroyed) {
      this.finish(true, 'クリスタルを破壊した');
      return;
    }
    if (this.timeLeft <= 0) this.finish(false, '90秒を守り切った');
  }

  private finish(attackerWon: boolean, reason: string): void {
    if (this.result) return;
    this.result = { attackerWon, reason };
    this.phase = 'OVER';
    this.overTimer = 2.6;
    const playerWon = (this.player.team === 'ATTACK') === attackerWon;
    this.hud.message(playerWon ? 'WIN' : 'LOSE', reason, 3);
    audio.play(playerWon ? 'win' : 'lose');
    this.input.releaseLock();
  }

  // ------------------------------------------------------------------ render

  private syncCamera(): void {
    if (this.phase === 'GENESIS') return;
    const p = this.player;
    this.camera.position.set(p.position.x, p.controller.eyeY, p.position.z);
    this.camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
    if (!p.alive) {
      this.camera.position.y = p.position.y + 0.4;
      this.camera.rotation.z = 0.5;
    }
    this.viewModel.position.z += (0 - this.viewModel.position.z) * 0.25;
    this.viewModel.visible = p.alive;
  }

  private syncNpcMesh(dt: number): void {
    const n = this.npc;
    this.npcMesh.group.visible = n.alive;
    if (!n.alive) return;
    this.npcMesh.group.position.copy(n.position);
    this.npcMesh.group.rotation.y = n.yaw;
    const speed = Math.hypot(n.controller.velocity.x, n.controller.velocity.z);
    animateStudentMesh(this.npcMesh, this.anim, speed, n.weapon.cooldown > 0 ? 1 : 0);
    void dt;
  }

  // ----------------------------------------------------------------- cleanup

  dispose(): void {
    this.hud.show(false);
    this.hud.clear();
    this.genesis?.finish();
    this.projectiles?.dispose();
    this.vfx?.dispose();
    this.arena?.dispose();
    this.camera.remove(this.viewModel);
    this.scene.remove(this.group);
    this.group.clear();
    this.group = new THREE.Group();
    this.deployedBoxes = [];
    this.traps = [];
  }
}
