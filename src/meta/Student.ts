import type { StudentDef, StudentStats } from '../data/types';
import type { Seat } from './SeatValue';

/** 1試合ぶんではなく、学期を通して持ち越す生徒の状態。 */
export class Student {
  seat!: Seat;
  conduct: number;
  frustration = 0;
  cooldown = 0;
  wins = 0;
  losses = 0;
  turnsSinceLastWin = 0;
  readonly grudges = new Map<string, number>();

  constructor(readonly def: StudentDef, conductStart: number, readonly isPlayer: boolean) {
    this.conduct = conductStart;
  }

  get id(): string { return this.def.id; }
  get name(): string { return this.def.name; }
  get stats(): StudentStats { return this.def.stats; }

  get maxHp(): number { return 100 + this.stats.stamina * 5; }
  get moveSpeed(): number { return 4.4 + this.stats.athletics * 0.12; }
  get reloadScale(): number { return 1.2 - this.stats.academics * 0.02; }
  get recoilScale(): number { return 1.15 - this.stats.nerve * 0.015; }
  /** 「自分はこの程度の席に座って当然」という自己評価。 */
  get expectedSeat(): number {
    const s = this.stats;
    return 40 + (s.academics + s.athletics + s.charisma) * 2;
  }

  grudgeTo(id: string): number { return this.grudges.get(id) ?? 0; }

  addGrudge(id: string, amount: number): void {
    this.grudges.set(id, Math.min(100, this.grudgeTo(id) + amount));
  }

  decayGrudges(amount: number): void {
    for (const [id, v] of this.grudges) {
      const next = v - amount;
      if (next <= 0) this.grudges.delete(id);
      else this.grudges.set(id, next);
    }
  }

  isFriend(id: string): boolean { return this.def.friends?.includes(id) ?? false; }
  isRival(id: string): boolean { return this.def.rivals?.includes(id) ?? false; }
}
