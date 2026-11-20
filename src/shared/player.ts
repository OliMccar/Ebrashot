import {
  ACCELERATE, AIR_ACCELERATE, AIR_WISH_CAP, BTN_ALT, BTN_CROUCH, BTN_FIRE, BTN_JUMP, BTN_RELOAD, BTN_WALK,
  CROUCH_HEIGHT, CROUCH_MULT, DT, DUCK_SPEED, EYE_CROUCH, EYE_STAND, FRICTION, GRAVITY, JUMP_VELOCITY,
  PLAYER_RADIUS, STAND_HEIGHT, STEP_HEIGHT, STOP_SPEED, WALK_MULT,
} from './constants';
import type { V3 } from './math';
import { DEG, clamp, dirFromAngles, hash2, lerp, mulberry32, raySphereLocal } from './math';
import type { GrenadeId, WeaponId } from './weapons';
import { GRENADES, WEAPONS, patternAt } from './weapons';
import type { World } from './world';
import { rayBox } from './world';

export interface WeaponSlotState { id: WeaponId; mag: number; res: number }
export interface Inventory {
  primary: WeaponSlotState | null;
  secondary: WeaponSlotState | null;
  nades: Record<GrenadeId, number>;
  c4: boolean;
}

export interface PlayerState {
  id: number;
  pos: V3;
  vel: V3;
  onGround: boolean;
  duck: number;
  yaw: number;
  pitch: number;
  weapon: WeaponId;
  lastWeapon: WeaponId;
  inv: Inventory;
  deployT: number;
  nextFireT: number;
  reloadT: number;
  throwT: number;
  throwStrength: number;
  scope: number;
  rescope: number;
  recoilIdx: number;
  shotInacc: number;
  sinceShot: number;
  shots: number;
  prevBtn: number;
  frozen: boolean;
  busy: boolean;
  alive: boolean;
}

export interface Cmd {
  seq: number;
  yaw: number;
  pitch: number;
  mx: number; // strafe -1..1 (direita +)
  mz: number; // frente -1..1
  btn: number;
  wpn: WeaponId | '';
  rt: number; // tick de renderização do cliente (lag compensation)
  as: boolean; // auto-semi (mobile/auto-fire): pistolas disparam segurando
}

export type Intent =
  | { type: 'shot'; origin: V3; dir: V3; weapon: WeaponId; recoil: number }
  | { type: 'melee'; heavy: boolean; origin: V3; dir: V3 }
  | { type: 'throw'; g: GrenadeId; origin: V3; vel: V3 }
  | { type: 'dry' }
  | { type: 'reload'; weapon: WeaponId }
  | { type: 'pin'; g: GrenadeId }
  | { type: 'jump' }
  | { type: 'land'; speed: number };

export type Emit = (i: Intent) => void;

export const emptyCmd = (seq = 0): Cmd => ({ seq, yaw: 0, pitch: 0, mx: 0, mz: 0, btn: 0, wpn: '', rt: 0, as: false });

export function createPlayerState(id: number): PlayerState {
  return {
    id, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, onGround: true, duck: 0, yaw: 0, pitch: 0,
    weapon: 'knife', lastWeapon: 'knife',
    inv: { primary: null, secondary: null, nades: { he: 0, flash: 0, smoke: 0, molotov: 0 }, c4: false },
    deployT: 0, nextFireT: 0, reloadT: 0, throwT: 0, throwStrength: 1, scope: 0, rescope: 0,
    recoilIdx: 0, shotInacc: 0, sinceShot: 10, shots: 0, prevBtn: 0, frozen: false, busy: false, alive: true,
  };
}

export function clonePlayerState(p: PlayerState): PlayerState {
  return {
    ...p,
    pos: { ...p.pos }, vel: { ...p.vel },
    inv: {
      primary: p.inv.primary ? { ...p.inv.primary } : null,
      secondary: p.inv.secondary ? { ...p.inv.secondary } : null,
      nades: { ...p.inv.nades }, c4: p.inv.c4,
    },
  };
}

/** Copia apenas os campos de PlayerState (descarta extras do servidor). */
export function extractPlayerState(p: PlayerState): PlayerState {
  const s = createPlayerState(p.id);
  for (const k of Object.keys(s) as (keyof PlayerState)[]) (s as any)[k] = (p as any)[k];
  return clonePlayerState(s);
}

