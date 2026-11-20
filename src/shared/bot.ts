import { BTN_ALT, BTN_CROUCH, BTN_FIRE, BTN_JUMP, BTN_RELOAD, BTN_USE, BTN_WALK, DT } from './constants';
import type { Match, ServerPlayer } from './match';
import { type V3, DEG, anglesFromDir, angleDiff, clamp, dirFromAngles } from './math';
import { type Cmd, eyeHeight, eyePos, slotState } from './player';
import { type GrenadeId, type WeaponId, GRENADES, WEAPONS, patternAt } from './weapons';
import { inRect } from './map';

interface DiffParams { reaction: number; turn: number; err: number; head: number; comp: number; fovCos: number; burst: number }
const DIFFS: DiffParams[] = [
  { reaction: 0.6, turn: 3.0, err: 0.07, head: 0.12, comp: 0.25, fovCos: Math.cos(55 * DEG), burst: 0.25 },
  { reaction: 0.4, turn: 5.0, err: 0.04, head: 0.28, comp: 0.5, fovCos: Math.cos(65 * DEG), burst: 0.35 },
  { reaction: 0.26, turn: 7.5, err: 0.022, head: 0.45, comp: 0.75, fovCos: Math.cos(75 * DEG), burst: 0.45 },
  { reaction: 0.16, turn: 11, err: 0.011, head: 0.65, comp: 0.9, fovCos: Math.cos(85 * DEG), burst: 0.6 },
];

type Goal = { kind: 'node'; node: number } | { kind: 'pos'; pos: V3; node: number } | { kind: 'none' };

export class BotBrain {
  p: DiffParams;
  seq = 0;
  aimYaw = 0;
  aimPitch = 0;
  target = 0;
  seenAt = 0;
  lastSeenPos: V3 | null = null;
  lastSeenTime = -99;
  heardPos: V3 | null = null;
  heardTime = -99;
  path: number[] = [];
  pi = 0;
  goalKey = '';
  ox = 0; oz = 0;
  stuckT = 0;
  unstuckT = 0;
  unstuckDir = 1;
  strafeT = 0;
  strafeDir = 1;
  burstT = 0;
  pauseT = 0;
  errYaw = 0; errPitch = 0; errT = 0;
  aimHead = false;
  holdLookYaw = 0;
  holdLookT = 0;
  startDelay = 0;
  nadeCooldown = 0;
  nadeThrow: { g: GrenadeId; yaw: number; pitch: number; t: number } | null = null;
  holdIdx = 0;
  roleSite: 'A' | 'B' = 'A';
  prevFire = false;
  wantWpn: WeaponId | '' = '';

  constructor(public diff: number) {
    this.p = DIFFS[clamp(Math.round(diff), 0, 3)];
  }

  onRoundStart(m: Match, me: ServerPlayer, ctIndex: number) {
    this.target = 0; this.lastSeenPos = null; this.heardPos = null; this.path = []; this.goalKey = '';
    this.aimYaw = me.yaw; this.aimPitch = 0; this.nadeThrow = null; this.nadeCooldown = 3;
    this.startDelay = Math.random() * 2.5;
    this.holdIdx = Math.floor(Math.random() * 4);
    this.roleSite = me.team === 'CT' ? (ctIndex % 2 === 0 ? 'A' : 'B') : m.plan.site;
    this.ox = (Math.random() - 0.5) * 1.0; this.oz = (Math.random() - 0.5) * 1.0;
  }

  onDamaged(att: ServerPlayer, time: number) {
    this.heardPos = { ...att.pos }; this.heardTime = time;
  }

