# 05. アリーナ生成演出「GENESIS」（5秒）

挑戦が成立した瞬間から戦闘開始までの **5秒間**。
このゲームの「掴み」になる部分なので、専用の仕様を切る。

## 5.1 演出タイムライン

| 時間 | 演出 | 実装 |
| --- | --- | --- |
| 0.00–0.50 | **時間停止**。BGM が止まり、教室の音がローパスで潰れる。全生徒がフリーズし、彩度が 0.15 まで落ちる | `AnimationMixer.timeScale = 0` / ポストの Saturation uniform / `BiquadFilterNode` |
| 0.50–1.00 | 挑戦者と防衛者の **顔アップのカットイン**（左右から差し込み）。名前・席番号・席価値を表示 | DOM オーバーレイ + CSS transform |
| 1.00–1.60 | 床から **青いスキャンライン**が黒板側から後方へ走査。通過した床がグリッド模様になる | 床マテリアルの `uScanZ` uniform |
| 1.60–3.00 | 机・椅子・ロッカーが **床から立ち上がりながらワイヤーフレーム→ソリッド化**。列ごとに 0.06秒ずつ遅延 | 頂点シェーダで `uProgress` に応じて Y をリフト＋ディゾルブ |
| 2.20–3.20 | 教室が **2倍にスケールアップ**（カメラのドリーバックで表現）。天井が持ち上がる | カメラの位置補間（easeInOutCubic） |
| 3.00–3.80 | **クリスタル降臨**。防衛側の机の上に光の柱が落ち、八面体が結晶化。衝撃波リング | Bloom強化 + リングのシェーダ |
| 3.80–4.40 | 両者が **スポーン地点にマテリアライズ**。武器がパーティクルから組み上がる | ディゾルブ逆再生 |
| 4.40–4.80 | 役割表示 `ATTACK` / `DEFEND` が画面に叩きつけられる。HUD がフェードイン | DOM アニメーション |
| 4.80–5.00 | チャイムの一打。彩度が戻り、操作可能になる | 全 uniform を通常値へ |

## 5.2 ディゾルブ生成シェーダ（家具の立ち上がり）

`src/render/shaders/genesis.glsl.ts`

```glsl
// --- vertex ---
uniform float uProgress;   // 0.0 → 1.0
uniform float uDelay;      // オブジェクトごとの遅延（列ごとに 0.06 * col）
varying float vLocal;      // このオブジェクトのローカル進行度
varying vec3  vPos;

void main() {
  vLocal = clamp((uProgress - uDelay) / 0.55, 0.0, 1.0);
  float ease = 1.0 - pow(1.0 - vLocal, 3.0);          // easeOutCubic
  vec3 p = position;
  p.y -= (1.0 - ease) * 2.5;                          // 床下から せり上がる
  vPos = p;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}

// --- fragment ---
uniform sampler2D uNoise;
uniform vec3 uEdgeColor;    // #4cc9ff（生成ライン）
varying float vLocal;
varying vec3  vPos;

void main() {
  float n = texture2D(uNoise, vPos.xz * 0.35).r;
  // 下から上へ「実体化の境界」が上がっていく
  float threshold = vLocal * 1.25 - 0.25;
  float h = (vPos.y + 1.5) / 3.0;
  if (h > threshold + n * 0.18) discard;              // まだ実体化していない部分
  float edge = smoothstep(0.14, 0.0, threshold + n * 0.18 - h);
  vec3 base = vec3(0.72, 0.68, 0.60);                 // 木目の机
  gl_FragColor = vec4(mix(base, uEdgeColor * 3.0, edge), 1.0);  // 境界が発光
}
```

`uEdgeColor * 3.0` で 1.0 を超えさせ、**UnrealBloomPass** に拾わせて発光させる。

## 5.3 実装インターフェース

```ts
class ArenaGenesis {
  constructor(private scene: THREE.Scene, private composer: EffectComposer) {}

  /** 5秒の演出を再生する。Promise は演出完了で解決 */
  async play(ctx: {
    defenderSeat: Seat;
    attacker: Student;
    defender: Student;
    arena: ArenaHandle;      // ArenaBuilder が作った Mesh 群（materials 差し替え済み）
  }): Promise<void>;

  /** GameLoop から毎フレーム呼ばれる（play 中のみ） */
  update(dt: number): void;

  /** スキップ（2周目以降の快適性のため必須） */
  skip(): void;
}
```

### タイムライン記述の型

演出はハードコードせず、**キーフレーム配列**で持つ。JSON 化してアドオン差し替え可能にする。

```ts
type GenesisTrack = {
  target: 'saturation' | 'furnitureProgress' | 'cameraDolly'
        | 'crystalScale' | 'bloomStrength' | 'scanZ';
  keys: { t: number; v: number; ease?: 'linear' | 'inCubic' | 'outCubic' | 'inOutCubic' }[];
};
```
→ `data/arenas/genesis_default.json` に格納（docs/06 のアドオン対象）。

## 5.4 スキップ仕様

- **初回のみ全編再生**、2回目以降は Space / Esc で 0.6秒のダイジェストに短縮。
- 設定に `genesisMode: 'full' | 'short' | 'off'` を持つ。
- スキップしても **アリーナの構築処理自体は完了させる**（見た目だけ飛ばす）。
  → `ArenaBuilder.build()` は演出とは独立に、`play()` の**前に**完了させておく。

## 5.5 パフォーマンス上の注意

- 演出中に `new THREE.Mesh()` を大量に呼ぶとカクつく。
  **アリーナは play() の前に構築済み**にして、演出はマテリアルの uniform を動かすだけにする。
- 家具は `InstancedMesh` なので `uDelay` は `InstancedBufferAttribute` で個体ごとに渡す。
- Bloom は演出中のみ `strength 0.4 → 1.6` に上げ、戦闘中は 0.4 に戻す（負荷対策）。