export const heightFor = (duck: number) => lerp(STAND_HEIGHT, CROUCH_HEIGHT, duck);
export const eyeHeight = (duck: number) => lerp(EYE_STAND, EYE_CROUCH, duck);
export const eyePos = (p: PlayerState): V3 => ({ x: p.pos.x, y: p.pos.y + eyeHeight(p.duck), z: p.pos.z });

export function hasWeapon(p: PlayerState, id: WeaponId): boolean {
  if (id === 'knife') return true;
  if (id === 'c4') return p.inv.c4;
  if (p.inv.primary?.id === id || p.inv.secondary?.id === id) return true;
  if ((GRENADES as string[]).includes(id)) return p.inv.nades[id as GrenadeId] > 0;
  return false;
}

export function slotState(p: PlayerState, id: WeaponId = p.weapon): WeaponSlotState | null {
  if (p.inv.primary?.id === id) return p.inv.primary;
  if (p.inv.secondary?.id === id) return p.inv.secondary;
  return null;
}

export function bestWeapon(p: PlayerState): WeaponId {
  return p.inv.primary?.id ?? p.inv.secondary?.id ?? 'knife';
}

export function switchWeapon(p: PlayerState, id: WeaponId) {
  if (p.weapon !== id && !(GRENADES as string[]).includes(p.weapon) && p.weapon !== 'c4') p.lastWeapon = p.weapon;
  p.weapon = id;
  p.deployT = WEAPONS[id].deployTime;
  p.reloadT = 0; p.scope = 0; p.rescope = 0; p.throwT = 0; p.recoilIdx = 0; p.shotInacc = 0;
  if (p.nextFireT < 0) p.nextFireT = 0;
}

export function computeInaccuracy(p: PlayerState): number {
  const def = WEAPONS[p.weapon];
  const sp = p.scope > 0 && def.scopedSpread ? def.scopedSpread : def.spread;
  let inacc = lerp(sp.stand, sp.crouch, p.duck);
  const speed = Math.hypot(p.vel.x, p.vel.z);
  const mv = clamp((speed - def.speed * 0.34) / (def.speed * 0.66), 0, 1);
  inacc += sp.move * mv;
  if (!p.onGround) inacc += sp.air;
  return inacc + p.shotInacc;
}

export function maxSpeedFor(p: PlayerState, walk: boolean): number {
  const def = WEAPONS[p.weapon];
  let s = def.speed;
  if (p.scope > 0) s = Math.min(s, 100 * 0.0254);
  if (p.duck > 0.5) s *= CROUCH_MULT;
  else if (walk) s *= WALK_MULT;
  return s;
}

// ---------------------------------------------------------------- colisão
const tmpBoxes: any[] = [];
const EPS = 1e-4;

function moveAxis(world: World, pos: V3, axis: 'x' | 'y' | 'z', delta: number, h: number): boolean {
  if (delta === 0) return false;
  pos[axis] += delta;
  const R = PLAYER_RADIUS;
  const boxes = world.query(pos.x - R, pos.y, pos.z - R, pos.x + R, pos.y + h, pos.z + R, tmpBoxes);
  if (boxes.length === 0) return false;
  let hit = false;
  if (axis === 'y') {
    if (delta > 0) { let lim = Infinity; for (const b of boxes) lim = Math.min(lim, b.min.y - h - EPS); if (lim < pos.y) { pos.y = lim; hit = true; } }
    else { let lim = -Infinity; for (const b of boxes) lim = Math.max(lim, b.max.y + EPS); if (lim > pos.y) { pos.y = lim; hit = true; } }
  } else {
    if (delta > 0) { let lim = Infinity; for (const b of boxes) lim = Math.min(lim, b.min[axis] - R - EPS); if (lim < pos[axis]) { pos[axis] = lim; hit = true; } }
    else { let lim = -Infinity; for (const b of boxes) lim = Math.max(lim, b.max[axis] + R + EPS); if (lim > pos[axis]) { pos[axis] = lim; hit = true; } }
  }
  return hit;
}

export function fits(world: World, pos: V3, h: number): boolean {
  const R = PLAYER_RADIUS - EPS;
  return world.query(pos.x - R, pos.y + EPS, pos.z - R, pos.x + R, pos.y + h, pos.z + R, tmpBoxes).length === 0;
}

function moveXZ(world: World, pos: V3, dx: number, dz: number, h: number) {
  const hx = moveAxis(world, pos, 'x', dx, h);
  const hz = moveAxis(world, pos, 'z', dz, h);
  return { hx, hz };
}

