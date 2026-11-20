import * as THREE from 'three';
import { buildCatalogWeapon } from './weaponCatalog';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Team } from '../../shared/constants';
import { type WeaponId, WEAPONS } from '../../shared/weapons';

/** Material único com cores por vértice: um draw call por peça mesclada. */
export const VC_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
export const GLOW_MAT = new THREE.MeshBasicMaterial({ color: 0xff2a2a });

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _c = new THREE.Color();

/** Construtor de geometria low poly com cores por vértice e mescla final. */
export class GeoBuilder {
  parts: THREE.BufferGeometry[] = [];

  add(geo: THREE.BufferGeometry, color: number, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0], scl: [number, number, number] = [1, 1, 1]) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.deleteAttribute('uv');
    _e.set(rot[0], rot[1], rot[2]);
    _q.setFromEuler(_e);
    _m.compose(new THREE.Vector3(...pos), _q, new THREE.Vector3(...scl));
    g.applyMatrix4(_m);
    const n = g.getAttribute('position').count;
    const cols = new Float32Array(n * 3);
    _c.setHex(color);
    // leve variação por face para o visual low poly
    for (let i = 0; i < n; i++) {
      const f = 0.94 + (((i / 3) | 0) % 3) * 0.03;
      cols[i * 3] = _c.r * f; cols[i * 3 + 1] = _c.g * f; cols[i * 3 + 2] = _c.b * f;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    this.parts.push(g);
    return this;
  }

  box(w: number, h: number, d: number, color: number, pos: [number, number, number], rot?: [number, number, number]) {
    return this.add(new THREE.BoxGeometry(w, h, d), color, pos, rot);
  }

  /** Cilindro ao longo do eixo Z. */
  cylZ(r: number, len: number, color: number, pos: [number, number, number], seg = 8, r2 = r) {
    return this.add(new THREE.CylinderGeometry(r2, r, len, seg), color, pos, [Math.PI / 2, 0, 0]);
  }

  cylY(r: number, len: number, color: number, pos: [number, number, number], seg = 8, r2 = r) {
    return this.add(new THREE.CylinderGeometry(r2, r, len, seg), color, pos);
  }

  build(): THREE.BufferGeometry {
    const g = this.parts.length ? mergeGeometries(this.parts, false)! : new THREE.BufferGeometry();
    for (const p of this.parts) p.dispose();
    this.parts = [];
    g.computeBoundingSphere();
    return g;
  }

  mesh(mat: THREE.Material = VC_MAT) { return new THREE.Mesh(this.build(), mat); }
}

// ---------------------------------------------------------------- cores
const C = {
  metalDark: 0x26282b, metal: 0x474c52, metalLight: 0x6a7077, wood: 0x8a4a1e, woodLight: 0xa9612a, woodDark: 0x5e3416,
  polymer: 0x2a2c30, polymerGray: 0x3d4045, olive: 0x4f5a33, oliveDark: 0x3c4527, silver: 0xb9bdc3, chrome: 0xd8dade,
  lens: 0x2d6fb3, tan: 0xb59a68, red: 0xc03030, blue: 0x2a52b0, cloth: 0xe2d6bb, glass: 0x5b7a3a, he: 0x4d5a2c,
};

export interface WeaponModel {
  root: THREE.Group;
  mag: THREE.Object3D | null;
  slide: THREE.Object3D | null;
  muzzle: THREE.Object3D;
  /** posição da mão esquerda (apoio) no espaço da arma */
  support: THREE.Vector3;
  id: WeaponId;
}

