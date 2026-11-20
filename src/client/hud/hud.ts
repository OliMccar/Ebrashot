import type { Team } from '../../shared/constants';
import type { MapData } from '../../shared/map';
import type { V3 } from '../../shared/math';
import type { PlayerNet, Snapshot } from '../../shared/protocol';
import { type BuyItemId, SHOP, WEAPONS, priceFor } from '../../shared/weapons';

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

function el(tag: string, cls: string, html = '') {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

const fmtTime = (s: number) => { const t = Math.max(0, Math.ceil(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

export interface HudState {
  hp: number; armor: number; helmet: boolean; money: number; weaponName: string; mag: number; res: number; showAmmo: boolean;
  inacc: number; scoped: boolean; alive: boolean; plantP: number; defuseP: number; canBuy: boolean; hint: string; spectating: string;
  fps: number; ping: number; kit: boolean; c4: boolean;
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
  private crossEl: HTMLElement;
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

  constructor(private map: MapData, mobile: boolean, crossColor: string) {
    this.root = document.getElementById('hud')!;
    this.root.innerHTML = '';
    this.root.classList.toggle('mobile', mobile);
    this.root.style.setProperty('--cross', crossColor);
    const top = el('div', 'hud-top', `
      <div class="score-box"><span class="sc-t">0</span><div class="timer"><span class="tm">0:00</span><span class="bomb-ico">💣</span></div><span class="sc-ct">0</span></div>
      <div class="alive-row"><span class="alive-t"></span><span class="alive-ct"></span></div>`);
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
      <div class="hp"><span class="ico">✚</span><span class="hpv">100</span></div>
      <div class="ar"><span class="ico">⛨</span><span class="arv">0</span></div>
      <div class="kit-ico">🔧</div><div class="c4-ico">C4</div>`));
    this.root.appendChild(el('div', 'bottom-right', '<div class="wname"></div><div class="ammo"><span class="mag">0</span><span class="res">/ 0</span></div>'));
    this.killfeed = el('div', 'killfeed');
    this.root.appendChild(this.killfeed);
    this.crossEl = el('div', 'crosshair', '<i class="l"></i><i class="r"></i><i class="t"></i><i class="b"></i><i class="d"></i>');
    this.root.appendChild(this.crossEl);
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
    this.buyEl = el('div', 'buy-menu panel');
    this.root.appendChild(this.buyEl);
    this.scoreEl = el('div', 'scoreboard panel');
    this.root.appendChild(this.scoreEl);
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
    c.fillStyle = 'rgba(214,190,140,0.85)';
    for (const r of m.walkable) c.fillRect((r.x0 - m.bounds.x0) * s, (r.z0 - m.bounds.z0) * s, (r.x1 - r.x0) * s, (r.z1 - r.z0) * s);
    c.fillStyle = 'rgba(70,55,40,0.9)';
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
    c.beginPath(); c.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2); c.closePath();
    c.fillStyle = 'rgba(15,14,12,0.55)'; c.fill();
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
      c.fillStyle = friend ? (p.tm === 'T' ? '#f2b84b' : '#5aa0ff') : '#ff3b30';
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
    this.set('.mo', `$${s.money}`);
    this.toggle('.money', 'canbuy', s.canBuy);
    this.toggle('.kit-ico', 'on', s.kit);
    this.toggle('.c4-ico', 'on', s.c4);
    this.set('.wname', s.weaponName);
    this.set('.mag', s.showAmmo ? String(s.mag) : '');
    this.set('.res', s.showAmmo ? `/ ${s.res}` : '');
    this.toggle('.ammo', 'low', s.showAmmo && s.mag <= 5);
    this.toggle('.bottom-left', 'hidden', !s.alive);
    this.toggle('.bottom-right', 'hidden', !s.alive);
    this.set('.hint', s.hint);
    this.set('.spectate', s.spectating);
    this.set('.fps', s.fps ? `${s.fps} FPS${s.ping ? ` · ${s.ping} ms` : ''}` : '');
    // mira dinâmica
    const gap = Math.round(3 + Math.min(60, s.inacc * 900));
    if (this.cache['gap'] !== String(gap)) { this.cache['gap'] = String(gap); this.crossEl.style.setProperty('--gap', gap + 'px'); }
    this.toggle('.crosshair', 'hidden', s.scoped || !s.alive);
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
      this.set('.alive-t', `${aliveT} vivos`);
      this.set('.alive-ct', `${aliveCT} vivos`);
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

  // ---------------------------------------------------------------- loja
  openBuy(team: Team, money: number, armor: number, helmet: boolean, buyLeft: number) {
    this.buyOpen = true;
    this.renderBuy(team, money, armor, helmet, buyLeft);
    this.buyEl.classList.add('on');
  }
  closeBuy() { this.buyOpen = false; this.buyEl.classList.remove('on'); }

  renderBuy(team: Team, money: number, armor: number, helmet: boolean, buyLeft: number) {
    const cats = [...new Set(SHOP.map((s) => s.category))];
    const key = `${team}|${money}|${armor}|${helmet}|${Math.ceil(buyLeft)}`;
    if (this.cache['buy'] === key) return;
    this.cache['buy'] = key;
    this.buyEl.innerHTML = `<div class="buy-head"><b>Loja</b><span>$${money}</span><span class="buy-left">${buyLeft > 0 ? `Tempo de compra: ${Math.ceil(buyLeft)}s` : 'Tempo de compra esgotado'}</span><button class="buy-x">✕</button></div>
      <div class="buy-cats">${cats.map((c) => `<div class="buy-cat"><h4>${c}</h4>${SHOP.filter((s) => s.category === c && (!s.team || s.team === team)).map((s) => {
        const price = priceFor(s.id, team, armor, helmet);
        return `<button class="buy-item ${price > money ? 'poor' : ''}" data-item="${s.id}"><span>${s.id === 'molotov' ? (team === 'CT' ? 'Incendiária' : 'Molotov') : s.name}</span><em>$${price}</em></button>`;
      }).join('')}</div>`).join('')}</div>`;
    this.buyEl.querySelectorAll<HTMLButtonElement>('.buy-item').forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); this.onBuy(b.dataset.item as BuyItemId); };
    });
    ($('.buy-x', this.buyEl) as HTMLButtonElement).onclick = () => { this.closeBuy(); this.onBuyClose(); };
  }

  // ---------------------------------------------------------------- placar
  showScore(on: boolean) { this.scoreOpen = on; this.scoreEl.classList.toggle('on', on); this.cache['sb'] = ''; }

  private renderScoreboard(s: Snapshot) {
    const rows = (t: Team) => s.players.filter((p) => p.tm === t).sort((a, b) => b.k - a.k || a.d - b.d).map((p) =>
      `<tr class="${p.a ? '' : 'dead'} ${p.id === s.you ? 'me' : ''}"><td>${esc(p.n)}${p.c4 ? ' <b class="c4t">C4</b>' : ''}</td><td>${p.k}</td><td>${p.as}</td><td>${p.d}</td><td>${p.tm === s.team ? '$' + p.mo : ''}</td><td>${p.bot ? 'BOT' : p.ping}</td></tr>`).join('');
    const html = `<div class="sb-head">Round ${s.round.round} / ${s.round.maxRounds} · Mapa Sahel</div>
      <div class="sb-team CT"><div class="sb-title">CT <b>${s.round.sCT}</b></div><table><tr><th>Jogador</th><th>K</th><th>A</th><th>D</th><th>$</th><th>Ping</th></tr>${rows('CT')}</table></div>
      <div class="sb-team T"><div class="sb-title">TR <b>${s.round.sT}</b></div><table><tr><th>Jogador</th><th>K</th><th>A</th><th>D</th><th>$</th><th>Ping</th></tr>${rows('T')}</table></div>`;
    if (this.cache['sb'] !== html) { this.cache['sb'] = html; this.scoreEl.innerHTML = html; }
  }
}

function esc(s: string) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); }