/** Move o jogador com colisão, step-up e snap ao chão. */
export function physicsMove(p: PlayerState, world: World, jumped: boolean, emit?: Emit) {
  const h = heightFor(p.duck);
  const wasGround = p.onGround;
  const prevVy = p.vel.y;
  const dx = p.vel.x * DT, dz = p.vel.z * DT;
  const start = { ...p.pos };
  const a = { ...p.pos };
  let r = moveXZ(world, a, dx, dz, h);
  if (wasGround && (r.hx || r.hz)) {
    const b = { ...start };
    moveAxis(world, b, 'y', STEP_HEIGHT, h);
    const raised = b.y - start.y;
    const r2 = moveXZ(world, b, dx, dz, h);
    const landed = moveAxis(world, b, 'y', -(raised + 0.02), h);
    const da = Math.hypot(a.x - start.x, a.z - start.z);
    const db = Math.hypot(b.x - start.x, b.z - start.z);
    if (landed && db > da + 0.001) { p.pos.x = b.x; p.pos.y = b.y; p.pos.z = b.z; r = r2; }
    else { p.pos.x = a.x; p.pos.y = a.y; p.pos.z = a.z; }
  } else { p.pos.x = a.x; p.pos.y = a.y; p.pos.z = a.z; }
  if (r.hx) p.vel.x = 0;
  if (r.hz) p.vel.z = 0;

  const dy = p.vel.y * DT;
  const hitY = moveAxis(world, p.pos, 'y', dy, h);
  p.onGround = false;
  if (hitY) {
    if (dy < 0) { p.onGround = true; if (!wasGround && emit) emit({ type: 'land', speed: -prevVy }); }
    p.vel.y = 0;
  }
  if (wasGround && !p.onGround && !jumped && p.vel.y <= 0) {
    const t = { ...p.pos };
    if (moveAxis(world, t, 'y', -STEP_HEIGHT, h)) { p.pos.y = t.y; p.onGround = true; p.vel.y = 0; }
  }
}

// ---------------------------------------------------------------- simulação
export function stepPlayer(p: PlayerState, cmd: Cmd, world: World, emit?: Emit) {
  p.yaw = cmd.yaw;
  p.pitch = clamp(cmd.pitch, -89 * DEG, 89 * DEG);
  const btn = cmd.btn;
  const pressed = btn & ~p.prevBtn;
  if (!p.alive) { p.prevBtn = btn; return; }

  if (cmd.wpn && cmd.wpn !== p.weapon && hasWeapon(p, cmd.wpn) && !p.busy && p.throwT <= 0) switchWeapon(p, cmd.wpn);
  if (!hasWeapon(p, p.weapon)) switchWeapon(p, bestWeapon(p));

  // --- agachar
  const target = btn & BTN_CROUCH ? 1 : 0;
  if (p.duck !== target) {
    const step = DUCK_SPEED * DT;
    let nd = target > p.duck ? Math.min(target, p.duck + step) : Math.max(target, p.duck - step);
    const oldH = heightFor(p.duck), newH = heightFor(nd);
    if (!p.onGround) {
      const dh = oldH - newH; // >0 agachando no ar: levanta os pés
      const np = { ...p.pos, y: p.pos.y + dh };
      if (fits(world, np, newH)) p.pos.y = np.y;
      else if (!fits(world, p.pos, newH)) nd = p.duck;
    } else if (nd < p.duck && !fits(world, p.pos, newH)) nd = p.duck;
    p.duck = nd;
  }

  // --- movimento
  let fwd = clamp(cmd.mz, -1, 1), side = clamp(cmd.mx, -1, 1);
  const ml = Math.hypot(fwd, side);
  if (ml > 1) { fwd /= ml; side /= ml; }
  if (p.frozen || p.busy) { fwd = 0; side = 0; }
  const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
  let wx = -sy * fwd + cy * side, wz = -cy * fwd - sy * side;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }
  const wishspeed = maxSpeedFor(p, !!(btn & BTN_WALK)) * Math.min(1, wl);

  let jumped = false;
  if (p.onGround) {
    if ((pressed & BTN_JUMP) && !p.frozen && !p.busy) {
      p.vel.y = JUMP_VELOCITY; p.onGround = false; jumped = true;
      emit?.({ type: 'jump' });
    }
    const speed = Math.hypot(p.vel.x, p.vel.z);
    if (speed > 0 && !jumped) {
      const control = Math.max(speed, STOP_SPEED);
      const ns = Math.max(0, speed - control * FRICTION * DT) / speed;
      p.vel.x *= ns; p.vel.z *= ns;
    }
    accelerate(p, wx, wz, wishspeed, wishspeed, ACCELERATE);
  } else {
    accelerate(p, wx, wz, Math.min(wishspeed, AIR_WISH_CAP), wishspeed, AIR_ACCELERATE);
  }
  p.vel.y -= GRAVITY * DT;
  physicsMove(p, world, jumped, emit);

  stepWeapon(p, cmd, pressed, emit);
  p.prevBtn = btn;
}

