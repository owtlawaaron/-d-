import type {
  AddonManifest, ArenaDef, BattleRules, Personality, PersonalityId,
  SeatLayout, StudentDef, WeaponDef,
} from './types';

/**
 * data/ と addons/ の JSON を集めてレジストリを組み立てる。
 *
 * Vite の import.meta.glob でビルド時に静的解決するため、実行時の fetch は不要。
 * addons/ に JSON を置いて再ビルドすれば、そのまま武器や教室が増える。
 * 同一 id は「後に読んだパックが勝ち」、manifest の overrides は深いマージで適用する。
 */
const vanillaFiles = import.meta.glob('/data/**/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const addonFiles = import.meta.glob('/addons/**/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 配列は置換、オブジェクトは再帰マージ（docs/06 §6.2）。 */
function deepMerge<T>(base: T, patch: Record<string, unknown>): T {
  const out = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    const cur = out[k];
    out[k] = isRecord(v) && isRecord(cur) ? deepMerge(cur, v) : v;
  }
  return out as T;
}

export interface LoadIssue {
  source: string;
  message: string;
}

export class DataRegistry {
  readonly seatLayouts = new Map<string, SeatLayout>();
  readonly students: StudentDef[] = [];
  readonly weapons = new Map<string, WeaponDef>();
  readonly arenas = new Map<string, ArenaDef>();
  readonly personalities = new Map<PersonalityId, Personality>();
  readonly issues: LoadIssue[] = [];
  battleRules!: BattleRules;
  genesisTimeline: unknown = null;

  static load(): DataRegistry {
    const reg = new DataRegistry();
    reg.ingest(vanillaFiles, 'vanilla');
    reg.ingestAddons();
    reg.validate();
    return reg;
  }

  private ingest(files: Record<string, unknown>, source: string): void {
    for (const [path, doc] of Object.entries(files)) {
      if (path.endsWith('manifest.json')) continue;
      try {
        this.ingestOne(path, doc);
      } catch (err) {
        this.issues.push({ source, message: `${path}: ${(err as Error).message}` });
      }
    }
  }

  private ingestOne(path: string, doc: unknown): void {
    if (!isRecord(doc)) throw new Error('オブジェクトではありません');

    if (Array.isArray(doc.weapons)) {
      for (const w of doc.weapons as WeaponDef[]) this.weapons.set(w.id, w);
      return;
    }
    if (Array.isArray(doc.personalities)) {
      for (const p of doc.personalities as Personality[]) this.personalities.set(p.id, p);
      return;
    }
    if (Array.isArray(doc.roster)) {
      for (const s of doc.roster as StudentDef[]) {
        const idx = this.students.findIndex((x) => x.id === s.id);
        if (idx >= 0) this.students[idx] = s;
        else this.students.push(s);
      }
      return;
    }
    if (Array.isArray(doc.tagRules)) {
      const layout = doc as unknown as SeatLayout;
      this.seatLayouts.set(layout.id, layout);
      return;
    }
    if (Array.isArray(doc.waypoints)) {
      const arena = doc as unknown as ArenaDef;
      this.arenas.set(arena.id, arena);
      return;
    }
    if (typeof doc.matchDuration === 'number') {
      this.battleRules = doc as unknown as BattleRules;
      return;
    }
    if (Array.isArray(doc.tracks)) {
      this.genesisTimeline = doc;
      return;
    }
    if (!path.includes('addons/')) {
      this.issues.push({ source: 'vanilla', message: `${path}: 種別を判定できませんでした` });
    }
  }

  private ingestAddons(): void {
    const manifests: { dir: string; manifest: AddonManifest }[] = [];
    for (const [path, doc] of Object.entries(addonFiles)) {
      if (!path.endsWith('/manifest.json')) continue;
      const manifest = doc as AddonManifest;
      if (manifest.enabled === false) continue; // 同梱したまま無効化できる
      manifests.push({ dir: path.slice(0, path.lastIndexOf('/')), manifest });
    }
    // loadAfter を尊重した簡易トポロジカルソート（vanilla は常に先に読み込み済み）
    manifests.sort((a, b) => {
      if (a.manifest.loadAfter?.includes(b.manifest.id)) return 1;
      if (b.manifest.loadAfter?.includes(a.manifest.id)) return -1;
      return a.manifest.id.localeCompare(b.manifest.id);
    });

    for (const { dir, manifest } of manifests) {
      const before = this.issues.length;
      for (const list of Object.values(manifest.provides ?? {})) {
        for (const rel of list) {
          const full = `${dir}/${rel}`;
          const doc = addonFiles[full];
          if (doc === undefined) {
            this.issues.push({ source: manifest.id, message: `${rel} が見つかりません` });
            continue;
          }
          try {
            this.ingestOne(full, doc);
          } catch (err) {
            this.issues.push({ source: manifest.id, message: `${rel}: ${(err as Error).message}` });
          }
        }
      }
      this.applyOverrides(manifest);
      if (this.issues.length > before) {
        this.issues.push({ source: manifest.id, message: 'このパックは一部が読み込めませんでした' });
      }
    }
  }

  private applyOverrides(manifest: AddonManifest): void {
    for (const [category, byId] of Object.entries(manifest.overrides ?? {})) {
      for (const [id, patch] of Object.entries(byId)) {
        if (category === 'weapons') {
          const cur = this.weapons.get(id);
          if (cur) this.weapons.set(id, deepMerge(cur, patch));
        } else if (category === 'seat_layouts') {
          const cur = this.seatLayouts.get(id);
          if (cur) this.seatLayouts.set(id, deepMerge(cur, patch));
        }
      }
    }
  }

  /** 参照切れを起動時に検出する（実行時に落とさないため）。 */
  private validate(): void {
    if (!this.battleRules) this.issues.push({ source: 'vanilla', message: 'battle_rules.json がありません' });
    for (const s of this.students) {
      if (!this.personalities.has(s.personality)) {
        this.issues.push({ source: 'vanilla', message: `${s.id}: 未知の性格 ${s.personality}` });
      }
      for (const wid of [s.loadout?.primary, s.loadout?.secondary]) {
        if (wid && !this.weapons.has(wid)) {
          this.issues.push({ source: 'vanilla', message: `${s.id}: 未知の武器 ${wid}` });
        }
      }
    }
  }

  weapon(id: string): WeaponDef {
    const w = this.weapons.get(id);
    if (!w) throw new Error(`weapon not found: ${id}`);
    return w;
  }

  personality(id: PersonalityId): Personality {
    const p = this.personalities.get(id);
    if (!p) throw new Error(`personality not found: ${id}`);
    return p;
  }
}
