import type { Mat } from '../shared/map';
import type { V3 } from '../shared/math';
import type { WeaponDef, WeaponId } from '../shared/weapons';

/**
 * Áudio 100% procedural (Web Audio API).
 *
 * Mixer:  vozes → [ar/oclusão → panner 3D] → barramento (efeitos | interface | música | ambiente)
 *         → abafador (flashbang) → master → limitador → saída
 * Cada voz espacial também manda um pouco de sinal para um reverb por convolução
 * (resposta ao impulso gerada por código), mais forte quanto mais longe a fonte.
 */
export interface AudioMix { master: number; sfx: number; ui: number; music: number; ambience: number; hrtf: boolean }

type Bus = 'sfx' | 'ui' | 'music';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class GameAudio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private muffle!: BiquadFilterNode;
  private duck!: GainNode;
  private buses!: Record<Bus | 'amb', GainNode>;
  private revIn!: GainNode;
  private white!: AudioBuffer;
  private brown!: AudioBuffer;
  private shaperCurve!: Float32Array;
  private active = 0;
  private lp = { x: 0, y: 0, z: 0 };
  private mobile = false;
  private amb: { stop: () => void } | null = null;
  volume = 0.7;
  mix: AudioMix = { master: 0.7, sfx: 1, ui: 0.8, music: 0.7, ambience: 0.5, hrtf: true };
  /** Retorna true se há linha livre entre ouvinte e fonte (usado para abafar sons atrás de paredes). */
  los: ((a: V3, b: V3) => boolean) | null = null;

  init(mobile: boolean) {
    this.mobile = mobile;
    if (this.ctx) { void this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC({ latencyHint: 'interactive' });
    // limitador final: evita clipping quando muita coisa toca junto
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -10; lim.knee.value = 6; lim.ratio.value = 12; lim.attack.value = 0.002; lim.release.value = 0.18;
    this.master = c.createGain();
    this.master.gain.value = this.mix.master;
    this.master.connect(lim).connect(c.destination);
    this.muffle = c.createBiquadFilter();
    this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000; this.muffle.Q.value = 0.5;
    this.duck = c.createGain();
    this.muffle.connect(this.duck).connect(this.master);
    const bus = (v: number, muffled = true) => { const g = c.createGain(); g.gain.value = v; g.connect(muffled ? this.muffle : this.master); return g; };
    this.buses = { sfx: bus(this.mix.sfx), ui: bus(this.mix.ui, false), music: bus(this.mix.music, false), amb: bus(this.mix.ambience) };
    // ruídos base
    const len = c.sampleRate * 2;
    this.white = c.createBuffer(1, len, c.sampleRate);
    this.brown = c.createBuffer(1, len, c.sampleRate);
    const w = this.white.getChannelData(0), b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const r = Math.random() * 2 - 1;
      w[i] = r;
      last = (last + 0.02 * r) / 1.02;
      b[i] = last * 3.5;
    }
    // saturação suave (dá "peso" aos tiros e explosões)
    this.shaperCurve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; this.shaperCurve[i] = Math.tanh(x * 2.6) / Math.tanh(2.6); }
    // reverb
    const conv = c.createConvolver();
    conv.buffer = this.impulse(1.6, 2.8);
    this.revIn = c.createGain();
    const revOut = c.createGain(); revOut.gain.value = 0.55;
    const revHp = c.createBiquadFilter(); revHp.type = 'highpass'; revHp.frequency.value = 180;
    this.revIn.connect(revHp).connect(conv).connect(revOut).connect(this.muffle);
    this.setMix(this.mix);
  }

  /** Resposta ao impulso estéreo: reflexões iniciais (paredes do mapa) + cauda que decai. */
  private impulse(seconds: number, decay: number) {
    const c = this.ctx!;
    const n = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (t < 0.01 ? t / 0.01 : 1);
      }
      // ecos discretos (slapback das paredes)
      for (const [ms, a] of [[23, 0.7], [41, 0.5], [67, 0.4], [97, 0.3], [140, 0.22]] as const) {
        const i = Math.floor(((ms + (ch ? 6 : 0)) / 1000) * c.sampleRate);
        if (i < n) d[i] += (Math.random() < 0.5 ? -1 : 1) * a;
      }
    }
    return buf;
  }

  setVolume(v: number) { this.volume = v; this.mix.master = v; if (this.ctx) this.master.gain.value = v; }

  setMix(m: Partial<AudioMix>) {
    Object.assign(this.mix, m);
    this.volume = this.mix.master;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.mix.master, t, 0.02);
    this.buses.sfx.gain.setTargetAtTime(this.mix.sfx, t, 0.02);
    this.buses.ui.gain.setTargetAtTime(this.mix.ui, t, 0.02);
    this.buses.music.gain.setTargetAtTime(this.mix.music, t, 0.02);
    this.buses.amb.gain.setTargetAtTime(this.mix.ambience * 0.6, t, 0.02);
  }

  setListener(p: V3, yaw: number, pitch: number) {
    if (!this.ctx) return;
    this.lp = p;
    const l = this.ctx.listener;
    const fx = -Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = -Math.cos(yaw) * Math.cos(pitch);
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setValueAtTime(p.x, t); l.positionY.setValueAtTime(p.y, t); l.positionZ.setValueAtTime(p.z, t);
      l.forwardX.setValueAtTime(fx, t); l.forwardY.setValueAtTime(fy, t); l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t);
    } else {
      (l as any).setPosition(p.x, p.y, p.z);
      (l as any).setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  private dist(p: V3) { return Math.hypot(p.x - this.lp.x, p.y - this.lp.y, p.z - this.lp.z); }

  /**
   * Cria a entrada de uma voz.
   * @param pos     posição no mundo (undefined = som "na cabeça", sem espacialização)
   * @param dur     duração aproximada (controle de vozes ativas)
   * @param maxDist distância máxima audível
   * @param rev     quanto vai para o reverb (0..1)
   * @param prio    0 = descartável (passos distantes), 1 = normal, 2 = importante (tiros perto, explosões, C4)
   */
  private out(pos: V3 | undefined, dur: number, maxDist = 120, rev = 0.25, prio = 1, bus: Bus = 'sfx'): AudioNode | null {
    if (!this.ctx || this.ctx.state !== 'running') return null;
    const cap = this.mobile ? 22 : 44;
    if (this.active > cap + (prio >= 2 ? 16 : prio === 0 ? -8 : 0)) return null;
    let d = 0;
    if (pos) { d = this.dist(pos); if (d > maxDist) return null; }
    this.active++;
    setTimeout(() => this.active--, dur * 1000 + 80);
    const c = this.ctx;
    const input = c.createGain();
    const dst = this.buses[bus];
    if (!pos) {
      input.connect(dst);
      if (rev > 0) { const s = c.createGain(); s.gain.value = rev * 0.35; input.connect(s).connect(this.revIn); }
      return input;
    }
    // absorção do ar e oclusão (paredes abafam e atenuam)
    const blocked = d > 1.5 && this.los ? !this.los({ x: this.lp.x, y: this.lp.y, z: this.lp.z }, { x: pos.x, y: pos.y + 0.3, z: pos.z }) : false;
    const air = c.createBiquadFilter();
    air.type = 'lowpass'; air.Q.value = 0.4;
    air.frequency.value = Math.max(320, (19000 / (1 + d / 14)) * (blocked ? 0.09 : 1));
    if (blocked) input.gain.value = 0.6;
    const p = c.createPanner();
    p.panningModel = this.mobile || !this.mix.hrtf ? 'equalpower' : 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 2.5; p.rolloffFactor = 1.05; p.maxDistance = maxDist;
    p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    input.connect(air).connect(p).connect(dst);
    if (rev > 0) {
      // longe = mais reverberação proporcionalmente (a fonte "some" no ambiente)
      const s = c.createGain();
      s.gain.value = rev * (0.15 + Math.min(1, d / 45) * 0.85) * (blocked ? 1.3 : 1) / (1 + d / 60);
      air.connect(s).connect(this.revIn);
    }
    return input;
  }

  // ------------------------------------------------------------------ primitivas
  private noiseSrc(dur: number, delay = 0, brown = false) {
    const s = this.ctx!.createBufferSource();
    s.buffer = brown ? this.brown : this.white;
    s.loop = true;
    s.start(this.ctx!.currentTime + delay, Math.random() * 1.5, dur + 0.05);
    return s;
  }

  private env(g: AudioParam, peak: number, a: number, dur: number, delay = 0) {
    const t = this.ctx!.currentTime + delay;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + Math.max(0.0005, a));
    g.exponentialRampToValueAtTime(0.0001, t + a + dur);
  }

  private tone(dst: AudioNode, type: OscillatorType, f0: number, f1: number, peak: number, dur: number, delay = 0, attack = 0.004) {
    const c = this.ctx!;
    const o = c.createOscillator(); o.type = type;
    const g = c.createGain();
    const t = c.currentTime + delay;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this.env(g.gain, peak, attack, dur, delay);
    o.connect(g).connect(dst);
    o.start(t); o.stop(t + attack + dur + 0.03);
  }

  private burst(dst: AudioNode, type: BiquadFilterType, freq: number, q: number, peak: number, attack: number, dur: number,
    sweepTo?: number, delay = 0, opts: { brown?: boolean; drive?: boolean } = {}) {
    const c = this.ctx!;
    const n = this.noiseSrc(attack + dur, delay, opts.brown);
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const t = c.currentTime + delay;
    if (sweepTo) { f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + attack + dur); }
    const g = c.createGain();
    this.env(g.gain, peak, attack, dur, delay);
    if (opts.drive) {
      const sh = c.createWaveShaper(); sh.curve = this.shaperCurve;
      n.connect(f).connect(sh).connect(g).connect(dst);
    } else n.connect(f).connect(g).connect(dst);
  }

  /** Clique metálico curto (mecanismos de arma). */
  private click(dst: AudioNode, freq: number, peak: number, delay = 0, q = 6) {
    this.burst(dst, 'bandpass', freq, q, peak, 0.0005, 0.018, undefined, delay);
  }

  /** Ressonância metálica (várias parciais inarmônicas). */
  private ring(dst: AudioNode, base: number, peak: number, dur: number, delay = 0) {
    for (const [m, a] of [[1, 1], [2.76, 0.5], [5.4, 0.28], [8.93, 0.12]] as const) this.tone(dst, 'sine', base * m, base * m * 0.995, peak * a, dur / Math.sqrt(m), delay, 0.001);
  }

  // ------------------------------------------------------------------ armas
  gunshot(def: WeaponDef, pos?: V3) {
    const s = def.sound;
    const dur = s.len;
    const d = pos ? this.dist(pos) : 0;
    const dst = this.out(pos, dur + 1.2, 220, s.suppressed ? 0.15 : 0.55, d < 40 ? 2 : 1);
    if (!dst) return;
    const g = s.gain * rnd(0.92, 1.05);
    const pt = s.pitch * rnd(0.96, 1.04); // cada disparo levemente diferente: rajadas não soam robóticas
    const boom = s.boom ?? 0;
    if (s.suppressed) {
      this.burst(dst, 'bandpass', 1300 * pt, 1.1, 0.6 * g, 0.001, dur * 0.45);
      this.burst(dst, 'highpass', 4500, 0.7, 0.25 * g, 0.0005, 0.025);
      this.tone(dst, 'sine', 260 * pt, 90, 0.35 * g, 0.07);
      this.click(dst, 3200, 0.25 * g, 0.012);
      this.click(dst, 2300, 0.18 * g, 0.05);
    } else {
      // 1) estalo inicial
      this.burst(dst, 'highpass', 2200 * pt, 0.7, 1.1 * g, 0.0004, 0.028);
      // 2) corpo com saturação
      this.burst(dst, 'bandpass', 1050 * pt, 0.7, 1.15 * g, 0.0008, dur * 0.42, 500 * pt, 0, { drive: true });
      // 3) soco grave
      this.tone(dst, 'sine', 165 * pt, 42, (0.75 + boom * 0.6) * g, 0.13 + boom * 0.18, 0, 0.001);
      // 4) cauda (estampido rolando pelo mapa)
      this.burst(dst, 'lowpass', 1800 * pt, 0.6, (0.42 + boom * 0.25) * g, 0.004, dur * 1.5 + boom * 0.7, 160, 0, { brown: true });
      if (boom) this.burst(dst, 'lowpass', 380, 0.8, boom * 0.55 * g, 0.01, dur * 2.2, 55, 0, { brown: true, drive: true });
      // eco distante: tiros longe chegam com um "slapback" atrasado
      if (pos && d > 22) this.burst(dst, 'lowpass', 900, 0.5, 0.3 * g, 0.01, 0.45 + boom * 0.3, 140, Math.min(0.35, 0.08 + d / 600), { brown: true });
    }
    if (!pos) this.weaponMech(def.id, dst, g);
  }

  /** Mecânica da arma do próprio jogador: ferrolho, cápsulas caindo. */
  private weaponMech(id: WeaponId, dst: AudioNode, g: number) {
    if (id === 'awp') {
      // ferrolho: abre, puxa, empurra, fecha
      this.click(dst, 2400, 0.3, 0.55);
      this.burst(dst, 'bandpass', 1800, 2, 0.18, 0.02, 0.09, 3200, 0.6);
      this.burst(dst, 'bandpass', 2600, 2, 0.16, 0.02, 0.08, 1500, 0.78);
      this.click(dst, 3000, 0.35, 0.9);
    } else {
      this.click(dst, rnd(2600, 3400), 0.12 * g, 0.018);
    }
    // cápsula batendo no chão
    if (id !== 'knife' && Math.random() < 0.8) {
      const t = rnd(0.32, 0.5);
      const f = rnd(3800, 5200);
      const v = id === 'awp' || id === 'deagle' ? 0.06 : 0.045;
      this.ring(dst, f, v, 0.12, t);
      if (Math.random() < 0.6) this.ring(dst, f * rnd(0.9, 1.1), v * 0.5, 0.08, t + rnd(0.06, 0.12));
    }
  }

  /** Bala passando perto da cabeça (estalo supersônico + assobio). */
  whiz(pos: V3) {
    const d = this.out(pos, 0.25, 8, 0.05, 2);
    if (!d) return;
    this.burst(d, 'highpass', 3500, 0.7, 0.45, 0.0005, 0.02);
    this.burst(d, 'bandpass', rnd(2800, 3600), 2.5, 0.35, 0.01, 0.13, 900);
  }

  /** Impacto de bala por material. */
  impact(mat: Mat, pos: V3) {
    const d = this.out(pos, 0.5, 45, 0.25, 0);
    if (!d) return;
    const v = rnd(0.8, 1.1);
    switch (mat) {
      case 'sand':
        this.burst(d, 'lowpass', 700, 0.8, 0.45 * v, 0.002, 0.09);
        for (let i = 0; i < 4; i++) this.burst(d, 'highpass', 5000, 0.5, 0.08 * v, 0.0005, 0.012, undefined, rnd(0.005, 0.07));
        break;
      case 'wood':
        this.burst(d, 'bandpass', rnd(450, 650), 2.5, 0.55 * v, 0.001, 0.08);
        this.burst(d, 'highpass', 2500, 0.7, 0.25 * v, 0.0005, 0.03);
        break;
      case 'metal':
        this.burst(d, 'highpass', 3000, 0.8, 0.35 * v, 0.0005, 0.02);
        this.ring(d, rnd(1500, 2400), 0.22 * v, 0.35);
        if (Math.random() < 0.5) this.ricochet(d);
        break;
      default: // pedra, reboco, tijolo, piso
        this.burst(d, 'bandpass', rnd(1800, 2800), 1.2, 0.5 * v, 0.0005, 0.035);
        this.burst(d, 'lowpass', 900, 0.8, 0.25 * v, 0.002, 0.06);
        for (let i = 0; i < 3; i++) this.burst(d, 'bandpass', rnd(3000, 6000), 3, 0.06 * v, 0.0005, 0.015, undefined, rnd(0.02, 0.12));
        if (Math.random() < 0.18) this.ricochet(d);
    }
  }

  private ricochet(d: AudioNode) {
    const f = rnd(2200, 3400);
    this.tone(d, 'sine', f, f * rnd(0.35, 0.55), 0.12, rnd(0.18, 0.3), 0.01, 0.003);
  }

  /** Som de sacar arma (troca). */
  deploy(id: WeaponId) {
    const d = this.out(undefined, 0.5, 0, 0.05);
    if (!d) return;
    this.burst(d, 'bandpass', 1400, 0.9, 0.14, 0.03, 0.1, 2600); // tecido/roupa
    if (id === 'knife') {
      this.burst(d, 'bandpass', 4200, 3, 0.2, 0.02, 0.22, 7500, 0.05);
      this.ring(d, 3100, 0.06, 0.4, 0.08);
    } else if (id === 'he' || id === 'flash' || id === 'smoke' || id === 'molotov') {
      this.click(d, 2000, 0.15, 0.08, 3);
    } else if (id === 'c4') {
      this.burst(d, 'bandpass', 900, 1.5, 0.15, 0.01, 0.08, undefined, 0.06);
    } else {
      this.click(d, 2700, 0.22, 0.09);
      this.burst(d, 'bandpass', 2100, 2, 0.12, 0.015, 0.06, 3200, 0.14);
      this.click(d, 3400, 0.25, 0.22);
    }
  }

  footstep(mat: Mat, pos?: V3, vol = 1) {
    const dst = this.out(pos, 0.3, 42, 0.12, pos && this.dist(pos) > 20 ? 0 : 1);
    if (!dst) return;
    const v = 0.4 * vol * rnd(0.8, 1.15);
    const toe = rnd(0.035, 0.06);
    switch (mat) {
      case 'metal':
        this.burst(dst, 'bandpass', 2600, 2.5, v * 0.8, 0.001, 0.05);
        this.ring(dst, rnd(380, 520), v * 0.35, 0.28);
        this.burst(dst, 'bandpass', 3200, 3, v * 0.4, 0.001, 0.03, undefined, toe);
        break;
      case 'wood':
        this.tone(dst, 'sine', rnd(150, 190), 100, v * 0.7, 0.09, 0, 0.001);
        this.burst(dst, 'bandpass', rnd(550, 750), 2.2, v * 1.1, 0.001, 0.07);
        this.burst(dst, 'bandpass', 900, 2, v * 0.5, 0.001, 0.05, undefined, toe);
        break;
      case 'tile': case 'stone': case 'plaster': case 'brick':
        this.burst(dst, 'bandpass', rnd(1800, 2400), 1.5, v, 0.0008, 0.035);
        this.burst(dst, 'lowpass', 450, 1, v * 0.6, 0.002, 0.06);
        this.burst(dst, 'bandpass', rnd(2400, 3000), 1.8, v * 0.55, 0.0008, 0.03, undefined, toe);
        break;
      default: // areia: textura granulada
        this.burst(dst, 'bandpass', rnd(900, 1300), 0.7, v * 0.9, 0.006, 0.09);
        this.burst(dst, 'lowpass', 260, 1, v * 0.5, 0.004, 0.07);
        for (let i = 0; i < 5; i++) this.burst(dst, 'highpass', rnd(4000, 7000), 0.6, v * 0.13, 0.0005, 0.01, undefined, rnd(0, 0.09));
    }
  }

  land(mat: Mat = 'sand', pos?: V3) {
    const d = this.out(pos, 0.4, 40, 0.15);
    if (!d) return;
    this.burst(d, 'lowpass', 500, 1, 0.6, 0.004, 0.16, 120, 0, { brown: true });
    this.tone(d, 'sine', 95, 45, 0.35, 0.12, 0, 0.002);
    this.footstep(mat, pos, 0.9);
  }

  // ------------------------------------------------------------------ dano
  headshot() {
    const d = this.out(undefined, 0.5, 0, 0.1, 2);
    if (!d) return;
    // "tink" de capacete + estalo
    this.ring(d, 2350, 0.22, 0.28);
    this.burst(d, 'highpass', 4500, 0.7, 0.28, 0.0005, 0.025);
    this.burst(d, 'lowpass', 700, 1, 0.25, 0.001, 0.05);
  }

  hitBody() {
    const d = this.out(undefined, 0.2, 0, 0, 1);
    if (!d) return;
    this.burst(d, 'lowpass', 420, 1.2, 0.5, 0.001, 0.07, 150, 0, { brown: true });
    this.tone(d, 'sine', 120, 55, 0.25, 0.07, 0, 0.001);
    this.burst(d, 'bandpass', 1600, 2, 0.12, 0.0008, 0.025);
  }

  hurt() {
    const d = this.out(undefined, 0.4, 0, 0.05, 2);
    if (!d) return;
    this.burst(d, 'lowpass', 380, 1, 0.65, 0.002, 0.16, 90, 0, { brown: true, drive: true });
    this.tone(d, 'sine', 110, 45, 0.4, 0.18, 0, 0.001);
    // pancada abafa o mundo por um instante
    if (this.ctx) {
      const t = this.ctx.currentTime;
      const f = this.muffle.frequency;
      if (f.value > 3000) { f.cancelScheduledValues(t); f.setValueAtTime(1600, t); f.exponentialRampToValueAtTime(20000, t + 0.35); }
    }
  }

  /** Batimento cardíaco (vida baixa). */
  heartbeat() {
    const d = this.out(undefined, 0.6, 0, 0, 1);
    if (!d) return;
    this.tone(d, 'sine', 62, 40, 0.38, 0.12, 0, 0.008);
    this.tone(d, 'sine', 58, 38, 0.26, 0.12, 0.16, 0.008);
  }

  killConfirm() {
    const d = this.out(undefined, 0.3, 0, 0.1, 1, 'ui');
    if (!d) return;
    this.tone(d, 'triangle', 1180, 1180, 0.09, 0.05, 0, 0.002);
    this.tone(d, 'triangle', 1580, 1580, 0.08, 0.09, 0.06, 0.002);
  }

  reload(stage: number, pos?: V3) {
    const d = this.out(pos, 0.25, 30, 0.1, 0);
    if (!d) return;
    switch (stage % 3) {
      case 0: // soltar o pente
        this.click(d, 2600, 0.35);
        this.burst(d, 'bandpass', 1300, 1.6, 0.25, 0.01, 0.09, 700, 0.02);
        break;
      case 1: // encaixar o pente
        this.burst(d, 'bandpass', 900, 1.8, 0.4, 0.002, 0.06);
        this.click(d, 2200, 0.4, 0.05);
        this.tone(d, 'sine', 180, 120, 0.15, 0.05, 0.05, 0.001);
        break;
      default: // puxar o ferrolho
        this.burst(d, 'bandpass', 2000, 2, 0.25, 0.015, 0.07, 3400);
        this.click(d, 3100, 0.45, 0.1);
        this.ring(d, 2900, 0.05, 0.12, 0.1);
    }
  }

  dry() {
    const d = this.out(undefined, 0.1, 0, 0);
    if (d) { this.click(d, 3400, 0.35); this.click(d, 2100, 0.15, 0.02, 3); }
  }

  knife(hit: boolean, pos?: V3) {
    const d = this.out(pos, 0.35, 30, 0.1);
    if (!d) return;
    // golpe cortando o ar
    this.burst(d, 'bandpass', 700, 1.3, 0.35, 0.05, 0.12, 2600);
    if (hit) {
      this.burst(d, 'lowpass', 600, 1.5, 0.6, 0.002, 0.09, 150, 0.04, { brown: true });
      this.burst(d, 'bandpass', 3500, 2, 0.2, 0.002, 0.05, undefined, 0.045);
    }
  }

  // ------------------------------------------------------------------ granadas
  pin(pos?: V3) {
    const d = this.out(pos, 0.3, 25, 0.05);
    if (!d) return;
    this.click(d, 3000, 0.3);
    this.ring(d, 2900, 0.08, 0.12, 0.02);
    this.burst(d, 'bandpass', 2400, 3, 0.15, 0.005, 0.05, 4000, 0.12);
  }

  throwSnd(pos?: V3) {
    const d = this.out(pos, 0.3, 30, 0.05);
    if (d) this.burst(d, 'bandpass', 500, 1, 0.35, 0.06, 0.14, 1800);
  }

  bounce(pos: V3) {
    const d = this.out(pos, 0.25, 40, 0.15, 0);
    if (!d) return;
    this.ring(d, rnd(1500, 2100), 0.14, 0.14);
    this.burst(d, 'lowpass', 600, 1, 0.12, 0.001, 0.03);
  }

  explosion(pos: V3, big = false) {
    const d = this.out(pos, big ? 4.5 : 3, 300, 0.9, 2);
    if (!d) return;
    const g = big ? 1.5 : 1;
    const dd = this.dist(pos);
    this.burst(d, 'highpass', 1200, 0.6, 1.1 * g, 0.0005, 0.04);
    this.burst(d, 'lowpass', 2600, 0.5, 1.3 * g, 0.003, 1.1 * g, 150, 0, { brown: true, drive: true });
    this.tone(d, 'sine', 75, 24, 1.1 * g, 1.5 * g, 0, 0.002);
    this.burst(d, 'lowpass', 220, 0.7, 0.8 * g, 0.05, (big ? 3.2 : 2) * g, 40, 0.04, { brown: true });
    // detritos caindo
    for (let i = 0; i < (big ? 14 : 8); i++) this.burst(d, 'bandpass', rnd(1500, 5000), 3, rnd(0.04, 0.1) * g, 0.0005, 0.02, undefined, rnd(0.15, 1.1));
    // eco do mapa
    if (dd > 15) this.burst(d, 'lowpass', 700, 0.6, 0.35 * g, 0.02, 1.0 * g, 90, Math.min(0.5, 0.12 + dd / 500), { brown: true });
  }

  flashPop(pos: V3) {
    const d = this.out(pos, 1, 160, 0.7, 2);
    if (!d) return;
    this.burst(d, 'highpass', 1400, 0.6, 1.0, 0.0005, 0.3);
    this.burst(d, 'bandpass', 2500, 1, 0.5, 0.0005, 0.08);
    this.tone(d, 'sine', 130, 40, 0.55, 0.25, 0, 0.001);
  }

  smokeHiss(pos: V3) {
    const c = this.ctx;
    const d = this.out(pos, 4, 60, 0.3);
    if (!d || !c) return;
    // chiado que oscila enquanto a fumaça sai
    const n = this.noiseSrc(3.6);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2600;
    const bp = c.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = 6000; bp.gain.value = 6;
    const g = c.createGain();
    const t = c.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.08);
    g.gain.setValueAtTime(0.4, t + 1.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
    const lfo = c.createOscillator(); lfo.frequency.value = 9;
    const lg = c.createGain(); lg.gain.value = 0.12;
    lfo.connect(lg).connect(g.gain);
    lfo.start(t); lfo.stop(t + 3.6);
    n.connect(hp).connect(bp).connect(g).connect(d);
    this.click(d, 2800, 0.2);
  }

  molotov(pos: V3) {
    const d = this.out(pos, 1.6, 90, 0.5, 2);
    if (!d) return;
    // vidro quebrando
    this.burst(d, 'highpass', 3500, 0.8, 0.55, 0.0005, 0.12);
    for (let i = 0; i < 8; i++) this.tone(d, 'triangle', rnd(2600, 7500), rnd(2400, 7000), rnd(0.04, 0.1), rnd(0.04, 0.14), rnd(0, 0.12), 0.0008);
    // ignição (whoosh)
    this.burst(d, 'lowpass', 260, 0.7, 0.75, 0.12, 0.9, 1500, 0.05, { brown: true });
    this.burst(d, 'bandpass', 900, 0.8, 0.3, 0.15, 0.7, 2500, 0.05);
  }

  fireCrackle(pos: V3) {
    const d = this.out(pos, 0.3, 35, 0.15, 0);
    if (!d) return;
    this.burst(d, 'bandpass', rnd(900, 3500), 2.5, rnd(0.08, 0.18), 0.0008, rnd(0.02, 0.05));
    if (Math.random() < 0.3) this.burst(d, 'lowpass', 300, 0.7, 0.2, 0.05, 0.25, 600, 0, { brown: true });
  }

  /** Zumbido de flashbang + mundo abafado e mais baixo, proporcional à duração. */
  flashRing(dur: number) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime;
    const rec = Math.max(0.6, dur * 1.25);
    const f = this.muffle.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(320, t);
    f.exponentialRampToValueAtTime(20000, t + rec);
    const dk = this.duck.gain;
    dk.cancelScheduledValues(t);
    dk.setValueAtTime(0.3, t);
    dk.linearRampToValueAtTime(1, t + rec);
    // zumbido: duas senoides próximas (batimento) + chiado agudo, direto no master (não é abafado)
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.11, t + 0.04);
    g.gain.setValueAtTime(0.11, t + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.6);
    g.connect(this.master);
    for (const fr of [3650, 3712]) { const o = c.createOscillator(); o.frequency.value = fr; o.connect(g); o.start(t); o.stop(t + dur + 0.7); }
    const n = this.noiseSrc(dur + 0.6);
    const hp = c.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 7000; hp.Q.value = 2;
    const ng = c.createGain(); ng.gain.value = 0.25;
    n.connect(hp).connect(ng).connect(g);
  }

  // ------------------------------------------------------------------ C4
  c4Beep(pos: V3, urgent: boolean) {
    const d = this.out(pos, 0.2, 90, 0.2, 2);
    if (!d || !this.ctx) return;
    const f = urgent ? 3150 : 2700;
    this.tone(d, 'square', f, f, 0.07, 0.09, 0, 0.002);
    this.tone(d, 'sine', f, f, 0.3, 0.1, 0, 0.002);
  }

  /** Teclas do painel ao plantar/desarmar (tons duplos estilo teclado de telefone). */
  plantBeep(pos?: V3) {
    const d = this.out(pos, 0.15, 40, 0.1);
    if (!d) return;
    const rows = [697, 770, 852, 941], cols = [1209, 1336, 1477];
    const a = rows[Math.floor(Math.random() * 4)], b = cols[Math.floor(Math.random() * 3)];
    this.tone(d, 'sine', a, a, 0.12, 0.08, 0, 0.002);
    this.tone(d, 'sine', b, b, 0.12, 0.08, 0, 0.002);
    this.click(d, 2500, 0.1);
  }

  defuseTick(pos?: V3) { const d = this.out(pos, 0.1, 40, 0.05); if (d) this.click(d, 4000, 0.25); }

  // ------------------------------------------------------------------ interface
  ui(kind: 'click' | 'hover' | 'buy' | 'deny' | 'pickup') {
    const d = this.out(undefined, 0.4, 0, 0.05, 1, 'ui');
    if (!d) return;
    if (kind === 'hover') this.tone(d, 'sine', 2400, 2300, 0.025, 0.025, 0, 0.002);
    if (kind === 'click') { this.tone(d, 'sine', 1700, 1500, 0.09, 0.035, 0, 0.001); this.click(d, 4200, 0.06); }
    if (kind === 'buy') {
      this.click(d, 2600, 0.2);
      this.ring(d, 1568, 0.09, 0.22, 0.03);
      this.ring(d, 2093, 0.08, 0.3, 0.1);
    }
    if (kind === 'deny') { this.tone(d, 'square', 180, 170, 0.05, 0.08, 0, 0.002); this.tone(d, 'square', 150, 140, 0.05, 0.12, 0.1, 0.002); }
    if (kind === 'pickup') { this.burst(d, 'bandpass', 1300, 1, 0.2, 0.02, 0.08, 2400); this.click(d, 2900, 0.25, 0.07); }
  }

  /** Vinhetas curtas (originais) de início de round, vitória, derrota e bomba plantada. */
  jingle(kind: 'start' | 'win' | 'lose' | 'planted') {
    const d = this.out(undefined, 3, 0, 0.5, 2, 'music');
    if (!d || !this.ctx) return;
    const c = this.ctx;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    lp.connect(d);
    const note = (f: number, at: number, len: number, a = 0.07) => {
      this.tone(lp, 'triangle', f, f, a, len, at, 0.01);
      this.tone(lp, 'sawtooth', f * 1.003, f * 1.003, a * 0.25, len * 0.8, at, 0.01);
      this.tone(lp, 'sine', f / 2, f / 2, a * 0.6, len, at, 0.01);
    };
    const chord = (fs: number[], at: number, len: number, a = 0.05) => fs.forEach((f) => note(f, at, len, a));
    if (kind === 'start') {
      [220, 261.6, 329.6, 440].forEach((f, i) => note(f, i * 0.09, 0.3, 0.06));
      chord([220, 329.6, 440], 0.36, 0.9, 0.035);
      this.tone(d, 'sine', 70, 40, 0.3, 0.4, 0.36, 0.005);
    } else if (kind === 'win') {
      chord([261.6, 329.6, 392], 0, 0.35, 0.05);
      chord([293.7, 370, 440], 0.22, 0.35, 0.05);
      chord([329.6, 415.3, 493.9, 659.3], 0.44, 1.4, 0.045);
      this.tone(d, 'sine', 82, 50, 0.35, 0.6, 0.44, 0.005);
    } else if (kind === 'lose') {
      chord([220, 261.6, 329.6], 0, 0.45, 0.05);
      chord([196, 233.1, 293.7], 0.3, 0.45, 0.05);
      chord([174.6, 207.7, 261.6], 0.6, 1.3, 0.045);
    } else {
      for (let i = 0; i < 3; i++) { this.tone(d, 'square', 1046, 1046, 0.035, 0.1, i * 0.16, 0.002); this.tone(d, 'sine', 1046, 1046, 0.12, 0.12, i * 0.16, 0.002); }
      this.tone(d, 'sine', 60, 35, 0.4, 0.6, 0.5, 0.005);
      this.burst(d, 'lowpass', 300, 0.7, 0.3, 0.02, 0.6, 60, 0.5, { brown: true });
    }
  }

  // ------------------------------------------------------------------ ambiente
  /** Vento do deserto em loop, com rajadas lentas. */
  startAmbience() {
    if (!this.ctx || this.amb) return;
    const c = this.ctx;
    const t = c.currentTime;
    const mk = (buf: AudioBuffer) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.start(t, Math.random()); return s; };
    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(1, t + 2);
    out.connect(this.buses.amb);
    // vento grave
    const w1 = mk(this.brown);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; lp.Q.value = 0.7;
    const g1 = c.createGain(); g1.gain.value = 0.16;
    w1.connect(lp).connect(g1).connect(out);
    // assobio do vento com ressonância que se move
    const w2 = mk(this.white);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 5;
    const g2 = c.createGain(); g2.gain.value = 0.02;
    w2.connect(bp).connect(g2).connect(out);
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07;
    const lfoF = c.createGain(); lfoF.gain.value = 350;
    lfo.connect(lfoF).connect(bp.frequency);
    const lfo2 = c.createOscillator(); lfo2.frequency.value = 0.11;
    const lfoG = c.createGain(); lfoG.gain.value = 0.07;
    lfo2.connect(lfoG).connect(g1.gain);
    lfo.start(t); lfo2.start(t);
    // areia leve
    const w3 = mk(this.white);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
    const g3 = c.createGain(); g3.gain.value = 0.006;
    w3.connect(hp).connect(g3).connect(out);
    const nodes = [w1, w2, w3, lfo, lfo2];
    this.amb = {
      stop: () => {
        const t2 = c.currentTime;
        out.gain.cancelScheduledValues(t2);
        out.gain.setValueAtTime(out.gain.value, t2);
        out.gain.exponentialRampToValueAtTime(0.0001, t2 + 0.6);
        for (const n of nodes) n.stop(t2 + 0.7);
      },
    };
  }

  stopAmbience() { this.amb?.stop(); this.amb = null; }
}