/** Arma low poly modular. Frente = -Z, origem = empunhadura. */
export function buildWeapon(id: WeaponId): WeaponModel {
  const root = new THREE.Group();
  const g = new GeoBuilder();
  const mg = new GeoBuilder();
  const sg = new GeoBuilder();
  let mag: THREE.Object3D | null = null;
  let slide: THREE.Object3D | null = null;
  const muzzle = new THREE.Object3D();
  const support = new THREE.Vector3(0, 0.0, -0.3);
  let magPos: [number, number, number] = [0, 0, 0];
  let slidePos: [number, number, number] = [0, 0, 0];

  switch (id) {
    case 'ak47': {
      g.box(0.058, 0.075, 0.36, C.metalDark, [0, 0.03, -0.08]);
      g.box(0.052, 0.028, 0.3, C.metal, [0, 0.08, -0.06]);
      g.cylZ(0.012, 0.44, C.metalDark, [0, 0.05, -0.48], 6);
      g.cylZ(0.013, 0.22, C.metal, [0, 0.078, -0.36], 6);
      g.box(0.066, 0.06, 0.2, C.wood, [0, 0.03, -0.33]);
      g.box(0.05, 0.034, 0.17, C.woodLight, [0, 0.078, -0.34]);
      g.box(0.01, 0.05, 0.015, C.metalDark, [0, 0.085, -0.66]);
      g.cylZ(0.018, 0.05, C.metal, [0, 0.05, -0.71], 6);
      g.box(0.012, 0.03, 0.03, C.metal, [0, 0.105, -0.17]);
      g.box(0.04, 0.11, 0.05, C.woodDark, [0, -0.06, 0.045], [-0.32, 0, 0]);
      g.box(0.012, 0.012, 0.07, C.metal, [0, -0.025, -0.02]);
      g.box(0.046, 0.085, 0.27, C.wood, [0, 0.0, 0.22], [0.12, 0, 0]);
      g.box(0.05, 0.13, 0.03, C.woodDark, [0, -0.02, 0.355], [0.12, 0, 0]);
      // carregador curvo (3 segmentos)
      mg.box(0.034, 0.08, 0.072, C.metalDark, [0, -0.04, 0]);
      mg.box(0.034, 0.08, 0.07, C.metalDark, [0, -0.11, -0.03], [0.38, 0, 0]);
      mg.box(0.034, 0.07, 0.066, C.metalDark, [0, -0.17, -0.075], [0.7, 0, 0]);
      magPos = [0, 0.0, -0.13];
      muzzle.position.set(0, 0.05, -0.75);
      support.set(0, 0.0, -0.33);
      break;
    }
    case 'm4a1': {
      g.box(0.05, 0.065, 0.2, C.polymerGray, [0, 0.0, -0.02]);
      g.box(0.048, 0.06, 0.26, C.polymer, [0, 0.062, -0.05]);
      g.box(0.028, 0.016, 0.28, C.metalDark, [0, 0.1, -0.08]);
      g.box(0.018, 0.04, 0.04, C.metalDark, [0, 0.12, 0.04]);
      g.cylZ(0.03, 0.26, C.polymer, [0, 0.06, -0.3], 8);
      g.cylZ(0.011, 0.22, C.metalDark, [0, 0.06, -0.52], 6);
      g.box(0.01, 0.06, 0.015, C.metalDark, [0, 0.105, -0.44]);
      g.cylZ(0.016, 0.05, C.metal, [0, 0.06, -0.64], 6);
      g.box(0.038, 0.1, 0.045, C.polymer, [0, -0.06, 0.07], [-0.3, 0, 0]);
      g.cylZ(0.016, 0.16, C.metalDark, [0, 0.05, 0.16], 6);
      g.box(0.044, 0.09, 0.15, C.polymer, [0, 0.03, 0.27]);
      g.box(0.044, 0.04, 0.06, C.polymerGray, [0, -0.025, -0.08]);
      mg.box(0.03, 0.16, 0.06, C.metal, [0, -0.08, 0], [0.12, 0, 0]);
      magPos = [0, -0.03, -0.08];
      muzzle.position.set(0, 0.06, -0.67);
      support.set(0, 0.02, -0.3);
      break;
    }
    case 'awp': {
      g.box(0.07, 0.09, 0.56, C.olive, [0, 0.0, 0.0]);
      g.box(0.06, 0.15, 0.22, C.olive, [0, -0.02, 0.32]);
      g.box(0.07, 0.03, 0.18, C.oliveDark, [0, 0.07, 0.3]);
      g.box(0.06, 0.12, 0.03, C.oliveDark, [0, -0.02, 0.44]);
      g.box(0.04, 0.1, 0.05, C.oliveDark, [0, -0.07, 0.12], [-0.3, 0, 0]);
      g.cylZ(0.017, 0.72, C.metalDark, [0, 0.04, -0.62], 6);
      g.cylZ(0.026, 0.07, C.metalDark, [0, 0.04, -1.0], 6);
      g.cylZ(0.026, 0.32, C.metalDark, [0, 0.13, -0.04], 8);
      g.cylZ(0.036, 0.08, C.metalDark, [0, 0.13, -0.23], 8, 0.026);
      g.cylZ(0.033, 0.06, C.metalDark, [0, 0.13, 0.14], 8, 0.026);
      g.cylZ(0.03, 0.005, C.lens, [0, 0.13, -0.272], 8);
      g.cylZ(0.028, 0.005, C.lens, [0, 0.13, 0.172], 8);
      g.box(0.02, 0.05, 0.03, C.metalDark, [0, 0.08, -0.12]);
      g.box(0.02, 0.05, 0.03, C.metalDark, [0, 0.08, 0.06]);
      g.cylY(0.008, 0.07, C.metal, [0.055, 0.04, 0.1], 6);
      g.add(new THREE.SphereGeometry(0.014, 6, 4), C.metal, [0.09, 0.04, 0.1]);
      mg.box(0.045, 0.07, 0.11, C.metalDark, [0, -0.04, 0]);
      magPos = [0, -0.03, -0.05];
      muzzle.position.set(0, 0.04, -1.05);
      support.set(0, -0.02, -0.25);
      break;
    }
    case 'glock': {
      sg.box(0.03, 0.035, 0.185, C.polymer, [0, 0, 0]);
      sg.box(0.006, 0.01, 0.01, C.metal, [0, 0.022, -0.08]);
      slidePos = [0, 0.04, -0.06];
      g.box(0.028, 0.026, 0.16, C.polymerGray, [0, 0.012, -0.05]);
      g.box(0.03, 0.11, 0.046, C.polymerGray, [0, -0.045, 0.02], [-0.25, 0, 0]);
      g.box(0.008, 0.01, 0.05, C.polymerGray, [0, -0.015, -0.03]);
      mg.box(0.026, 0.02, 0.04, C.polymer, [0, -0.1, 0.035], [-0.25, 0, 0]);
      muzzle.position.set(0, 0.04, -0.16);
      support.set(0, -0.06, 0.01);
      break;
    }
    case 'usp': {
      sg.box(0.03, 0.036, 0.19, C.metal, [0, 0, 0]);
      slidePos = [0, 0.04, -0.06];
      g.box(0.028, 0.026, 0.16, C.polymer, [0, 0.012, -0.05]);
      g.box(0.03, 0.11, 0.048, C.polymer, [0, -0.045, 0.02], [-0.22, 0, 0]);
      g.cylZ(0.017, 0.17, C.metalDark, [0, 0.04, -0.24], 8);
      g.box(0.008, 0.01, 0.05, C.polymer, [0, -0.015, -0.03]);
      mg.box(0.026, 0.02, 0.04, C.polymer, [0, -0.1, 0.035], [-0.22, 0, 0]);
      muzzle.position.set(0, 0.04, -0.33);
      support.set(0, -0.06, 0.01);
      break;
    }
    case 'deagle': {
      sg.box(0.036, 0.05, 0.26, C.silver, [0, 0, 0]);
      sg.box(0.02, 0.012, 0.25, C.chrome, [0, 0.03, -0.005]);
      slidePos = [0, 0.05, -0.08];
      g.box(0.034, 0.03, 0.2, C.silver, [0, 0.012, -0.06]);
      g.box(0.036, 0.12, 0.056, C.polymer, [0, -0.05, 0.025], [-0.2, 0, 0]);
      g.box(0.01, 0.012, 0.06, C.silver, [0, -0.015, -0.035]);
      mg.box(0.03, 0.02, 0.05, C.polymer, [0, -0.11, 0.04], [-0.2, 0, 0]);
      muzzle.position.set(0, 0.05, -0.22);
      support.set(0, -0.065, 0.015);
      break;
    }
    case 'knife': {
      g.box(0.026, 0.032, 0.11, C.polymer, [0, 0, 0.03]);
      g.box(0.05, 0.02, 0.012, C.metalDark, [0, 0, -0.03]);
      const s = new THREE.Shape();
      s.moveTo(0, -0.012); s.lineTo(0.17, -0.012); s.lineTo(0.21, 0.01); s.lineTo(0.15, 0.022); s.lineTo(0, 0.022); s.lineTo(0, -0.012);
      const ex = new THREE.ExtrudeGeometry(s, { depth: 0.005, bevelEnabled: false });
      ex.translate(0, 0, -0.0025);
      g.add(ex, C.chrome, [0, 0, -0.035], [0, Math.PI / 2, 0]);
      muzzle.position.set(0, 0, -0.24);
      break;
    }
    case 'he': {
      g.add(new THREE.SphereGeometry(0.036, 8, 6), C.he, [0, 0, 0]);
      g.box(0.012, 0.06, 0.02, C.metal, [0.03, 0.03, 0], [0, 0, -0.3]);
      g.cylY(0.012, 0.02, C.metal, [0, 0.04, 0], 6);
      g.add(new THREE.TorusGeometry(0.012, 0.003, 4, 8), C.metalLight, [-0.018, 0.05, 0]);
      muzzle.position.set(0, 0, -0.05);
      break;
    }
    case 'flash': {
      g.cylY(0.028, 0.1, C.metalLight, [0, 0, 0], 8);
      g.cylY(0.03, 0.012, C.polymerGray, [0, 0.03, 0], 8);
      g.box(0.01, 0.07, 0.02, C.metal, [0.032, 0.02, 0]);
      muzzle.position.set(0, 0, -0.05);
      break;
    }
    case 'smoke': {
      g.cylY(0.028, 0.1, C.polymerGray, [0, 0, 0], 8);
      g.cylY(0.0285, 0.015, 0x7c8f6a, [0, 0.0, 0], 8);
      g.box(0.01, 0.07, 0.02, C.metal, [0.032, 0.02, 0]);
      muzzle.position.set(0, 0, -0.05);
      break;
    }
    case 'molotov': {
      g.cylY(0.034, 0.11, C.glass, [0, 0, 0], 8);
      g.cylY(0.013, 0.06, C.glass, [0, 0.08, 0], 6, 0.016);
      g.box(0.02, 0.06, 0.02, C.cloth, [0, 0.13, 0], [0.2, 0, 0.3]);
      muzzle.position.set(0, 0, -0.05);
      break;
    }
    case 'c4': {
      g.box(0.2, 0.06, 0.12, C.tan, [0, 0, 0]);
      g.box(0.08, 0.012, 0.06, C.polymer, [0.03, 0.035, 0]);
      g.box(0.04, 0.012, 0.02, 0x2e5a2e, [-0.06, 0.035, -0.02]);
      g.cylZ(0.004, 0.12, C.red, [-0.03, 0.035, 0.0], 4);
      g.cylZ(0.004, 0.12, C.blue, [-0.04, 0.035, 0.0], 4);
      for (let i = 0; i < 3; i++) g.box(0.06, 0.05, 0.035, 0xb7a170, [-0.06 + i * 0.065, -0.005, 0.045]);
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 4), GLOW_MAT.clone());
      led.position.set(0.08, 0.04, -0.04);
      led.name = 'led';
      root.add(led);
      muzzle.position.set(0, 0, -0.1);
      break;
    }
    default:
      buildCatalogWeapon(id, {
        g, mg, sg, muzzle, support,
        setMag: (p) => { magPos = p; },
        setSlide: (p) => { slidePos = p; },
      });
  }
  root.add(g.mesh());
  if (mg.parts.length) { const m = mg.mesh(); m.position.set(...magPos); root.add(m); mag = m; }
  if (sg.parts.length) { const s = sg.mesh(); s.position.set(...slidePos); root.add(s); slide = s; }
  root.add(muzzle);
  return { root, mag, slide, muzzle, support, id };
}

