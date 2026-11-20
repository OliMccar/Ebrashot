import {
  BTN_ALT, BTN_CROUCH, BTN_DROP, BTN_FIRE, BTN_JUMP, BTN_RELOAD, BTN_USE, BTN_WALK,
} from '../../shared/constants';
import { DEG, clamp } from '../../shared/math';
import type { Cmd, PlayerState } from '../../shared/player';
import { hasWeapon } from '../../shared/player';
import { type GrenadeId, type WeaponId, GRENADES, WEAPONS } from '../../shared/weapons';
import { type ControlId, type Layout, createControlEl, loadLayout } from '../hud/layout';
import type { Settings } from '../settings';

export interface InputHooks {
  onBuyMenu(): void;
  onScoreboard(show: boolean): void;
  onMenu(): void;
  onInspect(): void;
  onSpectateNext(): void;
  isUiOpen(): boolean;
}

/** Entrada unificada: teclado/mouse (Pointer Lock) + toque estilo Standoff + giroscópio. */
export class Input {
  yaw = 0;
  pitch = 0;
  lookDX = 0;
  lookDY = 0;
  mobile: boolean;
  private keys = new Set<string>();
  private mouseBtn = 0;
  private wantWeapon: WeaponId | '' = '';
  private edgeBtn = 0; // botões pressionados desde o último comando (garante cliques curtos)
  private lastWeapon: WeaponId = 'knife';
  locked = false;
  // toque
  private touchRoot: HTMLDivElement | null = null;
  private joy = { id: -1, cx: 0, cy: 0, x: 0, y: 0, r: 60 };
  private lookTouches = new Map<number, { x: number; y: number }>();
  private fireTouches = new Set<number>();
  private held = new Set<ControlId>();
  private tapped = new Set<ControlId>();
  private layout: Layout;
  private els = new Map<ControlId, HTMLDivElement>();
  autoFireHeld = false;
  private gyroOn = false;
  private disposers: (() => void)[] = [];

  constructor(private canvas: HTMLCanvasElement, private settings: Settings, private hooks: InputHooks, private getState: () => PlayerState | null) {
    this.mobile = settings.forceMobile || isTouch();
    this.layout = loadLayout();
    this.bindKeyboard();
    if (this.mobile) this.buildTouch();
    if (settings.gyro) this.enableGyro();
  }

  dispose() { for (const d of this.disposers) d(); this.touchRoot?.remove(); if (document.pointerLockElement) document.exitPointerLock(); }

  private on<K extends keyof WindowEventMap>(t: Window, ev: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) {
    t.addEventListener(ev, fn as EventListener, opts);
    this.disposers.push(() => t.removeEventListener(ev, fn as EventListener));
  }

