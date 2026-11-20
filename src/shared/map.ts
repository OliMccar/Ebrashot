import type { V3 } from './math';
import { v3 } from './math';

export type Mat = 'sand' | 'stone' | 'wood' | 'metal' | 'tile' | 'plaster' | 'brick';

export interface Box {
  min: V3;
  max: V3;
  mat: Mat;
  color: number;
  /** false: colisor invisível (ex.: borda) */
  vis: boolean;
}

export interface Rect { x0: number; z0: number; x1: number; z1: number }

export interface FloorPatch { rect: Rect; mat: Mat; color: number; dark?: boolean }

export interface NavGraph { nodes: V3[]; names: string[]; edges: [number, number][] }

export interface MapData {
  name: string;
  bounds: Rect;
  boxes: Box[];
  floors: FloorPatch[];
  walkable: Rect[];
  sites: { A: Rect; B: Rect };
  siteCenters: { A: V3; B: V3 };
  spawns: { T: V3[]; CT: V3[] };
  buyZones: { T: Rect; CT: Rect };
  nav: NavGraph;
  plantNodes: { A: number[]; B: number[] };
  holdNodes: { A: number[]; B: number[] };
  ceilings: Rect[];
}

/** Resistência por metro para penetração de bala. */
export const MAT_RESIST: Record<Mat, number> = {
  sand: 2.2, stone: 2.6, wood: 0.9, metal: 3.2, tile: 2.6, plaster: 1.1, brick: 2.4,
};

export const MAT_COLOR: Record<Mat, number> = {
  sand: 0xd9b97c, stone: 0xb9a47e, wood: 0x9a6a3a, metal: 0x6f7c84, tile: 0xc8b28a, plaster: 0xe2cfa6, brick: 0xb2734c,
};

const R = (x0: number, z0: number, x1: number, z1: number): Rect => ({ x0, z0, x1, z1 });

