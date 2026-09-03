import type { BattleRules } from '../data/types';
import type { DataRegistry } from '../data/registry';
import type { Rng } from '../core/Rng';
import type { Classroom } from './Classroom';
import type { Student } from './Student';

export interface Challenge {
  attacker: Student;
  defender: Student;
  /** 攻め側から見た推定勝率（0〜1） */
  winChance: number;
  reason: string;
}

export interface DuelOutcome {
  challenge: Challenge;
  attackerWon: boolean;
  /** 3D戦闘の結果か、抽象モデルによる即決着か */
  simulated: boolean;
}

function atkPower(s: Student, weaponAtk: number): number {
  const st = s.stats;
  return (st.athletics * 1.0 + st.nerve * 1.2 + st.academics * 0.5) * weaponAtk;
}

function defPower(s: Student, weaponDef: number, advantage: number): number {
  const st = s.stats;
  return (st.stamina * 1.1 + st.nerve * 1.0 + st.academics * 0.8) * weaponDef + advantage;
}

/**
 * 挑戦の発生と、NPC同士の対戦の即決着（docs/02 §2.5）。
 * K と DEFENDER_ADVANTAGE は tools/balance_sim.py が
 * 時間発展シミュレーションにフィットした値を JSON から読む。
 */
export class ChallengeSystem {
  constructor(
    private readonly reg: DataRegistry,
    private readonly rules: BattleRules,
    private readonly rng: Rng,
  ) {}

  private ratings(s: Student): { atk: number; def: number } {
    const id = s.def.loadout?.primary;
    const w = id ? this.reg.weapons.get(id) : undefined;
    return { atk: w?.atkRating ?? 1, def: w?.defRating ?? 1 };
  }

  /** 攻め側の推定勝率。 */
  winChance(attacker: Student, defender: Student): number {
    const { exponentK: k, defenderAdvantage: adv } = this.rules.abstractDuel;
    const a = Math.pow(atkPower(attacker, this.ratings(attacker).atk), k);
    const d = Math.pow(defPower(defender, this.ratings(defender).def, adv), k);
    return a / (a + d);
  }

  /** 挑戦できる状態か。 */
  canChallenge(room: Classroom, s: Student): boolean {
    return s.cooldown <= 0 && s.conduct > this.rules.meta.conductCostChallenge
      && room.perceivedValue(s, s.seat) < 100;
  }

  /** 性格ごとの重みで相手を選ぶ（utility scoring）。 */
  pickTarget(room: Classroom, attacker: Student): Challenge | null {
    const p = this.reg.personality(attacker.def.personality);
    const myValue = room.perceivedValue(attacker, attacker.seat);
    let best: Challenge | null = null;
    let bestScore = -Infinity;

    for (const target of room.students) {
      if (target === attacker) continue;
      const gain = room.perceivedValue(attacker, target.seat) - myValue;
      if (gain <= 2) continue;
      const win = this.winChance(attacker, target);
      const grudge = attacker.grudgeTo(target.id);
      const friend = attacker.isFriend(target.id) ? 40 : 0;
      const score =
        gain * p.weights.value +
        win * 100 * p.weights.winChance +
        grudge * p.weights.grudge -
        friend * p.weights.friendship;
      if (score > bestScore) {
        bestScore = score;
        best = {
          attacker,
          defender: target,
          winChance: win,
          reason: grudge > 30 ? '遺恨' : gain > 25 ? '席の価値差' : '勝てると踏んだ',
        };
      }
    }
    return best;
  }

  /** 1ターンぶんの挑戦を組み立てる。プレイヤーの分は含めない。 */
  buildQueue(room: Classroom): Challenge[] {
    const queue: Challenge[] = [];
    const busy = new Set<string>();
    const candidates = room.students
      .filter((s) => !s.isPlayer && this.canChallenge(room, s))
      .filter((s) => s.frustration >= this.reg.personality(s.def.personality).challengeThreshold)
      .sort((a, b) => b.frustration - a.frustration);

    for (const attacker of candidates) {
      if (queue.length >= this.rules.meta.maxChallengesPerTurn) break;
      if (busy.has(attacker.id)) continue;
      const challenge = this.pickTarget(room, attacker);
      if (!challenge || busy.has(challenge.defender.id)) continue;
      busy.add(attacker.id);
      busy.add(challenge.defender.id);
      queue.push(challenge);
    }
    return queue;
  }

  /** NPC同士の対戦を確率で即決着させる。 */
  resolveAbstract(challenge: Challenge): DuelOutcome {
    return {
      challenge,
      attackerWon: this.rng.next() < challenge.winChance,
      simulated: true,
    };
  }

  /** 勝敗を教室に反映する（席の交換・素行点・遺恨）。 */
  applyOutcome(room: Classroom, outcome: DuelOutcome): void {
    const meta = this.rules.meta;
    const { attacker, defender } = outcome.challenge;
    attacker.conduct -= meta.conductCostChallenge;

    if (outcome.attackerWon) {
      room.swapSeats(attacker, defender);
      attacker.conduct -= meta.conductCostWin;
      attacker.wins++;
      attacker.turnsSinceLastWin = 0;
      attacker.grudges.delete(defender.id);
      defender.losses++;
      defender.addGrudge(attacker.id, meta.grudgeOnLoss);
    } else {
      attacker.conduct -= meta.conductCostLose;
      attacker.cooldown = meta.loserCooldownTurns;
      attacker.frustration = 0;
      attacker.losses++;
      attacker.addGrudge(defender.id, meta.grudgeOnLoss);
      defender.wins++;
      defender.turnsSinceLastWin = 0;
    }
    attacker.conduct = Math.max(0, attacker.conduct);
    room.refreshFrustration();
  }
}
