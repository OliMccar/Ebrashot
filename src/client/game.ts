import * as THREE from 'three';
import { DT, type Team, TICK_RATE } from '../shared/constants';
import { buildMap, inRect } from '../shared/map';
import { type V3, DEG, angleDiff, clamp, dirFromAngles, lerp } from '../shared/math';
import {
  type Cmd, type Intent, type PlayerState, clonePlayerState, computeInaccuracy, eyeHeight, hitTestPlayer, slotState, stepPlayer,
} from '../shared/player';
import type { GameEvent, GrenadeNet, MePriv, PlayerNet, Snapshot } from '../shared/protocol';
import { type WeaponId, WEAPONS, patternAt } from '../shared/weapons';
import { World } from '../shared/world';
import type { GameAudio } from './audio';
import { Hud } from './hud/hud';
import { Input, isTouch } from './input/input';
import type { Connection } from './net';
import { Effects } from './render/effects';
import { buildMapMesh } from './render/mapMesh';
import { textures } from './render/textures';
import { type CharacterModel, buildCharacter, buildWeaponCached, makeTextSprite, poseCharacter, setCharacterWeapon } from './render/models';
import { ViewModel } from './render/viewmodel';
import type { Settings } from './settings';

interface BufEntry { tick: number; players: Map<number, PlayerNet>; gr: Map<number, GrenadeNet> }

export interface GameOptions {
  settings: Settings;
  conn: Connection;
  audio: GameAudio;
  onExit: (reason?: string) => void;
  onOpenSettings: (done: () => void) => void;
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private map = buildMap();
  private world = new World(this.map);
  private effects: Effects;
  private vm = new ViewModel();
  private hud: Hud;
  input: Input;
  private settings: Settings;
  private conn: Connection;
  private audio: GameAudio;
  private predicted: PlayerState | null = null;
  private prevPred: PlayerState | null = null;
  private pending: Cmd[] = [];
  private seq = 0;
  private snap: Snapshot | null = null;
  private me: MePriv | null = null;
  private buf: BufEntry[] = [];
  private serverTick = 0;
  private recvAt = 0;
  private renderTick = 0;
  private models = new Map<number, CharacterModel>();
  private items = new Map<number, THREE.Object3D>();
  private nades = new Map<number, THREE.Object3D>();
  private bombObj: THREE.Object3D;
  private bombLed: THREE.Object3D | null;
  private acc = 0;
  private last = 0;
  private visOffset = new THREE.Vector3();
  private running = true;
  private raf = 0;
  private spectateId = 0;
  private deathPos: V3 | null = null;
  private steps = new Map<number, number>();
  private myStep = 0;
  private beepT = 0;
  private shakeT = 0;
  private shakeAmp = 0;
  private punchP = 0;
  private punchY = 0;
  private flinch = 0;
  private autoT = 0;
  private fps = 0;
  private frames = 0;
  private fpsT = 0;
  private dpr = 1;
  private dprMax = 1;
  private frameAvg = 16;
  private dprT = 0;
  private pauseEl: HTMLElement | null = null;
  private pauseAt = 0;
  private clickEl: HTMLElement;
  private mobile: boolean;
  private team: Team | null = null;
  private interpDelay: number;
  private reloadTimers: number[] = [];
  private lastWeapon: WeaponId | '' = '';
  private heartT = 0;
  /** Desenhar as mãos/arma em primeira pessoa neste frame (vivo ou assistindo alguém). */
  private vmVisible = false;
  /** Estado reconstruído do jogador assistido, para animar as mãos dele. */
  private specVm: { id: number; w: WeaponId; deployT: number; reloadT: number; yaw: number; pitch: number } | null = null;

  /** Id do jogador sendo assistido agora (0 se nenhum). */
  private specId() {
    if (this.predicted?.alive || !this.snap || !this.spectateId) return 0;
    return this.snap.players.some((p) => p.id === this.spectateId && p.a) ? this.spectateId : 0;
  }

  /** Atualiza as mãos em primeira pessoa do jogador assistido. Retorna false se não há ninguém. */
  private updateSpectatorVm(dt: number) {
    const id = this.specId();
    const pn = id ? this.snap!.players.find((p) => p.id === id) : undefined;
    const r = id ? this.interp(id) : null;
    if (!pn || !r) { this.specVm = null; return false; }
    let sv = this.specVm;
    if (!sv || sv.id !== id) {
      sv = this.specVm = { id, w: pn.w, deployT: WEAPONS[pn.w].deployTime, reloadT: 0, yaw: r.yaw, pitch: r.pitch };
    }
    if (pn.w !== sv.w) { sv.w = pn.w; sv.deployT = WEAPONS[pn.w].deployTime; sv.reloadT = 0; }
    sv.deployT = Math.max(0, sv.deployT - dt);
    sv.reloadT = Math.max(0, sv.reloadT - dt);
    // balanço da arma a partir de quanto a mira dele girou (convertido para "contagens de mouse")
    const dx = -angleDiff(sv.yaw, r.yaw) * 1300, dy = -(r.pitch - sv.pitch) * 1300;
    sv.yaw = r.yaw; sv.pitch = r.pitch;
    const fake = {
      weapon: pn.w, scope: 0, vel: { x: pn.vx, y: 0, z: pn.vz }, onGround: pn.og,
      deployT: sv.deployT, reloadT: sv.reloadT, throwT: 0,
    } as unknown as PlayerState;
    this.vm.team = pn.tm;
    this.vm.update(dt, fake, { dx, dy }, { plantP: 0, crouch: r.duck, aspect: this.camera.aspect, visible: true });
    return true;
  }

  /** Som de bala passando perto quando um tiro inimigo cruza perto do ouvinte. */
  private bulletWhiz(o: V3, end: V3) {
    if (!this.predicted?.alive) return;
    const c = this.camera.position;
    const dx = end.x - o.x, dy = end.y - o.y, dz = end.z - o.z;
    const L2 = dx * dx + dy * dy + dz * dz;
    if (L2 < 1) return;
    const t = clamp(((c.x - o.x) * dx + (c.y - o.y) * dy + (c.z - o.z) * dz) / L2, 0, 1);
    if (t <= 0.02 || t >= 0.98) return; // não passou pelo jogador (parou antes ou é o próprio alvo)
    const px = o.x + dx * t, py = o.y + dy * t, pz = o.z + dz * t;
    if (Math.hypot(px - c.x, py - c.y, pz - c.z) < 2.2) this.audio.whiz({ x: px, y: py, z: pz });
  }
  private onResize = () => this.resize();
  private sun!: THREE.DirectionalLight;
  private lastDraw = 0;

