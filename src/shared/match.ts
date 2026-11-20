import { BotBrain, botBuy } from './bot';
import {
  BOMB_TIMER, BTN_DROP, BTN_FIRE, BTN_USE, BUY_TIME, DEFUSE_REWARD, DEFUSE_TIME, DEFUSE_TIME_KIT, DT, FREEZE_TIME,
  LOSS_BONUS, MAX_MONEY, MAX_ROUNDS, PLANT_BONUS_TEAM, PLANT_REWARD, PLANT_TIME, POST_ROUND_TIME, REWARD_WIN_BOMB,
  REWARD_WIN_DEFUSE, REWARD_WIN_ELIM, REWARD_WIN_TIME, ROUND_TIME, START_MONEY, TICK_RATE, type Team, otherTeam,
} from './constants';
import { type GrenadeProj, stepGrenade } from './grenades';
import { type MapData, buildMap, inRect } from './map';
import { type V3, clamp, dirFromAngles, dist, r2, r3 } from './math';
import { Nav } from './nav';
import {
  type Cmd, type HitboxPose, type Intent, type PlayerState, HG_CHEST, HG_HEAD, HG_LEGS, HG_MULT, bestWeapon,
  createPlayerState, emptyCmd, extractPlayerState, eyeHeight, eyePos, hitTestPlayer, slotState, stepPlayer, switchWeapon,
} from './player';
import type { GameEvent, Phase, PlayerNet, Snapshot } from './protocol';
import { type BuyItemId, type GrenadeId, type WeaponId, GRENADES, MAX_GRENADES, MAX_GRENADES_TOTAL, WEAPONS, emptyNades, priceFor } from './weapons';
import { World, resistOf } from './world';

export interface ServerPlayer extends PlayerState {
  name: string;
  team: Team;
  isBot: boolean;
  money: number;
  hp: number;
  armor: number;
  helmet: boolean;
  kit: boolean;
  kills: number;
  deaths: number;
  assists: number;
  queue: Cmd[];
  lastSeq: number;
  lastCmd: Cmd;
  brain: BotBrain | null;
  plantT: number;
  defuseT: number;
  flashEnd: number;
  dmgFrom: Map<number, number>;
  burnAcc: number;
  spottedUntil: number;
  ping: number;
  events: GameEvent[];
}

export interface Smoke { id: number; pos: V3; age: number; life: number }
export interface Fire { id: number; pos: V3; r: number; age: number; life: number; owner: number; team: Team }
export interface Item { id: number; w: WeaponId; mag: number; res: number; pos: V3; yaw: number; noPick: number; noPickUntil: number }
export interface Noise { pos: V3; time: number; id: number; team: Team }

export interface MatchOptions {
  botsPerTeam: number;
  difficulty: number; // 0..3
  maxRounds?: number;
  freezeTime?: number;
}

const BOT_NAMES = ['Raio', 'Vulto', 'Cacto', 'Duna', 'Faísca', 'Tigre', 'Coruja', 'Bala', 'Neblina', 'Granito', 'Sombra', 'Trovão', 'Lince', 'Brasa', 'Areia', 'Pedra'];

export class Match {
  map: MapData;
  world: World;
  nav: Nav;
  players = new Map<number, ServerPlayer>();
  tickN = 0;
  time = 0;
  phase: Phase = 'freeze';
  phaseLeft = 0;
  roundElapsed = 0;
  round = 0;
  maxRounds: number;
  freezeTime: number;
  score: Record<Team, number> = { T: 0, CT: 0 };
  lossStreak: Record<Team, number> = { T: 0, CT: 0 };
  bomb = { st: 'none' as 'none' | 'carried' | 'dropped' | 'planted' | 'defused' | 'exploded', pos: { x: 0, y: 0, z: 0 } as V3, site: '' as 'A' | 'B' | '', left: 0, carrier: 0, defuser: 0, itemId: 0 };
  grenades: GrenadeProj[] = [];
  /** decoys no chão imitando tiros da arma do dono */
  decoys: { id: number; pos: V3; w: WeaponId; owner: number; team: Team; end: number; next: number; burst: number }[] = [];
  smokes: Smoke[] = [];
  fires: Fire[] = [];
  items: Item[] = [];
  noises: Noise[] = [];
  plan: { site: 'A' | 'B' } = { site: 'A' };
  private nextId = 1;
  private nextEnt = 1;
  private history: { tick: number; poses: Map<number, HitboxPose> }[] = [];
  private botNameIdx = 0;
  private overT = 0;

  constructor(public opts: MatchOptions) {
    this.map = buildMap();
    this.world = new World(this.map);
    this.nav = new Nav(this.map.nav, this.world);
    this.maxRounds = opts.maxRounds ?? MAX_ROUNDS;
    this.freezeTime = opts.freezeTime ?? FREEZE_TIME;
  }

  // ------------------------------------------------------------ jogadores
  addPlayer(name: string, isBot: boolean, team?: Team): ServerPlayer {
    const id = this.nextId++;
    const base = createPlayerState(id);
    const tCount = this.teamPlayers('T').length, ctCount = this.teamPlayers('CT').length;
    const tm: Team = team ?? (tCount <= ctCount ? 'T' : 'CT');
    const p: ServerPlayer = Object.assign(base, {
      name: name.slice(0, 16) || 'Jogador', team: tm, isBot, money: START_MONEY, hp: 100, armor: 0, helmet: false, kit: false,
      kills: 0, deaths: 0, assists: 0, queue: [], lastSeq: 0, lastCmd: emptyCmd(), brain: null as BotBrain | null,
      plantT: 0, defuseT: 0, flashEnd: 0, dmgFrom: new Map<number, number>(), burnAcc: 0, spottedUntil: 0, ping: 0, events: [],
    });
    if (isBot) p.brain = new BotBrain(this.opts.difficulty);
    this.players.set(id, p);
    this.giveDefaults(p, true);
    if (this.round === 0) { /* primeira rodada ainda vai começar */ }
    else if (this.phase === 'freeze') this.spawn(p);
    else { p.alive = false; p.hp = 0; }
    this.broadcast({ e: 'join', id, name: p.name, team: tm });
    return p;
  }

