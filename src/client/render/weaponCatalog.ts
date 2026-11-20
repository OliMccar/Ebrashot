import * as THREE from 'three';
import type { WeaponId } from '../../shared/weapons';

/**
 * Catálogo de armas procedurais (low poly) montadas a partir de especificações.
 * Convenção igual a buildWeapon: frente = -Z, origem = empunhadura (mão direita), Y para cima.
 */

/** Subconjunto do GeoBuilder usado aqui (evita import circular com models.ts). */
export interface Geo {
  add(geo: THREE.BufferGeometry, color: number, pos: [number, number, number], rot?: [number, number, number], scl?: [number, number, number]): Geo;
  box(w: number, h: number, d: number, color: number, pos: [number, number, number], rot?: [number, number, number]): Geo;
  cylZ(r: number, len: number, color: number, pos: [number, number, number], seg?: number, r2?: number): Geo;
  cylY(r: number, len: number, color: number, pos: [number, number, number], seg?: number, r2?: number): Geo;
}

export interface BuildCtx {
  g: Geo; // corpo
  mg: Geo; // carregador (anima na recarga)
  sg: Geo; // ferrolho/slide (anima no tiro)
  muzzle: THREE.Object3D;
  support: THREE.Vector3; // mão esquerda
  setMag(p: [number, number, number]): void;
  setSlide(p: [number, number, number]): void;
}

const K = {
  black: 0x1d1e20, metalDark: 0x26282b, metal: 0x474c52, metalLight: 0x6a7077, polymer: 0x2a2c30, polyGray: 0x3d4045,
  wood: 0x8a4a1e, woodLight: 0xa9612a, woodDark: 0x5e3416, olive: 0x4f5a33, oliveDark: 0x3c4527, tan: 0xa8916a, tanDark: 0x7d6b4b,
  silver: 0xb9bdc3, chrome: 0xd8dade, lens: 0x2d6fb3, amber: 0x8a6d2c, smoke: 0x55595e, yellow: 0xd9b200, green: 0x4a5a3a,
};

// ------------------------------------------------------------------ pistolas
interface PistolSpec {
  len?: number; h?: number; w?: number; slide?: number; frame?: number; grip?: number; gripRot?: number;
  suppressor?: number; barrel?: number; magOut?: number; // carregador saliente (CZ, Tec-9)
}

function pistol(c: BuildCtx, o: PistolSpec) {
  const len = o.len ?? 0.19, h = o.h ?? 0.036, w = o.w ?? 0.03;
  const slide = o.slide ?? K.metal, frame = o.frame ?? K.polymer, grip = o.grip ?? frame;
  const gr = o.gripRot ?? -0.22;
  c.sg.box(w, h, len, slide, [0, 0, 0]);
  c.sg.box(w * 0.3, h * 0.25, 0.01, K.metalDark, [0, h * 0.6, -len * 0.42]); // alça de mira
  c.setSlide([0, 0.04, -len * 0.32]);
  c.g.box(w * 0.95, 0.026, len * 0.85, frame, [0, 0.012, -len * 0.27]);
  c.g.box(w, 0.11, 0.048, grip, [0, -0.045, 0.02], [gr, 0, 0]);
  c.g.box(0.008, 0.01, 0.05, frame, [0, -0.015, -0.03]);
  let front = len * 0.82;
  if (o.barrel) { c.g.cylZ(0.011, o.barrel, K.metalDark, [0, 0.04, -(front + o.barrel / 2)], 6); front += o.barrel; }
  if (o.suppressor) { c.g.cylZ(0.017, o.suppressor, K.metalDark, [0, 0.04, -(front + o.suppressor / 2)], 8); front += o.suppressor; }
  c.mg.box(w * 0.85, 0.02 + (o.magOut ?? 0), 0.04, K.polymer, [0, -0.1 - (o.magOut ?? 0) / 2, 0.035], [gr, 0, 0]);
  c.muzzle.position.set(0, 0.04, -front);
  c.support.set(0, -0.06, 0.01);
}

// ------------------------------------------------------------------ armas longas
type StockKind = 'solid' | 'wood' | 'skeleton' | 'fold' | 'none' | 'grip';
type MagKind = 'curved' | 'straight' | 'box' | 'drum' | 'helical' | 'none' | 'top' | 'pistolGrip';