export const inRect = (r: Rect, x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

/**
 * Mapa original "Sahel": layout tático com spawn TR ao sul, spawn CT ao norte,
 * Bombsite A (leste) e B (oeste), meio com portas, túnel coberto no oeste e passarela.
 */
export function buildMap(): MapData {
  const bounds = R(-48, -58, 48, 58);
  const walkable: Rect[] = [
    R(-40, 42, 40, 56), // spawn TR
    R(34, -14, 46, 44), // corredor longo A (leste)
    R(-46, -14, -34, 44), // túneis B (oeste)
    R(-6, -44, 6, 44), // meio
    R(18, -40, 46, -14), // bombsite A
    R(-46, -40, -18, -14), // bombsite B
    R(-46, -56, 46, -44), // corredor CT
    R(20, -44, 28, -40), // CT -> A
    R(-28, -44, -20, -40), // CT -> B
    R(6, -22, 18, -16), // A curto
    R(-18, -22, -6, -16), // B curto
    R(-34, -2, -6, 4), // janela B
    R(6, 16, 34, 20), // passarela meio -> longo
  ];

  const boxes: Box[] = [];
  const add = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: Mat, color?: number, vis = true) => {
    boxes.push({ min: v3(x0, y0, z0), max: v3(x1, y1, z1), mat, color: color ?? MAT_COLOR[mat], vis });
  };

  // Chão base (colisão). O visual do chão vem dos FloorPatch.
  add(bounds.x0 - 2, -2, bounds.z0 - 2, bounds.x1 + 2, 0, bounds.z1 + 2, 'sand', MAT_COLOR.sand, false);

  // Rasteriza células sólidas de 2 m e faz greedy merge para gerar paredes.
  const CS = 2;
  const nx = (bounds.x1 - bounds.x0) / CS;
  const nz = (bounds.z1 - bounds.z0) / CS;
  const solid: boolean[] = new Array(nx * nz).fill(true);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const cx = bounds.x0 + ix * CS + CS / 2;
      const cz = bounds.z0 + iz * CS + CS / 2;
      for (const r of walkable) if (cx > r.x0 && cx < r.x1 && cz > r.z0 && cz < r.z1) { solid[iz * nx + ix] = false; break; }
    }
  }
  const used: boolean[] = new Array(nx * nz).fill(false);
  let wallIdx = 0;
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const i = iz * nx + ix;
      if (!solid[i] || used[i]) continue;
      let w = 1;
      while (ix + w < nx && solid[i + w] && !used[i + w]) w++;
      let h = 1;
      outer: while (iz + h < nz) {
        for (let k = 0; k < w; k++) { const j = (iz + h) * nx + ix + k; if (!solid[j] || used[j]) break outer; }
        h++;
      }
      for (let a = 0; a < h; a++) for (let k = 0; k < w; k++) used[(iz + a) * nx + ix + k] = true;
      const x0 = bounds.x0 + ix * CS, z0 = bounds.z0 + iz * CS;
      const height = 4.6 + ((wallIdx * 7919) % 5) * 0.8;
      const mats: Mat[] = ['plaster', 'stone', 'brick', 'plaster', 'sand'];
      const mat = mats[wallIdx % mats.length];
      const tint = shade(MAT_COLOR[mat], 0.9 + ((wallIdx * 31) % 7) * 0.03);
      add(x0, 0, z0, x0 + w * CS, height, z0 + h * CS, mat, tint);
      wallIdx++;
    }
  }
  // Paredes externas altas invisíveis (evita sair do mapa pulando)
  add(bounds.x0 - 2, 0, bounds.z0 - 2, bounds.x0, 40, bounds.z1 + 2, 'stone', 0, false);
  add(bounds.x1, 0, bounds.z0 - 2, bounds.x1 + 2, 40, bounds.z1 + 2, 'stone', 0, false);
  add(bounds.x0, 0, bounds.z0 - 2, bounds.x1, 40, bounds.z0, 'stone', 0, false);
  add(bounds.x0, 0, bounds.z1, bounds.x1, 40, bounds.z1 + 2, 'stone', 0, false);

  // Caixas de cobertura (madeira penetrável) e contêineres de metal
  const crate = (x: number, z: number, s = 1, y = 0, mat: Mat = 'wood') =>
    add(x - s / 2, y, z - s / 2, x + s / 2, y + s, z + s / 2, mat, mat === 'wood' ? shade(MAT_COLOR.wood, 0.9 + Math.abs(x * 13 + z) % 3 * 0.08) : undefined);
  // Spawn TR
  crate(-30, 52, 1.2); crate(30, 52, 1.2); crate(-8, 44.6, 1); crate(30, 52, 1.0, 1.2);
  // Meio
  crate(-4.5, 30, 1); crate(4.5, 10, 1); crate(4.5, 10, 1, 1); crate(-4.5, -6, 1.2); crate(4, -30, 1);
  // Corredor longo A
  crate(44.5, 30, 1.2); crate(35.5, 10, 1); crate(44.5, -5, 1); crate(44.5, -5, 1, 1);
  add(43.2, 0, 22, 46, 2.6, 28, 'metal', 0x5d7a6a); // contêiner
  // Túneis B
  crate(-44.5, 25, 1); crate(-35.5, 12, 1.2); crate(-44.5, -6, 1);
  // Bombsite A
  crate(26, -27, 1.2); crate(27.2, -27, 1.2); crate(26.6, -27, 1.1, 1.2); crate(22, -36, 1); crate(44, -18, 1);
  add(36, 0, -40, 46, 0.9, -30, 'stone', 0xb8a27a); // plataforma
  add(36, 0, -30, 46, 0.6, -29, 'stone', 0xb09a73); // degrau 2
  add(36, 0, -29, 46, 0.3, -28, 'stone', 0xa89270); // degrau 1
  crate(44.4, -38.4, 1.2, 0.9);
  // Bombsite B
  crate(-26, -27, 1.2); crate(-27.2, -27, 1.2); crate(-26.6, -27, 1.1, 1.2); crate(-22, -36, 1); crate(-44, -20, 1.2);
  crate(-38, -36, 1); crate(-38, -37.2, 1.2);
  add(-46, 0, -40, -43.5, 2.4, -36, 'metal', 0x7a5d4a); // contêiner
  // CT
  crate(12, -55, 1); crate(-40, -52, 1.2); crate(40, -52, 1.2); crate(-12, -45.2, 1);

  // Portas do meio (madeira fina, penetrável) e topo
  add(-6, 0, -10.2, -1.5, 3.2, -9.8, 'wood', 0x7f5a34);
  add(1.5, 0, -10.2, 6, 3.2, -9.8, 'wood', 0x7f5a34);
  add(-6, 3.2, -10.3, 6, 4.4, -9.7, 'plaster', 0xd8c39a);
  // Parede da janela B com vão
  add(-20.2, 0, -2, -19.8, 3.4, 0, 'plaster', 0xdcc8a0);
  add(-20.2, 0, 2.6, -19.8, 3.4, 4, 'plaster', 0xdcc8a0);
  add(-20.3, 2.6, -2, -19.7, 3.4, 4, 'plaster', 0xdcc8a0);
  // Teto dos túneis
  const ceilings = [R(-46, 8, -34, 32)];
  add(-46, 3.4, 8, -34, 4.2, 32, 'stone', 0x8d7b5e);
  // Arcos sobre entradas (decorativos, acima da cabeça)
  add(34, 3.6, 42, 46, 4.6, 44, 'brick', 0xa8694a);
  add(-46, 3.6, 42, -34, 4.6, 44, 'brick', 0xa8694a);
  add(20, 3.4, -44, 28, 4.4, -42.5, 'brick', 0xa8694a);
  add(-28, 3.4, -44, -20, 4.4, -42.5, 'brick', 0xa8694a);

  const floors: FloorPatch[] = [
    { rect: R(-46, -56, 46, 56), mat: 'sand', color: 0xd6b67a },
    { rect: R(-6, -44, 6, 44), mat: 'stone', color: 0xc4ad84 },
    { rect: R(18, -40, 46, -14), mat: 'tile', color: 0xcdb48a },
    { rect: R(-46, -40, -18, -14), mat: 'tile', color: 0xc9b08a },
    { rect: R(-46, -56, 46, -44), mat: 'stone', color: 0xbfa985 },
    { rect: R(-46, 8, -34, 32), mat: 'stone', color: 0x9c8866, dark: true },
    { rect: R(6, 16, 34, 20), mat: 'wood', color: 0xa77c4e },
    { rect: R(24, -36, 40, -22), mat: 'tile', color: 0xd4bc92 },
    { rect: R(-40, -36, -24, -22), mat: 'tile', color: 0xd1b98f },
  ];

  const N = (x: number, z: number) => v3(x, 0, z);
  const navList: [string, V3][] = [
    ['TS', N(0, 50)], ['TSW', N(-20, 48)], ['TSE', N(20, 48)],
    ['W0', N(-38, 46)], ['W1', N(-40, 36)], ['W2', N(-40, 18)], ['W3', N(-40, 1)], ['W4', N(-40, -17)],
    ['E0', N(38, 46)], ['E1', N(40, 36)], ['E2', N(40, 18)], ['E3', N(40, 0)], ['E4', N(40, -17)],
    ['M1', N(0, 40)], ['M2', N(0, 18)], ['M3', N(0, 1)], ['M4', N(0, -19)], ['M5', N(0, -34)],
    ['MC', N(0, -50)], ['CW', N(-24, -50)], ['CE', N(24, -50)], ['CBL', N(-24, -42)], ['CAL', N(24, -42)],
    ['B1', N(-30, -18)], ['B2', N(-32, -29)], ['B3', N(-26, -33)], ['B4', N(-42, -34)],
    ['BC', N(-12, -19)], ['BW1', N(-12, 1)], ['BW2', N(-26, 1)],
    ['A1', N(28, -18)], ['A2', N(32, -29)], ['A3', N(26, -33)], ['AS', N(41, -26)], ['AP', N(41, -35)],
    ['AC', N(12, -19)], ['CAT1', N(12, 18)], ['CAT2', N(30, 18)],
  ];
  const names = navList.map((n) => n[0]);
  const idx = (n: string) => { const i = names.indexOf(n); if (i < 0) throw new Error('nav ' + n); return i; };
  const edgeNames: [string, string][] = [
    ['TS', 'TSW'], ['TS', 'TSE'], ['TS', 'M1'], ['TSW', 'W0'], ['W0', 'W1'], ['W1', 'W2'], ['W2', 'W3'], ['W3', 'W4'], ['W4', 'B1'],
    ['TSE', 'E0'], ['E0', 'E1'], ['E1', 'E2'], ['E2', 'E3'], ['E3', 'E4'], ['E4', 'A1'], ['E4', 'A2'], ['E4', 'AS'],
    ['M1', 'M2'], ['M2', 'M3'], ['M3', 'M4'], ['M4', 'M5'], ['M5', 'MC'], ['MC', 'CW'], ['MC', 'CE'], ['CW', 'CBL'], ['CE', 'CAL'],
    ['CBL', 'B3'], ['CAL', 'A3'], ['B1', 'B2'], ['B2', 'B3'], ['B2', 'B4'], ['B3', 'B4'], ['W4', 'B4'],
    ['M4', 'BC'], ['BC', 'B1'], ['M4', 'AC'], ['AC', 'A1'], ['M3', 'BW1'], ['BW1', 'BW2'], ['BW2', 'W3'],
    ['M2', 'CAT1'], ['CAT1', 'CAT2'], ['CAT2', 'E2'], ['A1', 'A2'], ['A2', 'A3'], ['A2', 'AS'], ['AS', 'AP'],
  ];
  const nav: NavGraph = { nodes: navList.map((n) => n[1]), names, edges: edgeNames.map(([a, b]) => [idx(a), idx(b)]) };

  const spawnsT: V3[] = []; const spawnsCT: V3[] = [];
  for (const x of [-8, -4, 0, 4, 8]) { spawnsT.push(v3(x, 0, 48), v3(x, 0, 52)); spawnsCT.push(v3(x, 0, -48), v3(x, 0, -52)); }

  return {
    name: 'Sahel',
    bounds, boxes, floors, walkable,
    sites: { A: R(24, -36, 40, -22), B: R(-40, -36, -24, -22) },
    siteCenters: { A: v3(32, 0, -29), B: v3(-32, 0, -29) },
    spawns: { T: spawnsT, CT: spawnsCT },
    buyZones: { T: R(-40, 42, 40, 56), CT: R(-46, -56, 46, -44) },
    nav,
    plantNodes: { A: [idx('A2'), idx('A3')], B: [idx('B2'), idx('B3')] },
    holdNodes: { A: [idx('A2'), idx('AP'), idx('A3'), idx('A1')], B: [idx('B2'), idx('B4'), idx('B3'), idx('B1')] },
    ceilings,
  };
}

function shade(c: number, f: number) {
  const r = Math.min(255, ((c >> 16) & 255) * f), g = Math.min(255, ((c >> 8) & 255) * f), b = Math.min(255, (c & 255) * f);
  return (r << 16) | (g << 8) | b;
}
