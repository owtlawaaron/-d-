import type { BattleRules, Season } from '../data/types';
import type { DataRegistry } from '../data/registry';
import { Rng } from '../core/Rng';
import { SeatValueCalculator, type Seat } from './SeatValue';
import { Student } from './Student';

/** 教室ぜんぶ。席の割り当て、席価値、不満度、遺恨の一元管理。 */
export class Classroom {
  readonly calc: SeatValueCalculator;
  readonly students: Student[] = [];
  readonly bySeat = new Map<number, Student>();
  player!: Student;
  turn = 1;

  constructor(
    private readonly reg: DataRegistry,
    private readonly rules: BattleRules,
    private readonly rng: Rng,
    season: Season = 'summer',
    playerId?: string,
  ) {
    const layout = reg.seatLayouts.get('standard_6x5') ?? [...reg.seatLayouts.values()][0];
    this.calc = new SeatValueCalculator(layout, season);

    const capacity = this.calc.seats.length;
    const defs = reg.students.slice(0, capacity);
    const chosen = playerId ?? defs.find((d) => d.playable)?.id ?? defs[0].id;
    for (const def of defs) {
      this.students.push(new Student(def, rules.meta.conductStart, def.id === chosen));
    }
    this.player = this.students.find((s) => s.isPlayer)!;
    this.shuffleSeats();
  }

  /** 席替え抽選。全席をランダムに配り直す。 */
  shuffleSeats(): void {
    const seats = this.rng.shuffle([...this.calc.seats]);
    this.bySeat.clear();
    this.students.forEach((s, i) => {
      s.seat = seats[i];
      this.bySeat.set(seats[i].index, s);
    });
    this.refreshFrustration();
  }

  studentAt(seat: Seat): Student | undefined {
    return this.bySeat.get(seat.index);
  }

  /** 主観的席価値。好みと友人の隣接で ±15 まで補正する（docs/02 §2.3）。 */
  perceivedValue(student: Student, seat: Seat): number {
    const base = this.calc.baseValue(seat);
    let bonus = 0;
    const prefs = student.def.preferences ?? {};
    for (const tag of seat.tags) bonus += prefs[tag] ?? 0;
    bonus += this.socialBonus(student, seat);
    bonus = Math.max(-15, Math.min(15, bonus));
    return Math.max(0, Math.min(100, base + bonus));
  }

  private socialBonus(student: Student, seat: Seat): number {
    let bonus = 0;
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (dc === 0 && dr === 0) continue;
        const col = seat.col + dc;
        const row = seat.row + dr;
        if (col < 0 || row < 0 || col >= this.calc.cols || row >= this.calc.rows) continue;
        const neighbour = this.bySeat.get(this.calc.seatAt(col, row).index);
        if (!neighbour || neighbour === student) continue;
        if (student.isFriend(neighbour.id)) bonus += 4;
        if (student.isRival(neighbour.id)) bonus -= 6;
      }
    }
    return Math.max(-12, Math.min(12, bonus));
  }

  /** 不満度（docs/02 §2.4）。 */
  frustrationOf(student: Student): number {
    const gap = student.expectedSeat - this.perceivedValue(student, student.seat);
    const pride = this.reg.personality(student.def.personality).prideScale;
    let grudgeTotal = 0;
    for (const v of student.grudges.values()) grudgeTotal += v;
    const conductPenalty = Math.max(0, (this.rules.meta.conductStart - student.conduct) * 0.25);
    const raw = gap * pride + grudgeTotal * 0.35 + student.turnsSinceLastWin * 3 - conductPenalty;
    return Math.max(0, Math.min(100, raw));
  }

  refreshFrustration(): void {
    for (const s of this.students) s.frustration = this.frustrationOf(s);
  }

  /** 席を入れ替える（追い出しではなく交換）。 */
  swapSeats(a: Student, b: Student): void {
    const seatA = a.seat;
    const seatB = b.seat;
    a.seat = seatB;
    b.seat = seatA;
    this.bySeat.set(seatA.index, b);
    this.bySeat.set(seatB.index, a);
    this.refreshFrustration();
  }

  /** 席価値の降順ランキング（客観値）。 */
  ranking(): { seat: Seat; value: number; student?: Student }[] {
    return this.calc.seats
      .map((seat) => ({ seat, value: this.calc.baseValue(seat), student: this.studentAt(seat) }))
      .sort((a, b) => b.value - a.value);
  }
}
