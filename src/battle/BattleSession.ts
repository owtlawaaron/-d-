import * as THREE from 'three';
import type { ArenaDef, BattleRules } from '../data/types';
import type { DataRegistry } from '../data/registry';
import type { InputManager } from '../core/InputManager';
import type { Seat } from '../meta/SeatValue';
import type { Student } from '../meta/Student';
import { audio } from '../core/Audio';
import { createStudentMesh, poseStudentMesh, type StudentMesh } from '../render/StudentMesh';
import { makeHands, makeWeaponModel } from '../render/Weapons3D';
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
  private viewWeapon: THREE.Group | null = null;
  private viewLights: THREE.Light[] = [];
  private viewWeaponId = '';
  private npcWeapon: THREE.Group | null = null;
  private npcWeaponId = '';
  private npcFireFlash = 0;

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
  // --- 手触り（描画レートで更新する） ---
  private ads = false;
  private adsBlend = 0;
  private sprinting = false;
  private fov = 80;
  private landDip = 0;
  private bobPhase = 0;
  private roll = 0;
  private shake = 0;
  private swayX = 0;
  private swayY = 0;
  private camHeight = 1.58;
  private stepAccum = 0;
  private npcStepAccum = 0;
  private lastShotHead = false;
  /** 2回目以降の生成演出は短くする */
  private static battlesSeen = 0;
  private genesisScale = 1;
  /** クリスタルが直近で削られたか（守りNPCの反応に使う） */
  private crystalAlert = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly view: { scene: THREE.Scene; camera: THREE.PerspectiveCamera },
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
    this.genesisScale = BattleSession.battlesSeen > 0 ? 2.4 : 1; // 2戦目からは約2秒
    BattleSession.battlesSeen++;
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
    const hemi = new THREE.HemisphereLight(0xdfefff, 0x8a7a62, 1.0);
    const sun = new THREE.DirectionalLight(0xfff0d6, 1.35);
    sun.position.set(this.arenaDef.bounds.x * 0.9, 12, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -14;
    sun.shadow.camera.right = 14;
    sun.shadow.camera.top = 14;
    sun.shadow.camera.bottom = -14;
    sun.shadow.camera.far = 46;
    sun.target.position.set(-2, 0.6, 0);
    const fill = new THREE.DirectionalLight(0xbcd8ff, 0.28);
    fill.position.set(-10, 9, -6);
    // 蛍光灯の間接光
    const bounce = new THREE.PointLight(0xfff4dd, 26, 26, 2.0);
    bounce.position.set(0, this.arenaDef.bounds.y - 1.0, 0);
    this.lights = [hemi, sun, sun.target, fill, bounce];
    for (const l of this.lights) this.group.add(l);
  }

  private setupViewModel(): void {
    this.viewModel = new THREE.Group();
    this.viewModel.position.set(0.21, -0.18, -0.64);
    this.viewModel.rotation.set(0.02, 0.09, 0.02);
    this.viewModel.scale.setScalar(0.82);
    const hands = makeHands(this.player.student.def.appearance?.skin
      ? new THREE.Color(this.player.student.def.appearance.skin).getHex() : 0xf0cba8);
    this.viewModel.add(hands);
    // 手元が暗く潰れないよう、カメラに小さな補助光を付ける
    // 武器専用シーンの照明（ワールドの壁を照らさない）
    this.viewLights = [
      new THREE.HemisphereLight(0xeef4ff, 0x6a5a45, 1.3),
      new THREE.DirectionalLight(0xfff0dc, 1.2),
    ];
    this.viewLights[1].position.set(0.6, 1.2, 0.8);
    for (const l of this.viewLights) this.view.scene.add(l);
    this.view.camera.add(this.viewModel);
    this.syncViewWeapon();
  }

  /** 持ち替えたら一人称の武器モデルを差し替える。 */
  private syncViewWeapon(): void {
    const id = this.player.weapon.def.id;
    if (id === this.viewWeaponId) return;
    this.viewWeaponId = id;
    if (this.viewWeapon) {
      this.viewModel.remove(this.viewWeapon);
      disposeTree(this.viewWeapon);
    }
    this.viewWeapon = makeWeaponModel(id);
    this.viewModel.add(this.viewWeapon);
  }

  /** NPC の手に持たせる武器モデルを同期する。 */
  private syncNpcWeapon(): void {
    const id = this.npc.weapon.def.id;
    if (id === this.npcWeaponId) return;
    this.npcWeaponId = id;
    if (this.npcWeapon) {
      this.npcMesh.hand.remove(this.npcWeapon);
      disposeTree(this.npcWeapon);
    }
    const model = makeWeaponModel(id);
    // 手のローカル -Y が腕の延長。武器の銃口(-Z)をそこへ向ける
    model.rotation.x = -Math.PI / 2;
    model.position.set(0.02, -0.05, 0);
    this.npcMesh.hand.add(model);
    this.npcWeapon = model;
  }

  private spawnPointFor(c: Combatant): THREE.Vector3 {
    if (c.team === 'ATTACK') {
      const list = this.arena.attackerSpawns;
      const i = c.isPlayer ? Math.floor(list.length / 2) : Math.floor(Math.random() * list.length);
      return this.findFreeSpawn(list[i]);
    }
    return this.findFreeSpawn(this.arena.defenderSpawn);
  }

  /**
   * 机や教卓の内部にスポーンしないよう、周囲に螺旋状に探して空いている場所を返す。
   * 見つからなければ元の位置（安全側に倒すより、進行不能を避ける）。
   */
  private findFreeSpawn(preferred: THREE.Vector3): THREE.Vector3 {
    const r = this.rules.movement.capsule.radius + 0.06;
    const h = this.rules.movement.capsule.height;
    const min = new THREE.Vector3();
    const max = new THREE.Vector3();
    const probe: Box[] = [];
    const free = (x: number, z: number) => {
      min.set(x - r, 0.05, z - r);
      max.set(x + r, 0.05 + h, z + r);
      return this.arena.world.overlapping(min, max, probe).length === 0;
    };
    if (free(preferred.x, preferred.z)) return preferred.clone();
    for (let ring = 1; ring <= 14; ring++) {
      const radius = ring * 0.55;
      const steps = 8 + ring * 4;
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2 + ring;
        const x = preferred.x + Math.cos(a) * radius;
        const z = preferred.z + Math.sin(a) * radius;
        const bx = this.arenaDef.bounds.x / 2 - 1.0;
        const bz = this.arenaDef.bounds.z / 2 - 1.0;
        if (Math.abs(x) > bx || Math.abs(z) > bz) continue;
        if (free(x, z)) return new THREE.Vector3(x, preferred.y, z);
      }
    }
    return preferred.clone();
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
    const done = this.genesis.update(dt * this.genesisScale, skip && this.phaseTime > 0.3);
    this.crystal.update(dt, this.timeLeft);
    this.syncNpcMesh(0);
    if (done) this.enterPrepare();
  }

  private enterPrepare(): void {
    this.phase = 'PREPARE';
    this.phaseTime = this.cfg.playerRole === 'DEFEND'
      ? this.rules.prepareDuration
      : (this.rules.attackerPrepareDuration ?? 3);
    this.genesis.finish();
    this.hud.show(true);
    this.placeNpcDeployables();
    audio.play('chime');
    if (this.cfg.playerRole === 'DEFEND') {
      this.hud.message('準備フェーズ', '机で射線を切れ', 2.2);
    } else {
      this.hud.message('READY', 'クリスタルを探せ', 1.4);
    }
  }

  private updatePrepare(dt: number): void {
    this.phaseTime -= dt;
    this.updatePlayerMove(dt);
    this.player.update(dt);
    this.syncNpcMesh(dt);
    this.crystal.update(dt, this.timeLeft);
    this.hud.setTimer(this.phaseTime, this.phaseTime < 5);
    this.hud.syncPlayer(this.player);
    this.hud.setPrepare(this.prepareHint());

    if (this.cfg.playerRole === 'DEFEND') this.handleDeployInput();
    if (this.input.pressed('Enter') || this.phaseTime <= 0) this.enterFight();
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
    return `開始まで ${t}　<span class="kbd">Enter</span> すぐ始める`;
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
    this.syncNpcMesh(dt);
    this.updateFootsteps(dt);

    this.hud.setTimer(this.timeLeft, this.timeLeft <= 10);
    this.hud.setCrystal(this.crystal);
    this.hud.syncPlayer(this.player);
    this.checkVictory();
  }

  private updateOver(dt: number): void {
    this.overTimer -= dt;
    this.syncNpcMesh(dt);
    this.crystal.update(dt, 0);
    this.updateProjectiles(dt);
    if (this.overTimer <= 0 && this.resolveFn && this.result) {
      const fn = this.resolveFn;
      this.resolveFn = null;
      fn(this.result);
    }
  }

  // ---------------------------------------------------------- player control

  private updatePlayerMove(dt: number): void {
    const p = this.player;
    const c = p.controller;
    const mv = this.rules.movement;
    const fwd = (this.input.down('KeyW') ? 1 : 0) - (this.input.down('KeyS') ? 1 : 0);
    const strafe = (this.input.down('KeyD') ? 1 : 0) - (this.input.down('KeyA') ? 1 : 0);
    const dir = new THREE.Vector3(
      -Math.sin(p.yaw) * fwd + Math.cos(p.yaw) * strafe,
      0,
      -Math.cos(p.yaw) * fwd - Math.sin(p.yaw) * strafe,
    );
    if (dir.lengthSq() > 0) dir.normalize();

    // ADS は戦闘中だけ（準備中の右クリックは教科書シールドの設置）
    this.ads = this.phase === 'FIGHT' && this.input.rightDown && !c.sliding;
    const run = p.moveSpeed;
    // Ctrl は使わない（W と同時押しで Ctrl+W＝ブラウザのタブが閉じる）
    const crouchKey = this.input.down('KeyC');
    this.sprinting = this.input.down('ShiftLeft') && fwd > 0 && !this.ads && !this.input.mouseDown && !crouchKey;

    // 走っている最中にしゃがむとスライディング
    if (this.input.pressed('KeyC') && c.tryStartSlide(run)) {
      audio.play('slide');
      this.shake = Math.max(this.shake, 0.25);
    }
    c.setCrouch(crouchKey || c.sliding);
    if (this.input.pressed('Space')) c.queueJump();

    let speed = run;
    if (c.sliding) speed = mv.crouchSpeed;
    else if (c.crouching) speed = mv.crouchSpeed;
    else if (this.ads) speed = run * mv.adsSpeedMultiplier;
    else if (this.sprinting) speed = run * mv.sprintMultiplier;
    if (dir.lengthSq() === 0) speed = 0;

    c.step(dt, dir, speed, this.input.down('Space'));
  }

  /** 足音。プレイヤーは自分の足音、NPC は距離と方向で音量と定位が変わる。 */
  private updateFootsteps(dt: number): void {
    const pc = this.player.controller;
    if (this.player.alive && pc.grounded && !pc.sliding) {
      this.stepAccum += pc.horizontalSpeed * dt;
      if (this.stepAccum > 2.3) { this.stepAccum = 0; audio.play('step', { volume: pc.crouching ? 0.25 : 0.5 }); }
    }
    const nc = this.npc.controller;
    if (this.npc.alive && nc.grounded) {
      this.npcStepAccum += nc.horizontalSpeed * dt;
      if (this.npcStepAccum > 2.3) {
        this.npcStepAccum = 0;
        const d = this.npc.position.distanceTo(this.player.position);
        const vol = THREE.MathUtils.clamp(1.1 - d / 22, 0, 1);
        if (vol > 0.02) audio.play('step', { volume: vol, pan: this.panOf(this.npc.position) });
      }
    }
  }

  /** プレイヤーから見て、その位置が左右どちらか（-1〜1）。 */
  private panOf(pos: THREE.Vector3): number {
    const p = this.player;
    const dx = pos.x - p.position.x;
    const dz = pos.z - p.position.z;
    const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    const len = Math.hypot(dx, dz) || 1;
    return THREE.MathUtils.clamp((dx * right.x + dz * right.z) / len, -1, 1);
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
      this.viewModel.rotation.x += 0.05;
    } else {
      this.npcFireFlash = 1;
    }

    // 拡散
    // 構え・移動状態で拡散が変わる（撃つ前に止まる/構えることに意味を持たせる）
    let spreadMul = 1;
    const sc = shooter.controller;
    if (shooter.isPlayer) {
      if (this.ads) spreadMul *= 0.45;
      if (!sc.grounded) spreadMul *= 1.9;
      else if (sc.sliding) spreadMul *= 1.4;
      else if (sc.horizontalSpeed > shooter.moveSpeed * 1.05) spreadMul *= 1.6;
      this.shake = Math.max(this.shake, w.isMelee ? 0.35 : 0.08 + (w.def.recoil?.vertical ?? 0) * 0.12);
    }
    const spreadRad = w.spread * DEG * spreadMul;
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
      if (shooter.isPlayer) {
        this.hud.hit(!!shot.head);
        audio.play(shot.head ? 'headshot' : 'hit');
      } else {
        this.hud.damaged();
        this.hud.damageFrom(this.bearingTo(shooter.position));
        this.shake = Math.max(this.shake, 0.3);
      }
      this.lastShotHead = !!shot.head;
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
    if (victim.isPlayer) this.hud.message('DOWN', `${killer.student.name} にやられた`, 1.4);
    if (killer.isPlayer) {
      this.hud.message('ELIMINATED', this.lastShotHead ? 'HEADSHOT' : '', 1.0);
      audio.play('kill');
    }
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
    this.overTimer = this.rules.overDuration ?? 1.6;
    const playerWon = (this.player.team === 'ATTACK') === attackerWon;
    this.hud.message(playerWon ? 'WIN' : 'LOSE', reason, 3);
    audio.play(playerWon ? 'win' : 'lose');
    this.input.releaseLock();
  }

  // ------------------------------------------------------------------ render

  /** プレイヤーから見た、その位置の方位（0=正面、+ で右）。 */
  private bearingTo(pos: THREE.Vector3): number {
    const p = this.player;
    const dx = pos.x - p.position.x;
    const dz = pos.z - p.position.z;
    const world = Math.atan2(-dx, -dz);
    let a = p.yaw - world;
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  /**
   * 描画フレームごとに呼ぶ。視点入力・カメラ・ビューモデルはここで更新する。
   * 60Hz 固定の物理ステップで視点を動かすと、高リフレッシュレートの画面で
   * カクつき、入力遅延も出るため。位置は物理ステップ間を alpha で補間する。
   */
  renderUpdate(frameDt: number, alpha: number): void {
    const { dx, dy } = this.input.consumeMouse();
    // NPC も補間して描く
    if (this.npcMesh) {
      const nc = this.npc.controller;
      this.npcMesh.group.position.lerpVectors(nc.prevPosition, nc.position, alpha);
    }
    if (this.paused || this.phase === 'GENESIS' || !this.viewModel) return;
    const p = this.player;
    const c = p.controller;
    const dtc = Math.min(frameDt, 0.05);

    // --- 視点 ---
    if (p.alive && this.phase !== 'OVER') {
      const sens = this.input.sensitivity * (this.ads ? 0.72 : 1);
      p.yaw -= dx * sens;
      p.pitch -= dy * sens;
      const turn = 2.4 * dtc;
      if (this.input.down('ArrowLeft')) p.yaw += turn;
      if (this.input.down('ArrowRight')) p.yaw -= turn;
      if (this.input.down('ArrowUp')) p.pitch += turn * 0.6;
      if (this.input.down('ArrowDown')) p.pitch -= turn * 0.6;
      if (this.pendingRecover > 0 && this.sinceFire > 0.12) {
        const back = Math.min(this.pendingRecover, 9 * DEG * dtc);
        p.pitch -= back;
        this.pendingRecover -= back;
      }
      p.pitch = THREE.MathUtils.clamp(p.pitch, -1.45, 1.45);
    }

    // --- 位置（補間）と目線の高さ ---
    const pos = new THREE.Vector3().lerpVectors(c.prevPosition, c.position, alpha);
    const targetEye = c.height - 0.12;
    this.camHeight += (targetEye - this.camHeight) * Math.min(1, dtc * 14);
    if (c.landImpact > 0) {
      this.landDip = Math.min(0.26, c.landImpact * 0.02);
      audio.play('land', { volume: Math.min(1, c.landImpact / 10) });
      c.landImpact = 0;
    }
    this.landDip += (0 - this.landDip) * Math.min(1, dtc * 9);

    // --- 歩行の揺れ・傾き・揺さぶり ---
    const speed = c.horizontalSpeed;
    const run = p.moveSpeed;
    let bobY = 0;
    let bobX = 0;
    if (c.grounded && !c.sliding && speed > 0.5) {
      this.bobPhase += dtc * speed * 1.05;
      const k = Math.min(1, speed / run) * (this.ads ? 0.3 : 1);
      bobY = Math.sin(this.bobPhase * 2) * 0.03 * k;
      bobX = Math.cos(this.bobPhase) * 0.02 * k;
    }
    const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    const lateral = c.velocity.x * right.x + c.velocity.z * right.z;
    const targetRoll = -lateral / Math.max(1, run) * 1.6 * DEG + (c.sliding ? 3.5 * DEG : 0);
    this.roll += (targetRoll - this.roll) * Math.min(1, dtc * 10);
    this.shake = Math.max(0, this.shake - dtc * 3.2);
    const sh = this.shake * this.shake * 0.06;

    this.camera.position.set(
      pos.x + right.x * bobX + (Math.random() - 0.5) * sh,
      pos.y + this.camHeight - this.landDip + bobY + (Math.random() - 0.5) * sh,
      pos.z + right.z * bobX,
    );
    this.camera.rotation.set(p.pitch, p.yaw, this.roll, 'YXZ');
    if (!p.alive) {
      this.camera.position.y = pos.y + 0.4;
      this.camera.rotation.z = 0.5;
    }

    // --- FOV: 走り・スライドで広がり、構えで狭まる ---
    this.adsBlend += ((this.ads ? 1 : 0) - this.adsBlend) * Math.min(1, dtc * 16);
    let targetFov = 80;
    if (c.sliding) targetFov = 92;
    else if (this.sprinting && speed > run * 1.05) targetFov = 88;
    targetFov = THREE.MathUtils.lerp(targetFov, 58, this.adsBlend);
    this.fov += (targetFov - this.fov) * Math.min(1, dtc * 10);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // --- ビューモデル: 視点の動きに遅れてついてくる揺れ、構えで中央へ ---
    this.swayX += (THREE.MathUtils.clamp(-dx * 0.0009, -0.05, 0.05) - this.swayX) * Math.min(1, dtc * 12);
    this.swayY += (THREE.MathUtils.clamp(dy * 0.0009, -0.05, 0.05) - this.swayY) * Math.min(1, dtc * 12);
    const a = this.adsBlend;
    const baseX = THREE.MathUtils.lerp(0.21, 0.0, a);
    const baseY = THREE.MathUtils.lerp(-0.18, -0.13, a);
    const baseZ = THREE.MathUtils.lerp(-0.64, -0.56, a);
    const vm = this.viewModel;
    vm.position.x = baseX + this.swayX + bobX * 0.6 * (1 - a) + (this.sprinting ? 0.05 : 0);
    vm.position.y = baseY + this.swayY + bobY * 0.5 * (1 - a) - (this.sprinting ? 0.05 : 0) - this.landDip * 0.25;
    vm.position.z += (baseZ - vm.position.z) * Math.min(1, dtc * 16);
    const sprintTilt = this.sprinting ? 0.5 : 0;
    vm.rotation.x += (0.02 - this.swayY * 2 - vm.rotation.x) * Math.min(1, dtc * 14);
    vm.rotation.y += (THREE.MathUtils.lerp(0.09, 0, a) + sprintTilt - vm.rotation.y) * Math.min(1, dtc * 10);
    vm.rotation.z += ((c.sliding ? 0.25 : 0) - vm.rotation.z) * Math.min(1, dtc * 10);
    vm.visible = p.alive;
    this.syncViewWeapon();

    // --- HUD: 拡散に合わせた照準・速度線 ---
    const w = p.weapon;
    let spread = w.spread * (this.ads ? 0.45 : 1);
    if (!c.grounded) spread *= 1.9;
    else if (speed > run * 1.05) spread *= 1.6;
    this.hud.setSpread(4 + spread * 7 + (this.ads ? 0 : 3));
    const fast = THREE.MathUtils.clamp((speed - run) / (this.rules.movement.slide.maxSpeed - run), 0, 1);
    this.hud.setSpeedLines(c.sliding ? Math.max(0.45, fast) : fast * 0.8);
    this.hud.setAds(this.adsBlend > 0.5);
  }

  private syncNpcMesh(dt: number): void {
    const n = this.npc;
    this.npcFireFlash = Math.max(0, this.npcFireFlash - dt * 6);
    // 倒れた直後は少しの間その場に残す
    this.npcMesh.group.visible = n.alive || n.respawnTimer > 0 || !n.alive;
    this.npcMesh.group.rotation.y = n.yaw;
    this.syncNpcWeapon();
    const speed = Math.hypot(n.controller.velocity.x, n.controller.velocity.z);
    poseStudentMesh(this.npcMesh, this.anim, {
      speed,
      aim: n.alive ? 1 : 0,
      fire: this.npcFireFlash,
      down: n.alive ? 0 : 1,
      pitch: n.pitch,
    });
  }

  // ----------------------------------------------------------------- cleanup

  dispose(): void {
    this.camera.fov = 80;
    this.camera.rotation.z = 0;
    this.camera.updateProjectionMatrix();
    this.hud.setSpeedLines(0);
    this.hud.show(false);
    this.hud.clear();
    this.genesis?.finish();
    this.projectiles?.dispose();
    this.vfx?.dispose();
    this.arena?.dispose();
    this.view.camera.remove(this.viewModel);
    for (const l of this.viewLights) this.view.scene.remove(l);
    this.viewLights = [];
    disposeTree(this.viewModel);
    this.viewWeapon = null;
    this.viewWeaponId = '';
    this.npcWeapon = null;
    this.npcWeaponId = '';
    this.scene.remove(this.group);
    this.group.clear();
    this.group = new THREE.Group();
    this.deployedBoxes = [];
    this.traps = [];
  }
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose?.();
  });
}