  think(m: Match, me: ServerPlayer): Cmd {
    const cmd: Cmd = { seq: ++this.seq, yaw: this.aimYaw, pitch: this.aimPitch, mx: 0, mz: 0, btn: 0, wpn: '', rt: 0, as: false };
    if (!me.alive) return cmd;
    const now = m.time;
    if (me.frozen) { cmd.yaw = this.aimYaw = me.yaw; return cmd; }

    // ---- percepção
    if ((m.tickN + me.id) % 4 === 0) this.perceive(m, me, now);
    const tgt = this.target ? m.players.get(this.target) : undefined;
    const blind = now < me.flashEnd - 0.6;
    let moveDir: V3 | null = null;
    let wantStop = false;
    let lookAt: V3 | null = null;
    let fire = false, alt = false, crouch = false, use = false, jump = false, walk = false;

    const def = WEAPONS[me.weapon];
    const slot = slotState(me);
    this.nadeCooldown -= DT;

    // escolha de arma
    if (!this.nadeThrow) {
      const best: WeaponId = me.inv.primary && (me.inv.primary.mag + me.inv.primary.res > 0) ? me.inv.primary.id
        : me.inv.secondary && (me.inv.secondary.mag + me.inv.secondary.res > 0) ? me.inv.secondary.id : 'knife';
      if (me.weapon !== best && me.weapon !== 'c4' && me.plantT === 0) cmd.wpn = best;
    }

    if (tgt && tgt.alive && !blind) {
      // ---- combate
      const e = eyePos(me);
      const d = Math.hypot(tgt.pos.x - me.pos.x, tgt.pos.z - me.pos.z);
      const aimY = tgt.pos.y + eyeHeight(tgt.duck) + (this.aimHead ? 0.06 : -0.38);
      const dir = { x: tgt.pos.x - e.x, y: aimY - e.y, z: tgt.pos.z - e.z };
      const ang = anglesFromDir(dir);
      this.errT -= DT;
      if (this.errT <= 0) {
        this.errT = 0.25 + Math.random() * 0.3;
        this.errYaw = (Math.random() - 0.5) * 2 * this.p.err; this.errPitch = (Math.random() - 0.5) * 2 * this.p.err * 0.7;
        this.aimHead = Math.random() < this.p.head;
      }
      const reacting = now - this.seenAt < this.p.reaction;
      this.turnTo(ang.yaw + this.errYaw, ang.pitch + this.errPitch, reacting ? 0.35 : 1);
      // compensação de recuo
      const [pp, py] = patternAt(def, me.recoilIdx);
      cmd.yaw = this.aimYaw + py * DEG * this.p.comp;
      cmd.pitch = this.aimPitch - pp * DEG * this.p.comp;
      const err = Math.abs(angleDiff(this.aimYaw, ang.yaw)) + Math.abs(this.aimPitch - ang.pitch);
      const tol = Math.atan2(0.32, Math.max(1, d)) + 0.012 + this.p.err;
      const isRifle = def.slot === 0 && def.auto;
      const isShotgun = def.cls === 'shotgun';
      if (me.weapon === 'knife') {
        moveDir = { x: tgt.pos.x - me.pos.x, y: 0, z: tgt.pos.z - me.pos.z };
        if (d < 2 && err < 0.4) fire = true;
      } else if (slot && slot.mag === 0) {
        if (slot.res > 0) cmd.btn |= BTN_RELOAD;
        moveDir = { x: me.pos.x - tgt.pos.x, y: 0, z: me.pos.z - tgt.pos.z }; // recua
      } else {
        if (!reacting && err < tol * 1.6) {
          if (def.cls === 'sniper') {
            if (me.scope === 0 && d > 5 && me.deployT <= 0 && me.rescope === 0) alt = true;
            wantStop = true;
            if ((me.scope > 0 || d <= 5) && Math.hypot(me.vel.x, me.vel.z) < 1.2 && err < tol) fire = true;
          } else if (isRifle) {
            if (d > 16) {
              this.burstT -= DT;
              if (this.pauseT > 0) { this.pauseT -= DT; }
              else { fire = true; if (this.burstT <= 0) { this.burstT = this.p.burst; this.pauseT = 0.32; } }
            } else fire = true;
            wantStop = d > 7;
            crouch = d > 24 && this.diff >= 2;
          } else if (isShotgun) {
            // escopeta: só atira de perto, e se aproxima quando está longe
            if (d < 14) fire = !this.prevFire && me.nextFireT <= 0;
            else wantStop = false;
          } else {
            fire = !this.prevFire && me.nextFireT <= 0; // toques
          }
        }
        // movimentação de combate
        this.strafeT -= DT;
        if (this.strafeT <= 0) { this.strafeT = 0.35 + Math.random() * 0.6; this.strafeDir = Math.random() < 0.5 ? -1 : 1; }
        if (!wantStop || (!fire && this.diff >= 2)) {
          const r = { x: Math.cos(this.aimYaw), y: 0, z: -Math.sin(this.aimYaw) };
          moveDir = { x: r.x * this.strafeDir, y: 0, z: r.z * this.strafeDir };
          if (me.hp < 35 && this.diff >= 1) { const f = dirFromAngles(this.aimYaw, 0); moveDir.x -= f.x; moveDir.z -= f.z; }
        }
        if (fire && (isRifle || def.cls === 'sniper')) moveDir = null; // counter-strafe: para para atirar
        if (isShotgun && d >= 14) moveDir = { x: tgt.pos.x - me.pos.x, y: 0, z: tgt.pos.z - me.pos.z };
      }
      // granada de oportunidade com alvo visível de média distância
      if (!fire && d > 9 && d < 24 && this.nadeCooldown <= 0 && (me.inv.nades.he > 0 || me.inv.nades.molotov > 0)) this.startNade(me, tgt.pos);
    } else {
      // ---- sem alvo: objetivos
      this.target = 0;
      this.prevFire = false;
      if (slot && slot.mag < WEAPONS[slot.id].mag * 0.35 && slot.res > 0 && now - this.lastSeenTime > 1.5) cmd.btn |= BTN_RELOAD;

      if (this.nadeThrow) {
        const n = this.nadeThrow;
        n.t -= DT;
        cmd.wpn = me.weapon === n.g ? '' : n.g;
        this.turnTo(n.yaw, n.pitch, 1);
        if (me.weapon === n.g && me.deployT <= 0 && Math.abs(angleDiff(this.aimYaw, n.yaw)) < 0.08) { fire = true; }
        if (n.t <= 0 || me.inv.nades[n.g] === 0) { this.nadeThrow = null; this.nadeCooldown = 9 + Math.random() * 6; }
      } else if (this.lastSeenPos && now - this.lastSeenTime < 4 && this.nadeCooldown <= 0 &&
        GRENADES.some((g) => g !== 'smoke' && me.inv.nades[g] > 0)) {
        const d = Math.hypot(this.lastSeenPos.x - me.pos.x, this.lastSeenPos.z - me.pos.z);
        if (d > 7 && d < 26) this.startNade(me, this.lastSeenPos);
      }

      const goal = this.chooseGoal(m, me, now);
      const res = this.followGoal(m, me, goal);
      moveDir = res.dir;
      if (res.arrived) {
        if (goal.kind !== 'none' && me.inv.c4 && m.siteAt(me.pos)) { cmd.wpn = 'c4'; if (me.weapon === 'c4') { fire = true; } }
        if (m.bomb.st === 'planted' && me.team === 'CT' && Math.hypot(m.bomb.pos.x - me.pos.x, m.bomb.pos.z - me.pos.z) < 1.4) {
          use = true;
          lookAt = m.bomb.pos;
        }
      }
      const heard = this.heardPos && now - this.heardTime < 2.5 ? this.heardPos : null;
      if (!this.nadeThrow) {
        if (lookAt) {
          const e = eyePos(me); const a = anglesFromDir({ x: lookAt.x - e.x, y: lookAt.y - e.y, z: lookAt.z - e.z });
          this.turnTo(a.yaw, a.pitch, 0.6);
        } else if (heard) {
          const e = eyePos(me); const a = anglesFromDir({ x: heard.x - e.x, y: heard.y + 1.4 - e.y, z: heard.z - e.z });
          this.turnTo(a.yaw, a.pitch, 0.8);
        } else if (moveDir && Math.hypot(moveDir.x, moveDir.z) > 0.01) {
          const a = anglesFromDir(moveDir);
          this.turnTo(a.yaw, 0, 0.45);
        } else {
          // segurando posição: olha ao redor
          this.holdLookT -= DT;
          if (this.holdLookT <= 0) {
            this.holdLookT = 1.2 + Math.random() * 2;
            const base = me.team === 'CT' ? 0 : Math.PI;
            this.holdLookYaw = base + (Math.random() - 0.5) * 2.4;
          }
          this.turnTo(this.holdLookYaw, -0.02, 0.25);
        }
      }
      cmd.yaw = this.aimYaw; cmd.pitch = this.aimPitch;
      if (now - this.lastSeenTime < 6 && this.diff >= 2) walk = !!moveDir && Math.random() < 0.02 ? true : walk;
    }

    // ---- movimento e anti-travamento
    if (moveDir && !use) {
      const L = Math.hypot(moveDir.x, moveDir.z);
      if (L > 0.01) {
        let dx = moveDir.x / L, dz = moveDir.z / L;
        const sp = Math.hypot(me.vel.x, me.vel.z);
        if (sp < 0.6 && me.onGround && me.deployT <= 0) this.stuckT += DT; else this.stuckT = Math.max(0, this.stuckT - DT * 2);
        if (this.stuckT > 0.7) { this.unstuckT = 0.6; this.unstuckDir = Math.random() < 0.5 ? -1 : 1; this.stuckT = 0; jump = Math.random() < 0.6; this.path = []; this.goalKey = ''; }
        if (this.unstuckT > 0) {
          this.unstuckT -= DT;
          const rx = -dz * this.unstuckDir, rz = dx * this.unstuckDir;
          dx = dx * 0.3 + rx; dz = dz * 0.3 + rz;
        }
        const yaw = cmd.yaw;
        const f = { x: -Math.sin(yaw), z: -Math.cos(yaw) }, r = { x: Math.cos(yaw), z: -Math.sin(yaw) };
        cmd.mz = dx * f.x + dz * f.z; cmd.mx = dx * r.x + dz * r.z;
        const ml = Math.hypot(cmd.mx, cmd.mz); if (ml > 0) { cmd.mx /= ml; cmd.mz /= ml; }
      }
    }
    if (fire) cmd.btn |= BTN_FIRE;
    if (alt) cmd.btn |= BTN_ALT;
    if (crouch) cmd.btn |= BTN_CROUCH;
    if (use) cmd.btn |= BTN_USE;
    if (jump) cmd.btn |= BTN_JUMP;
    if (walk) cmd.btn |= BTN_WALK;
    this.prevFire = fire;
    return cmd;
  }

