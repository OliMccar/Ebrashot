import type { Team } from '../shared/constants';
import { Match } from '../shared/match';
import type { Cmd } from '../shared/player';
import type { ClientMsg, ServerMsg, Snapshot } from '../shared/protocol';
import type { BuyItemId } from '../shared/weapons';

export interface Connection {
  offline: boolean;
  rtt: number;
  onSnapshot: (s: Snapshot) => void;
  onClose: (reason: string) => void;
  sendCmd(c: Cmd): void;
  buy(item: BuyItemId): void;
  setTeam(t: Team): void;
  /** Chamado a cada tick de simulação do cliente (64 Hz). */
  tick(): void;
  close(): void;
}

/** Modo offline: roda a partida autoritativa localmente, mesmo código do servidor. */
export class LocalConnection implements Connection {
  offline = true;
  rtt = 0;
  match: Match;
  meId: number;
  onSnapshot: (s: Snapshot) => void = () => {};
  onClose: (reason: string) => void = () => {};

  constructor(name: string, opts: { bots: number; difficulty: number; maxRounds: number; team?: Team }) {
    this.match = new Match({ botsPerTeam: opts.bots, difficulty: opts.difficulty, maxRounds: opts.maxRounds });
    const me = this.match.addPlayer(name, false, opts.team);
    this.meId = me.id;
    this.match.start();
  }
  sendCmd(c: Cmd) { this.match.queueCmd(this.meId, c); }
  buy(item: BuyItemId) { this.match.buy(this.meId, item); }
  setTeam(t: Team) { this.match.setTeam(this.meId, t); }
  tick() {
    this.match.tick();
    this.onSnapshot(this.match.snapshotFor(this.meId));
  }
  close() {}
}

export interface RoomInfo { name: string; players: number; humans: number; max: number }

export function defaultServerUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

export function listRooms(url: string): Promise<RoomInfo[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const to = setTimeout(() => { ws.close(); reject(new Error('Tempo esgotado')); }, 4000);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'list' } satisfies ClientMsg));
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data) as ServerMsg;
      if (m.t === 'rooms') { clearTimeout(to); resolve(m.rooms); ws.close(); }
    };
    ws.onerror = () => { clearTimeout(to); reject(new Error('Falha ao conectar no servidor')); };
  });
}

/** Conexão online: envia comandos em lote, recebe snapshots autoritativos. */
export class WsConnection implements Connection {
  offline = false;
  rtt = 0;
  onSnapshot: (s: Snapshot) => void = () => {};
  onClose: (reason: string) => void = () => {};
  private ws: WebSocket;
  private out: Cmd[] = [];
  private tickN = 0;
  private pingTimer: number;
  private closed = false;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (ev) => this.handle(JSON.parse(ev.data) as ServerMsg);
    ws.onclose = () => { if (!this.closed) this.onClose('Conexão encerrada pelo servidor'); this.closed = true; };
    this.pingTimer = window.setInterval(() => this.send({ t: 'ping', ts: performance.now(), rtt: Math.round(this.rtt) }), 2000);
  }

  static connect(url: string, room: string, name: string, bots: number, diff: number): Promise<WsConnection> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const to = setTimeout(() => { ws.close(); reject(new Error('Tempo esgotado ao conectar')); }, 6000);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'join', room, name, bots, diff } satisfies ClientMsg));
      ws.onerror = () => { clearTimeout(to); reject(new Error('Não foi possível conectar em ' + url)); };
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data) as ServerMsg;
        if (m.t === 'welcome') { clearTimeout(to); resolve(new WsConnection(ws)); }
        else if (m.t === 'error') { clearTimeout(to); reject(new Error(m.msg)); ws.close(); }
      };
    });
  }

  private handle(m: ServerMsg) {
    if (m.t === 'snap') this.onSnapshot(m.s);
    else if (m.t === 'pong') this.rtt = this.rtt ? this.rtt * 0.7 + (performance.now() - m.ts) * 0.3 : performance.now() - m.ts;
    else if (m.t === 'error') this.onClose(m.msg);
  }

  private send(m: ClientMsg) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }
  sendCmd(c: Cmd) { this.out.push(c); }
  buy(item: BuyItemId) { this.send({ t: 'buy', item }); }
  setTeam(t: Team) { this.send({ t: 'team', team: t }); }
  tick() {
    this.tickN++;
    if (this.out.length && (this.tickN % 2 === 0 || this.out.length > 3)) {
      this.send({ t: 'cmd', c: this.out });
      this.out = [];
    }
  }
  close() { this.closed = true; clearInterval(this.pingTimer); try { this.ws.close(); } catch { /* */ } }
}
