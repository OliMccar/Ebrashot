import './style.css';
import { GameAudio } from './audio';
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

function show(id: string) {
  menu.querySelectorAll<HTMLElement>('.screen').forEach((s) => s.classList.toggle('on', s.id === id));
  menu.classList.add('on');
}

function esc(s: string) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); }

menu.innerHTML = `
<section class="screen on" id="scr-main">
  <div class="logo">EBRA<span>SHOT</span></div>
  <div class="subtitle">FPS tático low poly · Defuse · 5v5</div>
  <div class="main-buttons">
    <button class="big primary" data-go="offline">▶ Jogar Offline (vs Bots)</button>
    <button class="big" data-go="scr-online">🌐 Multiplayer Online</button>
    <button class="big" data-go="hud">✥ Editor de HUD (Mobile)</button>
    <button class="big" data-go="scr-settings">⚙ Configurações</button>
  </div>
  <div class="foot">Mapa: <b>Sahel</b> · PC: WASD, Mouse, B loja, Tab placar · Mobile: estilo Standoff</div>
</section>
<section class="screen" id="scr-online">
  <div class="panel wide">
    <h2>Multiplayer Online</h2>
    <label>Seu nome <input id="mp-name" maxlength="16"></label>
    <label>Servidor <input id="mp-url"></label>
    <label>Sala <input id="mp-room" maxlength="24" value="publica"></label>
    <div class="row"><button id="mp-refresh">Atualizar salas</button><button id="mp-join" class="primary">Entrar / Criar sala</button></div>
    <div id="mp-rooms" class="rooms"></div>
    <p id="mp-status" class="muted">Salas vazias são completadas com bots. Humanos substituem bots ao entrar.</p>
    <button data-go="scr-main">← Voltar</button>
  </div>
</section>
<section class="screen" id="scr-settings">
  <div class="panel wide settings">
    <h2>Configurações</h2>
    <div class="grid">
      <label>Nome <input data-k="name" type="text" maxlength="16"></label>
      <label>Sensibilidade do mouse <input data-k="sens" type="range" min="0.2" max="8" step="0.05"><output></output></label>
      <label>Sensibilidade do toque <input data-k="touchSens" type="range" min="0.2" max="3" step="0.05"><output></output></label>
      <label>Campo de visão (FOV) <input data-k="fov" type="range" min="60" max="95" step="1"><output></output></label>
      <label>Volume <input data-k="volume" type="range" min="0" max="1" step="0.05"><output></output></label>
      <label class="chk"><input data-k="forceMobile" type="checkbox"> Simular Controles Mobile no PC</label>
      <label class="chk"><input data-k="autoFire" type="checkbox"> Tiro Automático (Auto-Fire, modo mobile)</label>
      <label>Atraso do Auto-Fire (ms) <input data-k="autoFireDelay" type="range" min="0" max="500" step="10"><output></output></label>
      <label class="chk"><input data-k="gyro" type="checkbox"> Giroscópio (mira fina)</label>
      <label>Sensibilidade do giroscópio <input data-k="gyroSens" type="range" min="0.2" max="3" step="0.05"><output></output></label>
      <label class="chk"><input data-k="gyroInvert" type="checkbox"> Inverter giroscópio</label>
      <label class="chk"><input data-k="invertY" type="checkbox"> Inverter eixo Y</label>
      <label>Dificuldade dos bots <select data-k="difficulty"><option value="0">Fácil</option><option value="1">Normal</option><option value="2">Difícil</option><option value="3">Expert</option></select></label>
      <label>Jogadores por time (com bots) <input data-k="botsPerTeam" type="range" min="1" max="5" step="1"><output></output></label>
      <label>Rounds da partida <select data-k="maxRounds"><option value="8">8 (rápida)</option><option value="16">16</option><option value="24">24 (MR12)</option></select></label>
      <label>Qualidade gráfica <select data-k="quality"><option value="auto">Automática (DPR dinâmico)</option><option value="low">Baixa</option><option value="high">Alta</option></select></label>
      <label class="chk"><input data-k="showFps" type="checkbox"> Mostrar FPS</label>
      <label>Cor da mira <input data-k="crosshairColor" type="color"></label>
    </div>
    <div class="row"><button id="set-back" class="primary">Salvar e voltar</button></div>
  </div>
</section>
<section class="screen" id="scr-loading"><div class="panel"><h2 id="load-msg">Carregando...</h2></div></section>
`;

// ----------------------------------------------------------- navegação
let settingsDone: (() => void) | null = null;
menu.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('[data-go]') as HTMLElement | null;
  if (!b) return;
  audio.init(isTouch() || settings.forceMobile);
  audio.ui('click');
  const go = b.dataset.go!;
  if (go === 'offline') startOffline();
  else if (go === 'hud') { menu.classList.remove('on'); openHudEditor(() => show('scr-main')); }
  else if (go === 'scr-settings') { settingsDone = null; fillSettings(); show(go); }
  else if (go === 'scr-online') { fillOnline(); show(go); }
  else show(go);
});

// ----------------------------------------------------------- configurações
function fillSettings() {
  menu.querySelectorAll<HTMLInputElement | HTMLSelectElement>('#scr-settings [data-k]').forEach((inp) => {
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
  if (settingsDone) { const d = settingsDone; settingsDone = null; menu.classList.remove('on'); d(); }
  else show('scr-main');
};

function openSettingsInGame(done: () => void) {
  settingsDone = done;
  fillSettings();
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
    onExit: (reason) => { game = null; show('scr-main'); if (reason) alert(reason); },
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
document.getElementById('mp-join')!.onclick = () => { audio.init(isTouch()); void joinOnline(); };

// atalho: ?play=offline inicia direto (útil para testes)
if (new URLSearchParams(location.search).get('play') === 'offline') startOffline();
