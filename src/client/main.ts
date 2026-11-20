import './style.css';
import { GameAudio } from './audio';
import { createCrosshairEditor } from './crosshairEditor';
import { Game } from './game';
import { openHudEditor } from './hud/hudEditor';
import { isTouch, requestGyroPermission } from './input/input';
import { LocalConnection, WsConnection, defaultServerUrl, listRooms } from './net';
import { type Settings, loadSettings, saveSettings } from './settings';

const settings: Settings = loadSettings();
const audio = new GameAudio();
audio.volume = settings.volume;
let game: Game | null = null;

const app = document.getElementById('app')!;
const menu = document.getElementById('menu')!;

const TITLES: Record<string, string> = { 'scr-main': 'Início', 'scr-play': 'Jogar', 'scr-crosshair': 'Mira', 'scr-settings': 'Configurações', 'scr-loading': '' };
let current = 'scr-main';
let xhBack = 'scr-main';

function show(id: string) {
  if (id === 'scr-crosshair' && current !== 'scr-crosshair') xhBack = current === 'scr-settings' ? 'scr-settings' : 'scr-main';
  current = id;
  if (id === 'scr-crosshair') xhEditor.show(); else xhEditor.hide();
  menu.querySelectorAll<HTMLElement>('.screen').forEach((s) => s.classList.toggle('on', s.id === id));
  menu.querySelectorAll<HTMLElement>('.rail [data-go]').forEach((b) => b.classList.toggle('on', b.dataset.go === id));
  const t = menu.querySelector('.tb-title');
  if (t) t.textContent = TITLES[id] ?? '';
  const nm = menu.querySelector('.tb-name');
  if (nm) nm.textContent = settings.name || 'Jogador';
  fillSettings();
  menu.classList.add('on');
}

function esc(s: string) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); }

const row = (label: string, control: string) => `<label class="srow"><span>${label}</span><div class="sctl">${control}</div></label>`;
const range = (k: string, min: number, max: number, step: number) => `<input data-k="${k}" type="range" min="${min}" max="${max}" step="${step}"><output></output>`;
const check = (k: string) => `<input data-k="${k}" type="checkbox" class="tgl">`;
const DIFF = '<option value="0">Fácil</option><option value="1">Normal</option><option value="2">Difícil</option><option value="3">Expert</option>';
const ROUNDS = '<option value="8">8 (rápida)</option><option value="16">16</option><option value="24">24 (MR12)</option>';