// ---------------------------------------------------------------- personagem
export interface CharacterModel {
  root: THREE.Group;
  upper: THREE.Group;
  legL: THREE.Group; legR: THREE.Group;
  shinL: THREE.Group; shinR: THREE.Group;
  head: THREE.Object3D;
  weaponHolder: THREE.Group;
  weaponId: WeaponId | '';
  weapon: WeaponModel | null;
  team: Team;
  phase: number;
  deadT: number;
  tag: THREE.Sprite | null;
  /** braços articulados (ombro → cotovelo → mão), posicionados por IK em poseCharacter() */
  arms: { R: Arm; L: Arm };
  poseKey: string;
}

interface Arm { shoulder: THREE.Vector3; upper: THREE.Mesh; fore: THREE.Mesh; hand: THREE.Mesh; side: 1 | -1 }

/** Como o personagem segura a arma: 'aim' na partida, 'idle' (descanso) no menu. */
export type HoldStyle = 'aim' | 'idle';

const UPPER_LEN = 0.34, FORE_LEN = 0.37;
const SEG_DIR = new THREE.Vector3(0, 0, -1);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

/** Segmento de braço: caixa de comprimento 1 ao longo de -Z (escalada no comprimento real). */
function armSegment(w: number, color: number) {
  const g = new GeoBuilder().box(w, w, 1, color, [0, 0, -0.5]).build();
  return new THREE.Mesh(g, VC_MAT);
}