  private startNade(me: ServerPlayer, at: V3) {
    const g: GrenadeId | undefined = (['he', 'molotov', 'flash'] as GrenadeId[]).find((x) => me.inv.nades[x] > 0);
    if (!g) return;
    const e = eyePos(me);
    const dx = at.x - e.x, dz = at.z - e.z;
    const d = Math.hypot(dx, dz);
    const v = 17.5, gr = 9.5;
    const s = clamp((gr * d) / (v * v), 0, 1);
    let pitch = 0.5 * Math.asin(s) - 0.12;
    pitch = clamp(pitch, -0.2, 0.9);
    this.nadeThrow = { g, yaw: Math.atan2(-dx, -dz), pitch, t: 2.2 };
  }

  private turnTo(yaw: number, pitch: number, speedMul: number) {
    const max = this.p.turn * speedMul * DT;
    const dy = angleDiff(this.aimYaw, yaw);
    const k = Math.min(1, 12 * DT);
    this.aimYaw += clamp(dy * k * 2.2, -max, max);
    this.aimPitch += clamp((pitch - this.aimPitch) * k * 2.2, -max, max);
    this.aimPitch = clamp(this.aimPitch, -1.4, 1.4);
  }

  private perceive(m: Match, me: ServerPlayer, now: number) {
    const e = eyePos(me);
    const fwd = dirFromAngles(this.aimYaw, 0);
    let best: ServerPlayer | null = null, bd = Infinity;
    const blind = now < me.flashEnd - 0.6;
    for (const o of m.players.values()) {
      if (!o.alive || o.team === me.team) continue;
      const dx = o.pos.x - e.x, dz = o.pos.z - e.z;
      const d = Math.hypot(dx, dz);
      if (d > 90) continue;
      // audição: correndo perto
      const sp = Math.hypot(o.vel.x, o.vel.z);
      if (d < 16 && sp > 3.4 && o.onGround) { this.heardPos = { ...o.pos }; this.heardTime = now; }
      if (blind) continue;
      const inFov = (dx * fwd.x + dz * fwd.z) / (d || 1) > this.p.fovCos || d < 2.5 || o.id === this.target;
      if (!inFov) continue;
      if (!m.canSee(me, o)) continue;
      if (d < bd) { bd = d; best = o; }
    }
    for (const n of m.noises) {
      if (n.team === me.team || now - n.time > 0.3) continue;
      if (Math.hypot(n.pos.x - me.pos.x, n.pos.z - me.pos.z) < 35) { this.heardPos = { ...n.pos }; this.heardTime = now; }
    }
    if (best) {
      if (best.id !== this.target) { this.target = best.id; this.seenAt = now; }
      this.lastSeenPos = { ...best.pos }; this.lastSeenTime = now;
    } else if (this.target) {
      this.target = 0;
    }
  }

