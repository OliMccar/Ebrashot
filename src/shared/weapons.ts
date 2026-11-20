import type { Team } from './constants';

export type WeaponId =
  | 'knife' | 'zeus'
  // pistolas
  | 'glock' | 'usp' | 'p2000' | 'p250' | 'elite' | 'tec9' | 'fiveseven' | 'cz75' | 'deagle' | 'r8'
  // submetralhadoras
  | 'mac10' | 'mp9' | 'mp7' | 'mp5sd' | 'ump45' | 'p90' | 'bizon'
  // pesadas
  | 'nova' | 'xm1014' | 'sawedoff' | 'mag7' | 'm249' | 'negev'
  // fuzis
  | 'galil' | 'famas' | 'ak47' | 'm4a1' | 'm4a1s' | 'sg553' | 'aug'
  // snipers
  | 'ssg08' | 'awp' | 'g3sg1' | 'scar20'
  // granadas e objetivo
  | 'he' | 'flash' | 'smoke' | 'molotov' | 'decoy'
  | 'c4';

export type GrenadeId = 'he' | 'flash' | 'smoke' | 'molotov' | 'decoy';
export const GRENADES: GrenadeId[] = ['he', 'flash', 'smoke', 'molotov', 'decoy'];

/** 0 primária, 1 secundária, 2 faca/zeus, 3 granadas, 4 C4 */
export type Slot = 0 | 1 | 2 | 3 | 4;

/** Categoria da arma (decide loja, poses, sons, recompensa padrão e comportamento dos bots). */
export type WeaponClass = 'knife' | 'zeus' | 'pistol' | 'smg' | 'shotgun' | 'lmg' | 'rifle' | 'sniper' | 'grenade' | 'c4';

export interface SpreadDef {
  stand: number; crouch: number; move: number; air: number;
  fire: number; // inacurácia somada por disparo (rad)
  recovery: number; // segundos para recuperar
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
  cls: WeaponClass;
  slot: Slot;
  price: number;
  team: Team | null;
  damage: number;
  armorPen: number;
  rangeMod: number; // multiplicador de dano a cada 12.7 m
  range: number;
  fireInterval: number;
  auto: boolean;
  mag: number;
  reserve: number;
  reloadTime: number;
  deployTime: number;
  speed: number; // m/s
  killReward: number;
  penetration: number; // poder de penetração (wallbang)
  spread: SpreadDef;
  scopedSpread?: SpreadDef;
  scopeFov?: number[]; // FOV vertical por nível de zoom
  /** ferrolho: a luneta fecha depois do tiro e reabre sozinha (AWP, SSG 08) */
  bolt?: boolean;
  /** escopetas: número de chumbos e abertura do cone (rad) */
  pellets?: number;
  pelletSpread?: number;
  pattern: [number, number][]; // padrão de spray cumulativo em graus (pitch para cima, yaw para direita)
  recoilRecover: number; // índices de recuo recuperados por segundo
  kick: number; // intensidade visual do coice
  sound: { pitch: number; len: number; gain: number; suppressed?: boolean; boom?: number };
}

const U = 0.0254;

function pat(points: [number, number][], s = 1): [number, number][] {
  return points.map(([p, y]) => [p * s, y * s]);
}

/**
 * Gera um padrão de spray no estilo CS: sobe forte nas primeiras balas,
 * depois estabiliza e oscila para os lados.
 */
function genPattern(n: number, climb: number, sway: number, seed: number): [number, number][] {
  const out: [number, number][] = [[0, 0]];
  let p = 0, y = 0;
  for (let i = 1; i < n; i++) {
    const rise = i < 9 ? climb * (0.55 + 0.1 * i) : climb * 0.12;
    p += rise;
    const ph = i * 0.42 + seed;
    y = i < 6 ? y + Math.sin(seed + i) * sway * 0.08 : Math.sin(ph) * sway + Math.sin(ph * 2.3) * sway * 0.25;
    out.push([+p.toFixed(2), +y.toFixed(2)]);
  }
  return out;
}

