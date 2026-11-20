# Ebrashot

FPS tático 3D low poly para navegador, no modo Defuse (C4) com economia por rounds. Roda em PC e celular. Tem modo offline contra bots e multiplayer com servidor autoritativo. Todos os modelos (mapa, armas, personagens) e todos os sons são gerados por código, sem nenhum asset externo.

## Como rodar

```bash
npm install
npm run dev
```

Abra `http://localhost:5173` e clique em **Jogar Offline (vs Bots)**. O `npm run dev` também sobe o servidor multiplayer na mesma porta (WebSocket em `/ws`). Pelo celular na mesma rede Wi-Fi, use o endereço "Network" que o Vite mostra no terminal.

Produção (build estático + servidor de jogo numa porta só):

```bash
npm run build
npm start
```

O servidor sobe em `http://localhost:3000` (a porta muda com `PORT=8080 npm start`).

Outros scripts:

- `npm run sim -- 8 2` simula sem render uma partida de 8 rounds só com bots (dificuldade 2) e imprime placar, plantios, desarmes e kills.
- `npm run test:mp` conecta dois clientes WebSocket num servidor já rodando e verifica sincronização, ack de comandos e replicação.
- `npm run typecheck` roda só a verificação de tipos.

## Controles

**PC:** clique para travar o mouse. WASD move, Espaço pula, Ctrl ou C agacha, Shift anda em silêncio, 1 a 5 ou a roda do mouse trocam de arma (o 4 alterna entre as granadas), Q volta para a última arma, R recarrega, G dropa a arma, E planta, desarma ou pega arma, B abre a loja, F inspeciona, Tab mostra o placar e Esc abre o menu. Botão direito: luneta da AWP, ataque pesado da faca ou granada curta.

**Mobile (estilo Standoff 2):**

- O joystick esquerdo é dinâmico. A zona interna anda em silêncio e a borda corre.
- O botão de tiro também mira: segure e arraste o mesmo dedo.
- Há botões para pular, agachar, luneta, recarregar, usar, granada, loja, placar, dropar, inspecionar e menu, além de uma barra de armas.
- O Auto-Fire (opcional, com atraso configurável em ms) e o giroscópio (opcional) ficam nas Configurações.
- O **Editor de HUD** permite arrastar, redimensionar e mudar a opacidade de cada botão. O layout fica salvo no `localStorage`.
- Em Configurações, a opção **"Simular Controles Mobile no PC"** testa o HUD touch usando o mouse.

## Arquitetura

```
src/shared/   simulação determinística compartilhada por cliente, servidor e bots
  player.ts     movimento estilo Source (aceleração, atrito, air-strafe, step-up, agachar), armas, spray, hitboxes
  match.ts      partida autoritativa: rounds, economia, C4, granadas, dano, wallbang, lag compensation, snapshots
  bot.ts        IA: compra por saldo, navegação A* em waypoints, plant/defuse, mira com reação/erro, controle de spray
  map.ts        mapa original "Sahel" (Bombsites A/B, meio, túnel, passarela) descrito como dados
  world.ts      colisão AABB com broadphase, raycast e segmentos para penetração
src/client/   Three.js: render, viewmodel procedural, efeitos com pooling, HUD em DOM, entrada, áudio Web Audio
server/       WebSocket (ws): salas, loop de 64 ticks, snapshots a ~21 Hz, validação e limite de mensagens
```

- **Uma única fonte de verdade.** O modo offline roda a mesma classe `Match` do servidor dentro do navegador. Bots e humanos geram o mesmo `Cmd` (mover, olhar, atirar, recarregar, trocar de arma, usar).
- **Netcode.** O cliente faz predição local e, a cada snapshot, reconcilia com o estado do servidor e reaplica os comandos que ainda não foram confirmados. Os outros jogadores são interpolados com um atraso de cerca de 110 ms. O servidor compensa o lag do hitscan voltando as hitboxes até o tick que o atirador estava vendo. O spread usa um RNG com seed, então cliente e servidor calculam o mesmo desvio.
- **Performance.** Cada arma e cada parte de personagem é uma geometria mesclada com cores por vértice, e o mapa inteiro é um único draw call. Decals e partículas usam `InstancedMesh`, e traçantes, fumaça e fogo vêm de pools. O DPR se ajusta sozinho conforme o tempo de frame. Não há sombras em tempo real: a iluminação é hemisférica + direcional, com AO falso nos vértices.

## Limitações conhecidas

- O alvo de 60 FPS **não foi medido em celular real**. Os testes automatizados rodaram com renderização por software. O jogo baixa o DPR sozinho quando o frame passa de ~19 ms.
- O protocolo de rede usa JSON. Funciona bem para salas de 10 jogadores, mas um protocolo binário reduziria a banda se for necessário escalar.
- O Auto-Fire é calculado no cliente. Em salas online ele funciona, na prática, como um trigger-bot liberado para quem estiver no modo mobile.
- O anti-cheat é básico: comandos sanitizados, limite de comandos por tick e de mensagens por segundo, e validação de compra e de dano no servidor.
