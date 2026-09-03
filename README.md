# SEAT WARS（仮題） — 席替えメーカー × FPS

> 「席替えの不満は、陰口じゃなく実力で解決しろ。」

学校の席替えを **ランダム抽選 → 不満 → 直接タイマン（FPS）→ 席の奪取** という
ループに変換した 3D ゲームのプロジェクトです。Three.js + TypeScript で実装します。

## コアループ

```
[1] 席替え抽選        ランダムに席が配られる（クラス30人）
      ↓
[2] 不満フェーズ      各生徒(NPC/PLAYER)が「席価値」と「自己評価」の差から不満度を算出
      ↓
[3] 挑戦宣言          不満が閾値を超えた生徒が、良い席を取った生徒に「タイマン」を申し込む
      ↓
[4] アリーナ生成      5秒のカットイン演出。教室が拡張バトルフィールドに再構築される
      ↓
[5] 1本勝負(90秒)     挑戦側 = 攻め / 受け側 = 守り
                      攻め: 相手の「座席権クリスタル」を破壊すれば勝ち
                      守り: 90秒守り切れば勝ち
      ↓
[6] 席の移動          攻め勝ち → 席を強奪して交換 / 守り勝ち → 現状維持＋挑戦者にペナルティ
      ↓
[2] へ戻る（連鎖挑戦が起きる。1日の挑戦回数には上限あり）
```

## ドキュメント

| ファイル | 内容 |
| --- | --- |
| [docs/01_game_design.md](docs/01_game_design.md) | ゲーム全体設計・世界観・メタゲーム |
| [docs/02_seat_value.md](docs/02_seat_value.md) | 席価値の計算式と不満度・挑戦AIのロジック |
| [docs/03_battle_spec.md](docs/03_battle_spec.md) | FPS戦闘の仕様（勝敗条件・武器・数値バランス） |
| [docs/04_tech_architecture.md](docs/04_tech_architecture.md) | Three.js のクラス設計・ディレクトリ構成・実装順 |
| [docs/05_arena_genesis.md](docs/05_arena_genesis.md) | 5秒のアリーナ生成演出の実装仕様（シェーダ込み） |
| [docs/06_data_addon.md](docs/06_data_addon.md) | JSON アドオン仕様（教室・生徒・武器を JSON で差し替え） |
| [docs/07_roadmap.md](docs/07_roadmap.md) | 開発ロードマップ（M0〜M6） |

## データ / ツール

| ディレクトリ | 内容 |
| --- | --- |
| `schemas/` | JSON Schema 6種（アドオン検証用・draft 2020-12） |
| `data/` | 標準データ（教室レイアウト・生徒30人・武器6種・アリーナ・戦闘ルール） |
| `addons/example_pack/` | JSON を置くだけで拡張できることを示すサンプルパック |
| `tools/` | Python 製の検証・バランス調整ツール（すべて標準ライブラリのみで動作） |

### ツールの使い方

```bash
# 席価値のヒートマップを出す（玉座が1つに定まっているか確認）
python3 tools/seat_value_report.py
python3 tools/seat_value_report.py --season winter

# 戦闘バランスを4万試合シミュレートして検証＋抽象モデルの係数をフィット
python3 tools/balance_sim.py --trials 40000

# 全 JSON をスキーマ検証（CI 用）
pip install jsonschema && python3 tools/schema_check.py

# 生徒30人を再生成
python3 tools/roster_gen.py > data/students/class_3b_roster.json
```

### 現在の検証済みバランス

`python3 tools/balance_sim.py` の実測（4万試合・全項目 PASS）:

| 指標 | 実測 | 目標 |
| --- | --- | --- |
| 互角の攻め側勝率 | 43.7% | 42〜46%（守り有利） |
| 能力差 +3 の攻め側勝率 | 63.7% | 60〜68% |
| 平均決着時間 | 73.5秒 | 55〜75秒 |
| 時間切れ率 | 27.5% | 25〜35% |

NPC 同士の対戦を即決着させる閉形式モデル（K=2.63 / DEFENDER_ADVANTAGE=0.55）は、
この時間発展シミュレーションに RMSE 0.30pt でフィットさせてある。

## 現在の状態

**設計フェーズ完了。コードはこれから（→ docs/07_roadmap.md の M0 から着手）。**
数値仕様は Python ツールで検証済みなので、そのまま TypeScript に落とせる。

## 技術スタック（決定）

- **Three.js (r160+)** — 描画
- **TypeScript + Vite** — ビルド
- **自前の簡易物理**（カプセル vs AABB）＋ 弾は基本 hitscan（Raycaster）
- **glTF** — 3Dモデル（初期はプリミティブの「箱人間」で通す）
- **JSON + JSON Schema** — 全パラメータを外部データ化（アドオン対応）