interface LongSpec {
  recv: [number, number, number]; // comprimento, altura, largura
  col: number; // cor do receptor
  bullpup?: boolean; // carregador atrás da empunhadura
  barrel: number; barrelR?: number; barrelY?: number; barrelCol?: number;
  guard?: { len: number; col: number; kind?: 'box' | 'cyl'; h?: number; r?: number };
  stock?: StockKind; stockCol?: number; stockLen?: number;
  mag?: MagKind; magCol?: number; magLen?: number; magZ?: number;
  scope?: { len: number; r: number; col?: number };
  carry?: number; // alça de transporte (cor)
  rail?: boolean;
  suppressor?: { len: number; r: number };
  tube?: number; // tubo de cartuchos sob o cano (escopetas)
  pump?: number; // cor da bomba (escopeta): a mão de apoio vai nela
  bipod?: boolean;
  foregrip?: number; // empunhadura vertical (cor)
  gripCol?: number;
  muzzleBrake?: boolean;
  bolt?: boolean; // manopla do ferrolho
}

function longGun(c: BuildCtx, o: LongSpec) {
  const g = c.g;
  const [rl, rh, rw] = o.recv;
  const grip = o.gripCol ?? K.polymer;
  const by = o.barrelY ?? 0.035;
  // receptor: normal começa logo atrás da empunhadura; bullpup se estende para trás (vira coronha)
  const back = o.bullpup ? rl * 0.62 : 0.1;
  const zBack = back, zFront = back - rl, rz = (zBack + zFront) / 2;
  g.box(rw, rh, rl, o.col, [0, 0.02, rz]);
  if (o.rail) g.box(rw * 0.55, 0.014, rl * 0.85, K.metalDark, [0, 0.02 + rh / 2 + 0.007, rz - rl * 0.05]);
  // empunhadura (pistol grip) e guarda-mato
  if (o.mag !== 'pistolGrip') g.box(0.038, 0.1, 0.048, grip, [0, -0.055, 0.045], [-0.3, 0, 0]);
  g.box(0.01, 0.012, 0.06, K.metalDark, [0, -0.02, -0.01]);
  // guarda-mão
  let guardMid = zFront - 0.12;
  if (o.guard) {
    const gl = o.guard.len, gz = zFront - gl / 2;
    guardMid = gz;
    if (o.guard.kind === 'cyl') g.cylZ(o.guard.r ?? 0.03, gl, o.guard.col, [0, by, gz], 8);
    else g.box(rw * 1.05, o.guard.h ?? rh * 0.85, gl, o.guard.col, [0, by - 0.005, gz]);
  }
  // cano
  const bl = o.barrel;
  g.cylZ(o.barrelR ?? 0.012, bl, o.barrelCol ?? K.metalDark, [0, by, zFront - bl / 2], 6);
  let tip = zFront - bl;
  if (o.muzzleBrake) { g.cylZ((o.barrelR ?? 0.012) * 1.6, 0.05, K.metal, [0, by, tip - 0.02], 6); tip -= 0.04; }
  if (o.suppressor) { g.cylZ(o.suppressor.r, o.suppressor.len, K.metalDark, [0, by, tip - o.suppressor.len / 2], 8); tip -= o.suppressor.len; }
  c.muzzle.position.set(0, by, tip);
  // tubo e bomba (escopetas)
  if (o.tube) g.cylZ(0.016, o.tube, K.metal, [0, by - 0.035, zFront - o.tube / 2], 6);
  if (o.pump !== undefined) {
    const pz = zFront - 0.14;
    g.box(rw * 1.15, 0.045, 0.16, o.pump, [0, by - 0.035, pz]);
    guardMid = pz;
  }
  // alça de mira / alça de transporte / luneta
  if (o.carry !== undefined) {
    g.box(0.02, 0.05, rl * 0.7, o.carry, [0, 0.02 + rh / 2 + 0.03, rz]);
    g.box(0.02, 0.04, 0.03, o.carry, [0, 0.02 + rh / 2 + 0.015, rz - rl * 0.33]);
  }
  if (o.scope) {
    const sy = 0.02 + rh / 2 + o.scope.r + 0.025, sz = rz + rl * 0.08;
    g.cylZ(o.scope.r, o.scope.len, o.scope.col ?? K.metalDark, [0, sy, sz], 8);
    g.cylZ(o.scope.r * 1.25, 0.05, o.scope.col ?? K.metalDark, [0, sy, sz - o.scope.len / 2], 8, o.scope.r);
    g.cylZ(o.scope.r * 1.15, 0.006, K.lens, [0, sy, sz - o.scope.len / 2 - 0.026], 8);
    g.box(0.02, 0.03, 0.03, K.metalDark, [0, sy - o.scope.r - 0.01, sz - 0.07]);
    g.box(0.02, 0.03, 0.03, K.metalDark, [0, sy - o.scope.r - 0.01, sz + 0.07]);
  } else if (o.carry === undefined && !o.bullpup) {
    g.box(0.01, 0.04, 0.015, K.metalDark, [0, by + 0.04, tip + 0.06]); // massa de mira
  }
  if (o.bolt) {
    g.cylY(0.008, 0.06, K.metal, [0.045, 0.03, zBack - 0.06], 6);
    g.add(new THREE.SphereGeometry(0.014, 6, 4), K.metal, [0.075, 0.03, zBack - 0.06]);
  }
  if (o.foregrip !== undefined) g.box(0.03, 0.08, 0.035, o.foregrip, [0, by - 0.07, guardMid + 0.02], [0.15, 0, 0]);
  if (o.bipod) {
    g.box(0.01, 0.01, 0.16, K.metalDark, [0.018, by - 0.03, tip + 0.12]);
    g.box(0.01, 0.01, 0.16, K.metalDark, [-0.018, by - 0.03, tip + 0.12]);
  }
  // coronha (armas normais)
  if (!o.bullpup) {
    const sl = o.stockLen ?? 0.26, sc = o.stockCol ?? grip, sz = zBack + sl / 2;
    switch (o.stock ?? 'solid') {
      case 'solid':
        g.box(0.045, 0.085, sl, sc, [0, 0.0, sz], [0.06, 0, 0]);
        g.box(0.048, 0.12, 0.03, K.black, [0, -0.01, zBack + sl], [0.06, 0, 0]);
        break;
      case 'wood':
        g.box(0.046, 0.085, sl, sc, [0, -0.005, sz], [0.12, 0, 0]);
        g.box(0.05, 0.13, 0.03, K.woodDark, [0, -0.025, zBack + sl], [0.12, 0, 0]);
        break;
      case 'skeleton':
        g.box(0.012, 0.012, sl, sc, [0, 0.03, sz]);
        g.box(0.012, 0.012, sl, sc, [0, -0.03, sz], [0.1, 0, 0]);
        g.box(0.04, 0.11, 0.025, sc, [0, -0.005, zBack + sl]);
        break;
      case 'fold':
        g.box(0.01, 0.012, sl, sc, [0.025, 0.02, sz]);
        g.box(0.03, 0.08, 0.02, sc, [0.02, 0.0, zBack + sl]);
        break;
      case 'grip': // só empunhadura de madeira (sawed-off)
        g.box(0.04, 0.11, 0.06, sc, [0, -0.05, zBack + 0.04], [-0.55, 0, 0]);
        break;
      default: break;
    }
  }
  // carregador
  const mc = o.magCol ?? K.metalDark;
  const ml = o.magLen ?? 0.15;
  const magZ = o.magZ ?? (o.bullpup ? 0.13 : -0.12);
  switch (o.mag ?? 'straight') {
    case 'curved':
      c.mg.box(0.032, 0.075, 0.068, mc, [0, -0.035, 0]);
      c.mg.box(0.032, 0.075, 0.066, mc, [0, -0.1, -0.025], [0.35, 0, 0]);
      c.mg.box(0.032, 0.06, 0.062, mc, [0, -0.155, -0.065], [0.65, 0, 0]);
      break;
    case 'straight': c.mg.box(0.03, ml, 0.06, mc, [0, -ml / 2, 0], [0.1, 0, 0]); break;
    case 'box': c.mg.box(0.08, 0.1, 0.12, mc, [0, -0.06, 0]); break;
    case 'drum': c.mg.add(new THREE.CylinderGeometry(0.065, 0.065, 0.05, 10), mc, [0, -0.07, 0], [0, 0, Math.PI / 2]); break;
    case 'helical': c.mg.cylZ(0.033, 0.3, mc, [0, -0.02, 0], 8); break;
    case 'top': c.mg.box(0.05, 0.03, 0.34, mc, [0, 0, 0]); break;
    case 'pistolGrip': c.mg.box(0.032, 0.13, 0.045, mc, [0, -0.06, 0], [-0.15, 0, 0]); break;
    default: break;
  }
  const magPos: Record<MagKind, [number, number, number]> = {
    curved: [0, 0, magZ], straight: [0, 0, magZ], box: [0.02, 0, magZ], drum: [0, -0.01, magZ],
    helical: [0, by - 0.045, zFront - 0.15], top: [0, 0.02 + rh / 2 + 0.015, rz], pistolGrip: [0, -0.01, 0.04], none: [0, 0, 0],
  };
  c.setMag(magPos[o.mag ?? 'straight']);
  c.support.set(0, by - 0.035, guardMid);
}

