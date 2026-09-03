# 04. 技術アーキテクチャ（Three.js / TypeScript）

## 4.1 技術選定

| 領域 | 採用 | 理由 |
| --- | --- | --- |
| 描画 | **Three.js r160+** | WebGL2。要件（1教室・30キャラ）に対して十分軽い |
| 言語 | **TypeScript** | 席価値やステータスの型を固めたい |
| ビルド | **Vite** | ESM そのまま・HMR が速い |
| 物理 | **自前（カプセル vs AABB）** | 教室は静的な箱の集合。Rapier/cannon は過剰 |
| 弾 | **hitscan（Raycaster）＋ 一部 projectile** | 命中判定を単純化。projectile は自前の等加速度運動 |
| モデル | **glTF（GLTFLoader / DRACO）** | 初期はプリミティブで代替 |
| アニメ | `AnimationMixer` | 歩行・射撃・被弾・気絶の4クリップから開始 |
| 音 | `THREE.PositionalAudio` | 足音の定位が戦闘に効く |
| ポスト | `EffectComposer`（Bloom / Vignette） | アリーナ生成演出に必須 |
| データ | **JSON + JSON Schema (ajv)** | docs/06 のアドオン仕様 |
| 状態管理 | 自前の `EventBus` + `GameStateMachine` | 依存を増やさない |

**外部依存は Three.js と ajv のみ**に抑える。

## 4.2 ディレクトリ構成

```
seat-wars/
├─ index.html
├─ vite.config.ts
├─ schemas/                       # JSON Schema（アドオン検証）
├─ data/                          # 標準データ（JSON）
├─ public/assets/                 # models/ textures/ audio/
├─ tools/                         # Python バランス調整
└─ src/
   ├─ main.ts                     # エントリ。Game を起動するだけ
   ├─ core/
   │   ├─ Game.ts                 # 最上位。SceneManager とフェーズを保持
   │   ├─ GameLoop.ts             # 固定 60Hz の update + 可変 render
   │   ├─ EventBus.ts             # 型付き pub/sub
   │   ├─ StateMachine.ts         # 汎用の有限状態機械
   │   ├─ InputManager.ts         # キー/マウス/PointerLock
   │   ├─ AssetLoader.ts          # glTF・テクスチャ・音のプリロード
   │   └─ DataRegistry.ts         # JSON の読み込み + ajv 検証 + 参照解決
   ├─ meta/                       # 教室フェーズ（非FPS）
   │   ├─ Classroom.ts            # 教室全体。Seat と Student を保持
   │   ├─ SeatGrid.ts             # 6x5 のグリッド。座標変換
   │   ├─ Seat.ts                 # col,row,tags,occupant
   │   ├─ Student.ts              # ステータス・性格・遺恨・素行点
   │   ├─ SeatValueCalculator.ts  # baseValue / perceivedValue（docs/02）
   │   ├─ FrustrationSystem.ts    # 不満度の更新
   │   ├─ ChallengeScheduler.ts   # 挑戦キューの生成と処理
   │   ├─ AbstractDuelResolver.ts # NPC同士の勝敗を確率で即決着
   │   ├─ TurnController.ts       # 朝/昼/放課後/夜 のフェーズ進行
   │   └─ ClassroomView.ts        # 教室の俯瞰3D表示・席のハイライト
   ├─ battle/                     # FPS フェーズ
   │   ├─ BattleSession.ts        # 1試合のライフサイクル管理
   │   ├─ BattleRules.ts          # 勝敗判定・タイマー・リスポーン管理
   │   ├─ ArenaBuilder.ts         # 席配置からアリーナ(Mesh+Collider)を生成
   │   ├─ ArenaGenesis.ts         # 5秒の生成演出（docs/05）
   │   ├─ Colliders.ts            # AABB リスト + broadphase(グリッド)
   │   ├─ CharacterController.ts  # カプセル移動・重力・ステップ・スライド
   │   ├─ PlayerController.ts     # 入力 → CharacterController + カメラ
   │   ├─ NpcAgent.ts             # AI 本体（StateMachine + Perception）
   │   ├─ Perception.ts           # 視界判定・足音・被弾方向
   │   ├─ WaypointGraph.ts        # A* 経路探索
   │   ├─ Combatant.ts            # HP・所持武器・被弾処理の共通基底
   │   ├─ weapons/
   │   │   ├─ WeaponSystem.ts     # 装備・射撃・リロード・リコイル
   │   │   ├─ HitscanWeapon.ts
   │   │   ├─ ProjectileWeapon.ts
   │   │   └─ ProjectilePool.ts   # オブジェクトプール（GC回避）
   │   ├─ Crystal.ts              # 座席権クリスタル（HP・シールド・破壊演出）
   │   ├─ Deployables.ts          # バリケード・シールド・トラップ
   │   └─ DamageSystem.ts         # ダメージ計算の一元化（部位・貫通・倍率）
   ├─ render/
   │   ├─ RendererSetup.ts        # WebGLRenderer + EffectComposer
   │   ├─ Lighting.ts             # 教室の照明（昼/夕/戦闘）
   │   ├─ shaders/
   │   │   ├─ genesis.glsl.ts     # 生成演出のディゾルブシェーダ
   │   │   └─ crystal.glsl.ts     # クリスタルの屈折・脈動
   │   └─ vfx/                    # マズルフラッシュ・粉塵・ヒットマーク
   └─ ui/
       ├─ Hud.ts                  # 戦闘HUD（DOM overlay）
       ├─ SeatBoard.ts            # 席替え画面・席価値の可視化
       ├─ ChallengeDialog.ts      # 挑戦の宣言・受諾UI
       └─ ResultScreen.ts
```

