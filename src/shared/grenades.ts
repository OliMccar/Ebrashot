import type { Team } from './constants';
import type { V3 } from './math';
import type { GrenadeId } from './weapons';
import type { World } from './world';

export interface GrenadeProj {
  id: number; g: GrenadeId; owner: number; team: Team;
  pos: V3; vel: V3; age: number; floorHit: boolean;
}

const GR = 0.06;
const GRAV = 9.5;
const tmp: any[] = [];

function axisMove(world: World, p: V3, axis: 'x' | 'y' | 'z', d: number): boolean {
  if (d === 0) return false;
  p[axis] += d;
  const hits = world.query(p.x - GR, p.y - GR, p.z - GR, p.x + GR, p.y + GR, p.z + GR, tmp);
  if (!hits.length) return false;
  if (d > 0) { let lim = Infinity; for (const b of hits) lim = Math.min(lim, b.min[axis] - GR - 1e-4); p[axis] = Math.min(p[axis], lim); }
  else { let lim = -Infinity; for (const b of hits) lim = Math.max(lim, b.max[axis] + GR + 1e-4); p[axis] = Math.max(p[axis], lim); }
  return true;
}

/** Avança a granada; retorna true se deve detonar. */
export function stepGrenade(g: GrenadeProj, world: World, dt: number, onBounce: (p: V3, speed: number) => void): boolean {
  g.age += dt;
  g.vel.y -= GRAV * dt;
  const sub = 2;
  const h = dt / sub;
  g.floorHit = false;
  for (let i = 0; i < sub; i++) {
    for (const axis of ['x', 'z', 'y'] as const) {
      const v = g.vel[axis];
      if (axisMove(world, g.pos, axis, v * h)) {
        const sp = Math.abs(v);
        if (axis === 'y' && v < 0) {
          g.floorHit = true;
          g.vel.y = -v * 0.35;
          g.vel.x *= 0.7; g.vel.z *= 0.7;
          if (g.vel.y < 0.6) g.vel.y = 0;
        } else {
          g.vel[axis] = -v * 0.45;
        }
        if (sp > 1.2) onBounce({ ...g.pos }, sp);
      }
    }
  }
  if (g.floorHit && g.vel.y === 0) {
    // atrito de rolagem
    g.vel.x *= Math.exp(-4 * dt); g.vel.z *= Math.exp(-4 * dt);
  }
  const speed = Math.hypot(g.vel.x, g.vel.y, g.vel.z);
  switch (g.g) {
    case 'he': case 'flash': return g.age >= 1.6;
    case 'smoke': return (g.age > 1.2 && speed < 0.25) || g.age > 6;
    case 'molotov': return (g.floorHit && g.age > 0.05) || g.age > 2.5;
  }
}
