import * as THREE from 'three';
import type { Team } from '../../shared/constants';
import type { PlayerState } from '../../shared/player';
import { type WeaponId, WEAPONS } from '../../shared/weapons';
import { GeoBuilder, type WeaponModel, buildWeapon } from './models';
import { textures } from './textures';

const POSE: Partial<Record<WeaponId, [number, number, number]>> = {
  ak47: [0.12, -0.14, -0.3], m4a1: [0.12, -0.14, -0.3], awp: [0.14, -0.19, -0.44],
  glock: [0.11, -0.115, -0.36], usp: [0.11, -0.115, -0.36], deagle: [0.11, -0.12, -0.36],
  knife: [0.17, -0.15, -0.34], he: [0.13, -0.13, -0.27], flash: [0.13, -0.13, -0.27], smoke: [0.13, -0.13, -0.27],
  molotov: [0.13, -0.15, -0.27], c4: [0.02, -0.17, -0.3],
  // bullpups: o corpo vai para trás da empunhadura, então ficam mais à frente e mais baixas
  p90: [0.15, -0.2, -0.64], famas: [0.15, -0.205, -0.62], aug: [0.15, -0.21, -0.62],
};

/** Posição padrão por categoria (armas sem pose própria em POSE). */
const CLASS_POSE: Partial<Record<string, [number, number, number]>> = {
  pistol: [0.11, -0.115, -0.36], zeus: [0.11, -0.12, -0.34], smg: [0.12, -0.13, -0.3], rifle: [0.12, -0.14, -0.3],
  shotgun: [0.12, -0.15, -0.32], lmg: [0.15, -0.2, -0.44], sniper: [0.14, -0.19, -0.42], grenade: [0.13, -0.13, -0.27],
};

/** Rotação base por arma (só a faca precisa: ponta para cima/dentro e lâmina inclinada). */
const BASE_ROT: Partial<Record<WeaponId, [number, number, number]>> = {
  knife: [0.82, 0.07, -0.72],
};

/** Keyframe de animação: [tempo 0..1, px, py, pz, rx, ry, rz, easing do trecho que termina aqui] */
type Key = [number, number, number, number, number, number, number, 'smooth' | 'fast' | 'slow'];

// golpe leve: corte diagonal da direita para a esquerda (dir = 1) ou de volta (dir = -1)
const SLASH_A: Key[] = [
  [0, 0, 0, 0, 0, 0, 0, 'smooth'],
  [0.2, 0.07, 0.07, 0.03, 0.18, -0.55, -0.6, 'smooth'], // prepara: sobe para a direita
  [0.46, -0.25, -0.07, -0.12, -0.28, 1.05, 0.6, 'fast'], // corta atravessando a tela
  [0.66, -0.27, -0.09, -0.11, -0.32, 1.1, 0.65, 'slow'], // continuação
  [1, 0, 0, 0, 0, 0, 0, 'smooth'],
];
const SLASH_B: Key[] = [
  [0, 0, 0, 0, 0, 0, 0, 'smooth'],
  [0.2, -0.13, 0.07, 0.02, 0.18, 0.65, 0.75, 'smooth'], // prepara: cruza para a esquerda
  [0.46, 0.12, -0.08, -0.12, -0.28, -0.75, -0.55, 'fast'], // corta de volta (revés)
  [0.66, 0.13, -0.1, -0.1, -0.32, -0.8, -0.6, 'slow'],
  [1, 0, 0, 0, 0, 0, 0, 'smooth'],
];
// golpe forte: recua e levanta, estocada, segura, volta
const STAB: Key[] = [
  [0, 0, 0, 0, 0, 0, 0, 'smooth'],
  [0.36, 0.03, 0.05, 0.1, 0.5, -0.12, -0.25, 'slow'], // carrega
  [0.5, -0.08, 0.03, -0.32, -0.14, 0.14, 0.12, 'fast'], // estocada
  [0.64, -0.09, 0.02, -0.33, -0.16, 0.14, 0.12, 'slow'], // segura no alvo
  [1, 0, 0, 0, 0, 0, 0, 'smooth'],
];

