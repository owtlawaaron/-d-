import * as THREE from 'three';
import { audio } from '../core/Audio';
import type { Seat } from '../meta/SeatValue';
import type { Student } from '../meta/Student';
import type { Arena } from './ArenaBuilder';
import type { Crystal } from './Crystal';

export interface GenesisContext {
  attacker: Student;
  defender: Student;
  defenderSeat: Seat;
  playerRole: 'ATTACK' | 'DEFEND';
}

const DURATION = 5.0;

/**
 * 5秒のアリーナ生成演出（docs/05）。
 * data/arenas/genesis_default.json のタイムラインを、
 * カメラ・机のせり上がり・クリスタル降臨・彩度に割り当てる。
 */
export class Genesis {
  private t = 0;
  private done = false;
  private cutin: HTMLElement | null = null;
  private ring: THREE.Mesh;
  private pillar: THREE.Mesh;
  private cues = new Set<string>();
  private ctx!: GenesisContext;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly arena: Arena,
    private readonly crystal: Crystal,
    private readonly group: THREE.Group,
    private readonly bounds: { x: number; y: number; z: number },
  ) {
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 0.9, 48),
      new THREE.MeshBasicMaterial({ color: 0x6fd8ff, transparent: true, opacity: 0, side: THREE.DoubleSide }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.04;
    this.pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 12, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x8fe4ff, transparent: true, opacity: 0, side: THREE.DoubleSide }),
    );
    this.group.add(this.ring, this.pillar);
  }

  begin(ctx: GenesisContext): void {
    this.ctx = ctx;
    this.t = 0;
    this.done = false;
    this.cues.clear();
    this.arena.setGenesisProgress(0);
    this.crystal.scaleAnim = 0;
    this.ring.position.set(this.crystal.position.x, 0.04, this.crystal.position.z);
    this.pillar.position.set(this.crystal.position.x, 6, this.crystal.position.z);
    this.setFilter('saturate(0.35) contrast(1.06)');
    this.buildCutin();
  }

  /** 進行させる。演出が終わったら true。 */
  update(dt: number, skip: boolean): boolean {
    if (this.done) return true;
    this.t += skip ? DURATION : dt;
    const t = Math.min(this.t, DURATION);

    // 机・什器のせり上がり: 0.9s → 2.6s
    this.arena.setGenesisProgress(clamp01((t - 0.9) / 1.7));

    // スキャンリング: 0.5s → 1.5s
    const scan = clamp01((t - 0.5) / 1.0);
    const ringMat = this.ring.material as THREE.MeshBasicMaterial;
    ringMat.opacity = scan > 0 && scan < 1 ? 0.75 * (1 - scan) : 0;
    this.ring.scale.setScalar(0.5 + scan * 22);

    // クリスタル降臨: 2.7s → 3.5s
    const cs = clamp01((t - 2.7) / 0.8);
    this.crystal.scaleAnim = cs < 1 ? easeOutBack(cs) : 1;
    const pillarMat = this.pillar.material as THREE.MeshBasicMaterial;
    pillarMat.opacity = cs > 0 && cs < 1 ? 0.5 * (1 - cs) : 0;

    // 彩度の復帰: 3.6s → 4.4s（最後の 0.6 秒は完成したアリーナを見せる）
    if (t > 3.6) {
      const k = clamp01((t - 3.6) / 0.8);
      this.setFilter(`saturate(${(0.35 + 0.65 * k).toFixed(2)})`);
    }

    this.updateCamera(t);
    this.fireCues(t);
    this.updateCutin(t);

    if (t >= DURATION) {
      this.finish();
      return true;
    }
    return false;
  }

  private updateCamera(t: number): void {
    const c = this.crystal.position;
    // クリスタルから教室の中心へ向かう方向に引いていく（壁や天井を突き抜けない）
    const inward = new THREE.Vector3(-c.x, 0, -c.z);
    if (inward.lengthSq() < 0.01) inward.set(0, 0, 1);
    inward.normalize();
    const a = new THREE.Vector3(c.x, 0, c.z).addScaledVector(inward, 3.4).setY(4.6);
    const b = new THREE.Vector3(c.x, 0, c.z).addScaledVector(inward, 8.2).setY(2.4);
    this.clampInside(a);
    this.clampInside(b);
    const k = easeInOutCubic(clamp01((t - 0.4) / 4.2));
    this.camera.position.lerpVectors(a, b, k);
    this.camera.lookAt(c.x, c.y - 0.3 + k * 0.3, c.z);
  }

  /** アリーナの内側（壁と天井の手前）に押し込む。 */
  private clampInside(v: THREE.Vector3): void {
    const b = this.bounds;
    v.x = THREE.MathUtils.clamp(v.x, -b.x / 2 + 1.4, b.x / 2 - 1.4);
    v.z = THREE.MathUtils.clamp(v.z, -b.z / 2 + 1.4, b.z / 2 - 1.4);
    v.y = THREE.MathUtils.clamp(v.y, 1.2, b.y - 1.0);
  }

  private fireCues(t: number): void {
    const cue = (id: string, at: number, fn: () => void) => {
      if (t >= at && !this.cues.has(id)) {
        this.cues.add(id);
        fn();
      }
    };
    cue('scan', 0.5, () => audio.play('scan'));
    cue('crystal', 2.7, () => audio.play('crystal'));
    cue('chime', 4.55, () => audio.play('chime'));
  }

  // -------------------------------------------------------------- cut-in DOM

  private buildCutin(): void {
    const ui = document.getElementById('ui');
    if (!ui) return;
    const wrap = document.createElement('div');
    wrap.className = 'genesis-cutin';
    wrap.innerHTML = `
      <div class="cutin-card" data-side="l">
        <div class="cutin-role" style="color:#ff5a3c">CHALLENGER — 攻</div>
        <div class="cutin-name">${escapeHtml(this.ctx.attacker.name)}</div>
        <div class="cutin-seat">${seatLabel(this.ctx.attacker)} ${this.ctx.playerRole === 'ATTACK' ? '（あなた）' : ''}</div>
      </div>
      <div class="cutin-card right" data-side="r">
        <div class="cutin-role" style="color:#2aa8ff">DEFENDER — 守</div>
        <div class="cutin-name">${escapeHtml(this.ctx.defender.name)}</div>
        <div class="cutin-seat">${seatLabel(this.ctx.defender)} ${this.ctx.playerRole === 'DEFEND' ? '（あなた）' : ''}</div>
      </div>`;
    ui.appendChild(wrap);
    this.cutin = wrap;
  }

  private updateCutin(t: number): void {
    if (!this.cutin) return;
    const on = t >= 0.4 && t < 3.9;
    for (const card of Array.from(this.cutin.children)) card.classList.toggle('on', on);
  }

  finish(): void {
    if (this.done) return;
    this.done = true;
    this.arena.setGenesisProgress(1);
    this.crystal.scaleAnim = 1;
    (this.ring.material as THREE.MeshBasicMaterial).opacity = 0;
    (this.pillar.material as THREE.MeshBasicMaterial).opacity = 0;
    this.setFilter('none');
    this.cutin?.remove();
    this.cutin = null;
  }

  private setFilter(value: string): void {
    const canvas = document.getElementById('scene');
    if (canvas) canvas.style.filter = value;
  }
}

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }
function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}
function seatLabel(s: Student): string {
  return `${s.seat.col + 1}列 ${s.seat.row + 1}行目`;
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