menu.innerHTML = `
<nav class="rail">
  <div class="rail-logo" title="Ebrashot">E<span>S</span></div>
  <button class="rail-btn" data-go="scr-main" title="Início"><b>⌂</b><small>Início</small></button>
  <button class="rail-btn" data-go="scr-play" title="Jogar"><b>▶</b><small>Jogar</small></button>
  <button class="rail-btn" data-go="scr-crosshair" title="Mira"><b>⌖</b><small>Mira</small></button>
  <button class="rail-btn" data-go="hud" title="Editor de HUD"><b>✥</b><small>HUD</small></button>
  <button class="rail-btn" data-go="scr-settings" title="Configurações"><b>⚙</b><small>Config</small></button>
</nav>
<header class="topbar">
  <div class="tb-title">Início</div>
  <div class="tb-player"><span class="tb-name"></span><span class="tb-avatar">☺</span></div>
</header>
<div class="screens">
<section class="screen on" id="scr-main">
  <div class="home">
    <div class="hero">
      <div class="logo">EBRA<span>SHOT</span></div>
      <div class="subtitle">FPS tático low poly · Defuse · 5v5</div>
    </div>
    <div class="cards">
      <div class="card feature">
        <div class="card-tag">Mapa em destaque</div>
        <div class="map-art"><i></i><i></i><i></i><i></i></div>
        <div class="card-body"><b>Sahel</b><span>Bombsites A e B, meio, túnel e passarela.</span></div>
      </div>
      <div class="card">
        <div class="card-tag">Controles · PC</div>
        <ul class="keys">
          <li><kbd>WASD</kbd> mover</li><li><kbd>B</kbd> loja</li><li><kbd>Tab</kbd> placar</li>
          <li><kbd>E</kbd> plantar / desarmar</li><li><kbd>G</kbd> dropar</li><li><kbd>Esc</kbd> menu</li>
        </ul>
      </div>
      <div class="card">
        <div class="card-tag">Mobile</div>
        <div class="card-body"><span>Joystick dinâmico, botão de tiro que também mira e HUD totalmente editável.</span>
        <button class="ghost" data-go="hud">Abrir editor de HUD</button></div>
      </div>
    </div>
  </div>
  <button class="go-btn" data-go="scr-play">JOGAR</button>
</section>

<section class="screen" id="scr-play">
  <div class="play">
    <div class="tabs">
      <button class="tab on" data-tab="off">Offline · Bots</button>
      <button class="tab" data-tab="on">Multiplayer Online</button>
    </div>
    <div class="tabpane on" data-pane="off">
      <div class="play-grid">
        <div class="map-tile sel">
          <div class="map-art"><i></i><i></i><i></i><i></i></div>
          <div class="mt-name"><b>Sahel</b><small>Defuse</small></div>
          <span class="mt-check">✔</span>
        </div>
        <div class="opts">
          ${row('Dificuldade dos bots', `<select data-k="difficulty">${DIFF}</select>`)}
          ${row('Jogadores por time', range('botsPerTeam', 1, 5, 1))}
          ${row('Rounds da partida', `<select data-k="maxRounds">${ROUNDS}</select>`)}
        </div>
      </div>
    </div>
    <div class="tabpane" data-pane="on">
      <div class="opts">
        ${row('Seu nome', '<input id="mp-name" maxlength="16">')}
        ${row('Servidor', '<input id="mp-url">')}
        ${row('Sala', '<input id="mp-room" maxlength="24" value="publica">')}
      </div>
      <div class="room-head"><span>Salas ativas</span><button id="mp-refresh" class="ghost">⟳ Atualizar</button></div>
      <div id="mp-rooms" class="rooms"></div>
      <p id="mp-status" class="muted">Salas vazias são completadas com bots. Humanos substituem bots ao entrar.</p>
    </div>
  </div>
  <button class="go-btn" id="play-go">JOGAR</button>
</section>

<section class="screen" id="scr-settings">
  <div class="settings">
    <div class="sgroup"><h3>Jogo</h3>
      ${row('Nome', '<input data-k="name" type="text" maxlength="16">')}
      ${row('Dificuldade dos bots', `<select data-k="difficulty">${DIFF}</select>`)}
      ${row('Jogadores por time (com bots)', range('botsPerTeam', 1, 5, 1))}
      ${row('Rounds da partida', `<select data-k="maxRounds">${ROUNDS}</select>`)}
    </div>
    <div class="sgroup"><h3>Mouse e mira</h3>
      ${row('Sensibilidade do mouse', range('sens', 0.2, 8, 0.05))}
      ${row('Inverter eixo Y', check('invertY'))}
      ${row('Mira (estilo, tamanho, cor, contorno...)', '<button type="button" class="ghost xh-open" data-go="scr-crosshair">⌖ Personalizar mira</button>')}
      ${row('Campo de visão (FOV)', range('fov', 60, 95, 1))}
    </div>
    <div class="sgroup"><h3>Vídeo e áudio</h3>
      ${row('Qualidade gráfica', '<select data-k="quality"><option value="auto">Automática (DPR dinâmico)</option><option value="low">Baixa</option><option value="high">Alta</option></select>')}
      ${row('Mostrar FPS', check('showFps'))}
      ${row('Volume', range('volume', 0, 1, 0.05))}
    </div>
    <div class="sgroup"><h3>Mobile</h3>
      ${row('Simular controles mobile no PC', check('forceMobile'))}
      ${row('Sensibilidade do toque', range('touchSens', 0.2, 3, 0.05))}
      ${row('Tiro automático (Auto-Fire)', check('autoFire'))}
      ${row('Atraso do Auto-Fire (ms)', range('autoFireDelay', 0, 500, 10))}
      ${row('Giroscópio (mira fina)', check('gyro'))}
      ${row('Sensibilidade do giroscópio', range('gyroSens', 0.2, 3, 0.05))}
      ${row('Inverter giroscópio', check('gyroInvert'))}
    </div>
  </div>
  <button class="go-btn alt" id="set-back">SALVAR E VOLTAR</button>
</section>
<section class="screen" id="scr-crosshair"><div class="xh-root"></div><button class="go-btn alt" id="xh-back">VOLTAR</button></section>
<section class="screen" id="scr-loading"><div class="settings"><h2 id="load-msg">Carregando...</h2></div></section>
</div>
`;

