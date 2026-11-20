import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapData } from '../../shared/map';
import { textures } from './textures';

const col = new THREE.Color();

function colorize(g: THREE.BufferGeometry, base: number, minY: number, maxY: number, ao: boolean, jitter: number) {
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const n = pos.count;
  const c = new Float32Array(n * 3);
  col.setHex(base);
  const h = maxY - minY;
  for (let i = 0; i < n; i++) {
    const y = pos.getY(i);
    let f = 1 + jitter;
    const up = nrm ? nrm.getY(i) > 0.9 : false;
    if (ao && h > 1.2 && !up) f *= 0.68 + 0.32 * Math.min(1, (y - minY) / Math.min(2.2, h));
    if (up) f *= 1.08; // topo
    c[i * 3] = col.r * f; c[i * 3 + 1] = col.g * f; c[i * 3 + 2] = col.b * f;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
}

/** Gera a malha estática do mapa: tudo mesclado em poucos draw calls. */
export function buildMapMesh(map: MapData): THREE.Group {
  const group = new THREE.Group();
  const parts: THREE.BufferGeometry[] = [];
  let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  for (const b of map.boxes) {
    if (!b.vis) continue;
    const w = b.max.x - b.min.x, h = b.max.y - b.min.y, d = b.max.z - b.min.z;
    // faces longas subdivididas (evita artefatos de precisão perto do near plane em GPUs móveis)
    const g = new THREE.BoxGeometry(w, h, d, Math.max(1, Math.ceil(w / 6)), Math.max(1, Math.ceil(h / 6)), Math.max(1, Math.ceil(d / 6))).toNonIndexed();
    g.deleteAttribute('uv');
    g.translate((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
    colorize(g, b.color, b.min.y, b.max.y, true, (rnd() - 0.5) * 0.06);
    parts.push(g);
    // detalhes nas paredes altas: cornija e janelas
    if (h > 4 && b.min.y === 0) {
      const cap = new THREE.BoxGeometry(w + 0.24, 0.22, d + 0.24).toNonIndexed();
      cap.deleteAttribute('uv');
      cap.translate((b.min.x + b.max.x) / 2, b.max.y + 0.05, (b.min.z + b.max.z) / 2);
      colorize(cap, 0xe8d6b0, 0, 1, false, 0);
      parts.push(cap);
      const addWin = (x: number, z: number, nx: number, nz: number) => {
        const ww = 1.1, wh = 1.4;
        const wg = new THREE.BoxGeometry(nx ? 0.06 : ww, wh, nz ? 0.06 : ww).toNonIndexed();
        wg.deleteAttribute('uv');
        wg.translate(x + nx * 0.03, 3.1, z + nz * 0.03);
        colorize(wg, rnd() < 0.5 ? 0x3b2c20 : 0x2f4a5a, 0, 1, false, 0);
        parts.push(wg);
        const sill = new THREE.BoxGeometry(nx ? 0.14 : ww + 0.2, 0.1, nz ? 0.14 : ww + 0.2).toNonIndexed();
        sill.deleteAttribute('uv');
        sill.translate(x + nx * 0.06, 2.35, z + nz * 0.06);
        colorize(sill, 0xd9c49c, 0, 1, false, 0);
        parts.push(sill);
      };
      for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const L = nx ? d : w;
        if (L < 4) continue;
        for (let s = 2; s < L - 1.5; s += 4) {
          if (rnd() < 0.45) continue;
          if (nx) addWin(nx > 0 ? b.max.x : b.min.x, b.min.z + s, nx, 0);
          else addWin(b.min.x + s, nz > 0 ? b.max.z : b.min.z, 0, nz);
        }
      }
    }
  }
  // chão por zona
  map.floors.forEach((f, i) => {
    const w = f.rect.x1 - f.rect.x0, d = f.rect.z1 - f.rect.z0;
    const seg = Math.max(1, Math.round(Math.max(w, d) / 8));
    const g = new THREE.PlaneGeometry(w, d, Math.max(1, Math.round(w / 3)), Math.max(1, Math.round(d / 3))).toNonIndexed();
    g.deleteAttribute('uv');
    g.rotateX(-Math.PI / 2);
    g.translate((f.rect.x0 + f.rect.x1) / 2, 0.002 * i, (f.rect.z0 + f.rect.z1) / 2);
    const n = g.getAttribute('position').count;
    const c = new Float32Array(n * 3);
    col.setHex(f.color);
    for (let k = 0; k < n; k += 3) {
      const v = (f.dark ? 0.62 : 1) * (0.95 + rnd() * 0.08);
      for (let j = 0; j < 3; j++) { c[(k + j) * 3] = col.r * v; c[(k + j) * 3 + 1] = col.g * v; c[(k + j) * 3 + 2] = col.b * v; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    void seg;
    parts.push(g);
  });
  // colinas distantes (horizonte low poly)
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rnd() * 0.2;
    const r = 115 + rnd() * 40;
    const h = 14 + rnd() * 26;
    const g = new THREE.ConeGeometry(18 + rnd() * 16, h, 5).toNonIndexed();
    g.deleteAttribute('uv');
    g.translate(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r);
    colorize(g, 0xc79a62, -2, h, false, (rnd() - 0.5) * 0.15);
    parts.push(g);
  }
  // chão externo
  // subdividido: triângulos gigantes geram artefatos de clipping/precisão em GPUs móveis
  const ground = new THREE.PlaneGeometry(500, 500, 25, 25).toNonIndexed();
  ground.deleteAttribute('uv'); ground.rotateX(-Math.PI / 2); ground.translate(0, -0.05, 0);
  colorize(ground, 0xc9a56c, 0, 1, false, 0);
  parts.push(ground);

  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.matrixAutoUpdate = false;
  group.add(mesh);

  // letras dos bombsites
  const T = textures();
  const decal = (tex: THREE.Texture, x: number, y: number, z: number, size: number, rotY: number, floor: boolean) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.position.set(x, y, z);
    if (floor) m.rotation.x = -Math.PI / 2;
    m.rotation.y = rotY;
    if (floor) m.rotation.z = rotY;
    group.add(m);
  };
  decal(T.letterA, map.siteCenters.A.x, 0.03, map.siteCenters.A.z, 5, 0, true);
  decal(T.letterB, map.siteCenters.B.x, 0.03, map.siteCenters.B.z, 5, 0, true);
  // placas nas paredes indicando direção
  decal(T.letterA, 45.9, 2.5, 34, 2.4, -Math.PI / 2, false);
  decal(T.letterB, -45.9, 2.5, 34, 2.4, Math.PI / 2, false);
  decal(T.letterA, 5.9, 2.4, -26, 2.2, -Math.PI / 2, false);
  decal(T.letterB, -5.9, 2.4, -26, 2.2, Math.PI / 2, false);

  // céu em gradiente
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(400, 16, 8),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: new THREE.Color(0x5d9ad6) }, bottom: { value: new THREE.Color(0xf2d9b0) } },
      vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying float h; void main(){ gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.05, 0.45, h)), 1.0);} ',
    }),
  );
  sky.renderOrder = -1;
  group.add(sky);
  return group;
}