  private chooseGoal(m: Match, me: ServerPlayer, now: number): Goal {
    const map = m.map;
    if (m.phase !== 'live' && m.phase !== 'post') return { kind: 'none' };
    if (m.roundElapsed < this.startDelay) return { kind: 'none' };
    const bomb = m.bomb;
    if (me.team === 'T') {
      if (bomb.st === 'planted') {
        const nodes = map.holdNodes[bomb.site as 'A' | 'B'];
        return { kind: 'node', node: nodes[this.holdIdx % nodes.length] };
      }
      if (me.inv.c4) {
        const nodes = map.plantNodes[this.roleSite];
        return { kind: 'node', node: nodes[me.id % nodes.length] };
      }
      if (bomb.st === 'dropped') {
        // o T vivo mais próximo busca a bomba
        let nearest: ServerPlayer | null = null, nd = Infinity;
        for (const o of m.players.values()) {
          if (o.team !== 'T' || !o.alive) continue;
          const d = Math.hypot(o.pos.x - bomb.pos.x, o.pos.z - bomb.pos.z);
          if (d < nd) { nd = d; nearest = o; }
        }
        if (nearest === me) return { kind: 'pos', pos: bomb.pos, node: m.nav.nearest(bomb.pos) };
      }
      // apoio: acompanha o portador ou vai ao site
      const nodes = map.holdNodes[this.roleSite];
      return { kind: 'node', node: nodes[this.holdIdx % nodes.length] };
    }
    // CT
    if (bomb.st === 'planted') return { kind: 'pos', pos: bomb.pos, node: m.nav.nearest(bomb.pos) };
    const nodes = map.holdNodes[this.roleSite];
    // após 50s sem contato, rotaciona aleatoriamente
    if (m.roundElapsed > 50 && now - this.lastSeenTime > 20 && Math.random() < 0.0015) this.roleSite = this.roleSite === 'A' ? 'B' : 'A';
    return { kind: 'node', node: nodes[(this.holdIdx + me.id) % nodes.length] };
  }