// ----------------------------------------------------------- mira
const xhEditor = createCrosshairEditor(menu.querySelector('.xh-root') as HTMLElement, () => settings.xh, (c) => { settings.xh = c; saveSettings(settings); });
document.getElementById('xh-back')!.onclick = () => { audio.ui('click'); show(xhBack); };

// ----------------------------------------------------------- navegação
let settingsDone: (() => void) | null = null;
let playTab: 'off' | 'on' = 'off';
menu.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest('[data-tab]') as HTMLElement | null;
  if (t) { setTab(t.dataset.tab as 'off' | 'on'); audio.ui('click'); return; }
  const b = (e.target as HTMLElement).closest('[data-go]') as HTMLElement | null;
  if (!b) return;
  // configurações abertas durante a partida: só dá para ir à mira e voltar
  if (settingsDone && b.dataset.go !== 'scr-crosshair') return;
  audio.init(isTouch() || settings.forceMobile);
  audio.ui('click');
  const go = b.dataset.go!;
  if (go === 'hud') { menu.classList.remove('on'); openHudEditor(() => show('scr-main')); }
  else if (go === 'scr-play') { if (playTab === 'on') fillOnline(); show(go); }
  else show(go);
});

function setTab(tab: 'off' | 'on') {
  playTab = tab;
  menu.querySelectorAll<HTMLElement>('[data-tab]').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
  menu.querySelectorAll<HTMLElement>('[data-pane]').forEach((x) => x.classList.toggle('on', x.dataset.pane === tab));
  (document.getElementById('play-go') as HTMLButtonElement).textContent = tab === 'off' ? 'JOGAR' : 'ENTRAR NA SALA';
  if (tab === 'on') fillOnline();
}

document.getElementById('play-go')!.onclick = () => {
  audio.init(isTouch() || settings.forceMobile);
  audio.ui('click');
  if (playTab === 'off') startOffline(); else void joinOnline();
};

// ----------------------------------------------------------- configurações
function fillSettings() {
  menu.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((inp) => {
    const k = inp.dataset.k as keyof Settings;
    const v = settings[k];
    if (inp instanceof HTMLInputElement && inp.type === 'checkbox') inp.checked = !!v;
    else inp.value = String(v);
    const out = inp.parentElement?.querySelector('output');
    if (out) out.textContent = String(v);
    inp.oninput = inp.onchange = async () => {
      let val: unknown;
      if (inp instanceof HTMLInputElement && inp.type === 'checkbox') val = inp.checked;
      else if (inp instanceof HTMLInputElement && inp.type === 'range') val = Number(inp.value);
      else if (k === 'difficulty' || k === 'maxRounds') val = Number(inp.value);
      else val = inp.value;
      (settings as any)[k] = val;
      if (out) out.textContent = String(val);
      if (k === 'gyro' && val === true) {
        const ok = await requestGyroPermission();
        if (!ok) { settings.gyro = false; (inp as HTMLInputElement).checked = false; alert('Giroscópio não disponível ou permissão negada.'); }
        else game?.input.enableGyro();
      }
      if (k === 'volume') audio.setVolume(settings.volume);
      saveSettings(settings);
    };
  });
}
document.getElementById('set-back')!.onclick = () => {
  saveSettings(settings);
  if (settingsDone) { const d = settingsDone; settingsDone = null; menu.classList.remove('on', 'ingame'); d(); }
  else show('scr-main');
};