function accelerate(p: PlayerState, wx: number, wz: number, wishspd: number, accelBase: number, accel: number) {
  const cur = p.vel.x * wx + p.vel.z * wz;
  const add = wishspd - cur;
  if (add <= 0 || (wx === 0 && wz === 0)) return;
  const as = Math.min(add, accel * DT * accelBase);
  p.vel.x += as * wx; p.vel.z += as * wz;
}

function stepWeapon(p: PlayerState, cmd: Cmd, pressed: number, emit?: Emit) {
  const btn = cmd.btn;
  const def = WEAPONS[p.weapon];
  p.deployT = Math.max(0, p.deployT - DT);
  if (p.nextFireT > 0) p.nextFireT -= DT;
  p.sinceShot += DT;
  if (p.sinceShot > def.fireInterval * 1.05) p.recoilIdx = Math.max(0, p.recoilIdx - def.recoilRecover * DT);
  p.shotInacc *= Math.exp(-DT / Math.max(0.05, def.spread.recovery * 0.35));
  if (p.shotInacc < 1e-5) p.shotInacc = 0;

  const slot = slotState(p);
  if (p.reloadT > 0) {
    p.reloadT -= DT;
    if (p.reloadT <= 0) {
      p.reloadT = 0;
      if (slot) { const n = Math.min(def.mag - slot.mag, slot.res); slot.mag += n; slot.res -= n; }
    }
  }
  if (p.rescope && p.nextFireT <= 0 && p.reloadT <= 0) { p.scope = p.rescope; p.rescope = 0; }
  if (p.frozen) return;

  const startReload = () => {
    if (slot && p.reloadT <= 0 && slot.mag < def.mag && slot.res > 0) {
      p.reloadT = def.reloadTime; p.scope = 0; p.rescope = 0;
      emit?.({ type: 'reload', weapon: p.weapon });
    }
  };
  if (pressed & BTN_RELOAD) startReload();
  if (def.scopeFov && (pressed & BTN_ALT) && p.reloadT <= 0 && p.deployT <= 0) {
    p.scope = (p.scope + 1) % (def.scopeFov.length + 1); p.rescope = 0;
  }

  // granadas
  if (def.slot === 3) {
    if (p.throwT > 0) {
      p.throwT -= DT;
      if (p.throwT <= 0) {
        p.throwT = 0;
        const g = p.weapon as GrenadeId;
        if (p.inv.nades[g] > 0) {
          p.inv.nades[g]--;
          const ang = p.pitch + ((90 * DEG - Math.abs(p.pitch)) * 10) / 90;
          const d = dirFromAngles(p.yaw, clamp(ang, -89 * DEG, 89 * DEG));
          const sp = p.throwStrength >= 1 ? 17.5 : 8;
          const e = eyePos(p);
          emit?.({
            type: 'throw', g,
            origin: { x: e.x + d.x * 0.3, y: e.y - 0.05 + d.y * 0.3, z: e.z + d.z * 0.3 },
            vel: { x: d.x * sp + p.vel.x, y: d.y * sp + p.vel.y * 0.5, z: d.z * sp + p.vel.z },
          });
          const next = p.inv.nades[g] > 0 ? g : GRENADES.find((x) => p.inv.nades[x] > 0);
          switchWeapon(p, next ?? (hasWeapon(p, p.lastWeapon) ? p.lastWeapon : bestWeapon(p)));
          p.deployT = 0.4;
        }
      }
    } else if ((pressed & (BTN_FIRE | BTN_ALT)) && p.deployT <= 0) {
      p.throwT = 0.35; p.throwStrength = pressed & BTN_FIRE ? 1 : 0.5;
      emit?.({ type: 'pin', g: p.weapon as GrenadeId });
    }
    return;
  }
  if (def.id === 'c4') return;

  if (def.id === 'knife') {
    if ((btn & (BTN_FIRE | BTN_ALT)) && p.nextFireT <= 0 && p.deployT <= 0) {
      const heavy = !(btn & BTN_FIRE);
      p.nextFireT = heavy ? 1.0 : 0.42;
      p.sinceShot = 0;
      emit?.({ type: 'melee', heavy, origin: eyePos(p), dir: dirFromAngles(p.yaw, p.pitch) });
    }
    return;
  }

  const held = !!(btn & BTN_FIRE);
  const trigger = def.auto || cmd.as ? held : !!(pressed & BTN_FIRE);
  if (!trigger || p.nextFireT > 0 || p.deployT > 0 || p.reloadT > 0 || !slot) return;
  if (slot.mag <= 0) {
    if (slot.res > 0) startReload(); else { emit?.({ type: 'dry' }); p.nextFireT = 0.25; }
    return;
  }
  slot.mag--;
  const [pp, py] = patternAt(def, p.recoilIdx);
  const inacc = computeInaccuracy(p);
  const rng = mulberry32(hash2(p.id + 17, p.shots));
  p.shots++;
  const yaw = p.yaw - py * DEG + (rng() - 0.5) * 0.15 * DEG * Math.min(1, p.recoilIdx);
  const pitch = p.pitch + pp * DEG;
  const fwdV = dirFromAngles(yaw, pitch);
  const right = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
  const up = dirFromAngles(yaw, pitch + Math.PI / 2);
  const th = rng() * Math.PI * 2, rr = rng() * inacc;
  const ox = Math.cos(th) * rr, oy = Math.sin(th) * rr;
  const dir = {
    x: fwdV.x + right.x * ox + up.x * oy,
    y: fwdV.y + right.y * ox + up.y * oy,
    z: fwdV.z + right.z * ox + up.z * oy,
  };
  const L = Math.hypot(dir.x, dir.y, dir.z);
  dir.x /= L; dir.y /= L; dir.z /= L;
  p.recoilIdx += 1;
  p.shotInacc += def.spread.fire;
  p.sinceShot = 0;
  p.nextFireT = p.nextFireT > -DT ? p.nextFireT + def.fireInterval : def.fireInterval;
  if (p.scope > 0 && def.id === 'awp') { p.rescope = p.scope; p.scope = 0; }
  emit?.({ type: 'shot', origin: eyePos(p), dir, weapon: def.id, recoil: p.recoilIdx });
}