/** Monta uma das armas do catálogo. Retorna false se o id não for do catálogo. */
export function buildCatalogWeapon(id: WeaponId, c: BuildCtx): boolean {
  switch (id) {
    // -------------------------------------------------- pistolas
    case 'p2000': pistol(c, { len: 0.19, slide: K.metalDark, frame: K.polymer }); return true;
    case 'p250': pistol(c, { len: 0.18, slide: K.polyGray, frame: K.polymer, gripRot: -0.2 }); return true;
    case 'elite': pistol(c, { len: 0.21, slide: K.silver, frame: K.metal, grip: K.woodDark, barrel: 0.02 }); return true;
    case 'fiveseven': pistol(c, { len: 0.2, h: 0.034, slide: K.polyGray, frame: K.tanDark, grip: K.tanDark }); return true;
    case 'cz75': pistol(c, { len: 0.19, slide: K.metalDark, frame: K.metalDark, grip: K.woodDark, magOut: 0.05 }); return true;
    case 'tec9': {
      // corpo quadrado e carregador longo à frente do gatilho
      c.g.box(0.035, 0.05, 0.24, K.polyGray, [0, 0.025, -0.08]);
      c.g.cylZ(0.016, 0.12, K.metalDark, [0, 0.03, -0.26], 8);
      c.g.box(0.034, 0.1, 0.045, K.polymer, [0, -0.04, 0.03], [-0.2, 0, 0]);
      c.g.box(0.008, 0.01, 0.05, K.polymer, [0, -0.01, -0.03]);
      c.mg.box(0.028, 0.16, 0.04, K.metalDark, [0, -0.08, 0]);
      c.setMag([0, -0.005, -0.09]);
      c.muzzle.position.set(0, 0.03, -0.33);
      c.support.set(0, -0.09, -0.09);
      return true;
    }
    case 'r8': {
      // revólver: armação, tambor, cano longo com nervura
      c.g.box(0.03, 0.05, 0.12, K.metalDark, [0, 0.03, -0.02]);
      c.g.cylZ(0.032, 0.065, K.metal, [0, 0.035, -0.04], 8);
      c.g.cylZ(0.013, 0.2, K.metalDark, [0, 0.045, -0.18], 6);
      c.g.box(0.01, 0.014, 0.2, K.metal, [0, 0.062, -0.18]);
      c.g.box(0.034, 0.11, 0.05, K.woodDark, [0, -0.04, 0.035], [-0.3, 0, 0]);
      c.g.box(0.008, 0.012, 0.05, K.metalDark, [0, -0.005, -0.02]);
      c.sg.box(0.008, 0.025, 0.015, K.metal, [0, 0, 0]); // cão (martelo)
      c.setSlide([0, 0.065, 0.04]);
      c.muzzle.position.set(0, 0.045, -0.29);
      c.support.set(0, -0.06, 0.01);
      return true;
    }

    // -------------------------------------------------- submetralhadoras
    case 'mac10': longGun(c, { recv: [0.2, 0.08, 0.05], col: K.metalDark, barrel: 0.06, stock: 'fold', stockLen: 0.18, mag: 'pistolGrip', magCol: K.metalDark, rail: false }); return true;
    case 'mp9': longGun(c, { recv: [0.22, 0.065, 0.045], col: K.polymer, barrel: 0.08, stock: 'fold', stockLen: 0.2, mag: 'pistolGrip', magCol: K.polymer, rail: true, foregrip: K.polymer }); return true;
    case 'mp7': longGun(c, { recv: [0.25, 0.075, 0.05], col: K.polyGray, barrel: 0.08, stock: 'fold', stockLen: 0.22, mag: 'pistolGrip', magCol: K.polymer, rail: true, foregrip: K.polymer }); return true;
    case 'mp5sd': longGun(c, { recv: [0.28, 0.07, 0.05], col: K.metalDark, barrel: 0.04, guard: { len: 0.14, col: K.polymer, kind: 'cyl', r: 0.028 }, suppressor: { len: 0.2, r: 0.026 }, stock: 'skeleton', stockLen: 0.22, mag: 'curved', magCol: K.metalDark, magZ: -0.11 }); return true;
    case 'ump45': longGun(c, { recv: [0.32, 0.08, 0.05], col: K.polymer, barrel: 0.08, guard: { len: 0.14, col: K.polymer }, stock: 'skeleton', stockLen: 0.24, mag: 'straight', magLen: 0.16, magCol: K.polymer, rail: true }); return true;
    case 'p90': {
      longGun(c, { recv: [0.5, 0.11, 0.07], col: K.polyGray, bullpup: true, barrel: 0.08, barrelY: 0.03, mag: 'top', magCol: K.smoke, gripCol: K.polymer });
      c.g.box(0.05, 0.04, 0.1, K.polymer, [0, -0.05, -0.12]); // guarda frontal
      c.support.set(0, -0.03, -0.14);
      return true;
    }
    case 'bizon': longGun(c, { recv: [0.3, 0.07, 0.045], col: K.metalDark, barrel: 0.12, guard: { len: 0.12, col: K.woodDark }, stock: 'fold', stockLen: 0.24, mag: 'helical', magCol: K.metal }); return true;

    // -------------------------------------------------- escopetas e metralhadoras
    case 'nova': longGun(c, { recv: [0.24, 0.07, 0.05], col: K.metal, barrel: 0.5, barrelR: 0.014, tube: 0.42, pump: K.polymer, stock: 'solid', stockCol: K.polymer, stockLen: 0.3, mag: 'none' }); return true;
    case 'xm1014': longGun(c, { recv: [0.28, 0.075, 0.05], col: K.metalDark, barrel: 0.46, barrelR: 0.014, tube: 0.38, guard: { len: 0.2, col: K.polymer }, stock: 'solid', stockCol: K.polymer, stockLen: 0.28, mag: 'none', rail: true }); return true;
    case 'sawedoff': longGun(c, { recv: [0.2, 0.07, 0.05], col: K.metal, barrel: 0.26, barrelR: 0.016, tube: 0.22, pump: K.wood, stock: 'grip', stockCol: K.wood, mag: 'none' }); return true;
    case 'mag7': longGun(c, { recv: [0.3, 0.09, 0.06], col: K.polyGray, barrel: 0.2, barrelR: 0.016, pump: K.polymer, stock: 'fold', stockLen: 0.22, mag: 'pistolGrip', magCol: K.polymer }); return true;
    case 'm249': longGun(c, { recv: [0.42, 0.1, 0.07], col: K.metalDark, barrel: 0.48, guard: { len: 0.18, col: K.polymer }, stock: 'solid', stockCol: K.polymer, stockLen: 0.28, mag: 'box', magCol: K.green, magZ: -0.06, carry: K.metalDark, bipod: true, muzzleBrake: true }); return true;
    case 'negev': longGun(c, { recv: [0.45, 0.1, 0.065], col: K.metalDark, barrel: 0.52, guard: { len: 0.26, col: K.metal, kind: 'cyl', r: 0.032 }, stock: 'solid', stockCol: K.tanDark, stockLen: 0.28, mag: 'box', magCol: K.oliveDark, magZ: -0.06, bipod: true, rail: true }); return true;

    // -------------------------------------------------- fuzis
    case 'galil': longGun(c, { recv: [0.36, 0.08, 0.055], col: K.metal, barrel: 0.42, guard: { len: 0.18, col: K.polymer }, stock: 'fold', stockLen: 0.26, mag: 'curved', magCol: K.metalDark, muzzleBrake: true }); return true;
    case 'famas': longGun(c, { recv: [0.6, 0.1, 0.06], col: K.polyGray, bullpup: true, barrel: 0.18, guard: { len: 0.12, col: K.polymer }, mag: 'straight', magLen: 0.13, carry: K.polymer, bipod: true, muzzleBrake: true }); return true;
    case 'm4a1s': longGun(c, { recv: [0.34, 0.075, 0.05], col: K.polymer, barrel: 0.24, guard: { len: 0.22, col: K.polyGray, kind: 'cyl', r: 0.03 }, suppressor: { len: 0.2, r: 0.02 }, stock: 'solid', stockLen: 0.24, mag: 'straight', magCol: K.metal, rail: true }); return true;
    case 'sg553': longGun(c, { recv: [0.36, 0.085, 0.055], col: K.polyGray, barrel: 0.36, guard: { len: 0.2, col: K.polymer }, stock: 'skeleton', stockLen: 0.26, mag: 'curved', magCol: K.amber, scope: { len: 0.18, r: 0.022 }, muzzleBrake: true }); return true;
    case 'aug': longGun(c, { recv: [0.6, 0.1, 0.065], col: K.olive, bullpup: true, barrel: 0.3, scope: { len: 0.22, r: 0.024, col: K.olive }, mag: 'straight', magLen: 0.14, magCol: K.smoke, foregrip: K.olive, gripCol: K.olive }); return true;

    // -------------------------------------------------- snipers
    case 'ssg08': longGun(c, { recv: [0.32, 0.06, 0.045], col: K.metalDark, barrel: 0.58, barrelR: 0.011, guard: { len: 0.24, col: K.oliveDark }, stock: 'skeleton', stockCol: K.oliveDark, stockLen: 0.3, mag: 'straight', magLen: 0.06, scope: { len: 0.3, r: 0.024 }, bolt: true, muzzleBrake: true }); return true;
    case 'g3sg1': longGun(c, { recv: [0.44, 0.09, 0.06], col: K.metalDark, barrel: 0.46, guard: { len: 0.24, col: K.polymer, kind: 'cyl', r: 0.033 }, stock: 'solid', stockCol: K.polymer, stockLen: 0.3, mag: 'straight', magLen: 0.12, scope: { len: 0.3, r: 0.026 }, muzzleBrake: true }); return true;
    case 'scar20': longGun(c, { recv: [0.42, 0.09, 0.06], col: K.tan, barrel: 0.44, guard: { len: 0.24, col: K.tan }, stock: 'solid', stockCol: K.tanDark, stockLen: 0.3, mag: 'straight', magLen: 0.12, magCol: K.polymer, scope: { len: 0.3, r: 0.026 }, rail: true, muzzleBrake: true }); return true;

    // -------------------------------------------------- equipamento
    case 'zeus': {
      c.g.box(0.04, 0.06, 0.16, K.yellow, [0, 0.02, -0.06]);
      c.g.box(0.042, 0.02, 0.17, K.black, [0, 0.055, -0.06]);
      c.g.box(0.038, 0.1, 0.05, K.black, [0, -0.045, 0.03], [-0.2, 0, 0]);
      c.g.box(0.03, 0.03, 0.02, K.metal, [0, 0.025, -0.15]);
      c.muzzle.position.set(0, 0.025, -0.17);
      c.support.set(0, -0.06, 0.01);
      return true;
    }
    case 'decoy': {
      c.g.cylY(0.028, 0.1, 0x6b6b3b, [0, 0, 0], 8);
      c.g.cylY(0.03, 0.012, K.polyGray, [0, 0.03, 0], 8);
      c.g.box(0.01, 0.07, 0.02, K.metal, [0.032, 0.02, 0]);
      c.muzzle.position.set(0, 0, -0.05);
      return true;
    }
    default: return false;
  }
}