/** Estica um segmento de a até b (espaço local do tronco). */
function placeSegment(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
  _v1.subVectors(b, a);
  const len = Math.max(0.01, _v1.length());
  m.position.copy(a);
  m.quaternion.setFromUnitVectors(SEG_DIR, _v1.divideScalar(len));
  m.scale.set(1, 1, len);
}

/**
 * IK analítico de 2 ossos: dado ombro S e alvo T, acha o cotovelo E com o cotovelo
 * apontando para "pole" (para baixo e para fora). Se o alvo está longe demais, o braço estica até onde alcança.
 */
function solveArm(arm: Arm, target: THREE.Vector3, pole: THREE.Vector3) {
  const S = arm.shoulder;
  const dir = _v2.subVectors(target, S);
  let d = dir.length();
  dir.divideScalar(d || 1);
  d = Math.min(UPPER_LEN + FORE_LEN - 0.002, Math.max(Math.abs(UPPER_LEN - FORE_LEN) + 0.01, d));
  const T = new THREE.Vector3().copy(S).addScaledVector(dir, d);
  const a = (UPPER_LEN * UPPER_LEN - FORE_LEN * FORE_LEN + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, UPPER_LEN * UPPER_LEN - a * a));
  // direção perpendicular ao braço, no plano do "pole"
  const perp = _v3.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (perp.lengthSq() < 1e-6) perp.set(0, -1, 0);
  perp.normalize();
  const E = new THREE.Vector3().copy(S).addScaledVector(dir, a).addScaledVector(perp, h);
  placeSegment(arm.upper, S, E);
  placeSegment(arm.fore, E, T);
  arm.hand.position.copy(T);
  arm.hand.quaternion.copy(arm.fore.quaternion);
}

