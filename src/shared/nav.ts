import type { NavGraph } from './map';
import type { V3 } from './math';
import type { World } from './world';

export class Nav {
  adj: number[][];
  constructor(public g: NavGraph, private world: World) {
    this.adj = g.nodes.map(() => []);
    for (const [a, b] of g.edges) { this.adj[a].push(b); this.adj[b].push(a); }
  }

  nearest(p: V3, requireLos = true): number {
    let best = -1, bd = Infinity;
    for (let i = 0; i < this.g.nodes.length; i++) {
      const n = this.g.nodes[i];
      const d = (n.x - p.x) ** 2 + (n.z - p.z) ** 2 + (n.y - p.y) ** 2 * 4;
      if (d < bd) {
        if (requireLos && !this.world.los({ x: p.x, y: p.y + 1, z: p.z }, { x: n.x, y: n.y + 1, z: n.z })) continue;
        bd = d; best = i;
      }
    }
    if (best < 0 && requireLos) return this.nearest(p, false);
    return best;
  }

  path(from: number, to: number): number[] {
    if (from === to) return [to];
    const N = this.g.nodes;
    const h = (i: number) => Math.hypot(N[i].x - N[to].x, N[i].z - N[to].z);
    const gS = new Map<number, number>([[from, 0]]);
    const came = new Map<number, number>();
    const open = new Set<number>([from]);
    const f = new Map<number, number>([[from, h(from)]]);
    while (open.size) {
      let cur = -1, cf = Infinity;
      for (const o of open) { const v = f.get(o)!; if (v < cf) { cf = v; cur = o; } }
      if (cur === to) {
        const out = [cur];
        while (came.has(cur)) { cur = came.get(cur)!; out.unshift(cur); }
        return out;
      }
      open.delete(cur);
      for (const nb of this.adj[cur]) {
        const w = Math.hypot(N[cur].x - N[nb].x, N[cur].z - N[nb].z) * (0.9 + Math.random() * 0.3);
        const tg = gS.get(cur)! + w;
        if (tg < (gS.get(nb) ?? Infinity)) {
          came.set(nb, cur); gS.set(nb, tg); f.set(nb, tg + h(nb)); open.add(nb);
        }
      }
    }
    return [to];
  }
}
