#!/usr/bin/env python3
"""data/ と addons/ の全 JSON を schemas/ の JSON Schema で検証する（CI 用）。

jsonschema が入っていれば完全検証、無ければ JSON の構文チェックのみ行う。
    pip install jsonschema

usage:
    python3 tools/schema_check.py
終了コード: 0 = 全て OK / 1 = 検証エラーあり
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# データのグロブ → 対応するスキーマ
MAPPING = [
    ("data/seat_layouts/*.json", "seat_layout.schema.json"),
    ("data/students/*roster*.json", "student.schema.json"),
    ("data/students/personalities.json", "personality.schema.json"),
    ("data/weapons/*.json", "weapon.schema.json"),
    ("data/arenas/classroom*.json", "arena.schema.json"),
    ("addons/*/manifest.json", "manifest.schema.json"),
]


def load(path: pathlib.Path):
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    try:
        from jsonschema import Draft202012Validator
    except ImportError:
        Draft202012Validator = None
        print("! jsonschema 未インストール: 構文チェックのみ実行します "
              "(pip install jsonschema)\n")

    failures = 0
    checked = 0
    for pattern, schema_name in MAPPING:
        schema_path = ROOT / "schemas" / schema_name
        schema = load(schema_path)
        validator = Draft202012Validator(schema) if Draft202012Validator else None
        for path in sorted(ROOT.glob(pattern)):
            checked += 1
            rel = path.relative_to(ROOT)
            try:
                doc = load(path)
            except json.JSONDecodeError as e:
                print(f"[FAIL] {rel}: JSON 構文エラー {e}")
                failures += 1
                continue
            if validator is None:
                print(f"[ OK ] {rel}  (構文のみ)")
                continue
            errors = sorted(validator.iter_errors(doc), key=lambda e: list(e.path))
            if errors:
                failures += 1
                print(f"[FAIL] {rel}  ({schema_name})")
                for e in errors[:8]:
                    loc = "/".join(str(x) for x in e.path) or "(root)"
                    print(f"        {loc}: {e.message}")
            else:
                print(f"[ OK ] {rel}  ({schema_name})")

    # スキーマから漏れているデータファイルを検出する
    covered = {p for pattern, _ in MAPPING for p in ROOT.glob(pattern)}
    for path in sorted(ROOT.glob("data/**/*.json")):
        if path not in covered and path.name not in ("battle_rules.json", "genesis_default.json"):
            print(f"[WARN] {path.relative_to(ROOT)} はどのスキーマにも紐づいていません")

    print(f"\n検証: {checked} ファイル / 失敗 {failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