  // ---------------------------------------------------------------- PC
  private bindKeyboard() {
    const c = this.canvas;
    const lockClick = () => { if (!this.mobile && !this.hooks.isUiOpen() && !document.pointerLockElement) c.requestPointerLock?.(); };
    c.addEventListener('click', lockClick);
    this.disposers.push(() => c.removeEventListener('click', lockClick));
    const plc = () => { this.locked = document.pointerLockElement === c; if (!this.locked) { this.keys.clear(); this.mouseBtn = 0; } };
    document.addEventListener('pointerlockchange', plc);
    this.disposers.push(() => document.removeEventListener('pointerlockchange', plc));

    this.on(window, 'mousemove', (e) => {
      if (!this.locked) return;
      const k = 0.022 * this.settings.sens * DEG * this.zoomScale;
      this.yaw -= e.movementX * k;
      this.pitch -= e.movementY * k * (this.settings.invertY ? -1 : 1);
      this.pitch = clamp(this.pitch, -89 * DEG, 89 * DEG);
      this.lookDX += e.movementX; this.lookDY += e.movementY;
    });
    this.on(window, 'mousedown', (e) => {
      if (!this.locked) return;
      const b = e.button === 0 ? BTN_FIRE : e.button === 2 ? BTN_ALT : 0;
      this.mouseBtn |= b; this.edgeBtn |= b;
      if (e.button === 0) this.hooks.onSpectateNext();
    });
    this.on(window, 'mouseup', (e) => { this.mouseBtn &= ~(e.button === 0 ? BTN_FIRE : e.button === 2 ? BTN_ALT : 0); });
    this.on(window, 'contextmenu', (e) => { if (this.locked) e.preventDefault(); });
    this.on(window, 'wheel', (e) => { if (this.locked) this.cycleWeapon(e.deltaY > 0 ? 1 : -1); }, { passive: true });
    this.on(window, 'keydown', (e) => {
      const k = e.code;
      if (k === 'Tab') { e.preventDefault(); this.hooks.onScoreboard(true); return; }
      if (k === 'KeyB') { this.hooks.onBuyMenu(); return; }
      if (k === 'Escape') return;
      if (this.hooks.isUiOpen() && !this.locked) return;
      if (['Space', 'ControlLeft', 'ControlRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(k) && this.locked) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(k);
      if (k === 'Space') this.edgeBtn |= BTN_JUMP;
      if (k === 'KeyR') this.edgeBtn |= BTN_RELOAD;
      if (k === 'KeyE') this.edgeBtn |= BTN_USE;
      if (k === 'KeyG') this.edgeBtn |= BTN_DROP;
      if (k === 'KeyF') this.hooks.onInspect();
      if (k === 'Digit1') this.selectSlot(0);
      if (k === 'Digit2') this.selectSlot(1);
      if (k === 'Digit3') this.selectSlot(2);
      if (k === 'Digit4') this.selectSlot(3);
      if (k === 'Digit5') this.selectSlot(4);
      if (k === 'KeyQ') this.quickSwitch();
    });
    this.on(window, 'keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Tab') this.hooks.onScoreboard(false);
    });
    this.on(window, 'blur', () => { this.keys.clear(); this.mouseBtn = 0; });
  }

  zoomScale = 1;

  selectSlot(slot: number) {
    const st = this.getState();
    if (!st) return;
    let id: WeaponId | undefined;
    if (slot === 0) id = st.inv.primary?.id;
    else if (slot === 1) id = st.inv.secondary?.id;
    else if (slot === 2) id = 'knife';
    else if (slot === 3) {
      const owned = GRENADES.filter((g) => st.inv.nades[g] > 0);
      if (!owned.length) return;
      const i = owned.indexOf(st.weapon as GrenadeId);
      id = owned[(i + 1) % owned.length];
    } else if (slot === 4) id = st.inv.c4 ? 'c4' : undefined;
    if (id) this.setWeapon(id);
  }

  private setWeapon(id: WeaponId) {
    const st = this.getState();
    if (st && st.weapon !== id) this.lastWeapon = st.weapon;
    this.wantWeapon = id;
  }

  quickSwitch() {
    const st = this.getState();
    if (st && hasWeapon(st, this.lastWeapon)) this.setWeapon(this.lastWeapon);
  }

  private ownedList(st: PlayerState): WeaponId[] {
    const l: WeaponId[] = [];
    if (st.inv.primary) l.push(st.inv.primary.id);
    if (st.inv.secondary) l.push(st.inv.secondary.id);
    l.push('knife');
    for (const g of GRENADES) if (st.inv.nades[g] > 0) l.push(g);
    if (st.inv.c4) l.push('c4');
    return l;
  }

  cycleWeapon(dir: number) {
    const st = this.getState();
    if (!st) return;
    const l = this.ownedList(st);
    const i = l.indexOf(st.weapon);
    this.setWeapon(l[(i + dir + l.length) % l.length]);
  }

