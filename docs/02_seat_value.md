# 02. 席価値・不満度・挑戦AI

このゲームの心臓部。**「どの席が良い席か」を数値化**しないと、不満も挑戦も発生しない。

## 2.1 教室の座席グリッド

標準教室: **6列 × 5行 = 30席**。原点は教室の中心、黒板は -Z 方向。

```
                   [黒板 / 教卓]              ← z = -4.0m
   廊下側                                        窓側
   ┌─────┬─────┬─────┬─────┬─────┬─────┐
 1 │ 0,0 │ 1,0 │ 2,0 │ 3,0 │ 4,0 │ 5,0 │  row 0（最前列）
 2 │ 0,1 │ 1,1 │ 2,1 │ 3,1 │ 4,1 │ 5,1 │
 3 │ 0,2 │ 1,2 │ 2,2 │ 3,2 │ 4,2 │ 5,2 │
 4 │ 0,3 │ 1,3 │ 2,3 │ 3,3 │ 4,3 │ 5,3 │
 5 │ 0,4 │ 1,4 │ 2,4 │ 3,4 │ 4,4 │ 5,4 │  row 4（最後列）
   └─────┴─────┴─────┴─────┴─────┴─────┘
   [出入口]                        [窓・エアコン]
```

ワールド座標: `x = (col - 2.5) * 1.3`, `z = -2.2 + row * 1.35`

## 2.2 客観的席価値 baseValue（全員共通・0〜100）

各席は「属性タグ」を持ち、タグごとの重みの合計で基礎価値が決まる。

| 属性 | 条件 | 重み |
| --- | --- | --- |
| `back_row` | row >= 3 | +18（先生の視線が届かない） |
| `window_side` | col == 5 | +16（外が見える・換気） |
| `aircon_zone` | col >= 4 && row <= 1 | +12（夏）/ -8（冬）※季節で反転 |
| `corner_king` | col == 5 && row == 4 | +10（最強の角。追加ボーナス） |
| `front_row` | row == 0 | -20（当てられる） |
| `teacher_desk_adjacent` | col <= 1 && row == 0 | -12（教卓の真ん前） |
| `door_side` | col == 0 | -6（廊下の騒音・遅刻がバレる） |
| `cleaning_locker` | col == 0 && row == 4 | -8（掃除ロッカー隣） |
| `projector_glare` | col >= 4 && row <= 1 | -5（スクリーンが見づらい） |
| `center_screen` | col in [2,3] && row in [1,2] | +4（板書が一番見やすい） |

```ts
baseValue(seat) = clamp(50 + Σ weight(tag), 0, 100)
```

**代表値（夏設定）**

| 席 | 計算 | baseValue |
| --- | --- | --- |
| (5,4) 窓際最後列 | 50 +18 +16 +10 | **94** ← 玉座 |
| (4,4) | 50 +18 | 68 |
| (5,0) 窓際最前列 | 50 +16 +12 -20 -5 | 53 |
| (2,2) 中央 | 50 +4 | 54 |
| (0,0) 教卓前 | 50 -20 -12 -6 | 12 |
| (0,4) ロッカー隣 | 50 +18 -6 -8 | 54 |

→ **窓際最後列(5,4) が誰もが狙う「玉座」** になり、争奪の中心が自然に生まれる。

## 2.3 主観的席価値 perceivedValue（生徒ごと）

```
perceivedValue(student, seat)
  = baseValue(seat)
  + Σ preferenceBonus(student, seat.tags)     // 性格・好みによる補正
  + socialBonus(student, seat)                // 友達が隣にいるか
  + clamp(-15, 15)                            // 補正の合計は ±15 に制限
```

### preferenceBonus の例（students JSON の `preferences`）

```json
"preferences": { "window_side": 8, "front_row": 6, "back_row": -4 }
```
（＝真面目な生徒は前の席をむしろ好む → 全員が同じ席を狙わなくなる）

### socialBonus

隣接8マスに `friends` がいれば **+4/人**、`rivals` がいれば **-6/人**（最大±12）。

