import type { Team } from '../../shared/constants';
import type { MapData } from '../../shared/map';
import type { V3 } from '../../shared/math';
import type { PlayerNet, Snapshot } from '../../shared/protocol';
import { type CrosshairCfg, drawCrosshair } from '../crosshair';
import { type BuyItemId, SHOP, type ShopEntry, WEAPONS, priceFor } from '../../shared/weapons';

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

function el(tag: string, cls: string, html = '') {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

/** Categorias da loja radial, na ordem das teclas 1..n. */
const BUY_CATS = [...new Set(SHOP.map((s) => s.category))];

/** Caminho SVG de um setor de anel (ângulos em radianos, 0 = topo, sentido horário). */
function wedgePath(r0: number, r1: number, a0: number, a1: number) {
  const pt = (r: number, a: number) => `${(Math.sin(a) * r).toFixed(1)},${(-Math.cos(a) * r).toFixed(1)}`;
  const big = a1 - a0 > Math.PI ? 1 : 0;
  return `M${pt(r0, a0)} L${pt(r1, a0)} A${r1},${r1} 0 ${big} 1 ${pt(r1, a1)} L${pt(r0, a1)} A${r0},${r0} 0 ${big} 0 ${pt(r0, a0)} Z`;
}

const fmtTime = (s: number) => { const t = Math.max(0, Math.ceil(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

export interface HudState {
  hp: number; armor: number; helmet: boolean; money: number; weaponName: string; mag: number; res: number; showAmmo: boolean;
  inacc: number; scoped: boolean; alive: boolean; plantP: number; defuseP: number; canBuy: boolean; hint: string; spectating: string;
  fps: number; ping: number; kit: boolean; c4: boolean;
  /** abertura dinâmica da mira (px CSS), deslocamento do recoil (px CSS), gap da arma (px CSS) e se está assistindo alguém */
  /** mostra vida/colete/arma (vivo ou assistindo alguém) */
  panels: boolean;
  spreadPx: number; recoilX: number; recoilY: number; weaponGapPx: number; specActive: boolean;
}

/** HUD em DOM, atualizado apenas quando os valores mudam. */
export class Hud {
  root: HTMLElement;
  private cache: Record<string, string> = {};
  private killfeed: HTMLElement;
  private radar: HTMLCanvasElement;
  private radarCtx: CanvasRenderingContext2D;
  private radarMap: HTMLCanvasElement;
  private radarScale = 2.2;
  private buyEl: HTMLElement;
  private scoreEl: HTMLElement;
  private flashEl: HTMLElement;
  private dmgEl: HTMLElement;
  private bannerEl: HTMLElement;
  private toastEl: HTMLElement;
  private hitEl: HTMLElement;
  private crossEl: HTMLCanvasElement;
  private crossCtx: CanvasRenderingContext2D;
  private crossVer = 1;
  private scopeEl: HTMLElement;
  private progEl: HTMLElement;
  private flashLeft = 0;
  private flashDur = 0;
  private dmgT = 0;
  private hitT = 0;
  private bannerT = 0;
  private toastT = 0;
  buyOpen = false;
  scoreOpen = false;
  onBuy: (item: BuyItemId) => void = () => {};
  onBuyClose: () => void = () => {};

  constructor(private map: MapData, mobile: boolean, private xh: () => CrosshairCfg) {
    this.root = document.getElementById('hud')!;
    this.root.innerHTML = '';
    this.root.classList.toggle('mobile', mobile);
    const top = el('div', 'hud-top', `
      <div class="score-box">
        <div class="ts T"><span class="alive alive-t">0</span><b class="sc-t">0</b></div>
        <div class="timer"><span class="tm">0:00</span><span class="bomb-ico">💣</span></div>
        <div class="ts CT"><b class="sc-ct">0</b><span class="alive alive-ct">0</span></div>
      </div>`);
    this.root.appendChild(top);
    this.radar = el('canvas', 'radar') as HTMLCanvasElement;
    const rs = mobile ? 140 : 190;
    this.radar.width = this.radar.height = rs * 2;
    this.radar.style.width = this.radar.style.height = rs + 'px';
    this.radarCtx = this.radar.getContext('2d')!;
    this.root.appendChild(this.radar);
    this.radarMap = this.buildRadarMap();
    this.root.appendChild(el('div', 'money', '<span class="mo">$800</span><span class="mo-delta"></span>'));
    this.root.appendChild(el('div', 'bottom-left', `
      <div class="hp"><span class="ico">✚</span><span class="hpv">100</span><i class="bar"><i class="hpb"></i></i></div>
      <div class="ar"><span class="ico">⛨</span><span class="arv">0</span><i class="bar"><i class="arb"></i></i></div>
      <div class="kit-ico">🔧</div><div class="c4-ico">C4</div>`));
    this.root.appendChild(el('div', 'bottom-right', '<div class="wname"></div><div class="ammo"><span class="mag">0</span><span class="res">/ 0</span></div>'));
    this.killfeed = el('div', 'killfeed');
    this.root.appendChild(this.killfeed);
    this.crossEl = el('canvas', 'crosshair') as HTMLCanvasElement;
    this.crossCtx = this.crossEl.getContext('2d')!;
    this.root.appendChild(this.crossEl);
    this.setCrosshair();
    this.hitEl = el('div', 'hitmarker', '<i></i><i></i><i></i><i></i>');
    this.root.appendChild(this.hitEl);
    this.scopeEl = el('div', 'scope-overlay', '<div class="scope-hole"></div><i class="sh"></i><i class="sv"></i>');
    this.root.appendChild(this.scopeEl);
    this.progEl = el('div', 'progress', '<div class="plabel"></div><div class="pbar"><div class="pfill"></div></div>');
    this.root.appendChild(this.progEl);
    this.root.appendChild(el('div', 'hint'));
    this.root.appendChild(el('div', 'spectate'));
    this.root.appendChild(el('div', 'fps'));
    this.bannerEl = el('div', 'banner');
    this.root.appendChild(this.bannerEl);
    this.toastEl = el('div', 'toast');
    this.root.appendChild(this.toastEl);
    this.dmgEl = el('div', 'damage-vignette');
    this.root.appendChild(this.dmgEl);
    this.flashEl = el('div', 'flash-overlay');
    this.root.appendChild(this.flashEl);
    this.buyEl = el('div', 'buy-menu');
    this.root.appendChild(this.buyEl);
    this.scoreEl = el('div', 'scoreboard');
    this.root.appendChild(this.scoreEl);
  }

  /** Avisa que a configuração da mira mudou (redesenha no próximo frame). */
  setCrosshair() {
    this.crossVer++;
    this.root.style.setProperty('--sniper', this.xh().sniperWidth + 'px');
  }

  private drawCross(s: HudState) {
    const cfg = this.xh();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const css = 260;
    const px = Math.round(css * dpr);
    if (this.crossEl.width !== px) { this.crossEl.width = this.crossEl.height = px; this.crossEl.style.width = this.crossEl.style.height = css + 'px'; this.crossVer++; }
    const spread = Math.min(110, s.spreadPx);
    const scale = (window.innerHeight / 1080) * dpr;
    const key = `${this.crossVer}|${Math.round(spread * dpr)}|${Math.round(s.weaponGapPx)}|${scale.toFixed(3)}`;
    if (this.cache['xh'] !== key) { this.cache['xh'] = key; drawCrosshair(this.crossCtx, cfg, spread * dpr, scale, s.weaponGapPx * dpr); }
    const rx = cfg.recoil && s.alive ? Math.round(s.recoilX) : 0, ry = cfg.recoil && s.alive ? Math.round(s.recoilY) : 0;
    const tr = `translate(calc(-50% + ${rx}px), calc(-50% + ${ry}px))`;
    if (this.cache['xhT'] !== tr) { this.cache['xhT'] = tr; this.crossEl.style.transform = tr; }
  }

  private bar(sel: string, pct: number) {
    const v = `${Math.max(0, Math.min(100, pct))}%`;
    if (this.cache[sel + '|w'] === v) return;
    this.cache[sel + '|w'] = v;
    const e = $(sel, this.root);
    if (e) e.style.width = v;
  }

  private set(sel: string, text: string, prop: 'text' | 'html' = 'text') {
    if (this.cache[sel] === text) return;
    this.cache[sel] = text;
    const e = $(sel, this.root);
    if (!e) return;
    if (prop === 'text') e.textContent = text; else e.innerHTML = text;
  }
  private toggle(sel: string, cls: string, on: boolean) {
    const k = sel + '|' + cls;
    const v = on ? '1' : '0';
    if (this.cache[k] === v) return;
    this.cache[k] = v;
    $(sel, this.root)?.classList.toggle(cls, on);
  }

  private buildRadarMap() {
    const m = this.map;
    const s = this.radarScale;
    const w = (m.bounds.x1 - m.bounds.x0) * s, h = (m.bounds.z1 - m.bounds.z0) * s;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const c = cv.getContext('2d')!;
    c.fillStyle = 'rgba(30,26,20,0.0)'; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(190,196,200,0.8)';
    for (const r of m.walkable) c.fillRect((r.x0 - m.bounds.x0) * s, (r.z0 - m.bounds.z0) * s, (r.x1 - r.x0) * s, (r.z1 - r.z0) * s);
    c.fillStyle = 'rgba(55,62,70,0.9)';
    for (const b of m.boxes) {
      if (!b.vis || b.max.y > 3 || b.max.y < 0.5) continue;
      c.fillRect((b.min.x - m.bounds.x0) * s, (b.min.z - m.bounds.z0) * s, (b.max.x - b.min.x) * s, (b.max.z - b.min.z) * s);
    }
    c.fillStyle = 'rgba(200,40,30,0.35)';
    for (const k of ['A', 'B'] as const) {
      const r = m.sites[k];
      c.fillRect((r.x0 - m.bounds.x0) * s, (r.z0 - m.bounds.z0) * s, (r.x1 - r.x0) * s, (r.z1 - r.z0) * s);
    }
    return cv;
  }

  drawRadar(me: V3, yaw: number, myTeam: Team | null, players: { p: PlayerNet; pos: V3; yaw: number }[], bomb: Snapshot['bomb'], youId: number) {
    const c = this.radarCtx;
    const W = this.radar.width;
    const zoom = W / 190 / 1.0;
    const s = this.radarScale;
    c.save();
    c.clearRect(0, 0, W, W);
    // radar quadrado com cantos levemente arredondados
    const R = 14;
    c.beginPath();
    c.moveTo(R, 0); c.arcTo(W, 0, W, W, R); c.arcTo(W, W, 0, W, R); c.arcTo(0, W, 0, 0, R); c.arcTo(0, 0, W, 0, R);
    c.closePath();
    c.fillStyle = 'rgba(12,14,16,0.62)'; c.fill();
    c.clip();
    c.translate(W / 2, W / 2);
    c.scale(zoom, zoom);
    c.rotate(yaw);
    c.drawImage(this.radarMap, -(me.x - this.map.bounds.x0) * s, -(me.z - this.map.bounds.z0) * s);
    const tx = (p: V3) => [(p.x - me.x) * s, (p.z - me.z) * s] as const;
    c.font = 'bold 22px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const k of ['A', 'B'] as const) {
      const [x, y] = tx(this.map.siteCenters[k]);
      c.save(); c.translate(x, y); c.rotate(-yaw); c.fillStyle = 'rgba(255,90,70,0.95)'; c.fillText(k, 0, 0); c.restore();
    }
    for (const { p, pos, yaw: py } of players) {
      if (!p.a || p.id === youId) continue;
      const friend = p.tm === myTeam;
      if (!friend && !p.sp) continue;
      const [x, y] = tx(pos);
      c.save(); c.translate(x, y); c.rotate(-py);
      c.fillStyle = friend ? (p.tm === 'T' ? '#e8b94a' : '#6fa8e8') : '#ff3b30';
      c.beginPath(); c.arc(0, 0, 6, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.moveTo(-4, -4); c.lineTo(0, -11); c.lineTo(4, -4); c.fill();
      if (p.c4) { c.fillStyle = '#ff4040'; c.fillRect(-3, -3, 6, 6); }
      c.restore();
    }
    if (bomb.st === 'planted' || bomb.st === 'dropped') {
      const [x, y] = tx(bomb);
      c.fillStyle = bomb.st === 'planted' ? (Math.sin(performance.now() / 120) > 0 ? '#ff2020' : '#802020') : '#ff8c1a';
      c.fillRect(x - 6, y - 4, 12, 8);
    }
    c.restore();
    // jogador no centro
    c.fillStyle = '#ffffff';
    c.beginPath(); c.moveTo(W / 2, W / 2 - 12); c.lineTo(W / 2 + 7, W / 2 + 8); c.lineTo(W / 2, W / 2 + 4); c.lineTo(W / 2 - 7, W / 2 + 8); c.fill();
  }

  update(dt: number, s: HudState, snap: Snapshot | null) {
    this.set('.hpv', String(Math.max(0, s.hp)));
    this.toggle('.hp', 'low', s.hp <= 25);
    this.set('.arv', String(s.armor) + (s.helmet ? '+' : ''));
    this.bar('.hpb', s.hp);
    this.bar('.arb', s.armor);
    this.set('.mo', `$${s.money}`);
    this.toggle('.money', 'canbuy', s.canBuy);
    this.toggle('.kit-ico', 'on', s.kit);
    this.toggle('.c4-ico', 'on', s.c4);
    this.set('.wname', s.weaponName);
    this.set('.mag', s.showAmmo ? String(s.mag) : '');
    this.set('.res', s.showAmmo ? `/ ${s.res}` : '');
    this.toggle('.ammo', 'low', s.showAmmo && s.mag <= 5);
    this.toggle('.bottom-left', 'hidden', !s.panels);
    this.toggle('.bottom-right', 'hidden', !s.panels);
    this.set('.hint', s.hint);
    this.set('.spectate', s.spectating);
    this.set('.fps', s.fps ? `${s.fps} FPS${s.ping ? ` · ${s.ping} ms` : ''}` : '');
    // mira personalizável
    const showCross = !s.scoped && (s.alive || (s.specActive && this.xh().showSpectating));
    this.toggle('.crosshair', 'hidden', !showCross);
    if (showCross) this.drawCross(s);
    this.toggle('.scope-overlay', 'on', s.scoped);
    // progresso plant/defuse
    const p = Math.max(s.plantP, s.defuseP);
    this.toggle('.progress', 'on', p > 0);
    if (p > 0) {
      this.set('.plabel', s.plantP > 0 ? 'Plantando a C4...' : 'Desarmando...');
      ($('.pfill', this.root) as HTMLElement).style.width = `${Math.min(100, p * 100)}%`;
    }
    if (snap) {
      const r = snap.round;
      this.set('.sc-t', String(r.sT));
      this.set('.sc-ct', String(r.sCT));
      const planted = snap.bomb.st === 'planted';
      this.set('.tm', r.phase === 'freeze' ? fmtTime(r.left) : planted ? '' : fmtTime(r.left));
      this.toggle('.timer', 'freeze', r.phase === 'freeze');
      this.toggle('.timer', 'planted', planted);
      const aliveT = snap.players.filter((x) => x.tm === 'T' && x.a).length;
      const aliveCT = snap.players.filter((x) => x.tm === 'CT' && x.a).length;
      this.set('.alive-t', String(aliveT));
      this.set('.alive-ct', String(aliveCT));
      if (this.scoreOpen) this.renderScoreboard(snap);
    }
    // efeitos temporizados
    if (this.flashLeft > 0) {
      this.flashLeft -= dt;
      const k = Math.max(0, this.flashLeft / this.flashDur);
      const o = this.flashLeft > this.flashDur - 0.25 || this.flashLeft > 1.2 ? 1 : Math.min(1, this.flashLeft / 1.2);
      this.flashEl.style.opacity = String(Math.min(1, o) * (k > 0 ? 1 : 0));
    } else if (this.flashEl.style.opacity !== '0') this.flashEl.style.opacity = '0';
    if (this.dmgT > 0) { this.dmgT -= dt; this.dmgEl.style.opacity = String(Math.max(0, this.dmgT * 2)); }
    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) this.hitEl.classList.remove('on', 'hs', 'kill'); }
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) this.bannerEl.classList.remove('on'); }
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.toastEl.classList.remove('on'); }
  }

  flash(dur: number) { this.flashDur = Math.max(dur, this.flashLeft); this.flashLeft = Math.max(this.flashLeft, dur); }
  damage() { this.dmgT = 0.6; }
  hit(head: boolean, kill: boolean) { this.hitT = 0.25; this.hitEl.classList.add('on'); if (head) this.hitEl.classList.add('hs'); if (kill) this.hitEl.classList.add('kill'); }
  banner(text: string, cls = '', t = 3) { this.bannerEl.innerHTML = text; this.bannerEl.className = 'banner on ' + cls; this.bannerT = t; }
  toast(text: string) { this.toastEl.textContent = text; this.toastEl.classList.add('on'); this.toastT = 2.2; }
  moneyDelta(amount: number, why: string) {
    const d = $('.mo-delta', this.root);
    d.textContent = `${amount > 0 ? '+' : ''}$${amount} ${why}`;
    d.classList.remove('show'); void d.offsetWidth; d.classList.add('show');
    d.classList.toggle('neg', amount < 0);
  }

  kill(killer: PlayerNet | undefined, victim: PlayerNet | undefined, weapon: string, hs: boolean, wb: boolean, youId: number) {
    const k = killer ? `<span class="${killer.tm}">${esc(killer.n)}</span>` : '';
    const v = victim ? `<span class="${victim.tm}">${esc(victim.n)}</span>` : '';
    const wn = weapon === 'bomb' ? 'C4' : weapon === 'world' ? '☠' : WEAPONS[weapon as keyof typeof WEAPONS]?.name ?? weapon;
    const row = el('div', 'kf-row' + (killer?.id === youId || victim?.id === youId ? ' me' : ''),
      `${k}<span class="kf-w">${wn}${wb ? ' <i>⟂</i>' : ''}${hs ? ' <i>◉</i>' : ''}</span>${v}`);
    this.killfeed.prepend(row);
    while (this.killfeed.children.length > 6) this.killfeed.lastChild!.remove();
    setTimeout(() => row.remove(), 7000);
  }

  feedMsg(text: string) {
    const row = el('div', 'kf-row msg', esc(text));
    this.killfeed.prepend(row);
    while (this.killfeed.children.length > 7) this.killfeed.lastChild!.remove();
    setTimeout(() => row.remove(), 5000);
  }

  // ---------------------------------------------------------------- loja (roda de compra)
  private buyCat = -1;
  private buyArgs: [Team, number, number, boolean, number] = ['T', 0, 0, false, 0];
  private buyItems: ShopEntry[] = [];
  private onBuyKey = (e: KeyboardEvent) => {
    if (!this.buyOpen) return;
    const n = /^Digit([1-9])$/.exec(e.code);
    if (n) {
      e.preventDefault();
      const i = Number(n[1]) - 1;
      if (this.buyCat < 0) { if (i < BUY_CATS.length) this.enterCat(i); }
      else if (i < this.buyItems.length) this.onBuy(this.buyItems[i].id);
    } else if ((e.code === 'Backspace' || e.code === 'Digit0') && this.buyCat >= 0) { e.preventDefault(); this.enterCat(-1); }
  };

  openBuy(team: Team, money: number, armor: number, helmet: boolean, buyLeft: number) {
    this.buyOpen = true;
    this.buyCat = -1;
    this.cache['buy'] = '';
    this.renderBuy(team, money, armor, helmet, buyLeft);
    this.buyEl.classList.add('on');
    window.addEventListener('keydown', this.onBuyKey);
  }
  closeBuy() {
    this.buyOpen = false;
    this.buyEl.classList.remove('on');
    window.removeEventListener('keydown', this.onBuyKey);
  }

  private enterCat(i: number) {
    this.buyCat = i;
    this.cache['buy'] = '';
    this.renderBuy(...this.buyArgs);
  }

  renderBuy(team: Team, money: number, armor: number, helmet: boolean, buyLeft: number) {
    this.buyArgs = [team, money, armor, helmet, buyLeft];
    const key = `${team}|${money}|${armor}|${helmet}|${this.buyCat}`;
    const left = buyLeft > 0 ? `Tempo de compra: ${Math.ceil(buyLeft)}s` : 'Tempo de compra esgotado';
    if (this.cache['buy'] === key) { this.set('.bw-left', left); return; }
    this.cache['buy'] = key;
    delete this.cache['.bw-left'];
    const name = (s: ShopEntry) => (s.id === 'molotov' ? (team === 'CT' ? 'Incendiária' : 'Molotov') : s.name);
    type Slice = { label: string; sub: string; poor: boolean; act: string };
    let slices: Slice[];
    if (this.buyCat < 0) {
      this.buyItems = [];
      slices = BUY_CATS.map((c, i) => {
        const its = SHOP.filter((s) => s.category === c && (!s.team || s.team === team));
        const min = Math.min(...its.map((s) => priceFor(s.id, team, armor, helmet)));
        return { label: c, sub: `${its.length} itens`, poor: min > money, act: `cat:${i}` };
      });
    } else {
      this.buyItems = SHOP.filter((s) => s.category === BUY_CATS[this.buyCat] && (!s.team || s.team === team));
      slices = this.buyItems.map((s) => {
        const price = priceFor(s.id, team, armor, helmet);
        return { label: name(s), sub: `$${price}`, poor: price > money, act: `item:${s.id}` };
      });
    }
    const n = slices.length;
    const R0 = 92, R1 = 250, gap = 0.012;
    const step = (Math.PI * 2) / n;
    const off = -step / 2;
    const wedges = slices.map((sl, i) => {
      const a0 = off + i * step + gap, a1 = off + (i + 1) * step - gap;
      const am = (a0 + a1) / 2, rm = (R0 + R1) / 2 + 6;
      const x = Math.sin(am) * rm, y = -Math.cos(am) * rm;
      const kx = Math.sin(am) * (R1 - 20), ky = -Math.cos(am) * (R1 - 20);
      return `<g class="bw-slice ${sl.poor ? 'poor' : ''}" data-act="${sl.act}" data-label="${esc(sl.label)}" data-sub="${esc(sl.sub)}">
        <path d="${wedgePath(R0, R1, a0, a1)}"/>
        <text class="bw-key" x="${kx.toFixed(1)}" y="${(ky + 5).toFixed(1)}">${i + 1}</text>
        <text class="bw-label" x="${x.toFixed(1)}" y="${(y - 2).toFixed(1)}">${esc(sl.label)}</text>
        <text class="bw-sub" x="${x.toFixed(1)}" y="${(y + 18).toFixed(1)}">${esc(sl.sub)}</text>
      </g>`;
    }).join('');
    const title = this.buyCat < 0 ? 'Loja' : BUY_CATS[this.buyCat];
    const idle = this.buyCat < 0 ? 'Escolha uma categoria' : 'Clique no centro para voltar';
    this.buyEl.style.setProperty('--bw-font', n > 7 ? '15px' : n > 5 ? '17px' : '20px');
    this.buyEl.innerHTML = `<div class="bw-wrap">
      <svg class="bw" viewBox="-260 -260 520 520">${wedges}<circle class="bw-center ${this.buyCat >= 0 ? 'back' : ''}" r="${R0 - 6}"/></svg>
      <div class="bw-mid">
        <div class="bw-title">${esc(title)}</div>
        <div class="bw-money">$${money}</div>
        <div class="bw-info">${idle}</div>
      </div>
      <div class="bw-foot"><span class="bw-left">${left}</span><span>Teclas 1–${n}${this.buyCat >= 0 ? ' · 0 volta' : ''} · B ou Esc fecha</span></div>
      <button class="bw-x" title="Fechar">✕</button>
    </div>`;
    const info = $('.bw-info', this.buyEl);
    this.buyEl.querySelectorAll<SVGGElement>('.bw-slice').forEach((g) => {
      g.addEventListener('mouseenter', () => { info.textContent = `${g.dataset.label} · ${g.dataset.sub}`; });
      g.addEventListener('mouseleave', () => { info.textContent = idle; });
      g.addEventListener('click', (e) => {
        e.stopPropagation();
        const [kind, v] = g.dataset.act!.split(':');
        if (kind === 'cat') this.enterCat(Number(v));
        else this.onBuy(v as BuyItemId);
      });
    });
    ($('.bw-x', this.buyEl) as HTMLButtonElement).onclick = () => { this.closeBuy(); this.onBuyClose(); };
    if (this.buyCat >= 0) this.buyEl.querySelector('.bw-center')?.addEventListener('click', () => this.enterCat(-1));
  }

  // ---------------------------------------------------------------- placar
  showScore(on: boolean) { this.scoreOpen = on; this.scoreEl.classList.toggle('on', on); this.cache['sb'] = ''; }

  private renderScoreboard(s: Snapshot) {
    const rows = (t: Team) => s.players.filter((p) => p.tm === t).sort((a, b) => b.k - a.k || a.d - b.d).map((p) =>
      `<tr class="${p.a ? '' : 'dead'} ${p.id === s.you ? 'me' : ''}"><td class="pg">${p.bot ? 'BOT' : p.ping}</td><td class="nm">${p.a ? '' : '<i class="skull">☠</i>'}${esc(p.n)}${p.c4 ? ' <b class="c4t">C4</b>' : ''}</td><td class="mo">${p.tm === s.team ? '$' + p.mo : ''}</td><td>${p.k}</td><td>${p.as}</td><td>${p.d}</td></tr>`).join('');
    const head = '<tr><th class="pg">Ping</th><th class="nm">Jogador</th><th class="mo">Dinheiro</th><th>K</th><th>A</th><th>D</th></tr>';
    const team = (t: Team, label: string, score: number) => {
      const alive = s.players.filter((p) => p.tm === t && p.a).length;
      return `<div class="sb-team ${t}"><div class="sb-score"><b>${score}</b><small>${label}</small><small>${alive} vivos</small></div><table>${head}${rows(t)}</table></div>`;
    };
    const html = `<div class="sb-head"><b>Sahel</b><span>Defuse · Round ${s.round.round} de ${s.round.maxRounds}</span></div>
      ${team('CT', 'Contra-Terroristas', s.round.sCT)}${team('T', 'Terroristas', s.round.sT)}`;
    if (this.cache['sb'] !== html) { this.cache['sb'] = html; this.scoreEl.innerHTML = html; }
  }
}

function esc(s: string) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); }
