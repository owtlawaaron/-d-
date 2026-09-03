import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { audio } from './core/Audio';
import { GameLoop } from './core/GameLoop';
import { InputManager } from './core/InputManager';
import { Rng } from './core/Rng';
import { DataRegistry } from './data/registry';
import { BattleSession, type BattleResult } from './battle/BattleSession';
import { Classroom } from './meta/Classroom';
import { ChallengeSystem, type Challenge } from './meta/Challenge';
import { ClassroomView } from './render/ClassroomView';
import { Hud } from './ui/Hud';
import { Screens } from './ui/Screens';

type Mode = 'MENU' | 'SEATING' | 'BATTLE';

class Game {
  private readonly canvas = document.getElementById('scene') as HTMLCanvasElement;
  private readonly uiRoot = document.getElementById('ui') as HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly input: InputManager;
  private readonly hud: Hud;
  private readonly screens: Screens;
  private readonly reg = DataRegistry.load();
  private readonly rng = new Rng();

  private room!: Classroom;
  private challenges!: ChallengeSystem;
  private view: ClassroomView | null = null;
  private battle: BattleSession | null = null;
  private mode: Mode = 'MENU';
  private pausedByLock = false;
  private lastLog: string[] = [];
  private lastQueueSize = 0;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 200);
    this.scene.background = new THREE.Color(0x0a1018);
    this.scene.fog = new THREE.Fog(0x0a1018, 40, 90);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.7, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.input = new InputManager(this.canvas);
    this.hud = new Hud(this.uiRoot);
    this.screens = new Screens(this.uiRoot);

    window.addEventListener('resize', () => this.resize());
    this.canvas.addEventListener('click', () => {
      audio.resume();
      if (this.mode === 'BATTLE' && !this.input.isLocked) this.input.requestLock();
    });
    this.resize();

    new GameLoop((dt) => this.update(dt), () => this.render()).start();
    // デバッグ・自動テスト用のフック
    (window as unknown as Record<string, unknown>).__seatwars = this;
  }

  /** デバッグ/自動テスト用: 照準を強制的に向ける。 */
  debugAim(what: 'crystal' | 'enemy'): boolean {
    return this.battle?.debugAimAt(what) ?? false;
  }

  /** デバッグ/自動テスト用に、進行中の戦闘を即決着させる。 */
  debugSkipBattle(attackerWon: boolean): boolean {
    if (!this.battle) return false;
    this.battle.paused = false;
    this.battle.forceFinish(attackerWon);
    return true;
  }

  /** 現在の状態のスナップショット（テストとデバッグ用）。 */
  debugState(): Record<string, unknown> {
    return {
      mode: this.mode,
      turn: this.room?.turn,
      phase: this.battle?.phase ?? null,
      paused: this.battle?.paused ?? null,
      locked: this.input.isLocked,
      canLook: this.input.canLook,
      timeLeft: this.battle?.debugTimeLeft ?? null,
      crystal: this.battle?.debugCrystal ?? null,
      playerHp: this.battle?.debugPlayerHp ?? null,
      npcHp: this.battle?.debugNpcHp ?? null,
      npcState: this.battle?.debugNpcState ?? null,
      npcChallenges: this.lastQueueSize,
      playerSeat: this.room ? `${this.room.player.seat.col + 1}-${this.room.player.seat.row + 1}` : null,
      conduct: this.room?.player.conduct,
    };
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private update(dt: number): void {
    if (this.mode === 'BATTLE' && this.battle) {
      this.syncLockState();
      this.battle.update(dt);
      this.bloom.strength = this.battle.phase === 'GENESIS' ? 1.5 : 0.45;
    } else if (this.view) {
      this.view.update(dt, this.camera);
      this.bloom.strength = 0.4;
    }
    this.input.endFrame();
  }

  /** ポインタロックが外れたら自動でポーズ。戻ったら再開。 */
  private syncLockState(): void {
    const b = this.battle;
    if (!b) return;
    if (b.phase === 'GENESIS' || b.phase === 'OVER') return;
    if (!this.input.canLook && !this.pausedByLock) {
      this.pausedByLock = true;
      b.paused = true;
      this.screens.pause(() => this.input.requestLock());
    } else if (this.input.canLook && this.pausedByLock) {
      this.pausedByLock = false;
      b.paused = false;
      this.screens.clear();
    }
  }

  private render(): void {
    this.composer.render();
  }

  // ------------------------------------------------------------------- flow

  async run(): Promise<void> {
    this.screens.issues(this.reg.issues);
    for (;;) {
      this.newGame();
      await this.screens.title();
      await this.playTerm();
    }
  }

  private newGame(): void {
    this.view?.dispose();
    if (this.view) this.scene.remove(this.view.group);
    this.room = new Classroom(this.reg, this.reg.battleRules, this.rng, 'summer');
    this.challenges = new ChallengeSystem(this.reg, this.reg.battleRules, this.rng);
    this.view = new ClassroomView(this.room);
    this.scene.add(this.view.group);
    this.mode = 'SEATING';
    this.lastLog = ['クラス替え。席はランダムに配られた。'];
  }

  private async playTerm(): Promise<void> {
    const meta = this.reg.battleRules.meta;
    while (this.room.turn <= meta.turnsPerTerm) {
      const alive = await this.playTurn();
      if (!alive) break;
      this.room.turn++;
    }
    const { grade, comment } = this.evaluate();
    this.screens.clear();
    await this.screens.termEnd(this.room, grade, comment);
  }

  /** 1ターン。false を返したらゲームオーバー。 */
  private async playTurn(): Promise<boolean> {
    const meta = this.reg.battleRules.meta;
    const room = this.room;
    const player = room.player;

    // 朝: 状態の更新
    for (const s of room.students) {
      s.cooldown = Math.max(0, s.cooldown - 1);
      s.turnsSinceLastWin++;
    }
    if (room.turn % 3 === 0) {
      for (const s of room.students) s.decayGrudges(meta.grudgeDecayPerTurn);
    }
    room.refreshFrustration();
    this.view?.syncSeats();
    this.view?.clearHighlights();
    this.view?.setHighlight(player.seat.index, 0x8fe4ff, 0.5);

    // 昼: NPC の挑戦キュー
    const queue = this.challenges.buildQueue(room);
    this.lastQueueSize = queue.length;
    const incoming = queue.find((c) => c.defender === player) ?? null;

    const choice = await this.screens.seating({
      room,
      turnsTotal: meta.turnsPerTerm,
      incoming,
      canChallenge: this.challenges.canChallenge(room, player),
      log: this.lastLog,
      winChance: (t) => this.challenges.winChance(player, t),
      onHoverSeat: (index) => {
        this.view?.clearHighlights();
        this.view?.setHighlight(player.seat.index, 0x8fe4ff, 0.5);
        if (index !== null) this.view?.setHighlight(index, 0xff7a5a, 0.6);
      },
    });

    const log: string[] = [];
    let playerChallenge: Challenge | null = null;
    let playerRole: 'ATTACK' | 'DEFEND' = 'ATTACK';

    if (choice.type === 'defend') {
      playerChallenge = choice.challenge;
      playerRole = 'DEFEND';
    } else if (choice.type === 'challenge') {
      playerChallenge = {
        attacker: player,
        defender: choice.target,
        winChance: this.challenges.winChance(player, choice.target),
        reason: 'あなたの挑戦',
      };
      playerRole = 'ATTACK';
    } else {
      log.push('あなたは今日は我慢した。');
    }

    // 放課後: プレイヤーが関わる1戦を3Dで
    if (playerChallenge) {
      const result = await this.runBattle(playerChallenge, playerRole);
      this.challenges.applyOutcome(room, { challenge: playerChallenge, attackerWon: result.attackerWon, simulated: false });
      const won = (playerRole === 'ATTACK') === result.attackerWon;
      log.push(won
        ? `【あなた】${playerChallenge.attacker.name} vs ${playerChallenge.defender.name} — ${result.reason}。勝ち。`
        : `【あなた】${playerChallenge.attacker.name} vs ${playerChallenge.defender.name} — ${result.reason}。敗北。`);
      if (playerRole === 'ATTACK' && result.attackerWon) log.push(`席を奪った！ いまの席は ${player.seat.col + 1}列${player.seat.row + 1}行目。`);
      if (playerRole === 'DEFEND' && result.attackerWon) log.push(`席を奪われた。いまの席は ${player.seat.col + 1}列${player.seat.row + 1}行目。`);
    }

    // NPC 同士の対戦は抽象モデルで即決着
    for (const c of queue) {
      if (c === incoming) continue;
      if (c.attacker === player || c.defender === player) continue;
      const out = this.challenges.resolveAbstract(c);
      this.challenges.applyOutcome(room, out);
      log.push(out.attackerWon
        ? `${c.attacker.name} が ${c.defender.name} の席を奪った（${c.reason}）`
        : `${c.defender.name} が ${c.attacker.name} の挑戦を守り切った`);
    }

    this.view?.syncSeats();
    this.lastLog = log;

    if (player.conduct <= 0) {
      this.screens.clear();
      await this.screens.turnResult('学級指導', false,
        [...log, '素行点が尽きた。あなたは職員室に呼ばれた——ゲームオーバー。'], '結果を見る');
      return false;
    }

    this.screens.clear();
    await this.screens.turnResult(`ターン ${room.turn} 終了`, null, log);
    return true;
  }

  private async runBattle(challenge: Challenge, playerRole: 'ATTACK' | 'DEFEND'): Promise<BattleResult> {
    this.mode = 'BATTLE';
    this.screens.clear();
    if (this.view) this.scene.remove(this.view.group);

    const arenaDef = this.reg.arenas.get('classroom_expanded') ?? [...this.reg.arenas.values()][0];
    this.battle = new BattleSession(
      this.scene, this.camera, this.input, this.reg, this.reg.battleRules,
      this.hud, arenaDef, this.room.calc.seats,
    );
    const result = await this.battle.start({
      attacker: challenge.attacker,
      defender: challenge.defender,
      defenderSeat: challenge.defender.seat,
      playerRole,
    });

    this.battle.dispose();
    this.battle = null;
    this.pausedByLock = false;
    this.input.releaseLock();
    this.mode = 'SEATING';
    if (this.view) this.scene.add(this.view.group);
    return result;
  }

  private evaluate(): { grade: string; comment: string } {
    const player = this.room.player;
    const value = this.room.calc.baseValue(player.seat);
    const undefeated = player.losses === 0;
    if (player.conduct <= 0) {
      return { grade: 'F — 学級崩壊', comment: '暴れすぎた。席の前に信用を失った。' };
    }
    if (value >= 90 && undefeated) {
      return { grade: 'S — 玉座', comment: `窓際最後列。無敗。誰もあなたの席を狙えない。${player.wins}勝0敗。` };
    }
    if (value >= 85) return { grade: 'A — 王', comment: `席価値 ${Math.round(value)}。教室の頂点に手が届いた。` };
    if (value >= 70) return { grade: 'B — 勝ち組', comment: `席価値 ${Math.round(value)}。悪くない学期だった。` };
    if (value >= 50) return { grade: 'C — 平穏', comment: `席価値 ${Math.round(value)}。可もなく不可もなく。` };
    return { grade: 'D — 敗残', comment: `席価値 ${Math.round(value)}。来学期こそは。` };
  }
}

void new Game().run();