function openSettingsInGame(done: () => void) {
  settingsDone = done;
  menu.classList.add('ingame');
  show('scr-settings');
}

// ----------------------------------------------------------- partida
async function enterFullscreen() {
  if (!(isTouch() || settings.forceMobile)) return;
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' } as FullscreenOptions);
    await (screen.orientation as any)?.lock?.('landscape');
  } catch { /* opcional */ }
}

function startOffline() {
  void enterFullscreen();
  const conn = new LocalConnection(settings.name || 'Jogador', { bots: settings.botsPerTeam, difficulty: settings.difficulty, maxRounds: settings.maxRounds });
  launch(conn);
}

function launch(conn: LocalConnection | WsConnection) {
  (window as any).__ebrashot = () => game;
  menu.classList.remove('on');
  game = new Game(app, {
    settings, conn, audio,
    onExit: (reason) => { game = null; settingsDone = null; menu.classList.remove('ingame'); show('scr-main'); if (reason) alert(reason); },
    onOpenSettings: openSettingsInGame,
  });
}

function fillOnline() {
  const name = document.getElementById('mp-name') as HTMLInputElement;
  const url = document.getElementById('mp-url') as HTMLInputElement;
  name.value = settings.name;
  if (!url.value) url.value = defaultServerUrl();
  void refreshRooms();
}

async function refreshRooms() {
  const url = (document.getElementById('mp-url') as HTMLInputElement).value;
  const box = document.getElementById('mp-rooms')!;
  const status = document.getElementById('mp-status')!;
  box.innerHTML = '<p class="muted">Buscando salas...</p>';
  try {
    const rooms = await listRooms(url);
    box.innerHTML = rooms.length
      ? rooms.map((r) => `<button class="room" data-room="${esc(r.name)}"><b>${esc(r.name)}</b><span>${r.humans} humanos · ${r.players}/${r.max}</span></button>`).join('')
      : '<p class="muted">Nenhuma sala ativa. Crie uma!</p>';
    box.querySelectorAll<HTMLButtonElement>('.room').forEach((b) => {
      b.onclick = () => { (document.getElementById('mp-room') as HTMLInputElement).value = b.dataset.room!; void joinOnline(); };
    });
    status.textContent = 'Servidor online.';
  } catch (err) {
    box.innerHTML = '';
    status.textContent = `Servidor indisponível (${(err as Error).message}). Rode "npm run dev" ou "npm start" para hospedar.`;
  }
}

async function joinOnline() {
  const name = (document.getElementById('mp-name') as HTMLInputElement).value.trim() || 'Jogador';
  const url = (document.getElementById('mp-url') as HTMLInputElement).value.trim();
  const room = (document.getElementById('mp-room') as HTMLInputElement).value.trim() || 'publica';
  settings.name = name; saveSettings(settings);
  const status = document.getElementById('mp-status')!;
  status.textContent = 'Conectando...';
  try {
    void enterFullscreen();
    const conn = await WsConnection.connect(url, room, name, settings.botsPerTeam, settings.difficulty);
    launch(conn);
  } catch (err) {
    status.textContent = (err as Error).message;
  }
}
document.getElementById('mp-refresh')!.onclick = () => void refreshRooms();

// atalho: ?play=offline inicia direto (útil para testes)
show('scr-main');
if (new URLSearchParams(location.search).get('play') === 'offline') startOffline();