type Hold = { pos: [number, number, number]; rot: [number, number, number]; twoHands: boolean; support?: [number, number, number] };


/** Onde fica o cabo da arma (mão direita) e sua rotação, por estilo e tipo de arma. Espaço do tronco; frente = -Z. */
function holdFor(id: WeaponId | '', style: HoldStyle): Hold {
  const cls = id ? WEAPONS[id].cls : 'knife';
  const rifle = cls === 'rifle' || cls === 'sniper' || cls === 'smg' || cls === 'shotgun' || cls === 'lmg';
  const pistol = cls === 'pistol' || cls === 'zeus';
  if (style === 'aim') {
    if (rifle) return { pos: [0.06, 0.44, -0.4], rot: [0, 0, 0], twoHands: true };
    if (pistol) return { pos: [0.02, 0.44, -0.56], rot: [0, 0, 0], twoHands: true };
    if (id === 'knife') return { pos: [0.2, 0.3, -0.42], rot: [-0.25, 0.1, 0], twoHands: false };
    if (id === 'c4') return { pos: [0.08, 0.28, -0.42], rot: [0.2, 0, 0], twoHands: true, support: [-0.15, 0, 0] };
    return { pos: [0.2, 0.42, -0.36], rot: [0, 0, 0], twoHands: false }; // granadas
  }
  // descanso (menu): arma baixa, atravessada no corpo, cano apontando para o chão à esquerda
  if (rifle) return { pos: [0.14, 0.27, -0.33], rot: [-0.5, 0.5, 0.3], twoHands: true };
  if (pistol) return { pos: [0.03, 0.17, -0.42], rot: [-0.72, 0.05, 0], twoHands: true };
  if (id === 'knife') return { pos: [0.3, -0.13, -0.13], rot: [-0.32, -0.08, 0.06], twoHands: false };
  if (id === 'c4') return { pos: [0.08, 0.22, -0.36], rot: [0.3, 0, 0], twoHands: true, support: [-0.15, 0, 0] };
  return { pos: [0.29, -0.08, -0.16], rot: [-0.4, 0, 0], twoHands: false };
}