function sampleKeys(keys: Key[], f: number): number[] {
  let i = 1;
  while (i < keys.length - 1 && f > keys[i][0]) i++;
  const a = keys[i - 1], b = keys[i];
  const u = Math.max(0, Math.min(1, (f - a[0]) / Math.max(1e-4, b[0] - a[0])));
  const e = b[7] === 'fast' ? 1 - Math.pow(1 - u, 3) : b[7] === 'slow' ? u * u : u * u * (3 - 2 * u);
  const out: number[] = [];
  for (let k = 1; k <= 6; k++) out.push((a[k] as number) + ((b[k] as number) - (a[k] as number)) * e);
  return out;
}

class Spring {
  v = 0; x = 0;
  constructor(public k: number, public d: number) {}
  /** Integração semi-implícita com sub-passos: estável mesmo com quedas de FPS. */
  step(target: number, dt: number) {
    let t = Math.min(dt, 0.25);
    while (t > 1e-6) {
      const h = Math.min(t, 1 / 240);
      const a = (target - this.x) * this.k - this.v * this.d;
      this.v += a * h; this.x += this.v * h;
      t -= h;
    }
    if (!Number.isFinite(this.x) || !Number.isFinite(this.v)) { this.x = 0; this.v = 0; }
    this.x = Math.max(-2, Math.min(2, this.x));
    return this.x;
  }
}

/** Viewmodel em primeira pessoa com animações procedurais por molas. */
export class ViewModel {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
  private holder = new THREE.Group();
  private models = new Map<WeaponId, WeaponModel>();
  private cur: WeaponModel | null = null;
  private curId: WeaponId | '' = '';
  private arms: THREE.Group;
  private flash: THREE.Sprite;
  private flashT = 0;
  private kickZ = new Spring(220, 22);
  private kickR = new Spring(200, 20);
  private swayX = new Spring(90, 14);
  private swayY = new Spring(90, 14);
  private kickImpulse = 0;
  private bobT = 0;
  private inspectT = -1;
  private meleeT = -1;
  private meleeHeavy = false;
  private slashDir = 1;
  private time = 0;
  team: Team = 'T';
  /** viewmodel_fov (54..68 no CS) */
  fov = 60;
  /** viewmodel_offset_x/y/z (unidades do CS; 1 unidade ≈ 1 cm aqui) */
  offX = 1; offY = 1; offZ = -1;
  /** cl_bob: escala do balanço ao andar (0 desliga) */
  bob = 1;

  constructor() {
    this.scene.add(new THREE.HemisphereLight(0xfff2dd, 0x6b5a45, 1.6));
    const d = new THREE.DirectionalLight(0xffffff, 1.6);
    d.position.set(0.5, 1, 0.6);
    this.scene.add(d);
    this.scene.add(this.camera);
    this.camera.add(this.holder);
    this.arms = new THREE.Group();
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures().flash, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.visible = false;
  }

  /** Pré-cria modelos para evitar travadas na troca. */
  warm() { for (const id of Object.keys(POSE) as WeaponId[]) this.get(id); }

  private get(id: WeaponId) {
    let m = this.models.get(id);
    if (!m) { m = buildWeapon(id); this.models.set(id, m); }
    return m;
  }

