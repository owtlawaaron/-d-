# 06. JSON アドオン仕様

**ゲームのパラメータをコードに埋め込まない。** 教室・生徒・武器・アリーナ・演出は
すべて JSON で定義し、追加 JSON を置くだけで拡張できる構造にする。

## 6.1 パック構造

```
data/                              ← 標準パック（vanilla）
addons/
  └─ my_school_pack/
      ├─ manifest.json             ← 必須。パックの宣言
      ├─ seat_layouts/*.json
      ├─ students/*.json
      ├─ weapons/*.json
      └─ arenas/*.json
```

### manifest.json

```json
{
  "$schema": "../../schemas/manifest.schema.json",
  "id": "my_school_pack",
  "name": "うちの中学校パック",
  "version": "1.0.0",
  "gameVersion": ">=0.3.0",
  "author": "you",
  "loadAfter": ["vanilla"],
  "provides": {
    "seat_layouts": ["seat_layouts/class_3b.json"],
    "students":     ["students/class_3b_roster.json"],
    "weapons":      ["weapons/extra_weapons.json"]
  },
  "overrides": {
    "weapons": { "chalk_smg": { "damage": 9 } }
  }
}
```

## 6.2 読み込みとマージ規則（DataRegistry）

```
1. schemas/*.json を ajv にコンパイル
2. data/（vanilla）を読み込み → 検証 → レジストリに登録
3. addons/*/manifest.json を検出し、loadAfter でトポロジカルソート
4. 各パックの provides を読み込み → 検証 → 登録（同一 id は後勝ち）
5. overrides を **深いマージ**で適用（配列は置換、オブジェクトは再帰マージ）
6. 参照解決: "weaponId": "chalk_smg" のような文字列参照を実体に解決
   → 未解決の参照はロード時エラーにして、実行時に落ちないようにする
```

**検証エラーの扱い**: そのパックだけを読み込みから除外し、UI に理由を表示。
ゲーム全体は起動する（アドオンのミスで遊べなくなるのを防ぐ）。

## 6.3 各データ型

### seat_layout（教室レイアウト）

```jsonc
{
  "id": "standard_6x5",
  "cols": 6, "rows": 5,
  "origin": { "x": -3.25, "z": -2.2 },
  "pitch":  { "x": 1.3,  "z": 1.35 },
  "tagRules": [
    { "tag": "back_row",    "when": { "row": { "gte": 3 } },                  "weight": 18 },
    { "tag": "window_side", "when": { "col": { "eq": 5 } },                   "weight": 16 },
    { "tag": "front_row",   "when": { "row": { "eq": 0 } },                   "weight": -20 },
    { "tag": "aircon_zone", "when": { "col": { "gte": 4 }, "row": { "lte": 1 } },
      "weight": 12, "seasonal": { "summer": 12, "winter": -8 } }
  ]
}
```

`when` は `eq / gte / lte / in` のみのミニ DSL。**JSON に任意コードを書かせない**（安全性）。

### student（生徒）

```jsonc
{
  "id": "s07",
  "name": "花輪 陽介",
  "stats": { "athletics": 8, "nerve": 7, "academics": 4, "charisma": 6, "stamina": 7 },
  "personality": "hothead",
  "preferences": { "window_side": 8, "back_row": 6, "front_row": -10 },
  "friends": ["s12", "s22"],
  "rivals": ["s01"],
  "loadout": { "primary": "chalk_smg", "secondary": "eraser_launcher" },
  "appearance": { "hair": "spike", "hairColor": "#221a12", "skin": "#f0cba8", "height": 1.72 }
}
```

### weapon（武器）

```jsonc
{
  "id": "chalk_smg",
  "name": "チョークSMG",
  "kind": "hitscan",
  "damage": 8,
  "fireRate": 10.0,
  "magazine": 40,
  "reloadTime": 1.8,
  "range": 40.0,
  "spread": { "base": 0.6, "perShot": 0.35, "max": 4.0, "recoverPerSec": 6.0 },
  "recoil": { "vertical": 0.35, "horizontal": 0.12 },
  "headshotMultiplier": 2.0,
  "crystalMultiplier": 0.6,
  "onHit": [{ "effect": "dust_cloud", "duration": 1.2 }],
  "audio": { "fire": "chalk_fire.ogg", "reload": "chalk_reload.ogg" },
  "atkRating": 1.0, "defRating": 1.0     // 抽象戦闘シミュレータ用（docs/02 §2.5）
}
```

### arena（アリーナ）

```jsonc
{
  "id": "classroom_expanded",
  "scale": 2.0,
  "bounds": { "x": 18, "y": 6, "z": 16 },
  "colliders": [
    { "type": "box", "pos": [0, 1.5, -8], "size": [18, 6, 0.4], "tag": "wall_blackboard" }
  ],
  "cover": { "source": "seat_grid", "deskSize": [1.3, 1.44, 0.9] },
  "attackerSpawns": [[-6, 0, 6], [0, 0, 7], [6, 0, 6]],
  "spawnFlipWhenDefenderRow": { "gte": 3 },
  "waypoints": [
    { "id": "wp_back_l",  "pos": [-6, 0, 6],  "links": ["wp_mid_l", "wp_back_c"] },
    { "id": "wp_mid_l",   "pos": [-6, 0, 0],  "links": ["wp_back_l", "wp_front_l"] }
  ],
  "highGround": [{ "pos": [7.5, 2.4, -5], "size": [3, 0.2, 4], "tag": "locker_top" }]
}
```

## 6.4 JSON Schema

`schemas/` に以下を配置（draft 2020-12）。ajv で起動時に検証する。

| ファイル | 対象 |
| --- | --- |
| `manifest.schema.json` | アドオンの宣言 |
| `seat_layout.schema.json` | 教室レイアウト |
| `student.schema.json` | 生徒（配列ルート `roster`） |
| `weapon.schema.json` | 武器 |
| `arena.schema.json` | アリーナ |
| `personality.schema.json` | 性格プリセット |

エディタ（VS Code）で補完が効くよう、全データファイルに `"$schema"` を書く。

## 6.5 バランス調整ツール（Python）

`tools/` に配置。**ゲーム本体には同梱しない**（開発用）。

| ファイル | 役割 |
| --- | --- |
| `balance_sim.py` | 抽象戦闘モデルで 10万回対戦し、勝率・平均決着時間を出力。`DEFENDER_ADVANTAGE` を二分探索で調整 |
| `seat_value_report.py` | seat_layout JSON を読み、全席の baseValue をヒートマップ出力（matplotlib）。「玉座が1つだけ突出しているか」を確認 |
| `roster_gen.py` | 30人分の生徒 JSON を、ステータス合計が均等になるよう自動生成 |
| `schema_check.py` | CI 用。全 JSON を jsonschema で検証（`pip install jsonschema`） |

### 目標バランス（balance_sim.py の合格条件）

| 指標 | 目標値 |
| --- | --- |
| 同能力での攻め側勝率 | **42〜46%**（守り有利） |
| 能力差 +3 の攻め側勝率 | 60〜68%（実力が効くが確定ではない） |
| 平均決着時間 | 55〜75秒（90秒を使い切りすぎない） |
| 時間切れ決着の割合 | 25〜35% |