/** Braço solto: pende ao lado do corpo, cotovelo levemente para trás. */
const RELAXED_POLE = (side: number) => new THREE.Vector3(side * 0.3, -0.15, 1);

/**
 * Posiciona a arma e os braços. Só recalcula quando a arma ou o estilo mudam
 * (os braços são filhos do tronco, então acompanham a inclinação dele de graça).
 */
export function poseCharacter(c: CharacterModel, style: HoldStyle) {
  const key = c.weaponId + '|' + style;
  if (c.poseKey === key) return;
  c.poseKey = key;
  const h = holdFor(c.weaponId, style);
  const holder = c.weaponHolder;
  holder.position.set(...h.pos);
  holder.rotation.set(h.rot[0], h.rot[1], h.rot[2], 'YXZ');
  holder.updateMatrix();
  // mão direita no cabo (origem da arma); com uma mão só e arma baixa, o braço pende natural
  const oneHandLow = !h.twoHands && h.pos[1] < 0.2;
  solveArm(c.arms.R, holder.position.clone(), oneHandLow ? RELAXED_POLE(1) : new THREE.Vector3(0.6, -1, 0.25));
  // mão esquerda no apoio da arma, ou solta ao lado do corpo
  let lt: THREE.Vector3;
  if (h.twoHands && c.weapon) {
    lt = (h.support ? new THREE.Vector3(...h.support) : c.weapon.support.clone()).applyMatrix4(holder.matrix);
  } else {
    lt = new THREE.Vector3(-0.3, style === 'aim' ? -0.1 : -0.17, style === 'aim' ? -0.12 : -0.04);
  }
  solveArm(c.arms.L, lt, h.twoHands ? new THREE.Vector3(-0.6, -1, 0.25) : RELAXED_POLE(-1));
}

const TEAM_COL = {
  T: { shirt: 0x7b5a36, vest: 0x5d4a30, pants: 0x5a4c38, head: 0x2b2826, accent: 0xa0382a, boot: 0x2a2018 },
  CT: { shirt: 0x2f3e57, vest: 0x3c4a3a, pants: 0x3a4352, head: 0x2e3a2c, accent: 0x3060c0, boot: 0x1c1f24 },
};
const SKIN = 0xc79a72;