const AK_PATTERN: [number, number][] = [
  [0, 0], [0.45, 0], [1.25, 0.05], [2.3, -0.1], [3.45, 0.1], [4.5, 0.3], [5.35, 0.45], [6.05, 0.25], [6.55, -0.2],
  [6.85, -0.9], [7.05, -1.6], [7.2, -2.2], [7.3, -2.45], [7.4, -1.95], [7.45, -1.0], [7.55, 0.0], [7.65, 0.9],
  [7.75, 1.8], [7.8, 2.6], [7.9, 2.95], [7.95, 2.45], [8.0, 1.6], [8.05, 0.6], [8.15, -0.4], [8.2, -1.2],
  [8.25, -1.8], [8.3, -2.0], [8.35, -1.5], [8.4, -0.8], [8.45, 0],
];
const M4_PATTERN: [number, number][] = [
  [0, 0], [0.35, 0], [1.0, -0.05], [1.85, 0.1], [2.75, 0.25], [3.6, 0.15], [4.3, -0.15], [4.85, -0.55],
  [5.2, -1.05], [5.45, -1.5], [5.6, -1.6], [5.75, -1.2], [5.85, -0.5], [5.95, 0.3], [6.05, 1.0], [6.1, 1.6],
  [6.2, 1.95], [6.25, 1.7], [6.3, 1.1], [6.35, 0.4], [6.4, -0.3], [6.45, -0.9], [6.5, -1.3], [6.55, -1.1],
  [6.6, -0.6], [6.65, 0], [6.7, 0.5], [6.75, 0.9], [6.8, 1.0], [6.85, 0.8],
];
const PISTOL_PATTERN: [number, number][] = [[0, 0], [0.9, 0.1], [1.9, -0.15], [2.8, 0.2], [3.6, -0.1], [4.3, 0.15], [4.9, -0.2], [5.4, 0.1]];

// presets de imprecisão (rad)
const SP_PISTOL: SpreadDef = { stand: 0.0056, crouch: 0.0042, move: 0.03, air: 0.22, fire: 0.035, recovery: 0.3 };
const SP_SMG: SpreadDef = { stand: 0.0065, crouch: 0.0052, move: 0.045, air: 0.3, fire: 0.0095, recovery: 0.3 };
const SP_RIFLE: SpreadDef = { stand: 0.0045, crouch: 0.0035, move: 0.14, air: 0.45, fire: 0.0075, recovery: 0.38 };
const SP_LMG: SpreadDef = { stand: 0.0085, crouch: 0.0065, move: 0.18, air: 0.5, fire: 0.007, recovery: 0.5 };
const SP_SHOTGUN: SpreadDef = { stand: 0.012, crouch: 0.01, move: 0.03, air: 0.25, fire: 0.02, recovery: 0.4 };
const SP_SNIPER_HIP: SpreadDef = { stand: 0.09, crouch: 0.08, move: 0.3, air: 0.6, fire: 0.05, recovery: 0.5 };
const NONE: SpreadDef = { stand: 0, crouch: 0, move: 0, air: 0, fire: 0, recovery: 1 };

const sp = (base: SpreadDef, k: Partial<SpreadDef> = {}): SpreadDef => ({ ...base, ...k });