  removePlayer(id: number) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.alive) this.dropAll(p);
    this.players.delete(id);
    this.broadcast({ e: 'leave', id, name: p.name });
  }

  teamPlayers(t: Team) { return [...this.players.values()].filter((p) => p.team === t); }

  /** Mantém cada time com `botsPerTeam` jogadores no mínimo, usando bots. */
  balanceBots() {
    const target = this.opts.botsPerTeam;
    for (const t of ['T', 'CT'] as Team[]) {
      let list = this.teamPlayers(t);
      while (list.length < target) { this.addPlayer(this.botName(), true, t); list = this.teamPlayers(t); }
      while (list.length > target) {
        const bot = list.find((p) => p.isBot && !p.alive) ?? list.find((p) => p.isBot);
        if (!bot) break;
        this.removePlayer(bot.id);
        list = this.teamPlayers(t);
      }
    }
  }

  private botName() { const n = BOT_NAMES[this.botNameIdx++ % BOT_NAMES.length]; return `BOT ${n}`; }

  setTeam(id: number, team: Team) {
    const p = this.players.get(id);
    if (!p || p.team === team) return;
    if (p.alive) this.kill(p, null, 'world', false, false, true);
    p.team = team;
    this.giveDefaults(p, true);
    this.balanceBots();
  }

  queueCmd(id: number, cmd: Cmd) {
    const p = this.players.get(id);
    if (!p || p.isBot) return;
    if (p.queue.length < 24) p.queue.push(sanitizeCmd(cmd));
  }

  private giveDefaults(p: ServerPlayer, strip: boolean) {
    if (strip) {
      p.inv.primary = null; p.inv.secondary = null; p.inv.nades = emptyNades(); p.inv.c4 = false; p.inv.zeus = 0;
      p.armor = 0; p.helmet = false; p.kit = false;
    }
    if (!p.inv.secondary) {
      const id: WeaponId = p.team === 'T' ? 'glock' : 'usp';
      p.inv.secondary = { id, mag: WEAPONS[id].mag, res: WEAPONS[id].reserve };
    }
  }

  private spawn(p: ServerPlayer) {
    const spawns = this.map.spawns[p.team];
    const used = [...this.players.values()].filter((o) => o !== p && o.alive).map((o) => o.pos);
    let sp = spawns[0];
    for (const s of spawns) { if (!used.some((u) => Math.hypot(u.x - s.x, u.z - s.z) < 1)) { sp = s; break; } }
    p.pos = { x: sp.x, y: 0.01, z: sp.z };
    p.vel = { x: 0, y: 0, z: 0 };
    p.alive = true; p.hp = 100; p.duck = 0; p.onGround = true; p.busy = false; p.frozen = this.phase === 'freeze';
    p.yaw = p.team === 'T' ? 0 : Math.PI; p.pitch = 0;
    p.plantT = 0; p.defuseT = 0; p.flashEnd = 0; p.dmgFrom.clear(); p.burnAcc = 0;
    p.scope = 0; p.rescope = 0; p.reloadT = 0; p.throwT = 0; p.recoilIdx = 0; p.shotInacc = 0; p.nextFireT = 0; p.deployT = 0;
    // refil de munição de reserva ao spawnar (CS mantém o pente; damos reserva cheia)
    for (const s of [p.inv.primary, p.inv.secondary]) if (s) s.res = Math.max(s.res, WEAPONS[s.id].reserve);
    switchWeapon(p, bestWeapon(p)); p.deployT = 0;
  }

  // ------------------------------------------------------------ rounds
  start() { this.balanceBots(); this.startRound(); }

  private startRound() {
    this.round++;
    this.phase = 'freeze';
    this.phaseLeft = this.freezeTime;
    this.roundElapsed = 0;
    this.grenades = []; this.decoys = []; this.smokes = []; this.fires = []; this.items = []; this.noises = [];
    this.bomb = { st: 'none', pos: { x: 0, y: 0, z: 0 }, site: '', left: 0, carrier: 0, defuser: 0, itemId: 0 };
    this.plan.site = Math.random() < 0.5 ? 'A' : 'B';
    for (const p of this.players.values()) {
      if (!p.alive) this.giveDefaults(p, true);
      else this.giveDefaults(p, false);
      p.inv.c4 = false;
      this.spawn(p);
    }
    const ts = this.teamPlayers('T');
    if (ts.length) {
      const c = ts[Math.floor(Math.random() * ts.length)];
      c.inv.c4 = true; this.bomb.st = 'carried'; this.bomb.carrier = c.id;
    }
    let ctIdx = 0;
    for (const p of this.players.values()) {
      if (p.brain) {
        p.brain.onRoundStart(this, p, p.team === 'CT' ? ctIdx++ : 0);
        botBuy(this, p);
      }
    }
    this.broadcast({ e: 'roundStart', round: this.round });
  }

  private endRound(win: Team, reason: 'elim' | 'bomb' | 'defuse' | 'time') {
    if (this.phase !== 'live') return;
    this.phase = 'post';
    this.phaseLeft = POST_ROUND_TIME;
    this.score[win]++;
    const lose = otherTeam(win);
    this.lossStreak[win] = Math.max(0, this.lossStreak[win] - 1);
    this.lossStreak[lose] = Math.min(LOSS_BONUS.length, this.lossStreak[lose] + 1);
    const winReward = reason === 'elim' ? REWARD_WIN_ELIM : reason === 'bomb' ? REWARD_WIN_BOMB : reason === 'defuse' ? REWARD_WIN_DEFUSE : REWARD_WIN_TIME;
    const lossReward = LOSS_BONUS[this.lossStreak[lose] - 1];
    const planted = this.bomb.st === 'planted' || this.bomb.st === 'exploded' || this.bomb.st === 'defused';
    for (const p of this.players.values()) {
      if (p.team === win) this.addMoney(p, winReward, 'Vitória no round');
      else {
        let amt = lossReward;
        if (reason === 'time' && p.team === 'T' && p.alive) amt = 0;
        if (p.team === 'T' && planted) amt += PLANT_BONUS_TEAM;
        this.addMoney(p, amt, 'Bônus de derrota');
      }
    }
    for (const p of this.players.values()) { p.busy = false; p.plantT = 0; p.defuseT = 0; }
    this.broadcast({ e: 'roundEnd', win, reason });
  }

  private afterPost() {
    const half = Math.floor(this.maxRounds / 2);
    const toWin = half + 1;
    if (this.score.T >= toWin || this.score.CT >= toWin || this.round >= this.maxRounds) {
      const win = this.score.T > this.score.CT ? 'T' : this.score.CT > this.score.T ? 'CT' : 'draw';
      this.phase = 'over'; this.overT = 10;
      this.broadcast({ e: 'matchEnd', win });
      return;
    }
    if (this.round === half) {
      for (const p of this.players.values()) {
        p.team = otherTeam(p.team); p.money = START_MONEY; p.alive = false; // força reset de inventário
      }
      const s = this.score.T; this.score.T = this.score.CT; this.score.CT = s;
      this.lossStreak = { T: 0, CT: 0 };
      this.broadcast({ e: 'halftime' });
    }
    this.startRound();
  }

  private resetMatch() {
    this.score = { T: 0, CT: 0 }; this.lossStreak = { T: 0, CT: 0 }; this.round = 0;
    for (const p of this.players.values()) { p.money = START_MONEY; p.kills = 0; p.deaths = 0; p.assists = 0; p.alive = false; }
    this.startRound();
  }

  addMoney(p: ServerPlayer, amt: number, why: string) {
    if (!amt) return;
    p.money = clamp(p.money + amt, 0, MAX_MONEY);
    this.toPlayer(p, { e: 'money', id: p.id, amount: amt, why });
  }

  canBuy(p: ServerPlayer) {
    return p.alive && inRect(this.map.buyZones[p.team], p.pos.x, p.pos.z) &&
      (this.phase === 'freeze' || (this.phase === 'live' && this.roundElapsed < BUY_TIME));
  }

  buy(id: number, item: BuyItemId): boolean {
    const p = this.players.get(id);
    if (!p) return false;
    const fail = (reason: string) => { this.toPlayer(p, { e: 'buy', ok: false, item, reason }); return false; };
    if (!this.canBuy(p)) return fail('Fora da zona/tempo de compra');
    const price = priceFor(item, p.team, p.armor, p.helmet);
    if (p.money < price) return fail('Dinheiro insuficiente');
    if (item === 'vest') { if (p.armor >= 100) return fail('Colete já está completo'); p.armor = 100; }
    else if (item === 'vesthelm') { if (p.armor >= 100 && p.helmet) return fail('Já equipado'); p.armor = 100; p.helmet = true; }
    else if (item === 'kit') { if (p.team !== 'CT') return fail('Apenas CT'); if (p.kit) return fail('Já possui kit'); p.kit = true; }
    else {
      const def = WEAPONS[item];
      if (def.team && def.team !== p.team) return fail('Arma do outro time');
      if (def.slot === 3) {
        const g = item as GrenadeId;
        const total = GRENADES.reduce((s, x) => s + p.inv.nades[x], 0);
        if (p.inv.nades[g] >= MAX_GRENADES[g] || total >= MAX_GRENADES_TOTAL) return fail('Limite de granadas');
        p.inv.nades[g]++;
      } else if (item === 'zeus') {
        if ((p.inv.zeus ?? 0) > 0) return fail('Já possui Zeus');
        p.inv.zeus = 1;
      } else if (def.slot === 0 || def.slot === 1) {
        const key = def.slot === 0 ? 'primary' : 'secondary';
        const cur = p.inv[key];
        if (cur && cur.id === item) return fail('Já possui essa arma');
        if (cur) this.dropWeapon(p, cur.id);
        p.inv[key] = { id: item, mag: def.mag, res: def.reserve };
        switchWeapon(p, item);
      } else return fail('Item inválido');
    }
    p.money -= price;
    this.toPlayer(p, { e: 'buy', ok: true, item });
    return true;
  }

  // ------------------------------------------------------------ tick
  tick() {
    this.tickN++;
    this.time += DT;

    if (this.phase === 'freeze') {
      this.phaseLeft -= DT;
      if (this.phaseLeft <= 0) {
        this.phase = 'live'; this.phaseLeft = ROUND_TIME; this.roundElapsed = 0;
        for (const p of this.players.values()) p.frozen = false;
        this.broadcast({ e: 'live' });
      }
    } else if (this.phase === 'live') {
      this.roundElapsed += DT;
    }

    for (const p of this.players.values()) {
      if (p.brain) {
        const cmd = p.brain.think(this, p);
        this.processCmd(p, cmd);
      } else {
        const q = p.queue;
        const n = Math.min(q.length, 8);
        for (let i = 0; i < n; i++) this.processCmd(p, q[i]);
        q.splice(0, n);
        if (q.length > 16) q.splice(0, q.length - 4);
      }
    }

    this.recordHistory();
    this.stepGrenades();
    this.stepDecoys();
    this.stepFires();
    for (const s of this.smokes) s.age += DT;
    this.smokes = this.smokes.filter((s) => s.age < s.life);
    this.noises = this.noises.filter((n) => this.time - n.time < 3);
    if (this.tickN % 8 === 0) this.updateSpotted();

    if (this.phase === 'live') this.checkRound();
    else if (this.phase === 'post') { this.phaseLeft -= DT; if (this.phaseLeft <= 0) this.afterPost(); }
    else if (this.phase === 'over') { this.overT -= DT; if (this.overT <= 0) this.resetMatch(); }
  }

  private checkRound() {
    const alive = (t: Team) => this.teamPlayers(t).filter((p) => p.alive).length;
    const nT = this.teamPlayers('T').length, nCT = this.teamPlayers('CT').length;
    const aT = alive('T'), aCT = alive('CT');
    if (this.bomb.st === 'planted') {
      this.bomb.left -= DT;
      if (this.bomb.left <= 0) { this.explodeBomb(); return; }
      if (aCT === 0 && nCT > 0) { this.endRound('T', 'elim'); return; }
    } else {
      if (aT === 0 && nT > 0) { this.endRound('CT', 'elim'); return; }
      if (aCT === 0 && nCT > 0) { this.endRound('T', 'elim'); return; }
      this.phaseLeft -= DT;
      if (this.phaseLeft <= 0) this.endRound('CT', 'time');
    }
  }

  private processCmd(p: ServerPlayer, cmd: Cmd) {
    p.lastSeq = cmd.seq;
    p.lastCmd = cmd;
    const pressed = cmd.btn & ~p.prevBtn;
    if (!p.alive) { p.yaw = cmd.yaw; p.pitch = cmd.pitch; p.prevBtn = cmd.btn; return; }
    this.bombInteraction(p, cmd);
    stepPlayer(p, cmd, this.world, (i) => this.handleIntent(p, i, cmd));
    if ((pressed & BTN_DROP) && this.phase !== 'over') this.dropCurrent(p);
    this.pickups(p, !!(pressed & BTN_USE));
    if (p.pos.y < -20) this.kill(p, null, 'world', false, false);
  }

  private bombInteraction(p: ServerPlayer, cmd: Cmd) {
    const use = !!(cmd.btn & BTN_USE);
    const live = this.phase === 'live';
    // plantar
    if (p.inv.c4) {
      const site = this.siteAt(p.pos);
      if (use && site && p.weapon !== 'c4' && p.deployT <= 0) switchWeapon(p, 'c4');
      const holding = (cmd.btn & (BTN_FIRE | BTN_USE)) && p.weapon === 'c4' && p.deployT <= 0;
      if (live && holding && site && p.onGround) {
        if (p.plantT === 0) this.broadcast({ e: 'plantStart', id: p.id });
        p.plantT += DT; p.busy = true;
        if (p.plantT >= PLANT_TIME) this.plant(p, site);
        return;
      }
      if (p.plantT > 0) { p.plantT = 0; p.busy = false; }
    }
    // desarmar
    if (p.team === 'CT' && this.bomb.st === 'planted' && live) {
      const e = eyePos(p);
      const near = Math.hypot(e.x - this.bomb.pos.x, e.z - this.bomb.pos.z) < 1.8 && Math.abs(p.pos.y - this.bomb.pos.y) < 1.5;
      if (use && near && p.onGround && (this.bomb.defuser === 0 || this.bomb.defuser === p.id)) {
        if (this.bomb.defuser === 0) this.broadcast({ e: 'defuseStart', id: p.id, kit: p.kit });
        this.bomb.defuser = p.id;
        p.defuseT += DT; p.busy = true;
        if (p.defuseT >= (p.kit ? DEFUSE_TIME_KIT : DEFUSE_TIME)) this.defuse(p);
        return;
      }
      if (this.bomb.defuser === p.id) { this.bomb.defuser = 0; p.defuseT = 0; p.busy = false; }
    }
    if (p.busy && p.plantT === 0 && p.defuseT === 0) p.busy = false;
  }

  siteAt(pos: V3): 'A' | 'B' | null {
    if (inRect(this.map.sites.A, pos.x, pos.z)) return 'A';
    if (inRect(this.map.sites.B, pos.x, pos.z)) return 'B';
    return null;
  }

  private plant(p: ServerPlayer, site: 'A' | 'B') {
    p.inv.c4 = false; p.plantT = 0; p.busy = false;
    switchWeapon(p, bestWeapon(p));
    const y = this.world.groundHeight(p.pos.x, p.pos.z, p.pos.y + 0.5);
    this.bomb = { st: 'planted', pos: { x: p.pos.x, y, z: p.pos.z }, site, left: BOMB_TIMER, carrier: 0, defuser: 0, itemId: 0 };
    this.addMoney(p, PLANT_REWARD, 'Bomba plantada');
    this.broadcast({ e: 'planted', site, p: { ...this.bomb.pos }, by: p.id });
  }

  private defuse(p: ServerPlayer) {
    p.defuseT = 0; p.busy = false;
    this.bomb.st = 'defused'; this.bomb.defuser = 0;
    this.addMoney(p, DEFUSE_REWARD, 'Bomba desarmada');
    this.broadcast({ e: 'defused', by: p.id });
    this.endRound('CT', 'defuse');
  }

  private explodeBomb() {
    this.bomb.st = 'exploded';
    const bp = this.bomb.pos;
    this.broadcast({ e: 'det', g: 'bomb', p: { ...bp } });
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const d = dist(p.pos, bp);
      const dmg = d < 22 ? 500 * Math.pow(1 - d / 22, 1.6) : 0;
      if (dmg > 1) this.damage(p, null, dmg, 1, HG_CHEST, 'bomb' as any, false, p.pos);
    }
    this.endRound('T', 'bomb');
  }

  // ------------------------------------------------------------ combate
  private handleIntent(p: ServerPlayer, i: Intent, cmd: Cmd) {
    switch (i.type) {
      case 'shot': this.processShot(p, i.origin, i.dir, i.weapon, cmd.rt, i.pellet ?? 0); break;
      case 'melee': this.processMelee(p, i.origin, i.dir, i.heavy); break;
      case 'throw': {
        this.grenades.push({ id: this.nextEnt++, g: i.g, owner: p.id, team: p.team, pos: { ...i.origin }, vel: { ...i.vel }, age: 0, floorHit: false });
        this.broadcast({ e: 'throw', id: p.id, g: i.g });
        break;
      }
      case 'reload': this.broadcast({ e: 'reload', id: p.id, w: i.weapon }); break;
      case 'dry': this.toPlayer(p, { e: 'dry', id: p.id }); break;
      default: break;
    }
  }

  private recordHistory() {
    const poses = new Map<number, HitboxPose>();
    for (const p of this.players.values()) if (p.alive) poses.set(p.id, { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, duck: p.duck });
    this.history.push({ tick: this.tickN, poses });
    if (this.history.length > 40) this.history.shift();
  }

  /** Lag compensation: poses dos outros jogadores no tick que o atirador estava vendo. */
  private posesFor(shooter: ServerPlayer, rt: number): Map<number, HitboxPose> {
    const cur = new Map<number, HitboxPose>();
    for (const p of this.players.values()) if (p.alive && p.id !== shooter.id) cur.set(p.id, { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, duck: p.duck });
    if (shooter.isBot || !rt || this.history.length === 0) return cur;
    const want = clamp(Math.round(rt), this.tickN - 38, this.tickN);
    const rec = this.history.find((h) => h.tick === want);
    if (!rec) return cur;
    for (const [id, pose] of rec.poses) if (cur.has(id)) cur.set(id, pose);
    return cur;
  }

  private processShot(p: ServerPlayer, origin: V3, dir: V3, wid: WeaponId, rt: number, pellet = 0) {
    const def = WEAPONS[wid];
    if (!pellet) this.noises.push({ pos: { ...origin }, time: this.time, id: p.id, team: p.team });
    const poses = this.posesFor(p, rt);
    const hits: { t: number; group: number; id: number }[] = [];
    for (const [id, pose] of poses) {
      const v = this.players.get(id)!;
      if (v.team === p.team) continue;
      const h = hitTestPlayer(origin, dir, def.range, pose);
      if (h) hits.push({ ...h, id });
    }
    hits.sort((a, b) => a.t - b.t);
    const segs = this.world.raySegments(origin, dir, def.range);
    let power = def.penetration, dmg = def.damage, pen = 0;
    let endT = def.range;
    let si = 0;
    let stopped = false;
    const at = (t: number): V3 => ({ x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t });
    const passSegsUntil = (limit: number) => {
      while (si < segs.length && segs[si].tIn < limit) {
        const s = segs[si++];
        const isBound = !s.box.vis && s.box.min.y >= 0;
        const ip = at(s.tIn);
        if (!isBound) this.broadcast({ e: 'impact', p: ip, n: s.normal, m: s.box.vis ? s.box.mat : this.world.floorMaterial(ip), id: p.id });
        const cost = (s.tOut - s.tIn) * resistOf(s.box);
        if (isBound || !s.box.vis || cost >= power || pen >= 3) { endT = s.tIn; stopped = true; return; }
        power -= cost;
        dmg *= Math.max(0.15, 1 - 0.12 - (cost / def.penetration) * 0.55);
        pen++;
        const ep = at(s.tOut);
        this.broadcast({ e: 'impact', p: ep, n: { x: dir.x, y: dir.y, z: dir.z }, m: s.box.mat, id: p.id });
      }
    };
    for (const h of hits) {
      passSegsUntil(h.t);
      if (stopped) break;
      const v = this.players.get(h.id)!;
      if (!v.alive) continue;
      let d = dmg * Math.pow(def.rangeMod, h.t / 12.7) * HG_MULT[h.group];
      endT = h.t;
      this.damage(v, p, d, def.armorPen, h.group, wid, pen > 0, at(h.t));
      stopped = true;
      break;
    }
    if (!stopped) passSegsUntil(def.range);
    this.broadcast({ e: 'shot', id: p.id, w: wid, o: { ...origin }, end: at(Math.min(endT, def.range)), sup: !!WEAPONS[wid].sound.suppressed, ...(pellet ? { pi: pellet } : {}) });
  }

  private processMelee(p: ServerPlayer, origin: V3, dir: V3, heavy: boolean) {
    const range = heavy ? 1.5 : 1.75;
    let hit = false;
    const wallHit = this.world.raycast(origin, dir, range);
    const maxT = wallHit ? wallHit.t : range;
    let best: { t: number; group: number; v: ServerPlayer } | null = null;
    for (const v of this.players.values()) {
      if (!v.alive || v.id === p.id || v.team === p.team) continue;
      const h = hitTestPlayer(origin, dir, maxT, { x: v.pos.x, y: v.pos.y, z: v.pos.z, yaw: v.yaw, duck: v.duck });
      if (h && (!best || h.t < best.t)) best = { ...h, v };
    }
    if (best) {
      const vf = dirFromAngles(best.v.yaw, 0), af = dirFromAngles(p.yaw, 0);
      const back = vf.x * af.x + vf.z * af.z > 0.4;
      const dmg = heavy ? (back ? 180 : 65) : (back ? 90 : 34);
      this.damage(best.v, p, dmg, 0.85, best.group === HG_HEAD ? HG_HEAD : HG_CHEST, 'knife', false, { x: origin.x + dir.x * best.t, y: origin.y + dir.y * best.t, z: origin.z + dir.z * best.t }, best.group === HG_HEAD ? 1 : 1);
      hit = true;
    } else if (wallHit) {
      const ip = { x: origin.x + dir.x * wallHit.t, y: origin.y + dir.y * wallHit.t, z: origin.z + dir.z * wallHit.t };
      this.broadcast({ e: 'impact', p: ip, n: wallHit.normal, m: wallHit.box.mat, id: p.id });
      hit = true;
    }
    this.broadcast({ e: 'melee', id: p.id, heavy, hit });
  }

  damage(v: ServerPlayer, att: ServerPlayer | null, amount: number, armorPen: number, hg: number, w: WeaponId | 'bomb' | 'world', wallbang: boolean, pos: V3, _scale = 1) {
    if (!v.alive || this.phase === 'over') return;
    let hp = amount;
    let armored = false;
    if (v.armor > 0 && hg !== HG_LEGS && (hg !== HG_HEAD || v.helmet)) {
      hp = amount * armorPen;
      const armorDmg = (amount - hp) * 0.5;
      if (armorDmg > v.armor) { hp += (armorDmg - v.armor) * 2; v.armor = 0; } else v.armor -= armorDmg;
      armored = true;
    }
    const dealt = Math.max(1, Math.floor(hp));
    v.hp -= dealt;
    if (att) v.dmgFrom.set(att.id, (v.dmgFrom.get(att.id) ?? 0) + Math.min(dealt, dealt + v.hp));
    this.broadcast({ e: 'hit', att: att?.id ?? 0, vic: v.id, dmg: dealt, hg, p: { x: r3(pos.x), y: r3(pos.y), z: r3(pos.z) }, armor: armored });
    if (v.brain && att) v.brain.onDamaged(att, this.time);
    if (v.hp <= 0) this.kill(v, att, w, hg === HG_HEAD, wallbang);
  }

  kill(v: ServerPlayer, k: ServerPlayer | null, w: WeaponId | 'bomb' | 'world', hs: boolean, wb: boolean, silent = false) {
    if (!v.alive) return;
    v.alive = false; v.hp = 0; v.deaths++; v.busy = false; v.plantT = 0;
    if (this.bomb.defuser === v.id) { this.bomb.defuser = 0; v.defuseT = 0; }
    this.dropAll(v);
    if (k && k !== v) {
      if (k.team !== v.team) {
        k.kills++;
        const reward = w === 'bomb' || w === 'world' ? 0 : WEAPONS[w].killReward;
        this.addMoney(k, reward, `Eliminação (${w === 'bomb' || w === 'world' ? '' : WEAPONS[w].name})`);
      } else { k.kills--; this.addMoney(k, -300, 'Fogo amigo'); }
    }
    for (const [aid, dmg] of v.dmgFrom) {
      if (dmg >= 41 && aid !== k?.id) { const a = this.players.get(aid); if (a && a.team !== v.team) a.assists++; }
    }
    if (!silent) this.broadcast({ e: 'kill', k: k?.id ?? 0, v: v.id, w, hs, wb });
  }

  // ------------------------------------------------------------ itens
  private dropAll(p: ServerPlayer) {
    if (p.inv.c4) this.dropWeapon(p, 'c4');
    const best = p.inv.primary ?? p.inv.secondary;
    if (best) this.dropWeapon(p, best.id);
    p.inv.primary = null; p.inv.secondary = null; p.inv.nades = emptyNades(); p.inv.zeus = 0;
    p.armor = 0; p.helmet = false; p.kit = false;
  }

  private dropCurrent(p: ServerPlayer) {
    const w = p.weapon;
    if (w === 'knife' || WEAPONS[w].slot === 3) return;
    this.dropWeapon(p, w);
    switchWeapon(p, bestWeapon(p));
  }

  private dropWeapon(p: ServerPlayer, w: WeaponId) {
    const fwd = dirFromAngles(p.yaw, 0);
    const e = eyePos(p);
    let pos = { x: p.pos.x + fwd.x * 1.4, y: 0, z: p.pos.z + fwd.z * 1.4 };
    if (!this.world.los({ x: e.x, y: e.y - 0.6, z: e.z }, { x: pos.x, y: e.y - 0.6, z: pos.z })) pos = { x: p.pos.x, y: 0, z: p.pos.z };
    pos.y = this.world.groundHeight(pos.x, pos.z, p.pos.y + 1) + 0.04;
    let mag = 0, res = 0;
    if (w === 'c4') {
      p.inv.c4 = false;
      if (p.plantT > 0) { p.plantT = 0; p.busy = false; }
    } else {
      const s = slotState(p, w);
      if (!s) return;
      mag = s.mag; res = s.res;
      if (p.inv.primary?.id === w) p.inv.primary = null; else p.inv.secondary = null;
    }
    const it: Item = { id: this.nextEnt++, w, mag, res, pos, yaw: Math.random() * Math.PI * 2, noPick: p.id, noPickUntil: this.time + 1 };
    this.items.push(it);
    if (w === 'c4') { this.bomb.st = 'dropped'; this.bomb.carrier = 0; this.bomb.pos = { ...pos }; this.bomb.itemId = it.id; }
    this.broadcast({ e: 'drop', id: p.id, w });
  }

  private pickups(p: ServerPlayer, usePressed: boolean) {
    if (this.items.length === 0) return;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      const d = Math.hypot(it.pos.x - p.pos.x, it.pos.z - p.pos.z);
      if (d > (usePressed ? 1.8 : 1.0) || Math.abs(it.pos.y - p.pos.y) > 1.6) continue;
      if (it.noPick === p.id && this.time < it.noPickUntil) continue;
      if (it.w === 'c4') {
        if (p.team !== 'T') continue;
        p.inv.c4 = true; this.bomb.st = 'carried'; this.bomb.carrier = p.id; this.bomb.itemId = 0;
      } else {
        const def = WEAPONS[it.w];
        const key = def.slot === 0 ? 'primary' : 'secondary';
        if (p.inv[key]) {
          if (!usePressed) continue;
          this.dropWeapon(p, p.inv[key]!.id);
        }
        p.inv[key] = { id: it.w, mag: it.mag, res: it.res };
        if (p.weapon === 'knife' || usePressed) switchWeapon(p, it.w);
      }
      this.items.splice(i, 1);
      this.toPlayer(p, { e: 'pickup', id: p.id, w: it.w });
      if (usePressed) return;
    }
  }

  // ------------------------------------------------------------ granadas
  private stepGrenades() {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      const det = stepGrenade(g, this.world, DT, (p, sp) => { if (sp > 2) this.broadcast({ e: 'bounce', p: { x: r2(p.x), y: r2(p.y), z: r2(p.z) } }); });
      if (det) { this.grenades.splice(i, 1); this.detonate(g); }
    }
  }

  private detonate(g: GrenadeProj) {
    const pos = { ...g.pos };
    const owner = this.players.get(g.owner) ?? null;
    switch (g.g) {
      case 'he': {
        this.broadcast({ e: 'det', g: 'he', p: pos });
        this.noises.push({ pos, time: this.time, id: g.owner, team: g.team });
        for (const p of this.players.values()) {
          if (!p.alive || (p.team === g.team && p.id !== g.owner)) continue;
          const c = { x: p.pos.x, y: p.pos.y + 1.0, z: p.pos.z };
          const d = dist(pos, c);
          if (d > 9.5 || !this.world.los({ x: pos.x, y: pos.y + 0.15, z: pos.z }, c)) continue;
          const dmg = 98 * (1 - d / 9.5);
          if (dmg >= 1) this.damage(p, owner, dmg, 0.575, HG_CHEST, 'he', false, c);
        }
        break;
      }
      case 'flash': {
        this.broadcast({ e: 'det', g: 'flash', p: pos });
        for (const p of this.players.values()) {
          if (!p.alive) continue;
          const e = eyePos(p);
          const d = dist(pos, e);
          if (d > 38 || !this.world.los(pos, e) || this.smokeBlocks(pos, e)) continue;
          const f = dirFromAngles(p.yaw, p.pitch);
          const to = { x: (pos.x - e.x) / d, y: (pos.y - e.y) / d, z: (pos.z - e.z) / d };
          const dt = f.x * to.x + f.y * to.y + f.z * to.z;
          const ang = dt > 0.55 ? 1 : dt > 0 ? 0.55 : dt > -0.5 ? 0.3 : 0.15;
          const df = clamp(1 - (d - 5) / 33, 0.15, 1);
          const dur = 4.9 * ang * df;
          if (dur < 0.25) continue;
          p.flashEnd = Math.max(p.flashEnd, this.time + dur);
          this.broadcast({ e: 'flash', id: p.id, dur: r2(dur) });
        }
        break;
      }
      case 'smoke': {
        const y = this.world.groundHeight(pos.x, pos.z, pos.y + 0.3);
        const sp = { x: pos.x, y, z: pos.z };
        this.smokes.push({ id: this.nextEnt++, pos: sp, age: 0, life: 18 });
        this.fires = this.fires.filter((f) => Math.hypot(f.pos.x - sp.x, f.pos.z - sp.z) > 4.5);
        this.broadcast({ e: 'det', g: 'smoke', p: sp });
        break;
      }
      case 'decoy': {
        const w: WeaponId = owner?.inv.primary?.id ?? owner?.inv.secondary?.id ?? (g.team === 'T' ? 'glock' : 'usp');
        this.decoys.push({ id: this.nextEnt++, pos, w, owner: g.owner, team: g.team, end: this.time + 15, next: this.time + 0.4, burst: 0 });
        break;
      }
      case 'molotov': {
        const hit = this.world.raycast({ x: pos.x, y: pos.y + 0.1, z: pos.z }, { x: 0, y: -1, z: 0 }, 4);
        const fp = { x: pos.x, y: hit ? pos.y + 0.1 - hit.t : pos.y, z: pos.z };
        const inSmoke = this.smokes.some((s) => Math.hypot(s.pos.x - fp.x, s.pos.z - fp.z) < 4.5);
        this.broadcast({ e: 'det', g: 'molotov', p: fp });
        if (!hit || inSmoke) break;
        this.fires.push({ id: this.nextEnt++, pos: fp, r: 3.2, age: 0, life: 7, owner: g.owner, team: g.team });
        break;
      }
    }
  }

  /** Decoy: rajadas aleatórias com o som da arma do dono; no fim, um estalo. */
  private stepDecoys() {
    for (let i = this.decoys.length - 1; i >= 0; i--) {
      const d = this.decoys[i];
      if (this.time >= d.end) {
        this.decoys.splice(i, 1);
        this.broadcast({ e: 'det', g: 'decoy', p: { ...d.pos } });
        continue;
      }
      if (this.time < d.next) continue;
      const def = WEAPONS[d.w];
      this.broadcast({ e: 'decoy', p: { x: r2(d.pos.x), y: r2(d.pos.y), z: r2(d.pos.z) }, w: d.w });
      this.noises.push({ pos: { ...d.pos }, time: this.time, id: d.owner, team: d.team });
      if (d.burst > 0) { d.burst--; d.next = this.time + Math.max(0.09, def.fireInterval); }
      else { d.burst = def.auto ? Math.floor(Math.random() * 4) : Math.floor(Math.random() * 2); d.next = this.time + 0.5 + Math.random() * 1.6; }
    }
  }

  private stepFires() {
    for (const f of this.fires) {
      f.age += DT;
      const r = f.r * Math.min(1, f.age / 0.5 + 0.3);
      const owner = this.players.get(f.owner) ?? null;
      for (const p of this.players.values()) {
        if (!p.alive || (p.team === f.team && p.id !== f.owner)) continue;
        if (Math.hypot(p.pos.x - f.pos.x, p.pos.z - f.pos.z) > r || Math.abs(p.pos.y - f.pos.y) > 1.2) continue;
        p.burnAcc += 40 * DT;
        if (p.burnAcc >= 4) { const d = Math.floor(p.burnAcc); p.burnAcc -= d; this.damage(p, owner, d, 1, HG_LEGS, 'molotov', false, p.pos); }
      }
    }
    this.fires = this.fires.filter((f) => f.age < f.life);
  }

  /** Segmento a-b atravessa alguma fumaça? */
  smokeBlocks(a: V3, b: V3): boolean {
    for (const s of this.smokes) {
      if (s.age < 0.6) continue;
      const c = { x: s.pos.x, y: s.pos.y + 1.6, z: s.pos.z };
      const R = 3.9;
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const L2 = dx * dx + dy * dy + dz * dz || 1;
      const t = clamp(((c.x - a.x) * dx + (c.y - a.y) * dy + (c.z - a.z) * dz) / L2, 0, 1);
      const px = a.x + dx * t - c.x, py = (a.y + dy * t - c.y) * 1.3, pz = a.z + dz * t - c.z;
      if (px * px + py * py + pz * pz < R * R) return true;
    }
    return false;
  }

  canSee(a: ServerPlayer, b: ServerPlayer): boolean {
    const e = eyePos(a);
    const tHead = { x: b.pos.x, y: b.pos.y + eyeHeight(b.duck), z: b.pos.z };
    const tBody = { x: b.pos.x, y: b.pos.y + eyeHeight(b.duck) - 0.5, z: b.pos.z };
    if (this.smokeBlocks(e, tBody)) return false;
    return this.world.los(e, tHead) || this.world.los(e, tBody);
  }

  private updateSpotted() {
    const list = [...this.players.values()].filter((p) => p.alive);
    for (const p of list) {
      for (const o of list) {
        if (o.team === p.team || p.spottedUntil > this.time + 0.4) continue;
        const e = eyePos(o);
        const f = dirFromAngles(o.yaw, 0);
        const dx = p.pos.x - e.x, dz = p.pos.z - e.z;
        const L = Math.hypot(dx, dz) || 1;
        if ((dx * f.x + dz * f.z) / L < 0.2 && L > 4) continue;
        if (this.canSee(o, p)) { p.spottedUntil = this.time + 1.2; break; }
      }
    }
  }

  // ------------------------------------------------------------ eventos/snapshots
  broadcast(ev: GameEvent) {
    for (const p of this.players.values()) if (!p.isBot) { p.events.push(ev); if (p.events.length > 400) p.events.splice(0, 100); }
  }
  toPlayer(p: ServerPlayer, ev: GameEvent) { if (!p.isBot) p.events.push(ev); }

  snapshotFor(id: number): Snapshot {
    const me = this.players.get(id) ?? null;
    const ev = me ? me.events.splice(0) : [];
    const players: PlayerNet[] = [];
    for (const p of this.players.values()) {
      const friend = !me || p.team === me.team;
      players.push({
        id: p.id, n: p.name, tm: p.team, a: p.alive, bot: p.isBot,
        x: r3(p.pos.x), y: r3(p.pos.y), z: r3(p.pos.z), vx: r2(p.vel.x), vz: r2(p.vel.z), og: p.onGround,
        yw: r3(p.yaw), pt: r3(p.pitch), dk: r2(p.duck), w: p.weapon,
        hp: p.hp, ar: Math.round(p.armor), hm: p.helmet, kit: p.kit, mo: friend ? p.money : 0,
        k: p.kills, d: p.deaths, as: p.assists, c4: friend ? p.inv.c4 : false, sp: p.spottedUntil > this.time, ping: p.ping,
      });
    }
    const showBomb = !me || me.team === 'T' || this.bomb.st === 'planted' || this.bomb.st === 'defused' || this.bomb.st === 'exploded';
    const b = this.bomb;
    return {
      tick: this.tickN,
      ack: me ? me.lastSeq : 0,
      you: id,
      team: me ? me.team : null,
      me: me ? {
        st: extractPlayerState(me), money: me.money, hp: me.hp, armor: Math.round(me.armor), helmet: me.helmet, kit: me.kit,
        plantP: me.plantT / PLANT_TIME, defuseP: me.defuseT / (me.kit ? DEFUSE_TIME_KIT : DEFUSE_TIME), canBuy: this.canBuy(me),
        flashEnd: Math.max(0, me.flashEnd - this.time),
      } : null,
      players,
      gr: [
        ...this.grenades.map((g) => ({ id: g.id, g: g.g, x: r2(g.pos.x), y: r2(g.pos.y), z: r2(g.pos.z) })),
        ...this.decoys.map((d) => ({ id: d.id, g: 'decoy' as GrenadeId, x: r2(d.pos.x), y: r2(d.pos.y), z: r2(d.pos.z) })),
      ],
      sm: this.smokes.map((s) => ({ id: s.id, x: r2(s.pos.x), y: r2(s.pos.y), z: r2(s.pos.z), age: r2(s.age), life: s.life })),
      fi: this.fires.map((f) => ({ id: f.id, x: r2(f.pos.x), y: r2(f.pos.y), z: r2(f.pos.z), r: f.r, age: r2(f.age), life: f.life })),
      it: this.items.map((i) => ({ id: i.id, w: i.w, x: r2(i.pos.x), y: r2(i.pos.y), z: r2(i.pos.z), yw: r2(i.yaw) })),
      bomb: showBomb
        ? { st: b.st, x: r2(b.pos.x), y: r2(b.pos.y), z: r2(b.pos.z), site: b.site, left: r2(b.left), carrier: b.carrier, defuser: b.defuser }
        : { st: b.st === 'none' ? 'none' : 'carried', x: 0, y: 0, z: 0, site: '', left: 0, carrier: 0, defuser: 0 },
      round: {
        phase: this.phase, left: r2(this.bomb.st === 'planted' ? this.bomb.left : Math.max(0, this.phaseLeft)), round: this.round,
        sT: this.score.T, sCT: this.score.CT, buyLeft: r2(this.phase === 'freeze' ? BUY_TIME + this.phaseLeft : Math.max(0, BUY_TIME - this.roundElapsed)),
        maxRounds: this.maxRounds,
      },
      ev,
    };
  }
}

function sanitizeCmd(c: Cmd): Cmd {
  const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const w = typeof c.wpn === 'string' && (c.wpn === '' || c.wpn in WEAPONS) ? c.wpn : '';
  return {
    seq: num(c.seq) | 0, yaw: num(c.yaw), pitch: num(c.pitch), mx: clamp(num(c.mx), -1, 1), mz: clamp(num(c.mz), -1, 1),
    btn: num(c.btn) & 255, wpn: w as WeaponId | '', rt: num(c.rt), as: !!c.as,
  };
}

export { TICK_RATE };
