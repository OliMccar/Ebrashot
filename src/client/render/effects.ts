import * as THREE from 'three';
import type { V3 } from '../../shared/math';
import type { Mat } from '../../shared/map';
import { textures } from './textures';

const UP = new THREE.Vector3(0, 0, 1);
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpM = new THREE.Matrix4();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();

interface Tracer { mesh: THREE.Mesh; from: THREE.Vector3; dir: THREE.Vector3; len: number; t: number; active: boolean }
interface Particle { p: THREE.Vector3; v: THREE.Vector3; life: number; max: number; size: number; grav: number; drag: number; color: THREE.Color }
interface Flash { sp: THREE.Sprite; t: number }
interface Boom { mesh: THREE.Mesh; sp: THREE.Sprite; t: number; big: boolean }
interface Cloud { id: number; group: THREE.Group; sprites: THREE.Sprite[]; seen: boolean; base: THREE.Vector3[] }
interface FireFx { id: number; group: THREE.Group; flames: THREE.Sprite[]; scorch: THREE.Mesh; seen: boolean; r: number }

const MAT_PARTICLE: Record<Mat, number> = {
  sand: 0xcfae78, stone: 0xb7a27c, wood: 0x8a5a2e, metal: 0xffd27a, tile: 0xcbb592, plaster: 0xe5d4ae, brick: 0xa86a48,
};

/** Efeitos com object pooling: traçantes, decals, partículas, flashes, explosões, fumaça e fogo. */
export class Effects {
  private tracers: Tracer[] = [];
  private decals: THREE.InstancedMesh;
  private decalIdx = 0;
  private parts: Particle[] = [];
  private partMesh: THREE.InstancedMesh;
  private partFree: number[] = [];
  private flashes: Flash[] = [];
  private booms: Boom[] = [];
  private clouds = new Map<number, Cloud>();
  private cloudPool: Cloud[] = [];
  private fires = new Map<number, FireFx>();
  private firePool: FireFx[] = [];
  private maxParticles: number;
  light: THREE.PointLight | null = null;
  /** Desliga a luz dinâmica sem recompilar shaders (a luz continua na cena com intensidade 0). */
  lightsOn = true;
  blood = true;
  private lightT = 0;