// ---------------------------------------------------------------- hitboxes
export const HG_HEAD = 1, HG_CHEST = 2, HG_STOMACH = 3, HG_LEGS = 4;
export const HG_MULT: Record<number, number> = { 1: 4, 2: 1, 3: 1.25, 4: 0.75 };

export interface HitboxPose { x: number; y: number; z: number; yaw: number; duck: number }

/** Testa um raio contra as hitboxes (cabeça, tronco, estômago, pernas) de um jogador. */
export function hitTestPlayer(o: V3, d: V3, maxT: number, pose: HitboxPose): { t: number; group: number } | null {
  const c = Math.cos(-pose.yaw), s = Math.sin(-pose.yaw);
  const ox = o.x - pose.x, oz = o.z - pose.z;
  const lo = { x: ox * c + oz * s, y: o.y - pose.y, z: -ox * s + oz * c };
  const ld = { x: d.x * c + d.z * s, y: d.y, z: -d.x * s + d.z * c };
  // broadphase: cápsula grosseira
  if (!rayBox(lo, ld, { min: { x: -0.5, y: 0, z: -0.5 }, max: { x: 0.5, y: 2.0, z: 0.5 } })) return null;
  const eye = eyeHeight(pose.duck);
  let best: { t: number; group: number } | null = null;
  const consider = (t: number | null, g: number) => { if (t !== null && t <= maxT && (!best || t < best.t)) best = { t, group: g }; };
  consider(raySphereLocal(lo, ld, 0, eye + 0.07, 0.02, 0.135), HG_HEAD);
  const box = (x: number, y0: number, y1: number, z: number, g: number) => {
    const h = rayBox(lo, ld, { min: { x: -x, y: y0, z: -z }, max: { x, y: y1, z } });
    if (h) consider(Math.max(0, h.tIn), g);
  };
  box(0.3, eye - 0.52, eye - 0.08, 0.17, HG_CHEST);
  box(0.24, eye - 0.82, eye - 0.52, 0.15, HG_STOMACH);
  box(0.22, 0, eye - 0.82, 0.16, HG_LEGS);
  return best;
}
