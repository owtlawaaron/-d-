#!/usr/bin/env python3
"""1v1 攻防戦のバランス検証と、抽象戦闘モデルの係数調整。

2つのモデルを持つ:
  A) 時間発展シミュレーション  … docs/03 のルール（90秒・クリスタル1000・リスポーン）を
                                 1秒刻みで回す。勝率・決着時間・時間切れ率を出す。
  B) 閉形式の winChance        … docs/02 §2.5 の式。NPC 同士の対戦を即決着させるのに使う。

B の DEFENDER_ADVANTAGE を、A の実測勝率に一致するよう二分探索で求める。

usage:
    python3 tools/balance_sim.py                 # 標準設定で検証
    python3 tools/balance_sim.py --trials 200000
"""
import argparse
import json
import pathlib
import random
import statistics

ROOT = pathlib.Path(__file__).resolve().parent.parent
RULES = json.loads((ROOT / "data" / "battle_rules.json").read_text(encoding="utf-8"))

K = RULES["abstractDuel"]["exponentK"]          # 閉形式モデルの実力差強調係数
TARGET_LO, TARGET_HI = RULES["abstractDuel"]["targetAttackerWinRate"]

# --- 能力値 → 抽象パワー（docs/02 §2.5） -----------------------------------

def atk_power(s: dict, weapon_atk: float = 1.0) -> float:
    return (s["athletics"] * 1.0 + s["nerve"] * 1.2 + s["academics"] * 0.5) * weapon_atk


def def_power(s: dict, weapon_def: float = 1.0, advantage: float = 8.0) -> float:
    return (s["stamina"] * 1.1 + s["nerve"] * 1.0 + s["academics"] * 0.8) * weapon_def + advantage


def win_chance(atk: dict, dfd: dict, advantage: float) -> float:
    """B) 閉形式。攻め側の勝率を返す。"""
    a = atk_power(atk) ** K
    d = def_power(dfd, advantage=advantage) ** K
    return a / (a + d)


# --- A) 時間発展シミュレーション --------------------------------------------

CRYSTAL_HP = RULES["crystal"]["hp"]
MATCH_TIME = int(RULES["matchDuration"])
LATE_WINDOW = RULES["crystal"]["lateGameWindow"]
LATE_MULT = RULES["crystal"]["lateGameDamageMultiplier"]
ATK_RESPAWNS = RULES["attacker"]["respawns"]
ATK_DELAY = int(RULES["attacker"]["respawnDelay"])
DEF_RESPAWNS = RULES["defender"]["respawns"]
DEF_DELAY = int(RULES["defender"]["respawnDelay"])
SHIELD = RULES["defender"]["crystalShieldWhileDead"]

SIM = RULES["abstractDuel"]["simulation"]
WINDOW_DPS = SIM["crystalDps"]        # クリスタルに通る実効 DPS（チョークSMG 80dps × 0.6）
SIM_K = SIM["controlExponent"]        # シミュレーション側の制圧率の実力差係数（閉形式とは別物）
P_BREAKTHROUGH = SIM["breakthroughChance"]   # 制圧中に射線を通せる確率／秒
ATK_DEATH_P = SIM["attackerDeathChance"]     # 制圧に失敗した1秒あたりの攻め側の被撃破率
DEF_DEATH_P = SIM["defenderDeathChance"]     # 制圧中の1秒あたりの守り側の被撃破率


def simulate(atk: dict, dfd: dict, rng: random.Random) -> tuple:
    """1試合を1秒刻みで回す。(attacker_won, elapsed, timed_out) を返す。

    毎秒の流れ:
      攻めがダウン中          → 何も起きない
      守りがダウン中          → クリスタルにシールド越し(x0.5)のダメージ
      攻めが制圧に成功(p_control)
          → 確率 P_BREAKTHROUGH で射線が通りクリスタルにダメージ
          → 通らなければ守りを削る（DEF_DEATH_P で撃破）
      制圧に失敗              → ATK_DEATH_P で攻めが撃破される
    守りがリスポーンを使い切って倒れた場合、クリスタルは無防備になるが
    試合は続く（攻めは時間内に破壊しきる必要がある）。
    """
    a = atk_power(atk)
    d = def_power(dfd, advantage=0.0)      # 時間圧はルール側で表現するので加算しない
    p_control = a ** SIM_K / (a ** SIM_K + d ** SIM_K)

    hp = CRYSTAL_HP
    atk_respawns, def_respawns = ATK_RESPAWNS, DEF_RESPAWNS
    atk_down, def_down = 0, 0

    for t in range(MATCH_TIME):
        mult = LATE_MULT if MATCH_TIME - t <= LATE_WINDOW else 1.0
        if atk_down > 0:
            atk_down -= 1
            continue
        if def_down > 0:
            def_down -= 1
            hp -= WINDOW_DPS * SHIELD * mult
        elif rng.random() < p_control:
            if rng.random() < P_BREAKTHROUGH:
                hp -= WINDOW_DPS * mult
            elif rng.random() < DEF_DEATH_P:
                if def_respawns > 0:
                    def_respawns -= 1
                    def_down = DEF_DELAY
                else:
                    def_down = MATCH_TIME          # 以降ずっと不在（クリスタル無防備）
        else:
            if rng.random() < ATK_DEATH_P:
                if atk_respawns > 0:
                    atk_respawns -= 1
                    atk_down = ATK_DELAY
                else:
                    return (False, t + 1, False)   # 攻めのリスポーン枯渇 → 守り勝ち
        if hp <= 0:
            return (True, t + 1, False)
    return (False, MATCH_TIME, True)


