export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export interface Condition {
  eq?: number;
  gte?: number;
  lte?: number;
  in?: number[];
}

export interface TagRule {
  tag: string;
  label?: string;
  when: { col?: Condition; row?: Condition };
  weight: number;
  seasonal?: Partial<Record<Season, number>>;
}

export interface SeatLayout {
  id: string;
  name?: string;
  cols: number;
  rows: number;
  origin: { x: number; z: number };
  pitch: { x: number; z: number };
  baseValue?: number;
  tagRules: TagRule[];
}

export type PersonalityId =
  | 'hothead' | 'calculator' | 'loyal' | 'pacifist' | 'tyrant' | 'avenger';

export interface Personality {
  id: PersonalityId;
  label?: string;
  challengeThreshold: number;
  prideScale: number;
  weights: { value: number; winChance: number; grudge: number; friendship: number };
  npcCombat?: { aggression?: number; peekBraveryBias?: number };
}

export interface StudentStats {
  athletics: number;
  nerve: number;
  academics: number;
  charisma: number;
  stamina: number;
}

export interface StudentDef {
  id: string;
  name: string;
  playable?: boolean;
  stats: StudentStats;
  personality: PersonalityId;
  preferences?: Record<string, number>;
  friends?: string[];
  rivals?: string[];
  loadout?: { primary?: string; secondary?: string };
  appearance?: {
    hair?: string;
    hairColor?: string;
    skin?: string;
    height?: number;
  };
}

export type WeaponKind = 'hitscan' | 'projectile' | 'charge' | 'melee' | 'support';

export interface WeaponDef {
  id: string;
  name: string;
  kind: WeaponKind;
  slot?: 'primary' | 'secondary' | 'melee' | 'support';
  damage: number;
  damageMax?: number;
  chargeTime?: number;
  fireRate: number;
  magazine: number;
  reloadTime: number;
  range?: number;
  projectileSpeed?: number;
  projectileGravity?: number;
  knockback?: number;
  spread?: { base: number; perShot: number; max: number; recoverPerSec: number };
  recoil?: { vertical?: number; horizontal?: number };
  headshotMultiplier?: number;
  crystalMultiplier?: number;
  healAmount?: number;
  onHit?: { effect: string; duration?: number; magnitude?: number }[];
  atkRating?: number;
  defRating?: number;
}

export interface ColliderDef {
  type?: 'box';
  pos: [number, number, number];
  size: [number, number, number];
  tag?: string;
  penetrable?: boolean;
  hp?: number;
}

export interface ArenaDef {
  id: string;
  name?: string;
  scale: number;
  bounds: { x: number; y: number; z: number };
  colliders?: ColliderDef[];
  cover?: { source?: string; deskSize?: [number, number, number] };
  attackerSpawns: [number, number, number][];
  spawnFlipWhenDefenderRow?: { gte?: number; lte?: number };
  highGround?: ColliderDef[];
  waypoints: { id: string; pos: [number, number, number]; links: string[]; cover?: boolean; role?: string }[];
  genesisTimeline?: string;
}

export interface BattleRules {
  id: string;
  matchDuration: number;
  prepareDuration: number;
  genesisDuration: number;
  attacker: { respawns: number; respawnDelay: number };
  defender: { respawns: number; respawnDelay: number; crystalShieldWhileDead: number };
  crystal: {
    hp: number; height: number; radius: number;
    lateGameWindow: number; lateGameDamageMultiplier: number;
  };
  movement: {
    walkSpeed: number; crouchSpeed: number; baseRunSpeed: number; runSpeedPerAthletics: number;
    jumpVelocity: number; gravity: number; stepHeight: number; airControl: number; coyoteTime: number;
    slide: { duration: number; startSpeed: number; endSpeed: number; capsuleHeight: number };
    capsule: { radius: number; height: number; eyeHeight: number };
  };
  damage: {
    headMultiplier: number; legMultiplier: number;
    penetrationMultiplier: number; crystalMeleeMultiplier: number;
  };
  deployables: {
    id: string; name: string; count: number; hp?: number;
    size?: [number, number, number]; damage?: number;
    slowAmount?: number; slowDuration?: number; radius?: number; penetrable?: boolean;
  }[];
  abstractDuel: {
    defenderAdvantage: number;
    exponentK: number;
    targetAttackerWinRate: [number, number];
    simulation?: Record<string, number>;
  };
  meta: {
    turnsPerTerm: number;
    challengeTokensPerTurn: number;
    maxChallengesPerTurn: number;
    conductStart: number;
    conductCostChallenge: number;
    conductCostLose: number;
    conductCostWin: number;
    grudgeOnLoss: number;
    grudgeDecayPerTurn: number;
    loserCooldownTurns: number;
  };
}

export interface AddonManifest {
  id: string;
  name: string;
  version: string;
  loadAfter?: string[];
  provides?: Record<string, string[]>;
  overrides?: Record<string, Record<string, Record<string, unknown>>>;
}