/** Cria uma arma de fogo com valores padrão da categoria. */
function gun(id: WeaponId, name: string, cls: WeaponClass, o: Partial<WeaponDef> & Pick<WeaponDef, 'price' | 'damage' | 'fireInterval' | 'mag' | 'reserve'>): WeaponDef {
  const slot: Slot = cls === 'pistol' ? 1 : 0;
  const reward = cls === 'smg' ? 600 : cls === 'shotgun' ? 900 : 300;
  const base: WeaponDef = {
    id, name, cls, slot, price: 0, team: null, damage: 0, armorPen: 0.75, rangeMod: 0.95, range: 200,
    fireInterval: 0.1, auto: cls !== 'pistol' && cls !== 'shotgun' && cls !== 'sniper', mag: 0, reserve: 0,
    reloadTime: cls === 'pistol' ? 2.2 : cls === 'lmg' ? 5.5 : 2.6, deployTime: cls === 'pistol' ? 0.6 : 0.9,
    speed: 220 * U, killReward: reward, penetration: cls === 'pistol' || cls === 'smg' ? 1 : cls === 'shotgun' ? 0.6 : 2,
    spread: cls === 'pistol' ? SP_PISTOL : cls === 'smg' ? SP_SMG : cls === 'lmg' ? SP_LMG : cls === 'shotgun' ? SP_SHOTGUN : SP_RIFLE,
    pattern: cls === 'pistol' ? PISTOL_PATTERN : genPattern(30, 0.6, 1.4, id.length),
    recoilRecover: cls === 'pistol' ? 12 : 22, kick: cls === 'pistol' ? 0.6 : 0.9,
    sound: { pitch: 1, len: 0.25, gain: 0.7 },
  };
  return { ...base, ...o, id, name, cls };
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  knife: {
    id: 'knife', name: 'Faca', cls: 'knife', slot: 2, price: 0, team: null, damage: 34, armorPen: 0.85, rangeMod: 1, range: 1.7,
    fireInterval: 0.4, auto: true, mag: 0, reserve: 0, reloadTime: 0, deployTime: 0.5, speed: 250 * U, killReward: 1500,
    penetration: 0, spread: NONE, pattern: [[0, 0]], recoilRecover: 10, kick: 0, sound: { pitch: 1, len: 0.15, gain: 0.4 },
  },
  zeus: {
    id: 'zeus', name: 'Zeus x27', cls: 'zeus', slot: 2, price: 200, team: null, damage: 500, armorPen: 1, rangeMod: 1, range: 4.6,
    fireInterval: 1, auto: false, mag: 1, reserve: 0, reloadTime: 0, deployTime: 0.6, speed: 245 * U, killReward: 0,
    penetration: 0, spread: sp(NONE, { stand: 0.002, crouch: 0.002 }), pattern: [[0, 0]], recoilRecover: 10, kick: 0.4,
    sound: { pitch: 2.2, len: 0.3, gain: 0.5, suppressed: true },
  },

  // ------------------------------------------------------------ pistolas
  glock: gun('glock', 'Glock-18', 'pistol', {
    price: 200, team: 'T', damage: 30, armorPen: 0.47, rangeMod: 0.85, range: 150, fireInterval: 0.15, mag: 20, reserve: 120,
    speed: 240 * U, pattern: pat(PISTOL_PATTERN, 0.7), sound: { pitch: 1.25, len: 0.18, gain: 0.55 },
  }),
  usp: gun('usp', 'USP-S', 'pistol', {
    price: 200, team: 'CT', damage: 35, armorPen: 0.505, rangeMod: 0.91, range: 150, fireInterval: 0.17, mag: 12, reserve: 24,
    speed: 240 * U, spread: sp(SP_PISTOL, { stand: 0.0042, crouch: 0.0032, move: 0.025, air: 0.2, fire: 0.03 }),
    pattern: pat(PISTOL_PATTERN, 0.75), sound: { pitch: 1.6, len: 0.12, gain: 0.35, suppressed: true },
  }),
  p2000: gun('p2000', 'P2000', 'pistol', {
    price: 200, team: 'CT', damage: 35, armorPen: 0.505, rangeMod: 0.91, range: 150, fireInterval: 0.17, mag: 13, reserve: 52,
    speed: 240 * U, spread: sp(SP_PISTOL, { stand: 0.0048, crouch: 0.0036, fire: 0.033 }), pattern: pat(PISTOL_PATTERN, 0.8),
    sound: { pitch: 1.18, len: 0.18, gain: 0.58 },
  }),
  p250: gun('p250', 'P250', 'pistol', {
    price: 300, damage: 38, armorPen: 0.64, rangeMod: 0.85, range: 150, fireInterval: 0.15, mag: 13, reserve: 26,
    speed: 240 * U, spread: sp(SP_PISTOL, { fire: 0.045 }), pattern: pat(PISTOL_PATTERN, 1.0), sound: { pitch: 1.1, len: 0.2, gain: 0.62 },
  }),
  elite: gun('elite', 'Dual Berettas', 'pistol', {
    price: 300, damage: 38, armorPen: 0.575, rangeMod: 0.79, range: 140, fireInterval: 0.12, mag: 30, reserve: 120,
    reloadTime: 3.8, speed: 240 * U, spread: sp(SP_PISTOL, { stand: 0.007, move: 0.035, fire: 0.03 }), pattern: pat(PISTOL_PATTERN, 0.9),
    sound: { pitch: 1.2, len: 0.17, gain: 0.58 },
  }),
  tec9: gun('tec9', 'Tec-9', 'pistol', {
    price: 500, team: 'T', damage: 33, armorPen: 0.903, rangeMod: 0.83, range: 150, fireInterval: 0.12, mag: 18, reserve: 90,
    speed: 240 * U, spread: sp(SP_PISTOL, { stand: 0.006, move: 0.022, fire: 0.04 }), pattern: pat(PISTOL_PATTERN, 1.0),
    sound: { pitch: 1.15, len: 0.18, gain: 0.62 },
  }),
  fiveseven: gun('fiveseven', 'Five-SeveN', 'pistol', {
    price: 500, team: 'CT', damage: 32, armorPen: 0.911, rangeMod: 0.81, range: 150, fireInterval: 0.15, mag: 20, reserve: 100,
    speed: 240 * U, spread: sp(SP_PISTOL, { stand: 0.005, move: 0.026 }), pattern: pat(PISTOL_PATTERN, 0.85),
    sound: { pitch: 1.3, len: 0.17, gain: 0.58 },
  }),
  cz75: gun('cz75', 'CZ75-Auto', 'pistol', {
    price: 500, damage: 31, armorPen: 0.776, rangeMod: 0.85, range: 150, fireInterval: 0.1, auto: true, mag: 12, reserve: 12,
    reloadTime: 2.7, speed: 240 * U, killReward: 100, spread: sp(SP_PISTOL, { fire: 0.045 }), pattern: genPattern(12, 0.9, 1.0, 5),
    sound: { pitch: 1.22, len: 0.16, gain: 0.58 },
  }),
  deagle: gun('deagle', 'Desert Eagle', 'pistol', {
    price: 700, damage: 63, armorPen: 0.932, rangeMod: 0.81, range: 180, fireInterval: 0.225, mag: 7, reserve: 35, deployTime: 0.7,
    speed: 230 * U, penetration: 2, spread: sp(SP_PISTOL, { stand: 0.006, crouch: 0.0045, move: 0.09, air: 0.3, fire: 0.11, recovery: 0.55 }),
    pattern: pat(PISTOL_PATTERN, 2.2), recoilRecover: 6, kick: 1.6, sound: { pitch: 0.75, len: 0.35, gain: 0.85, boom: 0.6 },
  }),
  r8: gun('r8', 'R8 Revolver', 'pistol', {
    price: 600, damage: 86, armorPen: 0.932, rangeMod: 0.94, range: 180, fireInterval: 0.5, mag: 8, reserve: 8, deployTime: 1.0,
    speed: 220 * U, penetration: 2, spread: sp(SP_PISTOL, { stand: 0.006, move: 0.1, fire: 0.12, recovery: 0.6 }),
    pattern: pat(PISTOL_PATTERN, 2.4), recoilRecover: 5, kick: 1.7, sound: { pitch: 0.7, len: 0.4, gain: 0.9, boom: 0.7 },
  }),

  // ------------------------------------------------------------ submetralhadoras
  mac10: gun('mac10', 'MAC-10', 'smg', {
    price: 1050, team: 'T', damage: 29, armorPen: 0.575, rangeMod: 0.8, range: 120, fireInterval: 0.075, mag: 30, reserve: 100,
    speed: 240 * U, spread: sp(SP_SMG, { move: 0.04 }), pattern: genPattern(30, 0.55, 1.8, 1), sound: { pitch: 1.2, len: 0.16, gain: 0.55 },
  }),
  mp9: gun('mp9', 'MP9', 'smg', {
    price: 1250, team: 'CT', damage: 26, armorPen: 0.6, rangeMod: 0.87, range: 120, fireInterval: 0.07, mag: 30, reserve: 120,
    speed: 240 * U, pattern: genPattern(30, 0.5, 1.4, 2), sound: { pitch: 1.3, len: 0.15, gain: 0.52 },
  }),
  mp7: gun('mp7', 'MP7', 'smg', {
    price: 1500, damage: 29, armorPen: 0.625, rangeMod: 0.85, range: 130, fireInterval: 0.08, mag: 30, reserve: 120,
    speed: 220 * U, pattern: genPattern(30, 0.5, 1.1, 3), sound: { pitch: 1.15, len: 0.17, gain: 0.55 },
  }),
  mp5sd: gun('mp5sd', 'MP5-SD', 'smg', {
    price: 1500, damage: 27, armorPen: 0.625, rangeMod: 0.85, range: 130, fireInterval: 0.075, mag: 30, reserve: 120,
    speed: 235 * U, pattern: genPattern(30, 0.45, 1.0, 4), sound: { pitch: 1.4, len: 0.12, gain: 0.35, suppressed: true },
  }),
  ump45: gun('ump45', 'UMP-45', 'smg', {
    price: 1200, damage: 35, armorPen: 0.65, rangeMod: 0.75, range: 130, fireInterval: 0.09, mag: 25, reserve: 100,
    speed: 230 * U, pattern: genPattern(25, 0.6, 1.2, 6), sound: { pitch: 1.0, len: 0.2, gain: 0.6 },
  }),
  p90: gun('p90', 'P90', 'smg', {
    price: 2350, damage: 26, armorPen: 0.69, rangeMod: 0.86, range: 140, fireInterval: 0.07, mag: 50, reserve: 100,
    speed: 230 * U, killReward: 300, pattern: genPattern(50, 0.42, 1.3, 7), sound: { pitch: 1.25, len: 0.15, gain: 0.55 },
  }),
  bizon: gun('bizon', 'PP-Bizon', 'smg', {
    price: 1400, damage: 27, armorPen: 0.575, rangeMod: 0.8, range: 120, fireInterval: 0.08, mag: 64, reserve: 120,
    speed: 240 * U, pattern: genPattern(64, 0.4, 1.3, 8), sound: { pitch: 1.1, len: 0.17, gain: 0.55 },
  }),

  // ------------------------------------------------------------ pesadas
  nova: gun('nova', 'Nova', 'shotgun', {
    price: 1050, damage: 26, armorPen: 0.5, rangeMod: 0.7, range: 60, fireInterval: 0.88, mag: 8, reserve: 32, reloadTime: 3.6,
    speed: 220 * U, pellets: 9, pelletSpread: 0.06, pattern: [[0, 0], [3, 0]], recoilRecover: 4, kick: 1.8,
    sound: { pitch: 0.8, len: 0.4, gain: 0.95, boom: 0.8 },
  }),
  xm1014: gun('xm1014', 'XM1014', 'shotgun', {
    price: 2000, damage: 20, armorPen: 0.8, rangeMod: 0.7, range: 60, fireInterval: 0.35, mag: 7, reserve: 32, reloadTime: 3.4,
    speed: 215 * U, pellets: 6, pelletSpread: 0.065, pattern: [[0, 0], [2, 0], [3.6, 0.3], [5, -0.3], [6.2, 0.2]], recoilRecover: 6, kick: 1.5,
    sound: { pitch: 0.85, len: 0.35, gain: 0.9, boom: 0.7 },
  }),
  sawedoff: gun('sawedoff', 'Sawed-Off', 'shotgun', {
    price: 1100, team: 'T', damage: 32, armorPen: 0.75, rangeMod: 0.45, range: 45, fireInterval: 0.85, mag: 7, reserve: 32,
    reloadTime: 3.4, speed: 210 * U, pellets: 8, pelletSpread: 0.09, pattern: [[0, 0], [3.4, 0]], recoilRecover: 4, kick: 2,
    sound: { pitch: 0.75, len: 0.42, gain: 1.0, boom: 0.9 },
  }),
  mag7: gun('mag7', 'MAG-7', 'shotgun', {
    price: 1300, team: 'CT', damage: 30, armorPen: 0.75, rangeMod: 0.45, range: 50, fireInterval: 0.85, mag: 5, reserve: 32,
    reloadTime: 2.5, speed: 225 * U, pellets: 8, pelletSpread: 0.05, pattern: [[0, 0], [3.2, 0]], recoilRecover: 4, kick: 1.9,
    sound: { pitch: 0.8, len: 0.4, gain: 0.95, boom: 0.85 },
  }),
  m249: gun('m249', 'M249', 'lmg', {
    price: 5200, damage: 32, armorPen: 0.8, rangeMod: 0.97, range: 200, fireInterval: 0.08, mag: 100, reserve: 200,
    speed: 195 * U, pattern: genPattern(60, 0.5, 2.2, 9), sound: { pitch: 0.9, len: 0.28, gain: 0.8, boom: 0.35 },
  }),
  negev: gun('negev', 'Negev', 'lmg', {
    price: 1700, damage: 35, armorPen: 0.71, rangeMod: 0.97, range: 200, fireInterval: 0.075, mag: 150, reserve: 200,
    speed: 150 * U, pattern: genPattern(60, 0.35, 2.6, 10), sound: { pitch: 0.95, len: 0.26, gain: 0.78, boom: 0.3 },
  }),

  // ------------------------------------------------------------ fuzis
  galil: gun('galil', 'Galil AR', 'rifle', {
    price: 1800, team: 'T', damage: 30, armorPen: 0.775, rangeMod: 0.98, fireInterval: 0.09, mag: 35, reserve: 90,
    speed: 215 * U, spread: sp(SP_RIFLE, { stand: 0.0055 }), pattern: genPattern(35, 0.62, 1.6, 11),
    sound: { pitch: 0.95, len: 0.26, gain: 0.72, boom: 0.3 },
  }),
  famas: gun('famas', 'FAMAS', 'rifle', {
    price: 2050, team: 'CT', damage: 30, armorPen: 0.7, rangeMod: 0.96, fireInterval: 0.09, mag: 25, reserve: 90,
    speed: 220 * U, spread: sp(SP_RIFLE, { stand: 0.0055 }), pattern: genPattern(25, 0.6, 1.4, 12),
    sound: { pitch: 1.05, len: 0.24, gain: 0.7, boom: 0.25 },
  }),
  ak47: gun('ak47', 'AK-47', 'rifle', {
    price: 2700, team: 'T', damage: 36, armorPen: 0.775, rangeMod: 0.98, fireInterval: 0.1, mag: 30, reserve: 90, reloadTime: 2.45,
    speed: 215 * U, pattern: AK_PATTERN, kick: 1.0, sound: { pitch: 0.85, len: 0.3, gain: 0.8, boom: 0.4 },
  }),
  m4a1: gun('m4a1', 'M4A4', 'rifle', {
    price: 3100, team: 'CT', damage: 33, armorPen: 0.7, rangeMod: 0.97, fireInterval: 0.09, mag: 30, reserve: 90, reloadTime: 3.1,
    speed: 225 * U, spread: sp(SP_RIFLE, { stand: 0.0038, crouch: 0.003, move: 0.12, air: 0.42, fire: 0.0065, recovery: 0.33 }),
    pattern: M4_PATTERN, kick: 0.85, sound: { pitch: 1.0, len: 0.26, gain: 0.7, boom: 0.3 },
  }),
  m4a1s: gun('m4a1s', 'M4A1-S', 'rifle', {
    price: 2900, team: 'CT', damage: 38, armorPen: 0.7, rangeMod: 0.99, fireInterval: 0.1, mag: 20, reserve: 80, reloadTime: 3.1,
    speed: 225 * U, spread: sp(SP_RIFLE, { stand: 0.0035, crouch: 0.0028, move: 0.12, air: 0.42, fire: 0.006, recovery: 0.33 }),
    pattern: pat(M4_PATTERN.slice(0, 20), 0.85), kick: 0.75, sound: { pitch: 1.5, len: 0.14, gain: 0.38, suppressed: true },
  }),
  sg553: gun('sg553', 'SG 553', 'rifle', {
    price: 3000, team: 'T', damage: 30, armorPen: 1.0, rangeMod: 0.98, fireInterval: 0.09, mag: 30, reserve: 90,
    speed: 210 * U, scopeFov: [45], scopedSpread: sp(SP_RIFLE, { stand: 0.0025, crouch: 0.002 }), pattern: genPattern(30, 0.6, 1.5, 13),
    sound: { pitch: 0.92, len: 0.27, gain: 0.75, boom: 0.35 },
  }),
  aug: gun('aug', 'AUG', 'rifle', {
    price: 3300, team: 'CT', damage: 28, armorPen: 0.9, rangeMod: 0.98, fireInterval: 0.09, mag: 30, reserve: 90,
    speed: 220 * U, scopeFov: [45], scopedSpread: sp(SP_RIFLE, { stand: 0.0025, crouch: 0.002 }), pattern: genPattern(30, 0.55, 1.3, 14),
    sound: { pitch: 1.02, len: 0.25, gain: 0.72, boom: 0.3 },
  }),

  // ------------------------------------------------------------ snipers
  ssg08: gun('ssg08', 'SSG 08', 'sniper', {
    price: 1700, damage: 88, armorPen: 0.85, rangeMod: 0.98, range: 300, fireInterval: 1.25, mag: 10, reserve: 90, reloadTime: 3.7,
    deployTime: 1.0, speed: 230 * U, penetration: 2.5, bolt: true,
    spread: sp(SP_SNIPER_HIP, { stand: 0.05, move: 0.15 }), scopedSpread: { stand: 0.0015, crouch: 0.001, move: 0.12, air: 0.02, fire: 0.04, recovery: 0.45 },
    scopeFov: [32, 10], pattern: [[0, 0], [2, 0]], recoilRecover: 3, kick: 2.0, sound: { pitch: 0.7, len: 0.55, gain: 0.9, boom: 0.7 },
  }),
  awp: gun('awp', 'AWP', 'sniper', {
    price: 4750, damage: 115, armorPen: 0.975, rangeMod: 0.99, range: 300, fireInterval: 1.46, mag: 10, reserve: 30, reloadTime: 3.6,
    deployTime: 1.1, speed: 200 * U, killReward: 100, penetration: 2.5, bolt: true, spread: SP_SNIPER_HIP,
    scopedSpread: { stand: 0.0012, crouch: 0.0008, move: 0.25, air: 0.6, fire: 0.05, recovery: 0.5 },
    scopeFov: [32, 10], pattern: [[0, 0], [2.5, 0]], recoilRecover: 3, kick: 2.6, sound: { pitch: 0.55, len: 0.7, gain: 1.0, boom: 1.0 },
  }),
  g3sg1: gun('g3sg1', 'G3SG1', 'sniper', {
    price: 5000, team: 'T', damage: 80, armorPen: 0.825, rangeMod: 0.98, range: 300, fireInterval: 0.25, mag: 20, reserve: 90,
    reloadTime: 4.7, deployTime: 1.0, speed: 215 * U, penetration: 2.5, spread: SP_SNIPER_HIP,
    scopedSpread: { stand: 0.0022, crouch: 0.0016, move: 0.2, air: 0.5, fire: 0.012, recovery: 0.35 },
    scopeFov: [40, 15], pattern: genPattern(20, 0.8, 0.6, 15), recoilRecover: 8, kick: 1.4, sound: { pitch: 0.75, len: 0.45, gain: 0.9, boom: 0.6 },
  }),
  scar20: gun('scar20', 'SCAR-20', 'sniper', {
    price: 5000, team: 'CT', damage: 80, armorPen: 0.825, rangeMod: 0.98, range: 300, fireInterval: 0.25, mag: 20, reserve: 90,
    reloadTime: 3.1, deployTime: 1.0, speed: 215 * U, penetration: 2.5, spread: SP_SNIPER_HIP,
    scopedSpread: { stand: 0.0022, crouch: 0.0016, move: 0.2, air: 0.5, fire: 0.012, recovery: 0.35 },
    scopeFov: [40, 15], pattern: genPattern(20, 0.8, 0.6, 16), recoilRecover: 8, kick: 1.4, sound: { pitch: 0.8, len: 0.42, gain: 0.88, boom: 0.55 },
  }),

  // ------------------------------------------------------------ granadas e C4
  he: grenade('he', 'Granada HE', 300),
  flash: grenade('flash', 'Flashbang', 200),
  smoke: grenade('smoke', 'Smoke', 300),
  molotov: grenade('molotov', 'Molotov', 400),
  decoy: grenade('decoy', 'Decoy', 50),
  c4: {
    id: 'c4', name: 'C4', cls: 'c4', slot: 4, price: 0, team: 'T', damage: 0, armorPen: 0, rangeMod: 1, range: 0, fireInterval: 0.5,
    auto: true, mag: 0, reserve: 0, reloadTime: 0, deployTime: 0.6, speed: 250 * U, killReward: 300, penetration: 0,
    spread: NONE, pattern: [[0, 0]], recoilRecover: 10, kick: 0, sound: { pitch: 1, len: 0.1, gain: 0.3 },
  },
};

