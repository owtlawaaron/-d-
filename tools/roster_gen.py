#!/usr/bin/env python3
"""30人分の生徒 JSON を生成する。

ステータス合計をほぼ均等（合計30±2）に保ちつつ、性格と好みの分布を散らす。
「全員が窓際最後列を狙う」状態にならないよう、preferences を意図的にばらけさせる。

usage:
    python3 tools/roster_gen.py > data/students/class_3b_roster.json
"""
import json
import random
import sys

random.seed(20260903)  # 再現性のため固定

FAMILY = ["佐々木", "花輪", "轟", "白鳥", "南雲", "剣崎", "月島", "鷹野", "犬飼", "御堂",
          "灰田", "早坂", "十文字", "神楽坂", "有栖", "獅子堂", "氷室", "名取", "桐生", "赤羽",
          "海堂", "真中", "黒木", "美濃部", "陣内", "常磐", "羽鳥", "遠野", "九条", "藤堂"]
GIVEN = ["陽介", "美琴", "隼人", "詩織", "健太", "彩香", "拓真", "由紀", "翔太", "結衣",
         "大地", "楓", "涼介", "咲良", "悠真", "七海", "航平", "遥", "蓮", "凛",
         "颯太", "杏奈", "圭吾", "千夏", "駿", "花音", "陸", "真央", "誠", "小春"]

PERSONALITIES = (["hothead"] * 5 + ["calculator"] * 6 + ["loyal"] * 6 +
                 ["pacifist"] * 6 + ["tyrant"] * 3 + ["avenger"] * 4)

# 好みのプリセット。全員が同じ席を狙わないための「価値観の分散」
PREF_PRESETS = [
    ("窓際信仰",   {"window_side": 9, "back_row": 5, "front_row": -8}),
    ("後方の王",   {"back_row": 10, "corner_king": 6, "front_row": -12}),
    ("優等生",     {"front_row": 9, "center_screen": 8, "back_row": -6}),
    ("冷房命",     {"aircon_zone": 11, "window_side": 4, "door_side": -5}),
    ("廊下族",     {"door_side": 8, "back_row": 4, "window_side": -6}),
    ("目立ちたくない", {"center_screen": -7, "back_row": 7, "front_row": -9}),
    ("こだわりなし", {}),
]

LOADOUTS = [
    {"primary": "chalk_smg", "secondary": "ruler_boomerang"},
    {"primary": "eraser_launcher", "secondary": "ruler_boomerang"},
    {"primary": "compass_bow", "secondary": "ruler_boomerang"},
    {"primary": "chalk_smg", "secondary": "correction_tape"},
    {"primary": "compass_bow", "secondary": "correction_tape"},
]

HAIR = ["short", "spike", "bob", "long", "ponytail", "buzz"]
HAIR_COLORS = ["#221a12", "#2f2318", "#151515", "#4a3524", "#5c4630"]
SKINS = ["#f0cba8", "#e8bd96", "#d9a97f", "#f6d8bd"]


def make_stats(total: int = 30) -> dict:
    """合計 total になる 5 ステータス（各 1〜10）を作る。"""
    keys = ["athletics", "nerve", "academics", "charisma", "stamina"]
    while True:
        vals = [random.randint(2, 9) for _ in keys]
        diff = total - sum(vals)
        # 差分を 1 ずつ配って合計を合わせる
        for _ in range(abs(diff)):
            i = random.randrange(len(vals))
            step = 1 if diff > 0 else -1
            if 1 <= vals[i] + step <= 10:
                vals[i] += step
        if sum(vals) == total and all(1 <= v <= 10 for v in vals):
            return dict(zip(keys, vals))


def build() -> dict:
    ids = [f"s{i:02d}" for i in range(30)]
    roster = []
    for i, sid in enumerate(ids):
        _, prefs = random.choice(PREF_PRESETS)
        others = [x for x in ids if x != sid]
        friends = random.sample(others, k=random.randint(1, 3))
        rivals = random.sample([x for x in others if x not in friends], k=random.randint(0, 2))
        roster.append({
            "id": sid,
            "name": f"{FAMILY[i]} {GIVEN[i]}",
            "playable": i == 0,
            "stats": make_stats(30 + random.randint(-2, 2)),
            "personality": PERSONALITIES[i],
            "preferences": prefs,
            "friends": friends,
            "rivals": rivals,
            "loadout": random.choice(LOADOUTS),
            "appearance": {
                "hair": random.choice(HAIR),
                "hairColor": random.choice(HAIR_COLORS),
                "skin": random.choice(SKINS),
                "height": round(random.uniform(1.48, 1.82), 2),
            },
        })
    return {
        "$schema": "../../schemas/student.schema.json",
        "classId": "class_3b",
        "roster": roster,
    }


if __name__ == "__main__":
    json.dump(build(), sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