  private buildArms(model: WeaponModel) {
    this.arms.clear();
    const sleeve = this.team === 'T' ? 0x6e5232 : 0x2f3e57;
    const glove = 0x2a2420;
    const seg = (a: THREE.Vector3, b: THREE.Vector3, w: number, color: number) => {
      const len = a.distanceTo(b);
      const g = new GeoBuilder().box(w, w, len, color, [0, 0, -len / 2]).mesh();
      g.position.copy(a);
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), b.clone().sub(a).normalize());
      this.arms.add(g);
    };
    const hand = (p: THREE.Vector3, size: [number, number, number] = [0.06, 0.07, 0.09]) => {
      const h = new GeoBuilder().box(size[0], size[1], size[2], glove, [0, 0, 0]).mesh(); h.position.copy(p); this.arms.add(h);
    };
    if (model.id === 'knife') {
      // punho fechado envolvendo o cabo (cabo vai de z -0.025 a 0.085); antebraço vem de baixo/trás
      seg(new THREE.Vector3(0.05, -0.17, 0.42), new THREE.Vector3(0, -0.012, 0.07), 0.078, sleeve);
      hand(new THREE.Vector3(0, -0.004, 0.035), [0.068, 0.072, 0.1]);
      // polegar apoiado sobre o cabo
      hand(new THREE.Vector3(-0.012, 0.03, 0.005), [0.03, 0.022, 0.05]);
      return;
    }
    const rh = new THREE.Vector3(0.0, -0.03, 0.04);
    const lh = model.support.clone();
    seg(new THREE.Vector3(0.12, -0.2, 0.38), rh, 0.075, sleeve);
    hand(rh);
    if (WEAPONS[model.id].slot !== 3) { seg(new THREE.Vector3(-0.22, -0.24, 0.3), lh, 0.072, sleeve); hand(lh); }
  }

  setWeapon(id: WeaponId) {
    if (this.curId === id) return;
    if (this.cur) this.holder.remove(this.cur.root);
    const m = this.get(id);
    this.cur = m; this.curId = id;
    this.holder.add(m.root);
    this.buildArms(m);
    m.root.add(this.arms);
    m.muzzle.add(this.flash);
    this.flash.visible = false;
    this.inspectT = -1; this.meleeT = -1;
  }

  onFire(id: WeaponId) {
    const def = WEAPONS[id];
    this.kickImpulse = def.kick;
    this.kickZ.v += 1.2 * def.kick;
    this.kickR.v += 9 * def.kick;
    if (!def.sound.suppressed) {
      this.flash.visible = true; this.flashT = 0.045;
      this.flash.scale.setScalar((def.cls === 'sniper' || def.cls === 'shotgun' || def.cls === 'lmg' ? 0.32 : def.cls === 'smg' ? 0.17 : 0.2) * (0.8 + Math.random() * 0.4));
      this.flash.material.rotation = Math.random() * 6;
    }
    this.inspectT = -1;
  }

  onMelee(heavy: boolean) {
    this.meleeT = 0; this.meleeHeavy = heavy; this.inspectT = -1;
    if (!heavy) this.slashDir = -this.slashDir; // cortes leves alternam ida e volta
  }
  inspect() { if (this.inspectT < 0) this.inspectT = 0; }
  isInspecting() { return this.inspectT >= 0; }

  update(dt: number, st: PlayerState, look: { dx: number; dy: number }, extra: { plantP: number; crouch: number; aspect: number; visible: boolean }) {
    this.time += dt;
    this.camera.aspect = extra.aspect;
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
    this.setWeapon(st.weapon);
    const m = this.cur!;
    const def = WEAPONS[st.weapon];
    this.holder.visible = extra.visible && st.scope === 0;
    if (!this.holder.visible) return;
    const base = POSE[st.weapon] ?? CLASS_POSE[def.cls] ?? [0.12, -0.13, -0.25];
    const speed = Math.hypot(st.vel.x, st.vel.z);
    const sp = Math.min(1, speed / 6) * (st.onGround ? 1 : 0.2) * this.bob;
    this.bobT += dt * (6 + speed * 1.2) * (st.onGround ? 1 : 0.2);
    const bobX = Math.sin(this.bobT) * 0.008 * sp;
    const bobY = -Math.abs(Math.cos(this.bobT)) * 0.01 * sp;
    const idle = Math.sin(this.time * 1.6) * 0.0025;
    const sx = this.swayX.step(Math.max(-0.05, Math.min(0.05, -look.dx * 0.0009)), dt);
    const sy = this.swayY.step(Math.max(-0.05, Math.min(0.05, look.dy * 0.0009)), dt);
    const kz = this.kickZ.step(0, dt);
    const kr = this.kickR.step(0, dt);
    // offsets relativos ao padrão do CS (x=1, y=1, z=-1)
    const ox = (this.offX - 1) * 0.012, oy = (this.offZ + 1) * 0.012, oz = -(this.offY - 1) * 0.012;
    let px = base[0] + bobX + sx + ox, py = base[1] + bobY + idle + sy - extra.crouch * 0.01 + oy, pz = base[2] + kz * 0.03 + oz;
    const br = BASE_ROT[st.weapon] ?? [0, 0, 0];
    let rx = br[0] + kr * 0.02 + sy * 0.6, ry = br[1] + 0.035 + sx * 1.5, rz = br[2] - sx * 2;
    // deploy
    if (st.deployT > 0) {
      const k = Math.min(1, st.deployT / Math.max(0.1, def.deployTime));
      const e = k * k;
      py -= 0.22 * e; rx -= 0.9 * e;
    }
    // recarga
    if (m.mag) m.mag.position.y = m.mag.userData.baseY ?? (m.mag.userData.baseY = m.mag.position.y);
    if (st.reloadT > 0 && def.reloadTime > 0) {
      const f = 1 - st.reloadT / def.reloadTime;
      const s = Math.sin(Math.min(1, f) * Math.PI);
      rz += s * 0.55; rx += s * 0.22; px -= s * 0.03; py -= s * 0.02;
      if (m.mag) {
        const base = m.mag.userData.baseY as number;
        let off = 0;
        if (f > 0.12 && f < 0.42) off = -0.28 * smooth((f - 0.12) / 0.3);
        else if (f >= 0.42 && f < 0.72) off = -0.28 * (1 - smooth((f - 0.42) / 0.3));
        m.mag.position.y = base + off;
        m.mag.visible = !(f > 0.36 && f < 0.48);
      }
      if (m.slide && f > 0.82) m.slide.position.z = (m.slide.userData.bz ?? (m.slide.userData.bz = m.slide.position.z)) + Math.sin((f - 0.82) / 0.18 * Math.PI) * 0.03;
    } else if (m.mag) m.mag.visible = true;
    if (m.slide) {
      const bz = m.slide.userData.bz ?? (m.slide.userData.bz = m.slide.position.z);
      if (!(st.reloadT > 0)) m.slide.position.z = bz + Math.max(0, kz) * 0.02;
    }
    // inspeção
    if (this.inspectT >= 0) {
      if (st.reloadT > 0 || st.deployT > 0) this.inspectT = -1;
      else {
        this.inspectT += dt;
        const T = 2.6, f = this.inspectT / T;
        if (f >= 1) this.inspectT = -1;
        else {
          const a = smooth(Math.min(1, f * 3)) * (1 - smooth(Math.max(0, (f - 0.7) / 0.3)));
          const twist = Math.sin(f * Math.PI * 2) * 0.35;
          ry += a * 0.9 + twist * a; rz += a * 0.5; rx += a * 0.15; px -= a * 0.05; py += a * 0.02;
        }
      }
    }
    // faca
    if (this.meleeT >= 0) {
      this.meleeT += dt;
      const T = this.meleeHeavy ? 0.78 : 0.4;
      const f = this.meleeT / T;
      if (f >= 1) this.meleeT = -1;
      else {
        const keys = this.meleeHeavy ? STAB : this.slashDir > 0 ? SLASH_A : SLASH_B;
        const [dx, dy, dz, drx, dry, drz] = sampleKeys(keys, f);
        px += dx; py += dy; pz += dz; rx += drx; ry += dry; rz += drz;
      }
    }
    // granada: puxando o pino
    if (st.throwT > 0) { const k = 1 - st.throwT / 0.35; py += 0.04 * k; pz += 0.12 * k; rx += 0.5 * k; }
    // plantando
    if (extra.plantP > 0) { py -= 0.05; rx -= 0.4; px += Math.sin(this.time * 30) * 0.004; }
    if (st.weapon === 'c4') {
      const led = m.root.getObjectByName('led');
      if (led) led.visible = Math.sin(this.time * 6) > 0;
    }
    m.root.position.set(px, py, pz);
    m.root.rotation.set(rx, ry, rz);
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.visible = false; }
  }
}

function smooth(x: number) { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); }