## 4.3 主要クラスの責務とインターフェース

### core/Game.ts

```ts
type GamePhase = 'BOOT' | 'SEATING' | 'FRUSTRATION' | 'CHALLENGE'
               | 'GENESIS' | 'BATTLE' | 'RESULT' | 'GAME_OVER';

class Game {
  readonly bus: EventBus;
  readonly data: DataRegistry;
  readonly loop: GameLoop;
  private phase: StateMachine<GamePhase>;
  private classroom: Classroom;
  private battle: BattleSession | null;

  async boot(): Promise<void>;         // データ検証 → アセット → 教室生成
  update(dt: number): void;            // 現在フェーズの update に委譲
  render(alpha: number): void;
  startBattle(challenge: Challenge): Promise<BattleOutcome>;
}
```

### core/GameLoop.ts — 固定タイムステップ

```ts
// 物理と AI は 60Hz 固定、描画は可変。ヒット判定のブレを防ぐ
const FIXED_DT = 1 / 60;
tick(now: number) {
  this.accumulator += Math.min(now - this.last, 0.25);   // スパイラル防止
  while (this.accumulator >= FIXED_DT) {
    this.onUpdate(FIXED_DT);
    this.accumulator -= FIXED_DT;
  }
  this.onRender(this.accumulator / FIXED_DT);            // 補間 alpha
}
```

### meta/SeatValueCalculator.ts

```ts
class SeatValueCalculator {
  constructor(private cfg: SeatValueConfig /* data/seat_layouts/*.json */) {}
  baseValue(seat: Seat, season: Season): number;
  perceivedValue(student: Student, seat: Seat, room: Classroom): number;
  rank(room: Classroom): Seat[];   // 価値の降順（「玉座」判定に使う）
}
```

### battle/BattleSession.ts — 1試合の全体

```ts
interface BattleConfig {
  attacker: Student; defender: Student;
  attackerSeat: Seat; defenderSeat: Seat;
  playerRole: 'ATTACK' | 'DEFEND' | 'SPECTATE';
}

class BattleSession {
  async start(cfg: BattleConfig): Promise<BattleOutcome> {
    await this.genesis.play(cfg.defenderSeat);   // 5秒演出
    await this.rules.preparePhase(15);           // 準備フェーズ
    this.rules.startTimer(90);
    // GameLoop から update が回り、決着で resolve
  }
  update(dt: number): void;   // controller → npc → weapons → projectiles → rules
}
```