export function buildCharacter(team: Team): CharacterModel {
  const col = TEAM_COL[team];
  const root = new THREE.Group();
  const hips = new THREE.Group(); hips.position.y = 0.92; root.add(hips);
  const mkLeg = (x: number) => {
    const leg = new THREE.Group(); leg.position.set(x, 0, 0); hips.add(leg);
    const th = new GeoBuilder().box(0.17, 0.46, 0.19, col.pants, [0, -0.23, 0]).mesh(); leg.add(th);
    const shin = new THREE.Group(); shin.position.y = -0.46; leg.add(shin);
    const sm = new GeoBuilder().box(0.15, 0.4, 0.17, col.pants, [0, -0.2, 0]).box(0.16, 0.08, 0.26, col.boot, [0, -0.42, -0.04]).mesh();
    shin.add(sm);
    return { leg, shin };
  };
  const L = mkLeg(-0.11), Rr = mkLeg(0.11);
  const upper = new THREE.Group(); hips.add(upper);
  const ub = new GeoBuilder();
  ub.box(0.44, 0.56, 0.25, col.shirt, [0, 0.3, 0]);
  ub.box(0.46, 0.38, 0.29, col.vest, [0, 0.34, 0]);
  ub.box(0.12, 0.08, 0.03, col.accent, [0.12, 0.42, -0.15]);
  ub.box(0.14, 0.12, 0.14, SKIN, [0, 0.62, 0]);
  // ombros (os braços em si são articulados, veja poseCharacter)
  ub.box(0.13, 0.12, 0.2, col.shirt, [0.25, 0.5, -0.02]);
  ub.box(0.13, 0.12, 0.2, col.shirt, [-0.25, 0.5, -0.02]);
  upper.add(ub.mesh());
  const mkArm = (side: 1 | -1): Arm => {
    const arm: Arm = {
      shoulder: new THREE.Vector3(0.25 * side, 0.5, side < 0 ? -0.08 : -0.02),
      upper: armSegment(0.12, col.shirt), fore: armSegment(0.105, col.shirt),
      hand: new THREE.Mesh(new GeoBuilder().box(0.095, 0.1, 0.1, 0x2a2622, [0, 0, 0]).build(), VC_MAT),
      side,
    };
    upper.add(arm.upper, arm.fore, arm.hand);
    return arm;
  };
  const arms = { R: mkArm(1), L: mkArm(-1) };
  const head = new THREE.Group(); head.position.y = 0.78; upper.add(head);
  const hb = new GeoBuilder();
  hb.box(0.24, 0.27, 0.26, SKIN, [0, 0, 0]);
  if (team === 'CT') {
    hb.box(0.28, 0.13, 0.3, col.head, [0, 0.11, 0.01]);
    hb.box(0.2, 0.05, 0.04, 0x111418, [0, 0.03, -0.13]);
  } else {
    hb.box(0.255, 0.18, 0.27, col.head, [0, 0.06, 0.0]);
    hb.box(0.2, 0.05, 0.02, SKIN, [0, 0.02, -0.135]);
    hb.box(0.26, 0.06, 0.275, col.accent, [0, 0.14, 0]);
  }
  head.add(hb.mesh());
  const weaponHolder = new THREE.Group();
  weaponHolder.position.set(0.02, 0.42, -0.5);
  upper.add(weaponHolder);
  return {
    root, upper, legL: L.leg, legR: Rr.leg, shinL: L.shin, shinR: Rr.shin, head, weaponHolder,
    weaponId: '', weapon: null, team, phase: Math.random() * 6, deadT: 0, tag: null, arms, poseKey: '',
  };
}

export function setCharacterWeapon(c: CharacterModel, id: WeaponId) {
  if (c.weaponId === id) return;
  if (c.weapon) c.weaponHolder.remove(c.weapon.root);
  c.weapon = buildWeaponCached(id);
  c.weaponHolder.add(c.weapon.root);
  c.weaponId = id;
}

const cache = new Map<WeaponId, WeaponModel>();
/** Clona modelos (geometria compartilhada) para terceira pessoa/itens no chão. */
export function buildWeaponCached(id: WeaponId): WeaponModel {
  let base = cache.get(id);
  if (!base) { base = buildWeapon(id); cache.set(id, base); }
  const root = base.root.clone(true);
  const muzzle = root.children[base.root.children.indexOf(base.muzzle)] ?? new THREE.Object3D();
  return { root, mag: null, slide: null, muzzle, support: base.support.clone(), id };
}

export function makeTextSprite(text: string, color: string): THREE.Sprite {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const ctx = cv.getContext('2d')!;
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(text, 128, 32);
  ctx.fillStyle = color; ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
  sp.scale.set(1.2, 0.3, 1);
  return sp;
}