def run(atk: dict, dfd: dict, trials: int, seed: int = 1) -> dict:
    rng = random.Random(seed)
    wins, times, timeouts = 0, [], 0
    for _ in range(trials):
        won, t, to = simulate(atk, dfd, rng)
        wins += won
        timeouts += to
        times.append(t)
    return {
        "winRate": wins / trials,
        "avgTime": statistics.mean(times),
        "timeoutRate": timeouts / trials,
    }


def stats(a: int, n: int, ac: int, c: int, st: int) -> dict:
    return {"athletics": a, "nerve": n, "academics": ac, "charisma": c, "stamina": st}


def fit_model(samples: list) -> tuple:
    """B) 閉形式の K と DEFENDER_ADVANTAGE を A) の実測値に同時フィットする。

    samples: [(attackerStats, defenderStats, measuredWinRate), ...]
    戻り値:  (K, advantage, rmse)
    """
    best = None
    k = 1.0
    while k <= 4.0:
        adv = 0.0
        while adv <= 25.0:
            err = 0.0
            for a, d, target in samples:
                x = atk_power(a) ** k
                y = def_power(d, advantage=adv) ** k
                err += (x / (x + y) - target) ** 2
            if best is None or err < best[0]:
                best = (err, round(k, 3), round(adv, 2))
            adv += 0.05
        k += 0.01
    err, k, adv = best
    return k, adv, (err / len(samples)) ** 0.5


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--trials", type=int, default=50000)
    args = ap.parse_args()

    even = stats(6, 6, 6, 6, 6)
    strong = stats(8, 9, 7, 6, 8)     # 能力差 +3 相当
    weak = stats(4, 4, 5, 6, 5)

    cases = [("互角", even, even), ("攻め有利(+3)", strong, even), ("攻め不利(-3)", weak, even)]
    print(f"# 時間発展シミュレーション  trials={args.trials}\n")
    print(f"{'ケース':<16}{'攻め勝率':>10}{'平均決着':>10}{'時間切れ率':>12}")
    results = {}
    for label, a, d in cases:
        r = run(a, d, args.trials)
        results[label] = r
        print(f"{label:<16}{r['winRate']*100:9.1f}%{r['avgTime']:9.1f}s{r['timeoutRate']*100:11.1f}%")

    samples = [(a, d, results[label]["winRate"]) for label, a, d in cases]
    k, adv, rmse = fit_model(samples)
    even_rate = results["互角"]["winRate"]
    print("\n# 抽象モデルの較正（NPC同士の対戦を即決着させる閉形式）")
    print(f"  K = {k:.2f}  (設定値 {K})")
    print(f"  DEFENDER_ADVANTAGE = {adv:.2f}  (設定値 {RULES['abstractDuel']['defenderAdvantage']})")
    print(f"  RMSE = {rmse*100:.2f}pt")
    for label, a, d in cases:
        x = atk_power(a) ** k
        y = def_power(d, advantage=adv) ** k
        print(f"  {label:<14} 閉形式 {x/(x+y)*100:5.1f}%  実測 {results[label]['winRate']*100:5.1f}%")

    print("\n# 合格判定（docs/06 §6.5）")
    checks = [
        (f"互角の攻め勝率 {even_rate*100:.1f}% が {TARGET_LO*100:.0f}〜{TARGET_HI*100:.0f}%",
         TARGET_LO <= even_rate <= TARGET_HI),
        (f"平均決着 {results['互角']['avgTime']:.1f}s が 55〜75s",
         55 <= results["互角"]["avgTime"] <= 75),
        (f"時間切れ率 {results['互角']['timeoutRate']*100:.1f}% が 25〜35%",
         0.25 <= results["互角"]["timeoutRate"] <= 0.35),
        (f"+3 の攻め勝率 {results['攻め有利(+3)']['winRate']*100:.1f}% が 60〜68%",
         0.60 <= results["攻め有利(+3)"]["winRate"] <= 0.68),
    ]
    for label, ok in checks:
        print(f"  [{'PASS' if ok else 'FAIL'}] {label}")


if __name__ == "__main__":
    main()
