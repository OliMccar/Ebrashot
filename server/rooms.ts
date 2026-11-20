import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { DT, SNAPSHOT_EVERY, type Team } from '../src/shared/constants';
import { Match } from '../src/shared/match';
import type { ClientMsg, ServerMsg } from '../src/shared/protocol';
import { SHOP } from '../src/shared/weapons';

const MAX_PER_ROOM = 10;
const MAX_ROOMS = 50;

interface Client { ws: WebSocket; id: number; room: Room; msgs: number }

class Room {
  match: Match;
  clients = new Set<Client>();
  emptySince = 0;
  private acc = 0;
  private last = performance.now();
  private timer: NodeJS.Timeout;

  constructor(public name: string, bots: number, diff: number) {
    this.match = new Match({ botsPerTeam: Math.max(1, Math.min(5, bots)), difficulty: Math.max(0, Math.min(3, diff)) });
    this.match.start();
    this.timer = setInterval(() => this.loop(), 4);
  }

  private loop() {
    const now = performance.now();
    this.acc += (now - this.last) / 1000;
    this.last = now;
    if (this.acc > 0.25) this.acc = 0.25; // evita espiral após travamento
    while (this.acc >= DT) {
      this.acc -= DT;
      this.match.tick();
      if (this.match.tickN % SNAPSHOT_EVERY === 0) this.broadcastSnapshots();
    }
  }

  private broadcastSnapshots() {
    for (const c of this.clients) {
      if (c.ws.readyState !== WebSocket.OPEN) continue;
      if (c.ws.bufferedAmount > 512 * 1024) continue; // cliente lento: pula um snapshot
      const msg: ServerMsg = { t: 'snap', s: this.match.snapshotFor(c.id) };
      c.ws.send(JSON.stringify(msg));
    }
  }

  humans() { return this.clients.size; }

  join(ws: WebSocket, name: string): Client {
    const m = this.match;
    const nT = m.teamPlayers('T').filter((p) => !p.isBot).length;
    const nCT = m.teamPlayers('CT').filter((p) => !p.isBot).length;
    const team: Team = nT <= nCT ? 'T' : 'CT';
    const p = m.addPlayer(name, false, team);
    m.balanceBots();
    const c: Client = { ws, id: p.id, room: this, msgs: 0 };
    this.clients.add(c);
    this.emptySince = 0;
    return c;
  }

  leave(c: Client) {
    this.clients.delete(c);
    this.match.removePlayer(c.id);
    this.match.balanceBots();
    if (this.clients.size === 0) this.emptySince = Date.now();
  }

  close() { clearInterval(this.timer); }
}

const rooms = new Map<string, Room>();

setInterval(() => {
  for (const [k, r] of rooms) if (r.clients.size === 0 && r.emptySince && Date.now() - r.emptySince > 30_000) { r.close(); rooms.delete(k); }
}, 5000).unref?.();

function send(ws: WebSocket, m: ServerMsg) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); }

const validItems = new Set<string>(SHOP.map((s) => s.id));

/** Acopla o servidor de jogo (WebSocket em /ws) a um servidor HTTP existente. */
export function attachGameServer(http: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  http.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = req.url ?? '';
    if (!url.startsWith('/ws')) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket) => {
    let client: Client | null = null;
    const rate = setInterval(() => { if (client) client.msgs = 0; }, 1000);
    ws.on('message', (raw) => {
      let msg: ClientMsg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (client && ++client.msgs > 200) return; // limite de mensagens/s
      switch (msg.t) {
        case 'list':
          send(ws, { t: 'rooms', rooms: [...rooms.values()].map((r) => ({ name: r.name, players: r.match.players.size, humans: r.humans(), max: MAX_PER_ROOM })) });
          break;
        case 'join': {
          if (client) return;
          const name = String(msg.room ?? 'publica').replace(/[^\w\- ]/g, '').slice(0, 24) || 'publica';
          let room = rooms.get(name);
          if (!room) {
            if (rooms.size >= MAX_ROOMS) { send(ws, { t: 'error', msg: 'Servidor cheio' }); return; }
            room = new Room(name, Number(msg.bots ?? 5), Number(msg.diff ?? 1));
            rooms.set(name, room);
          }
          if (room.humans() >= MAX_PER_ROOM) { send(ws, { t: 'error', msg: 'Sala cheia' }); return; }
          const pname = String(msg.name ?? 'Jogador').replace(/[<>]/g, '').slice(0, 16) || 'Jogador';
          client = room.join(ws, pname);
          send(ws, { t: 'welcome', id: client.id, room: name });
          break;
        }
        case 'cmd':
          if (!client || !Array.isArray(msg.c)) return;
          for (const c of msg.c.slice(0, 12)) client.room.match.queueCmd(client.id, c);
          break;
        case 'buy':
          if (client && validItems.has(msg.item)) client.room.match.buy(client.id, msg.item);
          break;
        case 'team':
          if (client && (msg.team === 'T' || msg.team === 'CT')) client.room.match.setTeam(client.id, msg.team);
          break;
        case 'ping': {
          send(ws, { t: 'pong', ts: msg.ts });
          const p = client ? client.room.match.players.get(client.id) : undefined;
          if (p && typeof msg.rtt === 'number') p.ping = Math.max(0, Math.min(999, Math.round(msg.rtt)));
          break;
        }
        default: break;
      }
    });
    ws.on('close', () => { clearInterval(rate); if (client) client.room.leave(client); client = null; });
    ws.on('error', () => ws.close());
  });
  return wss;
}
