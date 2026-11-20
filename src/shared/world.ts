import type { Box, MapData, Mat } from './map';
import { MAT_RESIST } from './map';
import type { V3 } from './math';

export interface RayHit { t: number; box: Box; normal: V3 }
export interface RaySegment { tIn: number; tOut: number; box: Box; normal: V3 }

/** Mundo de colisão: lista de AABBs com broadphase em grade 2D. */
export class World {
  boxes: Box[];
  private cell = 8;
  private grid = new Map<number, Box[]>();
  private big: Box[] = [];

  constructor(public map: MapData) {
    this.boxes = map.boxes;
    for (const b of this.boxes) {
      const w = b.max.x - b.min.x, d = b.max.z - b.min.z;
      if (w > 60 || d > 60) { this.big.push(b); continue; }
      const x0 = Math.floor(b.min.x / this.cell), x1 = Math.floor(b.max.x / this.cell);
      const z0 = Math.floor(b.min.z / this.cell), z1 = Math.floor(b.max.z / this.cell);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const k = this.key(x, z);
        let arr = this.grid.get(k);
        if (!arr) { arr = []; this.grid.set(k, arr); }
        arr.push(b);
      }
    }
  }

  private key(x: number, z: number) { return (x + 1000) * 4096 + (z + 1000); }

  private stamp = 0;
  private marks = new WeakMap<Box, number>();
  /** Caixas que sobrepõem o AABB dado (com margem). */
  query(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, out: Box[]): Box[] {
    out.length = 0;
    this.stamp++;
    for (const b of this.big) if (overlap(b, minX, minY, minZ, maxX, maxY, maxZ)) out.push(b);
    const x0 = Math.floor(minX / this.cell), x1 = Math.floor(maxX / this.cell);
    const z0 = Math.floor(minZ / this.cell), z1 = Math.floor(maxZ / this.cell);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const arr = this.grid.get(this.key(x, z));
      if (!arr) continue;
      for (const b of arr) {
        if (this.marks.get(b) === this.stamp) continue;
        this.marks.set(b, this.stamp);
        if (overlap(b, minX, minY, minZ, maxX, maxY, maxZ)) out.push(b);
      }
    }
    return out;
  }

  /** Raio contra todas as caixas, retorna o impacto mais próximo. */
  raycast(o: V3, d: V3, maxT: number): RayHit | null {
    let best: RayHit | null = null;
    for (const b of this.boxes) {
      const h = rayBox(o, d, b);
      if (h && h.tIn >= 0 && h.tIn < maxT && (!best || h.tIn < best.t)) best = { t: h.tIn, box: b, normal: h.normal };
    }
    return best;
  }

  /** Todos os segmentos sólidos atravessados pelo raio, ordenados. */
  raySegments(o: V3, d: V3, maxT: number): RaySegment[] {
    const out: RaySegment[] = [];
    for (const b of this.boxes) {
      const h = rayBox(o, d, b);
      if (h && h.tOut > 0 && h.tIn < maxT) out.push({ tIn: Math.max(0, h.tIn), tOut: h.tOut, box: b, normal: h.normal });
    }
    out.sort((a, b) => a.tIn - b.tIn);
    return out;
  }

  /** Linha de visão livre entre dois pontos (ignora penetração). */
  los(a: V3, b: V3): boolean {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (L < 1e-4) return true;
    const d = { x: dx / L, y: dy / L, z: dz / L };
    return !this.raycast(a, d, L - 0.05);
  }

  floorMaterial(p: V3): Mat {
    const h = this.raycast({ x: p.x, y: p.y + 0.2, z: p.z }, { x: 0, y: -1, z: 0 }, 1.5);
    if (!h) return 'sand';
    if (h.box.vis === false) {
      for (let i = this.map.floors.length - 1; i >= 0; i--) {
        const f = this.map.floors[i];
        if (p.x >= f.rect.x0 && p.x <= f.rect.x1 && p.z >= f.rect.z0 && p.z <= f.rect.z1) return f.mat;
      }
      return 'sand';
    }
    return h.box.mat;
  }

  groundHeight(x: number, z: number, fromY: number): number {
    const h = this.raycast({ x, y: fromY, z }, { x: 0, y: -1, z: 0 }, 50);
    return h ? fromY - h.t : 0;
  }
}

export function resistOf(b: Box) { return MAT_RESIST[b.mat]; }

function overlap(b: Box, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) {
  return b.min.x < maxX && b.max.x > minX && b.min.y < maxY && b.max.y > minY && b.min.z < maxZ && b.max.z > minZ;
}

export function rayBox(o: V3, d: V3, b: { min: V3; max: V3 }): { tIn: number; tOut: number; normal: V3 } | null {
  let tmin = -Infinity, tmax = Infinity;
  let nAxis = 0, nSign = 0;
  // X
  if (Math.abs(d.x) < 1e-9) { if (o.x < b.min.x || o.x > b.max.x) return null; }
  else {
    const inv = 1 / d.x;
    let t1 = (b.min.x - o.x) * inv, t2 = (b.max.x - o.x) * inv;
    let s = -1; if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
    if (t1 > tmin) { tmin = t1; nAxis = 0; nSign = s; }
    if (t2 < tmax) tmax = t2;
  }
  if (Math.abs(d.y) < 1e-9) { if (o.y < b.min.y || o.y > b.max.y) return null; }
  else {
    const inv = 1 / d.y;
    let t1 = (b.min.y - o.y) * inv, t2 = (b.max.y - o.y) * inv;
    let s = -1; if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
    if (t1 > tmin) { tmin = t1; nAxis = 1; nSign = s; }
    if (t2 < tmax) tmax = t2;
  }
  if (Math.abs(d.z) < 1e-9) { if (o.z < b.min.z || o.z > b.max.z) return null; }
  else {
    const inv = 1 / d.z;
    let t1 = (b.min.z - o.z) * inv, t2 = (b.max.z - o.z) * inv;
    let s = -1; if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
    if (t1 > tmin) { tmin = t1; nAxis = 2; nSign = s; }
    if (t2 < tmax) tmax = t2;
  }
  if (tmax < tmin || tmax < 0) return null;
  const normal = { x: 0, y: 0, z: 0 };
  if (nAxis === 0) normal.x = nSign; else if (nAxis === 1) normal.y = nSign; else normal.z = nSign;
  return { tIn: tmin, tOut: tmax, normal };
}

export function raySphere(o: V3, d: V3, c: V3, r: number): number | null {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t >= 0) return t;
  const t2 = -b + Math.sqrt(disc);
  return t2 >= 0 ? 0 : null;
}
