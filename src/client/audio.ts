import type { Mat } from '../shared/map';
import type { V3 } from '../shared/math';
import type { WeaponDef } from '../shared/weapons';

/** Áudio 100% procedural (Web Audio API) com espacialização 3D. */
export class GameAudio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private muffle!: BiquadFilterNode;
  private noise!: AudioBuffer;
  private active = 0;
  private lp = { x: 0, y: 0, z: 0 };
  private mobile = false;
  volume = 0.7;

  init(mobile: boolean) {
    this.mobile = mobile;
    if (this.ctx) { void this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.muffle = this.ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.muffle.connect(this.master).connect(comp).connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v: number) { this.volume = v; if (this.ctx) this.master.gain.value = v; }

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

  /** Cria o destino de uma voz: espacial se pos != undefined. */
  private out(pos: V3 | undefined, dur: number, maxDist = 120): AudioNode | null {
    if (!this.ctx || this.ctx.state !== 'running') return null;
    if (this.active > (this.mobile ? 20 : 40)) return null;
    if (pos) {
      const d = Math.hypot(pos.x - this.lp.x, pos.y - this.lp.y, pos.z - this.lp.z);
      if (d > maxDist) return null;
    }
    this.active++;
    setTimeout(() => this.active--, dur * 1000 + 50);
    if (!pos) return this.muffle;
    const p = this.ctx.createPanner();
    p.panningModel = this.mobile ? 'equalpower' : 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 2.5; p.rolloffFactor = 1.1; p.maxDistance = maxDist;
    p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    p.connect(this.muffle);
    return p;
  }

  private noiseSrc(dur: number) {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.loopStart = Math.random();
    const t = this.ctx!.currentTime;
    s.start(t, Math.random() * 1.5, dur + 0.05);
    return s;
  }

  private env(g: GainNode, peak: number, a: number, dur: number) {
    const t = this.ctx!.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dur);
  }

  private tone(dst: AudioNode, type: OscillatorType, f0: number, f1: number, peak: number, dur: number, delay = 0) {
    const c = this.ctx!;
    const o = c.createOscillator(); o.type = type;
    const g = c.createGain();
    const t = c.currentTime + delay;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dst);
    o.start(t); o.stop(t + dur + 0.02);
  }

  private burst(dst: AudioNode, type: BiquadFilterType, freq: number, q: number, peak: number, attack: number, dur: number, sweepTo?: number) {
    const c = this.ctx!;
    const n = this.noiseSrc(attack + dur);
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, c.currentTime + attack + dur);
    const g = c.createGain();
    this.env(g, peak, attack, dur);
    n.connect(f).connect(g).connect(dst);
  }

  gunshot(def: WeaponDef, pos?: V3) {
    const s = def.sound;
    const dur = s.len;
    const dst = this.out(pos, dur + 0.3, 160);
    if (!dst) return;
    const far = pos ? Math.hypot(pos.x - this.lp.x, pos.z - this.lp.z) : 0;
    const farF = Math.max(0.25, 1 - far / 90);
    if (s.suppressed) {
      this.burst(dst, 'bandpass', 2600 * s.pitch, 0.9, 0.5 * s.gain, 0.002, dur * 0.7);
      this.tone(dst, 'triangle', 420, 120, 0.25 * s.gain, 0.06);
      return;
    }
    this.burst(dst, 'bandpass', 1500 * s.pitch * farF, 0.6, 1.0 * s.gain, 0.001, dur * 0.55);
    this.burst(dst, 'lowpass', 900 * s.pitch * farF, 0.5, 0.9 * s.gain, 0.002, dur * 1.3, 120);
    this.tone(dst, 'sine', 140 * s.pitch, 40, (0.6 + (s.boom ?? 0)) * s.gain, dur * 0.8);
    if (s.boom) this.burst(dst, 'lowpass', 300, 0.7, s.boom * 0.6 * s.gain, 0.01, dur * 2.2, 60);
  }

  footstep(mat: Mat, pos?: V3, vol = 1) {
    const dst = this.out(pos, 0.25, 40);
    if (!dst) return;
    const v = 0.35 * vol;
    switch (mat) {
      case 'metal': this.burst(dst, 'bandpass', 2800, 3, v, 0.002, 0.08); this.tone(dst, 'triangle', 520, 380, v * 0.35, 0.15); break;
      case 'wood': this.burst(dst, 'bandpass', 700, 2.5, v * 1.2, 0.002, 0.09); this.tone(dst, 'sine', 180, 120, v * 0.4, 0.08); break;
      case 'tile': case 'stone': this.burst(dst, 'bandpass', 2000, 1.4, v, 0.001, 0.05); this.burst(dst, 'lowpass', 500, 1, v * 0.6, 0.002, 0.06); break;
      default: this.burst(dst, 'bandpass', 900, 0.8, v * 1.1, 0.008, 0.1); this.burst(dst, 'highpass', 4000, 0.5, v * 0.3, 0.01, 0.07); break;
    }
  }

  land(pos?: V3) { const d = this.out(pos, 0.3, 40); if (d) { this.burst(d, 'lowpass', 600, 1, 0.5, 0.005, 0.15); } }

  headshot() {
    const d = this.out(undefined, 0.5);
    if (!d) return;
    for (const [f, a] of [[2350, 0.28], [3720, 0.18], [5150, 0.12], [6900, 0.06]] as const) this.tone(d, 'sine', f, f * 0.98, a, 0.35);
    this.burst(d, 'highpass', 5000, 0.7, 0.3, 0.001, 0.03);
  }

  hitBody(head = false) { const d = this.out(undefined, 0.15); if (d) { this.burst(d, 'bandpass', head ? 3000 : 1200, 1.5, 0.35, 0.001, 0.06); } }

  hurt() { const d = this.out(undefined, 0.3); if (d) { this.burst(d, 'lowpass', 500, 1, 0.6, 0.003, 0.18); this.tone(d, 'sine', 160, 60, 0.4, 0.2); } }

  killConfirm() { const d = this.out(undefined, 0.3); if (d) { this.tone(d, 'square', 880, 880, 0.08, 0.06); this.tone(d, 'square', 1320, 1320, 0.08, 0.1, 0.07); } }

  reload(stage: number, pos?: V3) {
    const d = this.out(pos, 0.2, 30);
    if (!d) return;
    const f = [1800, 1200, 2600][stage % 3];
    this.burst(d, 'bandpass', f, 4, 0.35, 0.001, 0.05);
    this.tone(d, 'square', f / 4, f / 6, 0.05, 0.04);
  }

  dry() { const d = this.out(undefined, 0.1); if (d) this.burst(d, 'bandpass', 3000, 5, 0.3, 0.001, 0.03); }

  knife(hit: boolean, pos?: V3) {
    const d = this.out(pos, 0.3, 30);
    if (!d) return;
    this.burst(d, 'bandpass', 2500, 1.2, 0.3, 0.03, 0.12, 900);
    if (hit) this.burst(d, 'lowpass', 900, 2, 0.5, 0.002, 0.1);
  }

  pin(pos?: V3) { const d = this.out(pos, 0.2, 25); if (d) { this.tone(d, 'triangle', 3200, 2800, 0.12, 0.05); this.tone(d, 'triangle', 2400, 2300, 0.08, 0.05, 0.08); } }
  throwSnd(pos?: V3) { const d = this.out(pos, 0.3, 30); if (d) this.burst(d, 'bandpass', 1200, 0.8, 0.25, 0.04, 0.15, 400); }
  bounce(pos: V3) { const d = this.out(pos, 0.15, 40); if (d) { this.tone(d, 'triangle', 1900, 1500, 0.18, 0.06); this.burst(d, 'bandpass', 3500, 3, 0.15, 0.001, 0.03); } }

  explosion(pos: V3, big = false) {
    const d = this.out(pos, 3, 250);
    if (!d) return;
    const g = big ? 1.6 : 1;
    this.burst(d, 'lowpass', 3000, 0.4, 1.2 * g, 0.004, 1.6 * g, 120);
    this.burst(d, 'bandpass', 900, 0.5, 0.6 * g, 0.002, 0.5);
    this.tone(d, 'sine', 90, 28, 1.0 * g, 1.2 * g);
  }

  flashPop(pos: V3) { const d = this.out(pos, 0.8, 150); if (d) { this.burst(d, 'highpass', 1500, 0.5, 1.0, 0.001, 0.35); this.tone(d, 'sine', 120, 40, 0.6, 0.3); } }

  smokeHiss(pos: V3) { const d = this.out(pos, 3, 60); if (d) this.burst(d, 'highpass', 3500, 0.4, 0.35, 0.3, 2.5, 1500); }

  molotov(pos: V3) {
    const d = this.out(pos, 1.5, 80);
    if (!d) return;
    this.burst(d, 'highpass', 4500, 1, 0.5, 0.001, 0.15);
    this.burst(d, 'lowpass', 900, 0.6, 0.7, 0.05, 1.0, 200);
  }

  fireCrackle(pos: V3) { const d = this.out(pos, 0.2, 35); if (d) this.burst(d, 'bandpass', 1500 + Math.random() * 2500, 2, 0.12, 0.002, 0.05); }

  /** Zumbido de flashbang + abafamento geral proporcional à duração. */
  flashRing(dur: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = this.muffle.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(500, t);
    f.exponentialRampToValueAtTime(20000, t + Math.max(0.5, dur * 1.2));
    const d = this.out(undefined, dur + 0.5);
    if (!d) return;
    const o = this.ctx.createOscillator(); o.frequency.value = 3700;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.4);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.5);
  }

  c4Beep(pos: V3, urgent: boolean) {
    const d = this.out(pos, 0.15, 90);
    if (d) this.tone(d, 'sine', urgent ? 3100 : 2650, urgent ? 3100 : 2650, 0.4, 0.09);
  }

  plantBeep(pos?: V3) { const d = this.out(pos, 0.12, 40); if (d) this.tone(d, 'square', 1800 + Math.random() * 600, 1800, 0.08, 0.06); }
  defuseTick(pos?: V3) { const d = this.out(pos, 0.1, 40); if (d) this.burst(d, 'bandpass', 4000, 6, 0.2, 0.001, 0.03); }

  ui(kind: 'click' | 'buy' | 'deny' | 'pickup') {
    const d = this.out(undefined, 0.3);
    if (!d) return;
    if (kind === 'click') this.tone(d, 'triangle', 1200, 1100, 0.08, 0.04);
    if (kind === 'buy') { this.burst(d, 'bandpass', 2400, 3, 0.25, 0.001, 0.05); this.tone(d, 'triangle', 700, 600, 0.12, 0.08, 0.04); }
    if (kind === 'deny') this.tone(d, 'square', 220, 180, 0.1, 0.15);
    if (kind === 'pickup') { this.burst(d, 'bandpass', 1500, 2, 0.25, 0.002, 0.08); }
  }

  jingle(kind: 'start' | 'win' | 'lose' | 'planted') {
    const d = this.out(undefined, 2);
    if (!d) return;
    const seqs: Record<string, number[]> = {
      start: [523, 659, 784], win: [523, 659, 784, 1046], lose: [440, 392, 330, 262], planted: [880, 660, 880, 660],
    };
    seqs[kind].forEach((f, i) => this.tone(d, kind === 'planted' ? 'square' : 'triangle', f, f, kind === 'planted' ? 0.06 : 0.14, 0.22, i * 0.13));
  }
}