function grenade(id: GrenadeId, name: string, price: number): WeaponDef {
  return {
    id, name, cls: 'grenade', slot: 3, price, team: null, damage: 0, armorPen: 0.5, rangeMod: 1, range: 0, fireInterval: 1.0, auto: false,
    mag: 0, reserve: 0, reloadTime: 0, deployTime: 0.5, speed: 245 * U, killReward: 300, penetration: 0,
    spread: NONE, pattern: [[0, 0]], recoilRecover: 10, kick: 0, sound: { pitch: 1, len: 0.1, gain: 0.3 },
  };
}

export const MAX_GRENADES: Record<GrenadeId, number> = { he: 1, flash: 2, smoke: 1, molotov: 1, decoy: 1 };
export const MAX_GRENADES_TOTAL = 4;
export const emptyNades = (): Record<GrenadeId, number> => ({ he: 0, flash: 0, smoke: 0, molotov: 0, decoy: 0 });

/** Armas de fogo (primárias e secundárias). */
export const isGun = (id: WeaponId) => WEAPONS[id].slot === 0 || WEAPONS[id].slot === 1;

export type BuyItemId = WeaponId | 'vest' | 'vesthelm' | 'kit';

export interface ShopEntry { id: BuyItemId; name: string; price: number; team: Team | null; category: string }

