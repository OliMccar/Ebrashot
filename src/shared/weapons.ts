import type { Team } from './constants';

export type WeaponId =
  | 'knife' | 'glock' | 'usp' | 'deagle'
  | 'ak47' | 'm4a1' | 'awp'
  | 'he' | 'flash' | 'smoke' | 'molotov'
  | 'c4';

export type GrenadeId = 'he' | 'flash' | 'smoke' | 'molotov';
export const GRENADES: GrenadeId[] = ['he', 'flash', 'smoke', 'molotov'];

/** 0 primária, 1 secundária, 2 faca, 3 granadas, 4 C4 */
export type Slot = 0 | 1 | 2 | 3 | 4;

export interface SpreadDef {
  stand: number; crouch: number; move: number; air: number;
  fire: number; // inacurácia somada por disparo (rad)
  recovery: number; // segundos para recuperar
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
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
  pattern: [number, number][]; // padrão de spray cumulativo em graus (pitch para cima, yaw para direita)
  recoilRecover: number; // índices de recuo recuperados por segundo
  kick: number; // intensidade visual do coice
  sound: { pitch: number; len: number; gain: number; suppressed?: boolean; boom?: number };
}

const U = 0.0254;

function pat(points: [number, number][], s = 1): [number, number][] {
  return points.map(([p, y]) => [p * s, y * s]);
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

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  knife: {
    id: 'knife', name: 'Faca', slot: 2, price: 0, team: null, damage: 34, armorPen: 0.85, rangeMod: 1, range: 1.7,
    fireInterval: 0.4, auto: true, mag: 0, reserve: 0, reloadTime: 0, deployTime: 0.5, speed: 250 * U, killReward: 1500,
    penetration: 0, spread: { stand: 0, crouch: 0, move: 0, air: 0, fire: 0, recovery: 1 }, pattern: [[0, 0]],
    recoilRecover: 10, kick: 0, sound: { pitch: 1, len: 0.15, gain: 0.4 },
  },
  glock: {
    id: 'glock', name: 'Glock-18', slot: 1, price: 200, team: 'T', damage: 30, armorPen: 0.47, rangeMod: 0.85, range: 150,
    fireInterval: 0.15, auto: false, mag: 20, reserve: 120, reloadTime: 2.2, deployTime: 0.6, speed: 240 * U, killReward: 300,
    penetration: 1, spread: { stand: 0.0056, crouch: 0.0042, move: 0.03, air: 0.22, fire: 0.035, recovery: 0.3 },
    pattern: pat(PISTOL_PATTERN, 0.7), recoilRecover: 12, kick: 0.6, sound: { pitch: 1.25, len: 0.18, gain: 0.55 },
  },
  usp: {
    id: 'usp', name: 'USP-S', slot: 1, price: 200, team: 'CT', damage: 35, armorPen: 0.505, rangeMod: 0.91, range: 150,
    fireInterval: 0.17, auto: false, mag: 12, reserve: 24, reloadTime: 2.2, deployTime: 0.6, speed: 240 * U, killReward: 300,
    penetration: 1, spread: { stand: 0.0042, crouch: 0.0032, move: 0.025, air: 0.2, fire: 0.03, recovery: 0.3 },
    pattern: pat(PISTOL_PATTERN, 0.75), recoilRecover: 12, kick: 0.6, sound: { pitch: 1.6, len: 0.12, gain: 0.35, suppressed: true },
  },
  deagle: {
    id: 'deagle', name: 'Desert Eagle', slot: 1, price: 700, team: null, damage: 63, armorPen: 0.932, rangeMod: 0.81, range: 180,
    fireInterval: 0.225, auto: false, mag: 7, reserve: 35, reloadTime: 2.2, deployTime: 0.7, speed: 230 * U, killReward: 300,
    penetration: 2, spread: { stand: 0.006, crouch: 0.0045, move: 0.09, air: 0.3, fire: 0.11, recovery: 0.55 },
    pattern: pat(PISTOL_PATTERN, 2.2), recoilRecover: 6, kick: 1.6, sound: { pitch: 0.75, len: 0.35, gain: 0.85, boom: 0.6 },
  },
  ak47: {
    id: 'ak47', name: 'AK-47', slot: 0, price: 2700, team: 'T', damage: 36, armorPen: 0.775, rangeMod: 0.98, range: 200,
    fireInterval: 0.1, auto: true, mag: 30, reserve: 90, reloadTime: 2.45, deployTime: 0.9, speed: 215 * U, killReward: 300,
    penetration: 2, spread: { stand: 0.0045, crouch: 0.0035, move: 0.14, air: 0.45, fire: 0.0075, recovery: 0.38 },
    pattern: AK_PATTERN, recoilRecover: 22, kick: 1.0, sound: { pitch: 0.85, len: 0.3, gain: 0.8, boom: 0.4 },
  },
  m4a1: {
    id: 'm4a1', name: 'M4A1', slot: 0, price: 3100, team: 'CT', damage: 33, armorPen: 0.7, rangeMod: 0.97, range: 200,
    fireInterval: 0.09, auto: true, mag: 30, reserve: 90, reloadTime: 3.1, deployTime: 0.9, speed: 225 * U, killReward: 300,
    penetration: 2, spread: { stand: 0.0038, crouch: 0.003, move: 0.12, air: 0.42, fire: 0.0065, recovery: 0.33 },
    pattern: M4_PATTERN, recoilRecover: 22, kick: 0.85, sound: { pitch: 1.0, len: 0.26, gain: 0.7, boom: 0.3 },
  },
  awp: {
    id: 'awp', name: 'AWP', slot: 0, price: 4750, team: null, damage: 115, armorPen: 0.975, rangeMod: 0.99, range: 300,
    fireInterval: 1.46, auto: false, mag: 10, reserve: 30, reloadTime: 3.6, deployTime: 1.1, speed: 200 * U, killReward: 100,
    penetration: 2.5, spread: { stand: 0.09, crouch: 0.08, move: 0.3, air: 0.6, fire: 0.05, recovery: 0.5 },
    scopedSpread: { stand: 0.0012, crouch: 0.0008, move: 0.25, air: 0.6, fire: 0.05, recovery: 0.5 },
    scopeFov: [32, 10], pattern: [[0, 0], [2.5, 0]], recoilRecover: 3, kick: 2.6,
    sound: { pitch: 0.55, len: 0.7, gain: 1.0, boom: 1.0 },
  },
  he: grenade('he', 'Granada HE', 300),
  flash: grenade('flash', 'Flashbang', 200),
  smoke: grenade('smoke', 'Smoke', 300),
  molotov: grenade('molotov', 'Molotov', 400),
  c4: {
    id: 'c4', name: 'C4', slot: 4, price: 0, team: 'T', damage: 0, armorPen: 0, rangeMod: 1, range: 0, fireInterval: 0.5,
    auto: true, mag: 0, reserve: 0, reloadTime: 0, deployTime: 0.6, speed: 250 * U, killReward: 300, penetration: 0,
    spread: { stand: 0, crouch: 0, move: 0, air: 0, fire: 0, recovery: 1 }, pattern: [[0, 0]], recoilRecover: 10, kick: 0,
    sound: { pitch: 1, len: 0.1, gain: 0.3 },
  },
};