**update の実行順序（重要）**:
```
1. InputManager.poll()
2. PlayerController.update()   // 入力 → 速度
3. NpcAgent.update()           // 知覚 → 状態遷移 → 意思決定
4. CharacterController.step()  // 移動 + 衝突解決（両者）
5. WeaponSystem.update()       // 射撃・リロード・リコイル回復
6. ProjectilePool.update()     // 弾の移動と当たり判定
7. DamageSystem.flush()        // 溜めたダメージを一括適用（同時ダメージの順序依存を消す）
8. BattleRules.update()        // タイマー・勝敗・リスポーン
9. Hud.sync()
```

### battle/CharacterController.ts — 自前物理

```ts
// カプセル(半径0.32m, 高さ1.7m) vs 静的AABB
step(dt: number) {
  this.velocity.y += GRAVITY * dt;
  const move = this.velocity.clone().multiplyScalar(dt);
  // 軸分離で解決（X → Z → Y）。壁ずりと自動ステップを実現
  this.resolveAxis('x', move.x);
  this.resolveAxis('z', move.z);
  this.resolveAxis('y', move.y);
  this.grounded = this.probeGround();
}
```
衝突対象は `Colliders`（AABB配列）を 1m グリッドでブロードフェーズ分割。
机30台＋壁＋設置物で最大 60 AABB 程度 → 毎フレーム全走査でも問題ないが、
将来の拡張のためグリッドを入れておく。

### battle/DamageSystem.ts

```ts
interface DamageEvent {
  source: Combatant; target: Combatant | Crystal;
  amount: number; part: 'HEAD' | 'BODY' | 'LEG'; penetrated: boolean;
}
// 倍率: HEAD ×2.0(hitscan)/×3.0(compass) | LEG ×0.85 | 貫通 ×0.5
// クリスタル: 銃撃 ×0.6 / 近接 ×2.5 / 残り30秒 ×1.3 / 守り死亡中 ×0.5
```

## 4.4 3Dモデルの方針（段階的）

| 段階 | 内容 |
| --- | --- |
| **P0** | `BoxGeometry` の「箱人間」。頭(0.25立方)＋胴＋腕2。制服の色だけ変える |
| **P1** | 頭・胴・腕を階層化して `Bone` 無しの簡易アニメ（腕を振る・銃を構える） |
| **P2** | glTF のリグ付きモデルに差し替え（`AnimationMixer`）。Mixamo 系で可 |
| **P3** | 30人分の見た目を JSON（髪型ID・色・体型スケール）で組み合わせ生成 |

**重要**: P0 でゲームループを完成させてから見た目を上げる。
モデル制作をクリティカルパスに置かない。

机は `InstancedMesh`（30台を1ドローコール）で描画する。

## 4.5 パフォーマンス目標

| 指標 | 目標 |
| --- | --- |
| FPS | 60（1920×1080 / GTX1050 相当） |
| ドローコール | 120 以下（机 instanced / 生徒 30体は教室フェーズのみ） |
| 三角形数 | 200k 以下 |
| 初回ロード | 5秒以内（アセット 15MB 以下） |
| GC ポーズ | 弾・パーティクル・ダメージイベントは全てプールし、毎フレームの `new` をゼロに |

## 4.6 実装の着手順（最短で「遊べる」に到達する順序）

```
1. Vite + Three.js の空シーン + 固定タイムステップループ
2. 箱の教室 + AABB コライダー + FPS移動（PointerLock）        ← ここで一度動かす
3. hitscan 射撃 + 的（静止した箱）を撃って壊す
4. NPC 1体（棒立ち → 撃ち返す → 遮蔽に隠れる）
5. クリスタル + 90秒タイマー + 勝敗判定                        ← ここで「1試合」が成立
6. SeatGrid / SeatValueCalculator / 席替え画面
7. FrustrationSystem + ChallengeScheduler（メタループ接続）    ← ここで「ゲーム」になる
8. ArenaGenesis（5秒演出）
9. 武器6種 / 設置物 / NPC AI の強化
10. JSON アドオン化・バランス調整（Python）
```
