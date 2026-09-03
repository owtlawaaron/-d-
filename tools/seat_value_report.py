#!/usr/bin/env python3
"""seat_layout JSON を読み、全席の baseValue を計算して ASCII ヒートマップで出力する。

docs/02 §2.2 の式をそのまま実装した「実行可能な仕様」。
TypeScript 側の SeatValueCalculator.baseValue() はこれと同じ結果を返す必要がある。

usage:
    python3 tools/seat_value_report.py [layout.json] [--season summer|winter|spring|autumn]
"""
import argparse
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_LAYOUT = ROOT / "data" / "seat_layouts" / "standard_6x5.json"


def match(cond: dict, value: int) -> bool:
    """when 節のミニ DSL（eq / gte / lte / in）を評価する。"""
    if "eq" in cond and value != cond["eq"]:
        return False
    if "gte" in cond and value < cond["gte"]:
        return False
    if "lte" in cond and value > cond["lte"]:
        return False
    if "in" in cond and value not in cond["in"]:
        return False
    return True


def seat_tags(layout: dict, col: int, row: int) -> list:
    tags = []
    for rule in layout["tagRules"]:
        when = rule.get("when", {})
        if "col" in when and not match(when["col"], col):
            continue
        if "row" in when and not match(when["row"], row):
            continue
        tags.append(rule)
    return tags


def base_value(layout: dict, col: int, row: int, season: str) -> float:
    total = layout.get("baseValue", 50)
    for rule in seat_tags(layout, col, row):
        weight = rule["weight"]
        if "seasonal" in rule and season in rule["seasonal"]:
            weight = rule["seasonal"][season]
        total += weight
    return max(0.0, min(100.0, float(total)))


def bar(v: float) -> str:
    blocks = " ░▒▓█"
    return blocks[min(4, int(v / 20.01))]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("layout", nargs="?", default=str(DEFAULT_LAYOUT))
    ap.add_argument("--season", default="summer",
                    choices=["spring", "summer", "autumn", "winter"])
    args = ap.parse_args()

    layout = json.loads(pathlib.Path(args.layout).read_text(encoding="utf-8"))
    cols, rows = layout["cols"], layout["rows"]

    print(f"# {layout.get('name', layout['id'])}  season={args.season}")
    print("  [黒板 / 教卓]")
    values = {}
    for row in range(rows):
        cells = []
        for col in range(cols):
            v = base_value(layout, col, row, args.season)
            values[(col, row)] = v
            cells.append(f"{bar(v)}{v:5.1f}")
        label = "最前列" if row == 0 else ("最後列" if row == rows - 1 else f"row{row} ")
        print(f"  {' '.join(cells)}   {label}")
    print("  [出入口]" + " " * (cols * 7 - 18) + "[窓・エアコン]")

    ranked = sorted(values.items(), key=lambda kv: -kv[1])
    print("\n## 上位5席")
    for (col, row), v in ranked[:5]:
        tags = ",".join(r["tag"] for r in seat_tags(layout, col, row))
        print(f"  ({col},{row})  {v:5.1f}  [{tags}]")
    print("\n## 下位3席")
    for (col, row), v in ranked[-3:]:
        tags = ",".join(r["tag"] for r in seat_tags(layout, col, row))
        print(f"  ({col},{row})  {v:5.1f}  [{tags}]")

    top, second = ranked[0][1], ranked[1][1]
    print(f"\n## 玉座の突出度: {top - second:+.1f}  "
          f"({'OK: 争点が1つに定まる' if top - second >= 6 else 'NG: 玉座が曖昧。tagRule を調整せよ'})")


if __name__ == "__main__":
    main()