  // ---------------------------------------------------------------- comando
  buildCmd(seq: number, rt: number): Cmd {
    let mx = 0, mz = 0, btn = 0;
    if (this.locked || this.mobile) {
      if (this.keys.has('KeyW')) mz += 1;
      if (this.keys.has('KeyS')) mz -= 1;
      if (this.keys.has('KeyD')) mx += 1;
      if (this.keys.has('KeyA')) mx -= 1;
      if (this.keys.has('Space')) btn |= BTN_JUMP;
      if (this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('KeyC')) btn |= BTN_CROUCH;
      if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) btn |= BTN_WALK;
      if (this.keys.has('KeyR')) btn |= BTN_RELOAD;
      if (this.keys.has('KeyE')) btn |= BTN_USE;
      btn |= this.mouseBtn;
    }
    if (this.mobile) {
      if (this.joy.id >= 0) {
        const jx = this.joy.x / this.joy.r, jy = this.joy.y / this.joy.r;
        const m = Math.min(1, Math.hypot(jx, jy));
        if (m > 0.12) {
          mx += jx / Math.max(m, 1e-3) * Math.min(1, m * 1.4);
          mz += -jy / Math.max(m, 1e-3) * Math.min(1, m * 1.4);
          if (m < 0.62) btn |= BTN_WALK; // zona interna: andar silencioso
        }
      }
      if (this.fireTouches.size > 0 || this.autoFireHeld) btn |= BTN_FIRE;
      if (this.held.has('crouch')) btn |= BTN_CROUCH;
      if (this.held.has('use')) btn |= BTN_USE;
      if (this.held.has('walk')) btn |= BTN_WALK;
      if (this.tapped.has('jump')) btn |= BTN_JUMP;
      if (this.tapped.has('reload')) btn |= BTN_RELOAD;
      if (this.tapped.has('scope')) btn |= BTN_ALT;
      if (this.tapped.has('drop')) btn |= BTN_DROP;
      if (this.tapped.has('use')) btn |= BTN_USE;
      this.tapped.clear();
    } else if (this.autoFireHeld) btn |= BTN_FIRE;
    btn |= this.edgeBtn;
    this.edgeBtn = 0;
    const wpn = this.wantWeapon;
    this.wantWeapon = '';
    const st = this.getState();
    const def = st ? WEAPONS[st.weapon] : null;
    return {
      seq, yaw: this.yaw, pitch: this.pitch, mx: clamp(mx, -1, 1), mz: clamp(mz, -1, 1), btn, wpn, rt,
      as: (this.mobile || this.autoFireHeld) && !!def && !def.auto && def.slot <= 1,
    };
  }

  consumeLook() { const r = { dx: this.lookDX, dy: this.lookDY }; this.lookDX = 0; this.lookDY = 0; return r; }

  // ---------------------------------------------------------------- toque
  private buildTouch() {
    const root = document.createElement('div');
    root.className = 'touch-root';
    document.getElementById('hud')!.appendChild(root);
    this.touchRoot = root;
    for (const id of Object.keys(this.layout) as ControlId[]) {
      const el = createControlEl(id, this.layout[id]);
      root.appendChild(el);
      this.els.set(id, el);
    }
    const look = (id: number, x: number, y: number) => {
      const prev = this.lookTouches.get(id);
      if (!prev) return;
      const dx = x - prev.x, dy = y - prev.y;
      prev.x = x; prev.y = y;
      const k = 0.0042 * this.settings.touchSens * this.zoomScale;
      this.yaw -= dx * k;
      this.pitch = clamp(this.pitch - dy * k * (this.settings.invertY ? -1 : 1), -89 * DEG, 89 * DEG);
      this.lookDX += dx * 2; this.lookDY += dy * 2;
    };
    const controlAt = (t: Touch): ControlId | null => {
      const el = (document.elementFromPoint(t.clientX, t.clientY) as HTMLElement | null)?.closest('.tc') as HTMLElement | null;
      return (el?.dataset.id as ControlId) ?? null;
    };
    const start = (e: TouchEvent) => {
      if (this.hooks.isUiOpen()) return;
      for (const t of Array.from(e.changedTouches)) {
        const target = e.target as HTMLElement;
        if (target.closest('.panel, .buy-menu, .menu-overlay, .scoreboard button')) continue;
        const cid = controlAt(t);
        e.preventDefault();
        const W = window.innerWidth;
        if (cid === 'fire' || cid === 'fireL') {
          this.fireTouches.add(t.identifier);
          this.lookTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
          this.els.get(cid)?.classList.add('on');
          this.hooks.onSpectateNext();
        } else if (cid === 'weapons') {
          const sp = (document.elementFromPoint(t.clientX, t.clientY) as HTMLElement).closest('span') as HTMLElement | null;
          if (sp) this.selectSlot(Number(sp.dataset.w));
        } else if (cid === 'joystick' || (!cid && t.clientX < W * 0.42 && this.joy.id < 0)) {
          const el = this.els.get('joystick')!;
          const r = el.getBoundingClientRect();
          this.joy.id = t.identifier;
          if (cid === 'joystick') { this.joy.cx = r.left + r.width / 2; this.joy.cy = r.top + r.height / 2; }
          else { this.joy.cx = t.clientX; this.joy.cy = t.clientY; el.style.left = `${t.clientX - r.width / 2}px`; el.style.top = `${t.clientY - r.height / 2}px`; }
          this.joy.r = r.width * 0.42;
          this.joy.x = t.clientX - this.joy.cx; this.joy.y = t.clientY - this.joy.cy;
          el.classList.add('on');
          this.updateKnob();
        } else if (cid) {
          this.held.add(cid); this.tapped.add(cid);
          this.els.get(cid)?.classList.add('on');
          if (cid === 'buy') this.hooks.onBuyMenu();
          if (cid === 'score') this.hooks.onScoreboard(true);
          if (cid === 'menu') this.hooks.onMenu();
          if (cid === 'inspect') this.hooks.onInspect();
          if (cid === 'nade') this.selectSlot(3);
          (t as any)._cid = cid;
          this.touchCid.set(t.identifier, cid);
        } else {
          this.lookTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
        }
      }
    };
    const move = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.joy.id) {
          this.joy.x = t.clientX - this.joy.cx; this.joy.y = t.clientY - this.joy.cy;
          const m = Math.hypot(this.joy.x, this.joy.y);
          if (m > this.joy.r) { this.joy.x *= this.joy.r / m; this.joy.y *= this.joy.r / m; }
          this.updateKnob();
          e.preventDefault();
        } else if (this.lookTouches.has(t.identifier)) { look(t.identifier, t.clientX, t.clientY); e.preventDefault(); }
      }
    };
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.joy.id) {
          this.joy.id = -1; this.joy.x = 0; this.joy.y = 0;
          const el = this.els.get('joystick')!;
          el.classList.remove('on');
          const l = this.layout.joystick;
          el.style.left = `calc(${l.x}% - ${l.size / 2}px)`; el.style.top = `calc(${l.y}% - ${l.size / 2}px)`;
          this.updateKnob();
        }
        this.lookTouches.delete(t.identifier);
        if (this.fireTouches.delete(t.identifier)) { this.els.get('fire')?.classList.remove('on'); this.els.get('fireL')?.classList.remove('on'); }
        const cid = this.touchCid.get(t.identifier);
        if (cid) {
          this.held.delete(cid); this.touchCid.delete(t.identifier);
          this.els.get(cid)?.classList.remove('on');
          if (cid === 'score') this.hooks.onScoreboard(false);
        }
      }
    };
    const opts = { passive: false } as AddEventListenerOptions;
    root.addEventListener('touchstart', start, opts);
    this.canvas.addEventListener('touchstart', start, opts);
    window.addEventListener('touchmove', move, opts);
    window.addEventListener('touchend', end, opts);
    window.addEventListener('touchcancel', end, opts);
    this.disposers.push(() => {
      this.canvas.removeEventListener('touchstart', start);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
    });
    // Simulação com mouse no PC (modo "Simular Controles Mobile")
    if (!isTouch()) this.mouseAsTouch(root, start, move, end);
  }

  private touchCid = new Map<number, ControlId>();

  /** Converte eventos de mouse em toques sintéticos para testar o HUD mobile no PC. */
  private mouseAsTouch(root: HTMLElement, start: (e: TouchEvent) => void, move: (e: TouchEvent) => void, end: (e: TouchEvent) => void) {
    let down = false;
    const fake = (e: MouseEvent) => ({
      changedTouches: [{ identifier: 999, clientX: e.clientX, clientY: e.clientY }],
      target: e.target, preventDefault: () => {},
    }) as unknown as TouchEvent;
    const md = (e: MouseEvent) => { if (e.button !== 0) return; down = true; start(fake(e)); };
    const mm = (e: MouseEvent) => { if (down) move(fake(e)); };
    const mu = (e: MouseEvent) => { if (down) { down = false; end(fake(e)); } };
    root.addEventListener('mousedown', md);
    this.canvas.addEventListener('mousedown', md);
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', mu);
    this.disposers.push(() => { this.canvas.removeEventListener('mousedown', md); window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); });
  }

  private updateKnob() {
    const el = this.els.get('joystick');
    const knob = el?.querySelector('.tc-knob') as HTMLElement | null;
    if (knob) knob.style.transform = `translate(calc(-50% + ${this.joy.x}px), calc(-50% + ${this.joy.y}px))`;
    const m = Math.hypot(this.joy.x, this.joy.y) / (this.joy.r || 1);
    el?.classList.toggle('run', m >= 0.62);
  }

  /** Atualiza rótulos da barra de armas mobile. */
  updateWeaponBar(st: PlayerState | null) {
    const el = this.els.get('weapons');
    if (!el || !st) return;
    const spans = el.querySelectorAll('span');
    const names = [st.inv.primary?.id, st.inv.secondary?.id, 'knife', GRENADES.find((g) => st.inv.nades[g] > 0), st.inv.c4 ? 'c4' : undefined];
    spans.forEach((s, i) => {
      const id = names[i] as WeaponId | undefined;
      const txt = id ? WEAPONS[id].name.replace('Granada ', '') : '—';
      if (s.textContent !== txt) s.textContent = txt;
      s.classList.toggle('active', id === st.weapon || (i === 3 && WEAPONS[st.weapon].slot === 3));
      s.classList.toggle('empty', !id);
    });
  }

  // ---------------------------------------------------------------- giroscópio
  enableGyro() {
    if (this.gyroOn) return;
    this.gyroOn = true;
    let last = 0;
    this.on(window, 'devicemotion', (e) => {
      if (!this.settings.gyro) return;
      const r = e.rotationRate;
      if (!r || r.alpha === null || r.beta === null || r.gamma === null) return;
      const now = performance.now();
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      const ang = (screen.orientation?.angle ?? (window as any).orientation ?? 0) as number;
      let yawRate: number, pitchRate: number;
      if (ang === 90) { yawRate = r.beta; pitchRate = -r.gamma; }
      else if (ang === 270 || ang === -90) { yawRate = -r.beta; pitchRate = r.gamma; }
      else { yawRate = r.gamma; pitchRate = r.beta; }
      const s = this.settings.gyroSens * DEG * dt * this.zoomScale * (this.settings.gyroInvert ? -1 : 1);
      this.yaw += yawRate * s;
      this.pitch = clamp(this.pitch + pitchRate * s, -89 * DEG, 89 * DEG);
    });
  }
}

export function isTouch() {
  return ('ontouchstart' in window || navigator.maxTouchPoints > 0) && matchMedia('(pointer: coarse)').matches;
}

/** iOS exige permissão explícita a partir de um gesto do usuário. */
export async function requestGyroPermission(): Promise<boolean> {
  const DM = (window as any).DeviceMotionEvent;
  if (DM && typeof DM.requestPermission === 'function') {
    try { return (await DM.requestPermission()) === 'granted'; } catch { return false; }
  }
  return typeof DM !== 'undefined';
}