  private followGoal(m: Match, me: ServerPlayer, goal: Goal): { dir: V3 | null; arrived: boolean } {
    if (goal.kind === 'none') { this.path = []; this.goalKey = ''; return { dir: null, arrived: false }; }
    const key = goal.kind === 'node' ? 'n' + goal.node : `p${Math.round(goal.pos.x)},${Math.round(goal.pos.z)}`;
    if (key !== this.goalKey || this.path.length === 0) {
      this.goalKey = key;
      const from = m.nav.nearest(me.pos);
      this.path = m.nav.path(from, goal.node);
      this.pi = 0;
      // pula nós que ficam para trás
      if (this.path.length > 1) {
        const a = m.map.nav.nodes[this.path[0]], b = m.map.nav.nodes[this.path[1]];
        const dA = Math.hypot(a.x - me.pos.x, a.z - me.pos.z), dAB = Math.hypot(a.x - b.x, a.z - b.z), dB = Math.hypot(b.x - me.pos.x, b.z - me.pos.z);
        if (dB < dAB && dA < dAB) this.pi = 1;
      }
    }
    const nodes = m.map.nav.nodes;
    const last = this.pi >= this.path.length - 1;
    let tx: number, tz: number;
    if (this.pi < this.path.length) {
      const n = nodes[this.path[this.pi]];
      tx = n.x + (last ? 0 : this.ox); tz = n.z + (last ? 0 : this.oz);
      const d = Math.hypot(tx - me.pos.x, tz - me.pos.z);
      if (d < (last ? 0.8 : 1.4)) { this.pi++; }
    } else if (goal.kind === 'pos') {
      tx = goal.pos.x; tz = goal.pos.z;
      const d = Math.hypot(tx - me.pos.x, tz - me.pos.z);
      if (d < 0.9) return { dir: null, arrived: true };
    } else {
      const n = nodes[goal.node];
      tx = n.x; tz = n.z;
      if (Math.hypot(tx - me.pos.x, tz - me.pos.z) < 1.2 || (me.inv.c4 && m.siteAt(me.pos))) return { dir: null, arrived: true };
    }
    if (me.inv.c4 && m.siteAt(me.pos) && this.pi >= this.path.length - 1) {
      const sites = m.map.sites[m.siteAt(me.pos)!];
      if (inRect({ x0: sites.x0 + 1, z0: sites.z0 + 1, x1: sites.x1 - 1, z1: sites.z1 - 1 }, me.pos.x, me.pos.z)) return { dir: null, arrived: true };
    }
    return { dir: { x: tx - me.pos.x, y: 0, z: tz - me.pos.z }, arrived: false };
  }
}

