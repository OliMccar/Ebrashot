// Teste de multiplayer: dois clientes WebSocket na mesma sala.
// Uso: com o servidor rodando (npm start ou npm run dev), execute: npm run test:mp
// Para outra porta: WS_URL=ws://localhost:5173/ws npm run test:mp
import WebSocket from 'ws';
const URL = process.env.WS_URL ?? 'ws://localhost:3000/ws';
function client(name: string): Promise<{ ws: WebSocket; id: number; snaps: any[] }> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(URL);
    const snaps: any[] = [];
    let id = 0;
    ws.on('open', () => ws.send(JSON.stringify({ t: 'join', room: 'teste', name, bots: 5, diff: 1 })));
    ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      if (m.t === 'welcome') { id = m.id; res({ ws, id, snaps }); }
      if (m.t === 'snap') snaps.push(m.s);
      if (m.t === 'error') rej(new Error(m.msg));
    });
    ws.on('error', rej);
  });
}
(async () => {
  const a = await client('Alice');
  const b = await client('Bruno');
  console.log('ids', a.id, b.id);
  await new Promise((r) => setTimeout(r, 1500));
  const last = a.snaps[a.snaps.length - 1];
  const humans = last.players.filter((p: any) => !p.bot).map((p: any) => `${p.n}:${p.tm}`);
  console.log('snapshots recebidos A:', a.snaps.length, 'B:', b.snaps.length, '(~21/s esperado)');
  console.log('jogadores', last.players.length, 'humanos', humans.join(','), 'fase', last.round.phase);
  // espera fim do freeze e anda para frente com A
  await new Promise((r) => setTimeout(r, 7000));
  const before = a.snaps[a.snaps.length - 1].me.st.pos;
  let seq = 1;
  const yaw = a.snaps[a.snaps.length - 1].me.st.yaw;
  const timer = setInterval(() => {
    const c = [0, 1].map(() => ({ seq: seq++, yaw, pitch: 0, mx: 0, mz: 1, btn: 0, wpn: '', rt: 0, as: false }));
    a.ws.send(JSON.stringify({ t: 'cmd', c }));
  }, 1000 / 32);
  await new Promise((r) => setTimeout(r, 1500));
  clearInterval(timer);
  await new Promise((r) => setTimeout(r, 300));
  const sA = a.snaps[a.snaps.length - 1];
  console.log('A antes', before, 'depois', sA.me.st.pos, 'ack', sA.ack, 'de', seq - 1);
  const seenByB = b.snaps[b.snaps.length - 1].players.find((p: any) => p.id === a.id);
  console.log('B vê A em', seenByB.x, seenByB.z);
  a.ws.send(JSON.stringify({ t: 'list' }));
  a.ws.close(); b.ws.close();
  setTimeout(() => process.exit(0), 300);
})().catch((e) => { console.error('ERRO', e); process.exit(1); });