  /**
   * @param level      0 baixo, 1 médio, 2 alto: quantidade de decals, partículas e chamas
   * @param mobile     mantém a fumaça igual ao comportamento anterior (densidade da fumaça não depende da qualidade)
   * @param dynLights  cria a luz dinâmica de disparos e explosões
   */
  constructor(private scene: THREE.Scene, level: 0 | 1 | 2, mobile: boolean, dynLights: boolean) {
    const T = textures();
    const trMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const trGeo = new THREE.BoxGeometry(0.018, 0.018, 1);
    trGeo.translate(0, 0, 0.5);
    for (let i = 0; i < 40; i++) {
      const mesh = new THREE.Mesh(trGeo, trMat);
      mesh.visible = false; mesh.frustumCulled = false;
      scene.add(mesh);
      this.tracers.push({ mesh, from: new THREE.Vector3(), dir: new THREE.Vector3(), len: 0, t: 0, active: false });
    }
    const decalCount = [64, 140, 260][level];
    this.decals = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.11, 0.11),
      new THREE.MeshBasicMaterial({ map: T.hole, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
      decalCount,
    );
    tmpM.makeScale(0, 0, 0);
    for (let i = 0; i < decalCount; i++) this.decals.setMatrixAt(i, tmpM);
    this.decals.frustumCulled = false;
    scene.add(this.decals);

    this.maxParticles = [160, 320, 600][level];
    this.partMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), this.maxParticles);
    this.partMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.maxParticles * 3), 3);
    for (let i = 0; i < this.maxParticles; i++) {
      this.partMesh.setMatrixAt(i, tmpM);
      this.parts.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, max: 1, size: 0.05, grav: 9, drag: 1, color: new THREE.Color() });
      this.partFree.push(i);
    }
    this.partMesh.frustumCulled = false;
    scene.add(this.partMesh);

    for (let i = 0; i < 12; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.flash, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      sp.visible = false; scene.add(sp);
      this.flashes.push({ sp, t: 0 });
    }
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: 0xffd090 }));
      mesh.visible = sp.visible = false;
      scene.add(mesh, sp);
      this.booms.push({ mesh, sp, t: 99, big: false });
    }
    const puffN = mobile ? 12 : 18;
    for (let i = 0; i < 6; i++) {
      const group = new THREE.Group(); group.visible = false; scene.add(group);
      const sprites: THREE.Sprite[] = [], base: THREE.Vector3[] = [];
      for (let k = 0; k < puffN; k++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.puff, color: 0xc8c8c4, transparent: true, depthWrite: false, opacity: 0.95 }));
        group.add(sp); sprites.push(sp);
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 3.0;
        base.push(new THREE.Vector3(Math.cos(a) * r, 0.9 + Math.random() * 2.4, Math.sin(a) * r));
      }
      this.cloudPool.push({ id: -1, group, sprites, seen: false, base });
    }
    for (let i = 0; i < 4; i++) {
      const group = new THREE.Group(); group.visible = false; scene.add(group);
      const flames: THREE.Sprite[] = [];
      for (let k = 0; k < [8, 12, 18][level]; k++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.flame, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
        group.add(sp); flames.push(sp);
      }
      const scorch = new THREE.Mesh(new THREE.CircleGeometry(1, 12), new THREE.MeshBasicMaterial({ map: T.scorch, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
      scorch.rotation.x = -Math.PI / 2; scorch.position.y = 0.02;
      group.add(scorch);
      this.firePool.push({ id: -1, group, flames, scorch, seen: false, r: 3 });
    }
    if (dynLights) {
      this.light = new THREE.PointLight(0xffc070, 0, 9, 2);
      scene.add(this.light);
    }
  }

  tracer(from: V3, to: V3) {
    const t = this.tracers.find((x) => !x.active);
    if (!t) return;
    t.from.set(from.x, from.y, from.z);
    t.dir.set(to.x - from.x, to.y - from.y, to.z - from.z);
    t.len = t.dir.length();
    if (t.len < 1) return;
    t.dir.divideScalar(t.len);
    t.t = 0; t.active = true; t.mesh.visible = true;
    tmpQ.setFromUnitVectors(UP, t.dir);
    t.mesh.quaternion.copy(tmpQ);
  }

  decal(p: V3, n: V3) {
    tmpV.set(n.x, n.y, n.z).normalize();
    tmpQ.setFromUnitVectors(UP, tmpV);
    const s = 0.8 + Math.random() * 0.5;
    tmpS.set(s, s, s);
    tmpM.compose(new THREE.Vector3(p.x + n.x * 0.005, p.y + n.y * 0.005, p.z + n.z * 0.005), tmpQ, tmpS);
    this.decals.setMatrixAt(this.decalIdx, tmpM);
    this.decalIdx = (this.decalIdx + 1) % this.decals.count;
    this.decals.instanceMatrix.needsUpdate = true;
  }

  burst(p: V3, n: V3, color: number, count: number, speed: number, size: number, life: number, grav = 9, spread = 1) {
    for (let i = 0; i < count; i++) {
      const idx = this.partFree.pop();
      if (idx === undefined) return;
      const q = this.parts[idx];
      q.p.set(p.x, p.y, p.z);
      q.v.set(n.x + (Math.random() - 0.5) * spread, n.y + (Math.random() - 0.5) * spread, n.z + (Math.random() - 0.5) * spread).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      q.life = q.max = life * (0.6 + Math.random() * 0.6);
      q.size = size * (0.6 + Math.random() * 0.8);
      q.grav = grav; q.drag = 2;
      q.color.setHex(color);
      tmpC.copy(q.color).multiplyScalar(0.8 + Math.random() * 0.4);
      this.partMesh.setColorAt(idx, tmpC);
    }
    if (this.partMesh.instanceColor) this.partMesh.instanceColor.needsUpdate = true;
  }

  impact(p: V3, n: V3, m: Mat) {
    this.decal(p, n);
    this.burst(p, n, MAT_PARTICLE[m], m === 'metal' ? 6 : 5, m === 'metal' ? 5 : 2.5, 0.035, 0.45, 9, 1.2);
    if (m === 'metal') this.burst(p, n, 0xfff0a0, 3, 7, 0.02, 0.2, 4, 1.5);
  }

  bloodFx(p: V3, dir: V3, head: boolean) {
    if (this.blood) this.bloodBurst(p, dir, head);
  }

  private bloodBurst(p: V3, dir: V3, head: boolean) {
    this.burst(p, dir, 0x8a0f0f, head ? 12 : 7, head ? 3.5 : 2.5, 0.045, 0.5, 9, 1.4);
  }

  muzzle(p: V3, scale = 0.5) {
    const f = this.flashes.find((x) => x.t <= 0) ?? this.flashes[0];
    f.sp.position.set(p.x, p.y, p.z);
    f.sp.scale.setScalar(scale * (0.8 + Math.random() * 0.4));
    f.sp.material.rotation = Math.random() * Math.PI;
    f.sp.visible = true; f.t = 0.05;
    if (this.light && this.lightsOn) { this.light.position.set(p.x, p.y, p.z); this.light.intensity = 3; this.lightT = 0.05; }
  }

  explosion(p: V3, big: boolean) {
    const b = this.booms.find((x) => x.t > 1) ?? this.booms[0];
    b.mesh.position.set(p.x, p.y + 0.3, p.z);
    b.sp.position.set(p.x, p.y + 0.6, p.z);
    b.t = 0; b.big = big;
    b.mesh.visible = b.sp.visible = true;
    this.burst({ x: p.x, y: p.y + 0.2, z: p.z }, { x: 0, y: 1, z: 0 }, 0xffa040, big ? 60 : 30, big ? 14 : 9, 0.09, 0.9, 6, 2.2);
    this.burst({ x: p.x, y: p.y + 0.2, z: p.z }, { x: 0, y: 1, z: 0 }, 0x3a332c, big ? 40 : 20, big ? 6 : 4, 0.25, 1.6, -0.5, 2);
    this.decal({ x: p.x, y: p.y + 0.01, z: p.z }, { x: 0, y: 1, z: 0 });
    if (this.light && this.lightsOn) { this.light.position.set(p.x, p.y + 1, p.z); this.light.intensity = big ? 40 : 15; this.light.distance = big ? 40 : 18; this.lightT = 0.25; }
  }

  flashPop(p: V3) {
    const b = this.booms.find((x) => x.t > 1) ?? this.booms[0];
    b.sp.position.set(p.x, p.y, p.z);
    b.t = 0.55; b.big = false;
    b.sp.visible = true; b.mesh.visible = false;
    b.sp.material.color.setHex(0xffffff);
    this.burst(p, { x: 0, y: 1, z: 0 }, 0xffffff, 10, 6, 0.03, 0.3, 3, 2);
  }

  /** Sincroniza nuvens de fumaça com o snapshot. */
  syncSmokes(list: { id: number; x: number; y: number; z: number; age: number; life: number }[]) {
    for (const c of this.clouds.values()) c.seen = false;
    for (const s of list) {
      let c = this.clouds.get(s.id);
      if (!c) {
        c = this.cloudPool.find((x) => x.id === -1);
        if (!c) continue;
        c.id = s.id; this.clouds.set(s.id, c);
        c.group.visible = true;
      }
      c.seen = true;
      c.group.position.set(s.x, s.y, s.z);
      const grow = Math.min(1, s.age / 1.2);
      const fade = Math.min(1, (s.life - s.age) / 2.5);
      c.sprites.forEach((sp, i) => {
        const b = c!.base[i];
        const wob = Math.sin(s.age * 0.4 + i) * 0.25;
        sp.position.set(b.x * grow + wob, b.y * (0.4 + 0.6 * grow), b.z * grow);
        sp.scale.setScalar((3.2 + (i % 3) * 0.6) * (0.4 + 0.6 * grow));
        sp.material.opacity = 0.93 * fade;
        sp.material.rotation = i + s.age * 0.05 * (i % 2 ? 1 : -1);
      });
    }
    for (const [id, c] of this.clouds) if (!c.seen) { c.group.visible = false; c.id = -1; this.clouds.delete(id); }
  }

  syncFires(list: { id: number; x: number; y: number; z: number; r: number; age: number; life: number }[], t: number) {
    for (const f of this.fires.values()) f.seen = false;
    for (const s of list) {
      let f = this.fires.get(s.id);
      if (!f) {
        f = this.firePool.find((x) => x.id === -1);
        if (!f) continue;
        f.id = s.id; this.fires.set(s.id, f); f.group.visible = true;
      }
      f.seen = true;
      f.group.position.set(s.x, s.y, s.z);
      const r = s.r * Math.min(1, s.age / 0.5 + 0.3);
      const fade = Math.min(1, (s.life - s.age) / 1.0);
      f.scorch.scale.setScalar(r * 1.15);
      f.flames.forEach((sp, i) => {
        const a = i * 2.399 + Math.sin(t * 2 + i) * 0.3;
        const rr = Math.sqrt((i + 0.5) / f!.flames.length) * r * 0.9;
        const flick = 0.7 + Math.sin(t * 13 + i * 7) * 0.2 + Math.random() * 0.15;
        sp.position.set(Math.cos(a) * rr, 0.35 * flick, Math.sin(a) * rr);
        sp.scale.set(0.9 * flick * fade, 1.3 * flick * fade, 1);
      });
    }
    for (const [id, f] of this.fires) if (!f.seen) { f.group.visible = false; f.id = -1; this.fires.delete(id); }
  }

  update(dt: number) {
    for (const t of this.tracers) {
      if (!t.active) continue;
      t.t += dt;
      // a cauda segue o tempo (não a cabeça já parada no impacto): tiros curtos (< 4 m) também terminam
      const travel = t.t * 320;
      const head = Math.min(t.len, travel);
      const tail = Math.min(head, Math.max(0, travel - 4));
      if (tail >= t.len - 0.01 || t.t > 2) { t.active = false; t.mesh.visible = false; continue; }
      t.mesh.position.copy(t.from).addScaledVector(t.dir, tail);
      t.mesh.scale.set(1, 1, Math.max(0.01, head - tail));
    }
    let any = false;
    for (let i = 0; i < this.parts.length; i++) {
      const q = this.parts[i];
      if (q.life <= 0) continue;
      any = true;
      q.life -= dt;
      if (q.life <= 0) {
        tmpM.makeScale(0, 0, 0);
        this.partMesh.setMatrixAt(i, tmpM);
        this.partFree.push(i);
        continue;
      }
      q.v.y -= q.grav * dt;
      q.v.multiplyScalar(Math.exp(-q.drag * dt));
      q.p.addScaledVector(q.v, dt);
      const s = q.size * (0.4 + 0.6 * (q.life / q.max));
      tmpM.makeScale(s, s, s);
      tmpM.setPosition(q.p);
      this.partMesh.setMatrixAt(i, tmpM);
    }
    if (any) this.partMesh.instanceMatrix.needsUpdate = true;
    for (const f of this.flashes) { if (f.t > 0) { f.t -= dt; if (f.t <= 0) f.sp.visible = false; } }
    for (const b of this.booms) {
      if (b.t > 1) continue;
      b.t += dt;
      const k = b.t / (b.big ? 0.9 : 0.6);
      if (k >= 1) { b.mesh.visible = b.sp.visible = false; b.t = 2; b.sp.material.color.setHex(0xffd090); continue; }
      const R = (b.big ? 9 : 4.2) * Math.pow(k, 0.4);
      b.mesh.scale.setScalar(R);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.85;
      b.sp.scale.setScalar(R * 2.6);
      b.sp.material.opacity = 1 - k;
    }
    if (this.light && this.lightT > 0) { this.lightT -= dt; if (this.lightT <= 0) this.light.intensity = 0; }
  }
}
