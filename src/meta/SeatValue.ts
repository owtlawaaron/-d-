import type { Condition, SeatLayout, Season, TagRule } from '../data/types';

export interface Seat {
  index: number;
  col: number;
  row: number;
  tags: string[];
  /** 教室フェーズのワールド座標（等倍） */
  x: number;
  z: number;
}

function matches(cond: Condition | undefined, value: number): boolean {
  if (!cond) return true;
  if (cond.eq !== undefined && value !== cond.eq) return false;
  if (cond.gte !== undefined && value < cond.gte) return false;
  if (cond.lte !== undefined && value > cond.lte) return false;
  if (cond.in !== undefined && !cond.in.includes(value)) return false;
  return true;
}

/**
 * 席価値の計算（docs/02）。
 * tools/seat_value_report.py と同じ結果を返す必要がある。
 */
export class SeatValueCalculator {
  readonly seats: Seat[] = [];

  constructor(private readonly layout: SeatLayout, private season: Season = 'summer') {
    let index = 0;
    for (let row = 0; row < layout.rows; row++) {
      for (let col = 0; col < layout.cols; col++) {
        this.seats.push({
          index: index++,
          col,
          row,
          tags: this.rulesFor(col, row).map((r) => r.tag),
          x: layout.origin.x + col * layout.pitch.x,
          z: layout.origin.z + row * layout.pitch.z,
        });
      }
    }
  }

  setSeason(season: Season): void {
    this.season = season;
  }

  private rulesFor(col: number, row: number): TagRule[] {
    return this.layout.tagRules.filter(
      (r) => matches(r.when.col, col) && matches(r.when.row, row),
    );
  }

  /** 全員に共通の客観的な席価値（0〜100）。 */
  baseValue(seat: Seat): number {
    let total = this.layout.baseValue ?? 50;
    for (const rule of this.rulesFor(seat.col, seat.row)) {
      const seasonal = rule.seasonal?.[this.season];
      total += seasonal ?? rule.weight;
    }
    return Math.max(0, Math.min(100, total));
  }

  tagLabels(seat: Seat): string[] {
    return this.rulesFor(seat.col, seat.row).map((r) => r.label ?? r.tag);
  }

  seatAt(col: number, row: number): Seat {
    return this.seats[row * this.layout.cols + col];
  }

  get cols(): number { return this.layout.cols; }
  get rows(): number { return this.layout.rows; }
}