function grenade(id: GrenadeId, name: string, price: number): WeaponDef {
  return {
    id, name, slot: 3, price, team: null, damage: 0, armorPen: 0.5, rangeMod: 1, range: 0, fireInterval: 1.0, auto: false,
    mag: 0, reserve: 0, reloadTime: 0, deployTime: 0.5, speed: 245 * U, killReward: 300, penetration: 0,
    spread: { stand: 0, crouch: 0, move: 0, air: 0, fire: 0, recovery: 1 }, pattern: [[0, 0]], recoilRecover: 10, kick: 0,
    sound: { pitch: 1, len: 0.1, gain: 0.3 },
  };
}

export const MAX_GRENADES: Record<GrenadeId, number> = { he: 1, flash: 2, smoke: 1, molotov: 1 };
export const MAX_GRENADES_TOTAL = 4;

export type BuyItemId = WeaponId | 'vest' | 'vesthelm' | 'kit';

export interface ShopEntry { id: BuyItemId; name: string; price: number; team: Team | null; category: string }

export function priceFor(item: BuyItemId, team: Team, armor = 0, helmet = false): number {
  if (item === 'vest') return 650;
  if (item === 'vesthelm') return armor >= 100 && !helmet ? 350 : 1000;
  if (item === 'kit') return 400;
  if (item === 'molotov') return team === 'CT' ? 600 : 400;
  return WEAPONS[item].price;
}

export const SHOP: ShopEntry[] = [
  { id: 'glock', name: 'Glock-18', price: 200, team: 'T', category: 'Pistolas' },
  { id: 'usp', name: 'USP-S', price: 200, team: 'CT', category: 'Pistolas' },
  { id: 'deagle', name: 'Desert Eagle', price: 700, team: null, category: 'Pistolas' },
  { id: 'ak47', name: 'AK-47', price: 2700, team: 'T', category: 'Rifles' },
  { id: 'm4a1', name: 'M4A1', price: 3100, team: 'CT', category: 'Rifles' },
  { id: 'awp', name: 'AWP', price: 4750, team: null, category: 'Rifles' },
  { id: 'vest', name: 'Colete', price: 650, team: null, category: 'Equipamento' },
  { id: 'vesthelm', name: 'Colete + Capacete', price: 1000, team: null, category: 'Equipamento' },
  { id: 'kit', name: 'Kit de Desarme', price: 400, team: 'CT', category: 'Equipamento' },
  { id: 'he', name: 'Granada HE', price: 300, team: null, category: 'Granadas' },
  { id: 'flash', name: 'Flashbang', price: 200, team: null, category: 'Granadas' },
  { id: 'smoke', name: 'Smoke', price: 300, team: null, category: 'Granadas' },
  { id: 'molotov', name: 'Molotov / Incendiária', price: 400, team: null, category: 'Granadas' },
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