export function priceFor(item: BuyItemId, team: Team, armor = 0, helmet = false): number {
  if (item === 'vest') return 650;
  if (item === 'vesthelm') return armor >= 100 && !helmet ? 350 : 1000;
  if (item === 'kit') return 400;
  if (item === 'molotov') return team === 'CT' ? 600 : 400;
  return WEAPONS[item].price;
}

const shop = (category: string, ids: WeaponId[]): ShopEntry[] =>
  ids.map((id) => ({ id, name: WEAPONS[id].name, price: WEAPONS[id].price, team: WEAPONS[id].team, category }));

/** Loja na ordem das categorias da roda de compra (teclas 1..6). */
export const SHOP: ShopEntry[] = [
  ...shop('Pistolas', ['glock', 'usp', 'p2000', 'p250', 'elite', 'tec9', 'fiveseven', 'cz75', 'deagle', 'r8']),
  ...shop('SMGs', ['mac10', 'mp9', 'mp7', 'mp5sd', 'ump45', 'p90', 'bizon']),
  ...shop('Pesadas', ['nova', 'xm1014', 'sawedoff', 'mag7', 'm249', 'negev']),
  ...shop('Rifles', ['galil', 'famas', 'ak47', 'm4a1', 'm4a1s', 'sg553', 'aug', 'ssg08', 'awp', 'g3sg1', 'scar20']),
  { id: 'vest', name: 'Colete', price: 650, team: null, category: 'Equipamento' },
  { id: 'vesthelm', name: 'Colete + Capacete', price: 1000, team: null, category: 'Equipamento' },
  { id: 'kit', name: 'Kit de Desarme', price: 400, team: 'CT', category: 'Equipamento' },
  ...shop('Equipamento', ['zeus']),
  { id: 'he', name: 'Granada HE', price: 300, team: null, category: 'Granadas' },
  { id: 'flash', name: 'Flashbang', price: 200, team: null, category: 'Granadas' },
  { id: 'smoke', name: 'Smoke', price: 300, team: null, category: 'Granadas' },
  { id: 'molotov', name: 'Molotov / Incendiária', price: 400, team: null, category: 'Granadas' },
  { id: 'decoy', name: 'Decoy', price: 50, team: null, category: 'Granadas' },
];

/** Retorna o deslocamento (graus) do padrão de spray para um índice fracionário. */
export function patternAt(def: WeaponDef, idx: number): [number, number] {
  const p = def.pattern;
  if (idx <= 0) return [0, 0];
  const i = Math.floor(idx);
  if (i >= p.length - 1) return p[p.length - 1];
  const f = idx - i;
  return [p[i][0] + (p[i + 1][0] - p[i][0]) * f, p[i][1] + (p[i + 1][1] - p[i][1]) * f];
}