  private computeDpr() {
    const cap = this.mobile ? 2 : 2.5;
    this.dprMax = Math.max(0.5, Math.min(cap, (window.devicePixelRatio || 1) * this.settings.gScale));
  }

  /** Aplica as opções gráficas que podem mudar durante a partida. */
  applyGraphics() {
    const g = this.settings;
    // escala de renderização
    this.computeDpr();
    const nd = g.gDynRes ? Math.min(this.dpr, this.dprMax) : this.dprMax;
    if (Math.abs(nd - this.dpr) > 0.01 || this.renderer.getPixelRatio() !== nd) { this.dpr = nd; this.renderer.setPixelRatio(nd); this.resize(); }
    // sombras
    const on = g.gShadows !== 'off';
    const type = g.gShadows === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    const sm = this.renderer.shadowMap;
    const recompile = sm.enabled !== on || (on && sm.type !== type);
    sm.enabled = on; sm.type = type;
    this.sun.castShadow = on;
    const q = g.gShadows;
    if (q !== 'off') {
      const size = { low: 1024, medium: 2048, high: 4096 }[q];
      if (this.sun.shadow.mapSize.x !== size) {
        this.sun.shadow.mapSize.set(size, size);
        this.sun.shadow.map?.dispose();
        (this.sun.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
      }
    }
    if (recompile) {
      const mark = (o: THREE.Object3D) => {
        const m = (o as THREE.Mesh).material;
        if (m) (Array.isArray(m) ? m : [m]).forEach((x) => { x.needsUpdate = true; });
      };
      this.scene.traverse(mark);
    }
    // distância de visão (neblina)
    const fog = this.scene.fog as THREE.Fog;
    const [near, far] = { low: [55, 190], medium: [80, 260], high: [140, 420] }[g.gViewDist];
    fog.near = near; fog.far = far;
    // filtragem de textura
    const maxA = this.renderer.capabilities.getMaxAnisotropy();
    for (const t of Object.values(textures())) {
      const a = Math.max(1, Math.min(maxA, g.gAniso));
      if (t.anisotropy !== a) { t.anisotropy = a; t.needsUpdate = true; }
    }
    // efeitos
    this.effects.lightsOn = g.gDynLights;
    if (!g.gDynLights && this.effects.light) this.effects.light.intensity = 0;
    this.effects.blood = g.gBlood;
    // brilho / contraste / saturação (filtro CSS: custo quase zero quando neutro)
    const f = g.gBright === 1 && g.gContrast === 1 && g.gSat === 1 ? '' : `brightness(${g.gBright}) contrast(${g.gContrast}) saturate(${g.gSat})`;
    if (this.renderer.domElement.style.filter !== f) this.renderer.domElement.style.filter = f;
    // viewmodel
    this.vm.fov = g.vmFov; this.vm.offX = g.vmX; this.vm.offY = g.vmY; this.vm.offZ = g.vmZ; this.vm.bob = g.vmBob;
    this.hud.setCrosshair();
  }

  constructor(private container: HTMLElement, private opts: GameOptions) {
    this.settings = opts.settings;
    this.conn = opts.conn;
    this.audio = opts.audio;
    this.interpDelay = this.conn.offline ? 1.5 : 7;
    const canvas = document.createElement('canvas');
    canvas.className = 'game-canvas';
    container.appendChild(canvas);
    // HUD antes do Input: o HUD limpa #hud e o Input acrescenta os controles touch
    this.hud = new Hud(this.map, this.settings.forceMobile || isTouch(), () => this.settings.xh);
    this.input = new Input(canvas, this.settings, {
      onBuyMenu: () => this.toggleBuy(),
      onScoreboard: (s) => this.hud.showScore(s),
      onMenu: () => this.openPause(),
      onInspect: () => { if (this.predicted?.alive) this.vm.inspect(); },
      onSpectateNext: () => this.nextSpectate(),
      onEscape: () => this.onEscape(),
      isUiOpen: () => this.hud.buyOpen || !!this.pauseEl,
    }, () => this.predicted);
    this.mobile = this.input.mobile;
    const g = this.settings;
    this.computeDpr();
    this.dpr = this.mobile && g.gDynRes ? Math.min(1, this.dprMax) : this.dprMax;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: g.gMsaa, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = false;
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.1, 520);
    this.camera.rotation.order = 'YXZ';
    this.scene.fog = new THREE.Fog(0xead7b4, 80, 260);
    this.scene.add(new THREE.HemisphereLight(0xfff3dd, 0x8a6c48, 1.55));
    const sun = new THREE.DirectionalLight(0xfff0d2, 2.1);
    sun.position.set(60, 120, 37.5);
    // sombra cobre o mapa inteiro (bounds ±48 x ±58) com folga
    const sc = sun.shadow.camera;
    sc.left = -82; sc.right = 82; sc.top = 82; sc.bottom = -82; sc.near = 20; sc.far = 320;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    sun.shadow.intensity = 0.72;
    this.sun = sun;
    this.scene.add(sun, sun.target);
    const mapMesh = buildMapMesh(this.map);
    mapMesh.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material instanceof THREE.MeshLambertMaterial) { o.castShadow = true; o.receiveShadow = true; }
    });
    this.scene.add(mapMesh);
    const lvl = ({ low: 0, medium: 1, high: 2 } as const)[g.gEffects];
    this.effects = new Effects(this.scene, lvl, this.mobile, g.gDynLights);
    this.applyGraphics();
    // áudio: sons atrás de paredes ficam abafados; vento ambiente durante a partida
    this.audio.los = (a, b) => this.world.los(a, b);
    this.audio.startAmbience();
    const bomb = buildWeaponCached('c4');
    this.bombObj = bomb.root;
    this.bombObj.scale.setScalar(1.4);
    this.bombObj.visible = false;
    this.bombObj.traverse((o) => { o.castShadow = true; });
    this.bombLed = this.bombObj.getObjectByName('led') ?? null;
    this.scene.add(this.bombObj);
    this.hud.onBuy = (item) => this.conn.buy(item);
    this.hud.onBuyClose = () => this.relock();
    this.clickEl = document.createElement('div');
    this.clickEl.className = 'click-to-play';
    this.clickEl.innerHTML = '<div>Clique para jogar</div><small>WASD mover · Mouse mirar · B comprar · Tab placar · Esc menu</small>';
    this.clickEl.onclick = () => this.relock();
    document.getElementById('hud')!.appendChild(this.clickEl);
    this.conn.onSnapshot = (s) => this.onSnapshot(s);
    this.conn.onClose = (r) => this.exit(r);
    window.addEventListener('resize', this.onResize);
    this.resize();
    this.vm.warm();
    this.renderer.compile(this.scene, this.camera);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  private onLockChange = () => {
    if (!document.pointerLockElement && !this.mobile && !this.hud.buyOpen && this.running) this.openPause();
  };

  private relock() {
    if (!this.mobile && !document.pointerLockElement) this.renderer.domElement.requestPointerLock?.();
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- rede
  private onSnapshot(s: Snapshot) {
    const first = !this.snap;
    this.snap = s;
    this.team = s.team;
    this.buf.push({ tick: s.tick, players: new Map(s.players.map((p) => [p.id, p])), gr: new Map(s.gr.map((g) => [g.id, g])) });
    while (this.buf.length > 80) this.buf.shift();
    this.serverTick = s.tick;
    this.recvAt = performance.now();
    if (first) this.renderTick = s.tick - this.interpDelay;
    if (s.me) {
      this.me = s.me;
      const st = s.me.st;
      this.pending = this.pending.filter((c) => c.seq > s.ack);
      const old = this.predicted;
      const next = clonePlayerState(st);
      for (const c of this.pending) stepPlayer(next, c, this.world);
      if (old && old.alive && next.alive) {
        const dx = old.pos.x - next.pos.x, dy = old.pos.y - next.pos.y, dz = old.pos.z - next.pos.z;
        const d = Math.hypot(dx, dy, dz);
        if (d > 0.0005 && d < 2) {
          this.visOffset.x += dx; this.visOffset.y += dy; this.visOffset.z += dz;
          if (this.prevPred) { this.prevPred.pos.x -= dx; this.prevPred.pos.y -= dy; this.prevPred.pos.z -= dz; }
        } else if (d >= 2) { this.visOffset.set(0, 0, 0); this.prevPred = clonePlayerState(next); }
      }
      if (!old || (!old.alive && next.alive)) {
        this.prevPred = clonePlayerState(next);
        this.visOffset.set(0, 0, 0);
        this.input.yaw = st.yaw; this.input.pitch = 0;
        this.deathPos = null;
      }
      this.predicted = next;
    }
    for (const e of s.ev) this.handleEvent(e);
  }

  private tick() {
    const cmd = this.input.buildCmd(++this.seq, this.renderTick);
    if (this.predicted && this.predicted.alive) {
      this.prevPred = clonePlayerState(this.predicted);
      stepPlayer(this.predicted, cmd, this.world, (i) => this.onLocalIntent(i));
    }
    this.pending.push(cmd);
    if (this.pending.length > 160) this.pending.shift();
    this.conn.sendCmd(cmd);
    this.conn.tick();
  }

  // ---------------------------------------------------------------- loop
  private frame = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    // limite de FPS: pula frames do requestAnimationFrame (o tempo acumulado segue para o próximo)
    const cap = this.settings.gFpsCap;
    if (cap > 0) {
      const iv = 1000 / cap;
      const el = now - this.lastDraw;
      if (el < iv - 1) return;
      this.lastDraw = el > iv * 2 ? now : this.lastDraw + iv;
    }
    const dtRaw = (now - this.last) / 1000;
    this.last = now;
    const dt = Math.min(0.1, Math.max(0, dtRaw));
    this.updateAutoFire(dt);
    this.acc += dt;
    let n = 0;
    while (this.acc >= DT && n < 6) { this.tick(); this.acc -= DT; n++; }
    if (n === 6) this.acc = 0;
    const alpha = this.acc / DT;
    // tempo de renderização dos outros (interpolação)
    const est = this.serverTick + ((now - this.recvAt) / 1000) * TICK_RATE;
    const target = est - this.interpDelay;
    this.renderTick += dt * TICK_RATE;
    const diff = target - this.renderTick;
    if (Math.abs(diff) > 24) this.renderTick = target; else this.renderTick += diff * 0.08;

    this.updateCamera(dt, alpha);
    this.updateWorldObjects(dt, now / 1000);
    this.effects.update(dt);
    this.updateHud(dt);
    this.render();
    this.adaptQuality(dtRaw);
  };

  private interp(id: number): { p: PlayerNet; pos: V3; yaw: number; pitch: number; duck: number } | null {
    const b = this.buf;
    if (!b.length) return null;
    const rt = this.renderTick;
    let s0: BufEntry | null = null, s1: BufEntry | null = null;
    for (let i = b.length - 1; i >= 0; i--) {
      if (b[i].tick <= rt) { s0 = b[i]; s1 = b[i + 1] ?? null; break; }
    }
    if (!s0) { s0 = b[0]; s1 = null; }
    const a = s0.players.get(id);
    const latest = b[b.length - 1].players.get(id);
    if (!latest) return null;
    if (!a) return { p: latest, pos: { x: latest.x, y: latest.y, z: latest.z }, yaw: latest.yw, pitch: latest.pt, duck: latest.dk };
    const c = s1?.players.get(id);
    if (!c || !s1 || !c.a || !a.a) return { p: latest, pos: { x: a.x, y: a.y, z: a.z }, yaw: a.yw, pitch: a.pt, duck: a.dk };
    const t = clamp((rt - s0.tick) / Math.max(1, s1.tick - s0.tick), 0, 1);
    return {
      p: latest,
      pos: { x: lerp(a.x, c.x, t), y: lerp(a.y, c.y, t), z: lerp(a.z, c.z, t) },
      yaw: a.yw + angleDiff(a.yw, c.yw) * t, pitch: lerp(a.pt, c.pt, t), duck: lerp(a.dk, c.dk, t),
    };
  }

  private updateCamera(dt: number, alpha: number) {
    const st = this.predicted;
    const cam = this.camera;
    this.visOffset.multiplyScalar(Math.exp(-dt * 14));
    let fov = this.settings.fov;
    if (st && st.alive && this.prevPred) {
      const a = this.prevPred, b = st;
      const duck = lerp(a.duck, b.duck, alpha);
      cam.position.set(
        lerp(a.pos.x, b.pos.x, alpha) + this.visOffset.x,
        lerp(a.pos.y, b.pos.y, alpha) + this.visOffset.y + eyeHeight(duck),
        lerp(a.pos.z, b.pos.z, alpha) + this.visOffset.z,
      );
      const def = WEAPONS[st.weapon];
      const [pp, py] = patternAt(def, st.recoilIdx);
      const k = Math.min(1, dt * 25);
      this.punchP += (pp * DEG * 0.45 - this.punchP) * k;
      this.punchY += (py * DEG * 0.45 - this.punchY) * k;
      this.flinch *= Math.exp(-dt * 10);
      cam.rotation.set(this.input.pitch + this.punchP + this.flinch, this.input.yaw - this.punchY, 0);
      if (st.scope > 0 && def.scopeFov) fov = def.scopeFov[st.scope - 1];
      this.input.zoomScale = fov / this.settings.fov;
    } else {
      this.input.zoomScale = 1;
      const sp = this.spectateTarget();
      if (sp) {
        cam.position.set(sp.pos.x, sp.pos.y + eyeHeight(sp.duck), sp.pos.z);
        cam.rotation.set(sp.pitch, sp.yaw, 0);
      } else if (this.deathPos) {
        const t = performance.now() / 4000;
        cam.position.set(this.deathPos.x + Math.sin(t) * 4, this.deathPos.y + 3.5, this.deathPos.z + Math.cos(t) * 4);
        cam.lookAt(this.deathPos.x, this.deathPos.y + 0.5, this.deathPos.z);
      } else {
        cam.position.set(0, 30, 10);
        cam.rotation.set(-1.2, 0, 0);
      }
    }
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const s = this.shakeAmp * Math.max(0, this.shakeT);
      cam.rotation.x += (Math.random() - 0.5) * s; cam.rotation.y += (Math.random() - 0.5) * s;
    }
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    const f = dirFromAngles(cam.rotation.y, cam.rotation.x);
    void f;
    this.audio.setListener({ x: cam.position.x, y: cam.position.y, z: cam.position.z }, cam.rotation.y, cam.rotation.x);
  }

  private spectateTarget() {
    if (!this.snap) return null;
    if (this.spectateId) {
      const r = this.interp(this.spectateId);
      if (r && r.p.a) return r;
    }
    const mates = this.snap.players.filter((p) => p.a && p.tm === this.team && p.id !== this.snap!.you);
    if (!mates.length) return null;
    this.spectateId = mates[0].id;
    return this.interp(this.spectateId);
  }

  private nextSpectate() {
    if (!this.snap || this.predicted?.alive) return;
    const mates = this.snap.players.filter((p) => p.a && p.tm === this.team && p.id !== this.snap!.you);
    if (!mates.length) return;
    const i = mates.findIndex((m) => m.id === this.spectateId);
    this.spectateId = mates[(i + 1) % mates.length].id;
  }

  // ---------------------------------------------------------------- objetos
  private updateWorldObjects(dt: number, t: number) {
    const s = this.snap;
    if (!s) return;
    const seen = new Set<number>();
    const meAlive = !!this.predicted?.alive;
    const specId = meAlive ? 0 : this.spectateId;
    for (const pn of s.players) {
      if (pn.id === s.you) continue;
      const r = this.interp(pn.id);
      if (!r) continue;
      seen.add(pn.id);
      let m = this.models.get(pn.id);
      if (!m || m.team !== pn.tm) {
        if (m) this.scene.remove(m.root);
        m = buildCharacter(pn.tm);
        m.root.traverse((o) => { if ((o as THREE.Mesh).isMesh && !(o as THREE.Sprite).isSprite) o.castShadow = true; });
        m.root.rotation.order = 'YXZ';
        this.scene.add(m.root);
        this.models.set(pn.id, m);
      }
      m.root.visible = pn.id !== specId;
      m.root.position.set(r.pos.x, r.pos.y, r.pos.z);
      setCharacterWeapon(m, pn.w);
      poseCharacter(m, 'aim');
      const speed = Math.hypot(pn.vx, pn.vz);
      if (pn.a) {
        m.deadT = 0;
        m.root.rotation.set(0, r.yaw, 0);
        m.upper.rotation.x = r.pitch * 0.75;
        const hipsY = 0.92 - r.duck * 0.42;
        (m.upper.parent as THREE.Object3D).position.y = hipsY;
        const sw = Math.min(1, speed / 5);
        m.phase += dt * speed * 1.9;
        const sn = Math.sin(m.phase);
        const air = pn.og ? 0 : 0.5;
        m.legL.rotation.x = r.duck * 0.9 + sn * 0.55 * sw + air;
        m.legR.rotation.x = r.duck * 0.9 - sn * 0.55 * sw + air * 0.4;
        m.shinL.rotation.x = -r.duck * 1.6 - Math.max(0, -sn) * 0.7 * sw - air;
        m.shinR.rotation.x = -r.duck * 1.6 - Math.max(0, sn) * 0.7 * sw - air * 0.6;
        // passos
        if (pn.og && speed > 3.4) {
          const acc = (this.steps.get(pn.id) ?? 0) + speed * dt;
          if (acc > 2.1) { this.audio.footstep(this.world.floorMaterial(r.pos), r.pos, 1); this.steps.set(pn.id, 0); }
          else this.steps.set(pn.id, acc);
        }
      } else {
        m.deadT += dt;
        const k = Math.min(1, m.deadT / 0.45);
        m.root.rotation.set(-k * k * Math.PI / 2, r.yaw, 0);
        m.root.position.y = r.pos.y + 0.12 * k;
      }
      // nametag só para aliados
      const friend = pn.tm === this.team;
      if (friend && pn.a) {
        if (!m.tag) { m.tag = makeTextSprite(pn.n, pn.tm === 'T' ? '#f2c060' : '#7ab4ff'); m.tag.position.y = 2.15; m.root.add(m.tag); }
        m.tag.visible = !specId || pn.id !== specId;
      } else if (m.tag) m.tag.visible = false;
    }
    for (const [id, m] of this.models) if (!seen.has(id)) { this.scene.remove(m.root); this.models.delete(id); }

    // itens no chão
    const iseen = new Set<number>();
    for (const it of s.it) {
      iseen.add(it.id);
      let o = this.items.get(it.id);
      if (!o) {
        o = buildWeaponCached(it.w).root;
        if (it.w === 'c4') o.scale.setScalar(1.3);
        o.rotation.set(0, it.yw, Math.PI / 2);
        this.scene.add(o); this.items.set(it.id, o);
      }
      o.position.set(it.x, it.y + 0.04, it.z);
    }
    for (const [id, o] of this.items) if (!iseen.has(id)) { this.scene.remove(o); this.items.delete(id); }

    // granadas em voo (interpoladas)
    const gseen = new Set<number>();
    const latest = this.buf[this.buf.length - 1];
    for (const g of s.gr) {
      gseen.add(g.id);
      let o = this.nades.get(g.id);
      if (!o) { o = buildWeaponCached(g.g).root; o.scale.setScalar(1.3); this.scene.add(o); this.nades.set(g.id, o); }
      const p = this.interpNade(g.id) ?? latest.gr.get(g.id)!;
      // só gira enquanto voa (a decoy no chão fica parada)
      const moving = Math.hypot(p.x - o.position.x, p.y - o.position.y, p.z - o.position.z) > 0.002;
      o.position.set(p.x, p.y, p.z);
      if (moving) { o.rotation.x += dt * 9; o.rotation.z += dt * 5; }
    }
    for (const [id, o] of this.nades) if (!gseen.has(id)) { this.scene.remove(o); this.nades.delete(id); }

    this.effects.syncSmokes(s.sm);
    this.effects.syncFires(s.fi, t);
    for (const f of s.fi) if (Math.random() < dt * 5) this.audio.fireCrackle(f);

    // bomba plantada
    const b = s.bomb;
    this.bombObj.visible = b.st === 'planted' || b.st === 'defused';
    if (this.bombObj.visible) {
      this.bombObj.position.set(b.x, b.y + 0.05, b.z);
      if (b.st === 'planted') {
        this.beepT -= dt;
        if (this.beepT <= 0) {
          const k = Math.max(0, b.left) / 40;
          this.beepT = b.left < 1.2 ? 0.08 : 0.13 + 0.87 * Math.pow(k, 1.3);
          this.audio.c4Beep(b, b.left < 10);
          if (this.bombLed) this.bombLed.visible = true;
          setTimeout(() => { if (this.bombLed) this.bombLed.visible = false; }, 80);
        }
      }
    }

    // passos do jogador local
    const st = this.predicted;
    if (st && st.alive && st.onGround) {
      const sp = Math.hypot(st.vel.x, st.vel.z);
      if (sp > 3.4) {
        this.myStep += sp * dt;
        if (this.myStep > 2.1) { this.myStep = 0; this.audio.footstep(this.world.floorMaterial(st.pos), undefined, 0.55); }
      }
    }
  }

  private interpNade(id: number): V3 | null {
    const b = this.buf;
    for (let i = b.length - 1; i > 0; i--) {
      if (b[i - 1].tick <= this.renderTick) {
        const a = b[i - 1].gr.get(id), c = b[i].gr.get(id);
        if (!a || !c) return a ?? c ?? null;
        const t = clamp((this.renderTick - b[i - 1].tick) / Math.max(1, b[i].tick - b[i - 1].tick), 0, 1);
        return { x: lerp(a.x, c.x, t), y: lerp(a.y, c.y, t), z: lerp(a.z, c.z, t) };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- tiro
  private muzzleWorld(): V3 {
    const c = this.camera;
    const f = dirFromAngles(c.rotation.y, c.rotation.x);
    const r = { x: Math.cos(c.rotation.y), z: -Math.sin(c.rotation.y) };
    return { x: c.position.x + f.x * 0.7 + r.x * 0.12, y: c.position.y + f.y * 0.7 - 0.1, z: c.position.z + f.z * 0.7 + r.z * 0.12 };
  }

  private onLocalIntent(i: Intent) {
    const st = this.predicted!;
    switch (i.type) {
      case 'shot': {
        const def = WEAPONS[i.weapon];
        const pellet = i.pellet ?? 0;
        // escopetas: som, coice e clarão só no primeiro chumbo
        if (!pellet) { this.audio.gunshot(def); this.vm.onFire(i.weapon); }
        const wall = this.world.raycast(i.origin, i.dir, def.range);
        let end = wall ? wall.t : def.range;
        let hitPlayer = false;
        if (this.snap) {
          for (const pn of this.snap.players) {
            if (!pn.a || pn.id === this.snap.you || pn.tm === this.team) continue;
            const r = this.interp(pn.id);
            if (!r) continue;
            const h = hitTestPlayer(i.origin, i.dir, end, { x: r.pos.x, y: r.pos.y, z: r.pos.z, yaw: r.yaw, duck: r.duck });
            if (h && h.t < end) { end = h.t; hitPlayer = true; }
          }
        }
        const p = { x: i.origin.x + i.dir.x * end, y: i.origin.y + i.dir.y * end, z: i.origin.z + i.dir.z * end };
        if (wall && !hitPlayer && (wall.box.vis || wall.box.min.y < 0)) {
          const mat = wall.box.vis ? wall.box.mat : this.world.floorMaterial(p);
          this.effects.impact(p, wall.normal, mat);
          this.audio.impact(mat, p);
        }
        if (def.slot <= 1 && pellet < 3 && Math.random() < (def.cls === 'sniper' ? 1 : 0.55)) this.effects.tracer(this.muzzleWorld(), p);
        if (!pellet && this.effects.light && this.effects.lightsOn && !def.sound.suppressed) this.effects.muzzle(this.muzzleWorld(), 0.01);
        break;
      }
      case 'melee': this.vm.onMelee(i.heavy); this.audio.knife(false); break;
      case 'reload': {
        const def = WEAPONS[i.weapon];
        this.reloadTimers.forEach(clearTimeout);
        this.reloadTimers = [0.2, 0.55, 0.85].map((f, k) => window.setTimeout(() => { if (this.predicted?.reloadT) this.audio.reload(k); }, def.reloadTime * f * 1000));
        break;
      }
      case 'dry': this.audio.dry(); break;
      case 'pin': this.audio.pin(); break;
      case 'throw': this.audio.throwSnd(); break;
      case 'land': if (i.speed > 4) this.audio.land(this.world.floorMaterial(st.pos)); break;
      default: break;
    }
    void st;
  }

  private updateAutoFire(dt: number) {
    const st = this.predicted;
    this.input.autoFireHeld = false;
    if (!this.settings.autoFire || !this.input.mobile || !st || !st.alive || !this.snap) { this.autoT = 0; return; }
    const def = WEAPONS[st.weapon];
    if (def.slot > 1) { this.autoT = 0; return; }
    const o = { x: st.pos.x, y: st.pos.y + eyeHeight(st.duck), z: st.pos.z };
    const d = dirFromAngles(this.input.yaw, this.input.pitch);
    const wall = this.world.raycast(o, d, 200);
    const maxT = wall ? wall.t : 200;
    let on = false;
    for (const pn of this.snap.players) {
      if (!pn.a || pn.tm === this.team || pn.id === this.snap.you) continue;
      const r = this.interp(pn.id);
      if (!r) continue;
      const h = hitTestPlayer(o, d, maxT, { x: r.pos.x, y: r.pos.y, z: r.pos.z, yaw: r.yaw, duck: r.duck });
      if (h && !this.smokeBetween(o, { x: o.x + d.x * h.t, y: o.y + d.y * h.t, z: o.z + d.z * h.t })) { on = true; break; }
    }
    this.autoT = on ? this.autoT + dt : 0;
    this.input.autoFireHeld = on && this.autoT * 1000 >= this.settings.autoFireDelay;
  }

  private smokeBetween(a: V3, b: V3) {
    if (!this.snap) return false;
    for (const s of this.snap.sm) {
      if (s.age < 0.6) continue;
      const c = { x: s.x, y: s.y + 1.6, z: s.z };
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const L2 = dx * dx + dy * dy + dz * dz || 1;
      const t = clamp(((c.x - a.x) * dx + (c.y - a.y) * dy + (c.z - a.z) * dz) / L2, 0, 1);
      if ((a.x + dx * t - c.x) ** 2 + ((a.y + dy * t - c.y) * 1.3) ** 2 + (a.z + dz * t - c.z) ** 2 < 3.9 * 3.9) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- eventos
  private playerName(id: number) { return this.snap?.players.find((p) => p.id === id); }
  private posOf(id: number): V3 | undefined { const r = this.interp(id); return r ? { x: r.pos.x, y: r.pos.y + 1.2, z: r.pos.z } : undefined; }

  private handleEvent(e: GameEvent) {
    const you = this.snap?.you ?? -1;
    switch (e.e) {
      case 'shot': {
        if (e.id === you) break;
        const def = WEAPONS[e.w];
        const m = this.models.get(e.id);
        let mz = e.o;
        if (m?.weapon) { const v = new THREE.Vector3(); m.weapon.muzzle.getWorldPosition(v); mz = { x: v.x, y: v.y, z: v.z }; }
        const pi = e.pi ?? 0;
        if (!pi && !def.sound.suppressed) this.effects.muzzle(mz, def.cls === 'sniper' || def.cls === 'shotgun' ? 0.9 : 0.6);
        if (pi < 3 && (Math.random() < 0.6 || def.cls === 'sniper')) this.effects.tracer(mz, e.end);
        if (!pi) this.audio.gunshot(def, e.o);
        this.bulletWhiz(e.o, e.end);
        if (e.id === this.specId()) { this.vm.onFire(e.w); if (this.specVm) this.specVm.reloadT = 0; }
        break;
      }
      case 'impact': if (e.id !== you) { this.effects.impact(e.p, e.n, e.m); this.audio.impact(e.m, e.p); } break;
      case 'hit': {
        const ap = this.posOf(e.att);
        const dir = ap ? { x: e.p.x - ap.x, y: 0.3, z: e.p.z - ap.z } : { x: 0, y: 1, z: 0 };
        const L = Math.hypot(dir.x, dir.y, dir.z) || 1;
        if (e.vic !== you) this.effects.bloodFx(e.p, { x: dir.x / L, y: dir.y / L, z: dir.z / L }, e.hg === 1);
        if (e.att === you && e.vic !== you) { this.hud.hit(e.hg === 1, false); if (e.hg === 1) this.audio.headshot(); else this.audio.hitBody(); }
        if (e.vic === you) { this.hud.damage(); this.audio.hurt(); this.flinch += 0.025 * Math.min(2, e.dmg / 30); if (e.hg === 1) this.audio.headshot(); }
        break;
      }
      case 'kill': {
        const k = this.playerName(e.k), v = this.playerName(e.v);
        this.hud.kill(k, v, e.w, e.hs, e.wb, you);
        if (e.k === you && e.v !== you) { this.hud.hit(e.hs, true); this.audio.killConfirm(); }
        if (e.v === you) {
          const p = this.predicted?.pos;
          this.deathPos = p ? { ...p } : null;
          this.spectateId = k && k.tm === this.team ? k.id : 0;
          this.hud.closeBuy();
          this.hud.toast(k && e.k !== you ? `Eliminado por ${k.n}${e.hs ? ' (headshot)' : ''}` : 'Você morreu');
        }
        break;
      }
      case 'melee':
        if (e.id !== you) this.audio.knife(e.hit, this.posOf(e.id)); else if (e.hit) this.audio.knife(true);
        if (e.id === this.specId()) this.vm.onMelee(e.heavy);
        break;
      case 'throw': if (e.id !== you) this.audio.throwSnd(this.posOf(e.id)); break;
      case 'det': {
        const d = this.camera.position.distanceTo(new THREE.Vector3(e.p.x, e.p.y, e.p.z));
        if (e.g === 'he' || e.g === 'bomb') {
          const big = e.g === 'bomb';
          this.effects.explosion(e.p, big);
          this.audio.explosion(e.p, big);
          const amp = Math.max(0, 1 - d / (big ? 50 : 22)) * (big ? 0.12 : 0.06);
          if (amp > 0) { this.shakeT = big ? 1.2 : 0.6; this.shakeAmp = amp; }
        } else if (e.g === 'flash') { this.effects.flashPop(e.p); this.audio.flashPop(e.p); }
        else if (e.g === 'smoke') this.audio.smokeHiss(e.p);
        else if (e.g === 'decoy') { this.audio.bounce(e.p); this.effects.burst(e.p, { x: 0, y: 1, z: 0 }, 0xffd080, 10, 2.5, 0.04, 0.35, 6, 1); }
        else if (e.g === 'molotov') { this.audio.molotov(e.p); this.effects.burst(e.p, { x: 0, y: 1, z: 0 }, 0xff8a20, 20, 4, 0.06, 0.5, 4, 2); }
        break;
      }
      case 'flash': if (e.id === you) { this.hud.flash(e.dur); this.audio.flashRing(e.dur); } break;
      case 'bounce': this.audio.bounce(e.p); break;
      case 'decoy': this.audio.gunshot(WEAPONS[e.w], e.p); break;
      case 'reload': if (e.id === this.specId() && this.specVm) this.specVm.reloadT = WEAPONS[e.w].reloadTime;
        if (e.id !== you) { const p = this.posOf(e.id); this.audio.reload(0, p); setTimeout(() => this.audio.reload(1, p), 900); } break;
      case 'planted': this.hud.banner('A BOMBA FOI PLANTADA', 'bomb', 3); this.audio.jingle('planted'); this.beepT = 0; break;
      case 'defused': this.hud.banner('BOMBA DESARMADA', 'CT', 3); break;
      case 'plantStart': case 'defuseStart': this.audio.plantBeep(this.posOf(e.id)); break;
      case 'roundStart': {
        this.hud.banner(`ROUND ${e.round}`, '', 2.5);
        this.audio.jingle('start');
        const myTeam = this.snap?.team;
        this.input.yaw = myTeam === 'CT' ? Math.PI : 0; this.input.pitch = 0;
        this.spectateId = 0; this.deathPos = null;
        for (const m of this.models.values()) m.deadT = 0;
        this.visOffset.set(0, 0, 0);
        if (this.predicted) this.prevPred = clonePlayerState(this.predicted);
        break;
      }
      case 'live': this.hud.banner('VAI! VAI! VAI!', 'go', 1.4); break;
      case 'roundEnd': {
        const why: Record<string, string> = { elim: 'Time eliminado', bomb: 'A bomba explodiu', defuse: 'Bomba desarmada', time: 'Tempo esgotado' };
        this.hud.banner(`${e.win === 'T' ? 'TERRORISTAS' : 'CONTRA-TERRORISTAS'} VENCEM<small>${why[e.reason]}</small>`, e.win, 4.5);
        this.audio.jingle(e.win === this.team ? 'win' : 'lose');
        break;
      }
      case 'matchEnd': this.hud.banner(e.win === 'draw' ? 'EMPATE' : `FIM DE JOGO<small>${e.win === this.team ? 'Vitória!' : 'Derrota'}</small>`, e.win === 'draw' ? '' : e.win, 8); break;
      case 'halftime': this.hud.banner('INTERVALO<small>Troca de lados</small>', '', 4); break;
      case 'buy': if (e.ok) this.audio.ui('buy'); else { this.audio.ui('deny'); this.hud.toast(e.reason ?? 'Compra negada'); } break;
      case 'pickup': if (e.id === you) this.audio.ui('pickup'); break;
      case 'money': if (e.id === you) this.hud.moneyDelta(e.amount, e.why); break;
      case 'join': if (!e.name.startsWith('BOT ')) this.hud.feedMsg(`${e.name} entrou (${e.team === 'T' ? 'TR' : 'CT'})`); break;
      case 'leave': if (!e.name.startsWith('BOT ')) this.hud.feedMsg(`${e.name} saiu`); break;
      case 'msg': this.hud.feedMsg(e.text); break;
      default: break;
    }
  }

  // ---------------------------------------------------------------- HUD
  private updateHud(dt: number) {
    const st = this.predicted;
    const me = this.me;
    const snap = this.snap;
    const look = this.input.consumeLook();
    const alive = !!st?.alive;
    if (st) {
      if (st.weapon !== this.lastWeapon) {
        if (this.lastWeapon && alive) this.audio.deploy(st.weapon);
        this.lastWeapon = st.weapon;
      }
      // batimento cardíaco com vida baixa
      const hp = me?.hp ?? 100;
      if (alive && hp > 0 && hp <= 25) {
        this.heartT -= dt;
        if (this.heartT <= 0) { this.audio.heartbeat(); this.heartT = hp <= 10 ? 0.62 : 0.85; }
      } else this.heartT = 0;
      this.input.updateWeaponBar(st);
    }
    if (st && alive) {
      this.specVm = null;
      this.vm.team = this.team ?? 'T';
      this.vm.update(dt, st, look, { plantP: me?.plantP ?? 0, crouch: st.duck, aspect: this.camera.aspect, visible: true });
      this.vmVisible = st.scope === 0;
    } else {
      this.vmVisible = this.updateSpectatorVm(dt);
    }
    const def = st ? WEAPONS[st.weapon] : null;
    const slot = st ? slotState(st) : null;
    let hint = '';
    if (alive && st && snap && me) {
      const site = inRect(this.map.sites.A, st.pos.x, st.pos.z) || inRect(this.map.sites.B, st.pos.x, st.pos.z);
      if (st.inv.c4 && site && snap.round.phase === 'live') hint = this.mobile ? 'Segure USAR para plantar a C4' : 'Segure E (ou clique com a C4) para plantar';
      else if (st.inv.c4 && snap.round.phase === 'live') hint = 'Leve a C4 até o Bombsite A ou B';
      if (snap.bomb.st === 'planted' && this.team === 'CT' && Math.hypot(snap.bomb.x - st.pos.x, snap.bomb.z - st.pos.z) < 2.2) hint = this.mobile ? 'Segure USAR para desarmar' : 'Segure E para desarmar';
      if (me.canBuy && !this.hud.buyOpen && snap.round.phase === 'freeze') hint = this.mobile ? 'Toque em $ para comprar' : 'Pressione B para comprar';
    }
    let spectating = '';
    if (!alive && snap) {
      const sp = this.spectateId ? snap.players.find((p) => p.id === this.spectateId) : null;
      spectating = sp && sp.a ? `Assistindo: ${sp.n} · ${this.mobile ? 'toque em atirar' : 'clique'} para trocar` : 'Aguardando o próximo round';
    }
    // mira: converte ângulos em pixels de tela usando o FOV atual
    const focal = (window.innerHeight / 2) / Math.tan((this.camera.fov * DEG) / 2);
    let spreadPx = 0, recoilX = 0, recoilY = 0, weaponGapPx = 0;
    if (st && def) {
      spreadPx = Math.tan(computeInaccuracy(st)) * focal;
      weaponGapPx = Math.tan(def.spread.stand) * focal;
      const [pp, py] = patternAt(def, st.recoilIdx);
      recoilX = Math.tan(py * DEG - this.punchY) * focal;
      recoilY = -Math.tan(pp * DEG - this.punchP) * focal;
    }
    const specActive = !alive && !!snap && !!this.spectateId && snap.players.some((p) => p.id === this.spectateId && p.a);
    this.frames++; this.fpsT += dt;
    if (this.fpsT >= 0.5) { this.fps = Math.round(this.frames / this.fpsT); this.frames = 0; this.fpsT = 0; }
    const specP = specActive ? snap!.players.find((p) => p.id === this.spectateId) : undefined;
    this.hud.update(dt, {
      hp: specP ? specP.hp : me?.hp ?? 0, armor: specP ? specP.ar : me?.armor ?? 0, helmet: specP ? specP.hm : !!me?.helmet,
      money: me?.money ?? 0, kit: specP ? specP.kit : !!me?.kit, c4: specP ? specP.c4 : !!st?.inv.c4,
      weaponName: specP ? WEAPONS[specP.w].name : def ? def.name : '', mag: slot?.mag ?? 0, res: slot?.res ?? 0, showAmmo: !specP && !!slot,
      panels: alive || !!specP,
      inacc: st ? computeInaccuracy(st) : 0, scoped: alive && !!st && st.scope > 0, alive,
      plantP: me?.plantP ?? 0, defuseP: me?.defuseP ?? 0, canBuy: !!me?.canBuy, hint, spectating,
      fps: this.settings.showFps ? this.fps : 0, ping: Math.round(this.conn.rtt),
      spreadPx, recoilX, recoilY, weaponGapPx, specActive,
    }, snap);
    if (this.hud.buyOpen && me && snap && this.team) this.hud.renderBuy(this.team, me.money, me.armor, me.helmet, snap.round.buyLeft);
    if (this.hud.buyOpen && me && !me.canBuy) { this.hud.closeBuy(); this.relock(); }
    if (snap && st) {
      const plist = snap.players.map((p) => { const r = this.interp(p.id); return { p, pos: r?.pos ?? { x: p.x, y: p.y, z: p.z }, yaw: r?.yaw ?? p.yw }; });
      const cpos = alive ? st.pos : { x: this.camera.position.x, y: 0, z: this.camera.position.z };
      this.hud.drawRadar(cpos, alive ? this.input.yaw : this.camera.rotation.y, this.team, plist, snap.bomb, snap.you);
    }
    const showClick = !this.mobile && !document.pointerLockElement && !this.hud.buyOpen && !this.pauseEl;
    this.clickEl.classList.toggle('on', showClick);
  }

  private onEscape() {
    if (this.hud.buyOpen) { this.hud.closeBuy(); this.relock(); }
    else if (this.pauseEl) { if (this.pauseEl.style.display !== 'none' && performance.now() - this.pauseAt > 300) this.closePause(); }
    else this.openPause();
  }

  private toggleBuy() {
    if (this.pauseEl) return;
    if (this.hud.buyOpen) { this.hud.closeBuy(); this.relock(); return; }
    const me = this.me;
    if (!me || !this.team || !this.snap) return;
    if (!me.canBuy) { this.hud.toast('Fora da zona ou do tempo de compra'); this.audio.ui('deny'); return; }
    this.hud.openBuy(this.team, me.money, me.armor, me.helmet, this.snap.round.buyLeft);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // ---------------------------------------------------------------- pausa
  private openPause() {
    if (this.pauseEl || !this.running) return;
    this.pauseAt = performance.now();
    this.hud.closeBuy();
    const el = document.createElement('div');
    el.className = 'menu-overlay pause';
    const sc = this.snap?.round;
    el.innerHTML = `<div class="pause-rail">
        <div class="pr-logo">E<span>S</span></div>
        <button class="pr-ico on" data-a="resume" title="Continuar">▶</button>
        <button class="pr-ico" data-a="settings" title="Configurações">⚙</button>
        <button class="pr-ico pr-exit" data-a="exit" title="Desconectar">⏻</button>
      </div>
      <div class="pause-panel">
        <div class="pp-head">${this.conn.offline ? 'Partida offline · vs Bots' : `Online · ping ${Math.round(this.conn.rtt)} ms`}</div>
        <div class="pp-score"><span class="T">TR ${sc?.sT ?? 0}</span><i>${sc ? `Round ${sc.round}/${sc.maxRounds}` : ''}</i><span class="CT">${sc?.sCT ?? 0} CT</span></div>
        <button class="pp-btn primary" data-a="resume">Continuar partida</button>
        <div class="pp-sep">Escolher time</div>
        <div class="pp-teams">
          <button class="pp-team T ${this.team === 'T' ? 'cur' : ''}" data-a="T"><b>Terroristas</b><small>${this.team === 'T' ? 'Seu time' : 'Entrar'}</small></button>
          <button class="pp-team CT ${this.team === 'CT' ? 'cur' : ''}" data-a="CT"><b>Contra-Terroristas</b><small>${this.team === 'CT' ? 'Seu time' : 'Entrar'}</small></button>
        </div>
        <button class="pp-btn" data-a="settings">Configurações</button>
        <button class="pp-btn danger" data-a="exit">Desconectar</button>
      </div>`;
    document.getElementById('hud')!.appendChild(el);
    this.pauseEl = el;
    el.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.onclick = () => {
        const a = b.dataset.a;
        if (a === 'resume') this.closePause();
        if ((a === 'T' || a === 'CT') && a !== this.team) { this.conn.setTeam(a); this.closePause(); }
        if (a === 'settings') { el.style.display = 'none'; this.opts.onOpenSettings(() => { el.style.display = ''; this.audio.setVolume(this.settings.volume); this.hud.setCrosshair(); }); }
        if (a === 'exit') this.exit();
      };
    });
  }

  private closePause() {
    this.pauseEl?.remove();
    this.pauseEl = null;
    this.relock();
  }

  // ---------------------------------------------------------------- render
  private render() {
    const r = this.renderer;
    r.clear();
    r.render(this.scene, this.camera);
    if (this.vmVisible) {
      r.clearDepth();
      r.render(this.vm.scene, this.vm.camera);
    }
  }

  private adaptQuality(dtRaw: number) {
    if (!this.settings.gDynRes) return;
    this.frameAvg = this.frameAvg * 0.95 + dtRaw * 1000 * 0.05;
    this.dprT += dtRaw;
    if (this.dprT < 1.5) return;
    this.dprT = 0;
    let nd = this.dpr;
    if (this.frameAvg > 19) nd = Math.max(0.5, this.dpr - 0.15);
    else if (this.frameAvg < 13.5) nd = Math.min(this.dprMax, this.dpr + 0.1);
    if (Math.abs(nd - this.dpr) > 0.01) { this.dpr = nd; this.renderer.setPixelRatio(nd); this.resize(); }
  }

  exit(reason?: string) {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.reloadTimers.forEach(clearTimeout);
    this.input.dispose();
    this.audio.stopAmbience();
    this.audio.los = null;
    this.conn.close();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    document.getElementById('hud')!.innerHTML = '';
    this.opts.onExit(reason);
  }
}