## 2.4 不満度 Frustration（0〜100）

```
gap        = expectedSeat(student) - perceivedValue(student, currentSeat)
frustration = clamp(
                 gap * personality.prideScale        // 性格による増幅 0.8〜1.4
               + grudgeTotal * 0.35                  // 遺恨
               + turnsSinceLastWin * 2               // 燻り
               - conductPenalty                      // 素行点が減ると挑戦を控える
               , 0, 100)
```

`frustration >= personality.challengeThreshold` かつ
`challengeTokens > 0` かつ `cooldown == 0` のとき **挑戦が発生**する。

## 2.5 ターゲット選定AI（utility scoring）

挑戦者は「自分より価値の高い席」の全員に対してスコアを計算し、最大の相手を選ぶ。

```
utility(target)
  = valueGain(target) * W_VALUE          // 席価値の差（0〜100）
  + winChance(self, target) * W_WIN      // 推定勝率（0〜1 → 0〜100換算）
  + grudge(self, target) * W_GRUDGE      // 遺恨
  - friendship(self, target) * W_FRIEND  // 友達は狙いにくい
```

性格ごとの重み（`data/students/personalities.json`）:

| type | W_VALUE | W_WIN | W_GRUDGE | W_FRIEND |
| --- | --- | --- | --- | --- |
| hothead | 1.0 | 0.1 | 0.8 | 0.1 |
| calculator | 0.7 | 1.2 | 0.2 | 0.4 |
| loyal | 0.8 | 0.6 | 0.3 | 1.5 |
| tyrant | 1.6 | 0.3 | 0.1 | 0.0 |
| avenger | 0.4 | 0.4 | 2.0 | 0.2 |
| pacifist | 0.5 | 1.0 | 0.5 | 1.0 |

### 推定勝率 winChance（抽象戦闘モデル）

3D戦闘を回さずに勝敗を出すための近似式。攻め側の勝率を返す。

```
atkPower = athletics*1.0 + nerve*1.2 + academics*0.5
defPower = stamina*1.1  + nerve*1.0 + academics*0.8 + DEFENDER_ADVANTAGE

winChance = atkPower^K / (atkPower^K + defPower^K)
```

| 係数 | 値 | 出所 |
| --- | --- | --- |
| `K` | **2.63** | `tools/balance_sim.py` によるフィット |
| `DEFENDER_ADVANTAGE` | **0.55** | 同上 |

この2つは手で決めた値ではなく、**docs/03 のルールを1秒刻みで回した
時間発展シミュレーション（4万試合）の実測勝率に最小二乗フィットした結果**。
RMSE 0.30pt で一致しており、NPC同士の対戦を閉形式で即決着させても
3D戦闘と同じ勝率分布になる。

| ケース | 閉形式 | 実測（シミュレーション） |
| --- | --- | --- |
| 互角（全能力6） | 43.3% | 43.7% |
| 攻め +3 | 63.9% | 63.7% |
| 攻め -3 | 22.8% | 22.6% |

再現: `python3 tools/balance_sim.py --trials 40000`

ルールや武器を変えたら **必ずこのツールを回して係数を取り直すこと**。
そうしないと「プレイヤーが戦うと勝てるのに、NPC同士だと結果が違う」というズレが出る。

## 2.6 席の交換ルール

- **攻め勝ち**: 攻撃側と防御側の席を **入れ替える**（追い出しではなく交換）。
- **守り勝ち**: 席は動かない。攻撃側は `frustration = 0`、`cooldown = 2ターン`、`conduct -= 10`。
- どちらの場合も敗者に `grudge += 25`。

## 2.7 連鎖挑戦（Chain Challenge）

席が動くと周囲の perceivedValue が変わる（socialBonus が変化するため）ので、
同一ターン内で **最大3件** まで連鎖挑戦が起きる。教室が荒れていく感覚を作る要素。
プレイヤーが関与しない連鎖は結果ログのみ表示。