/** Sorteia um item de uma lista com pesos. */
function pick<T>(opts: [T, number][]): T {
  const total = opts.reduce((t, o) => t + o[1], 0);
  let r = Math.random() * total;
  for (const [v, w] of opts) { r -= w; if (r <= 0) return v; }
  return opts[0][0];
}

/** Lógica de compra dos bots: rodada de pistola, eco, compra forçada ou compra completa, com variedade de armas. */
export function botBuy(m: Match, p: ServerPlayer) {
  const r = Math.random();
  const T = p.team === 'T';
  const isPistolRound = m.round === 1 || m.round === Math.floor(m.maxRounds / 2) + 1;
  const buyPistol = (opts: [WeaponId, number][]) => {
    const id = pick(opts);
    if (p.money >= WEAPONS[id].price) m.buy(p.id, id);
  };
  if (isPistolRound) {
    if (r < 0.35) m.buy(p.id, 'vest');
    else if (r < 0.6) buyPistol(T ? [['p250', 3], ['tec9', 2], ['elite', 1]] : [['p250', 3], ['fiveseven', 2], ['p2000', 1]]);
    else if (r < 0.8) { m.buy(p.id, 'flash'); m.buy(p.id, 'he'); }
    else if (!T) m.buy(p.id, 'kit');
    else m.buy(p.id, 'zeus');
    return;
  }
  if (!p.inv.primary) {
    const rifles: [WeaponId, number][] = T
      ? [['ak47', 6], ['sg553', 1.2], ['galil', 1.2]]
      : [['m4a1', 3], ['m4a1s', 3], ['aug', 1], ['famas', 1]];
    const want = pick(rifles);
    if (p.money >= 4750 + 1000 && r < 0.14) m.buy(p.id, 'awp');
    else if (p.money >= 5000 + 1000 && r < 0.18) m.buy(p.id, T ? 'g3sg1' : 'scar20');
    else if (p.money >= WEAPONS[want].price + 650) m.buy(p.id, want);
    else if (p.money >= 1700 + 650 && r < 0.25) m.buy(p.id, 'ssg08');
    else if (p.money >= 1800 && r < 0.55) m.buy(p.id, T ? 'galil' : 'famas');
    else if (p.money >= 1500 && r < 0.75) {
      // compra forçada: SMG ou escopeta
      m.buy(p.id, pick<WeaponId>(T
        ? [['mac10', 3], ['mp7', 2], ['ump45', 2], ['mp5sd', 1], ['bizon', 1], ['nova', 1], ['sawedoff', 1]]
        : [['mp9', 3], ['mp7', 2], ['ump45', 2], ['mp5sd', 1], ['bizon', 1], ['nova', 1], ['mag7', 1]]));
    } else if (p.money >= 1100 && r < 0.4) m.buy(p.id, T ? 'mac10' : 'mp9');
    else if (p.money >= 700) buyPistol([['deagle', 3], [T ? 'tec9' : 'fiveseven', 2], ['p250', 1], ['r8', 0.3]]);
  }
  if (p.inv.primary) {
    if (p.money >= 1000) m.buy(p.id, 'vesthelm'); else if (p.money >= 650) m.buy(p.id, 'vest');
    if (!T && p.money >= 400) m.buy(p.id, 'kit');
    const nades: GrenadeId[] = ['smoke', 'flash', 'he', 'molotov'];
    for (const g of nades) if (p.money >= 900 && Math.random() < 0.6) m.buy(p.id, g);
    if (p.money >= 1500 && Math.random() < 0.15) m.buy(p.id, 'decoy');
    if (p.money >= 2500 && Math.random() < 0.1) m.buy(p.id, 'zeus');
  }
}
