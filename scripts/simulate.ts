// Simula partidas completas só com bots (sem render) para validar regras, economia, C4 e IA.
// Uso: npm run sim -- [rounds] [dificuldade]
import { Match } from '../src/shared/match';
import type { GameEvent } from '../src/shared/protocol';

const rounds = Number(process.argv[2] ?? 8);
const diff = Number(process.argv[3] ?? 2);
const m = new Match({ botsPerTeam: 5, difficulty: diff, maxRounds: rounds, freezeTime: 2 });
const reasons: Record<string, number> = {};
const killW: Record<string, number> = {};
let plants = 0, defuses = 0, kills = 0, hs = 0, nades = 0, wallbangs = 0, done = false;
const orig = m.broadcast.bind(m);
m.broadcast = (e: GameEvent) => {
  orig(e);
  if (e.e === 'roundEnd') { reasons[e.reason] = (reasons[e.reason] ?? 0) + 1; console.log(`round ${m.round}: ${e.win} venceu (${e.reason})  T ${m.score.T} x ${m.score.CT} CT  t=${m.time.toFixed(0)}s`); }
  if (e.e === 'planted') plants++;
  if (e.e === 'defused') defuses++;
  if (e.e === 'kill') { kills++; killW[e.w] = (killW[e.w] ?? 0) + 1; if (e.hs) hs++; if (e.wb) wallbangs++; }
  if (e.e === 'throw') nades++;
  if (e.e === 'matchEnd') { console.log('FIM DE PARTIDA:', e.win); done = true; }
};
m.start();
const t0 = Date.now();
let ticks = 0;
while (!done && ticks < 64 * 60 * 60) { m.tick(); ticks++; }
const ms = Date.now() - t0;
console.log({ reasons, plants, defuses, kills, hs, nades, wallbangs, killW });
console.log(`simulados ${(ticks / 64).toFixed(0)}s de jogo em ${ms}ms (${((ticks / ms) * 1000 / 64).toFixed(0)}x tempo real)`);
console.log([...m.players.values()].map((p) => `${p.name}[${p.team}] $${p.money} ${p.kills}/${p.deaths}`).join(' | '));
