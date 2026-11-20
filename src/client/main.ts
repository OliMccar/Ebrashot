import './style.css';
import { GameAudio } from './audio';
import { createCrosshairEditor } from './crosshairEditor';
import { Game } from './game';
import { openHudEditor } from './hud/hudEditor';
import { isTouch, requestGyroPermission } from './input/input';
import { MenuScene } from './menuScene';
import { LocalConnection, WsConnection, defaultServerUrl, listRooms } from './net';
import type { Team } from '../shared/constants';
import { SHOP, type WeaponId, WEAPONS } from '../shared/weapons';
import { type GfxPreset, GFX_CORE_KEYS, type Settings, applyGfxPreset, loadSettings, saveSettings } from './settings';

const settings: Settings = loadSettings();
const audio = new GameAudio();
const syncAudio = () => audio.setMix({ master: settings.volume, sfx: settings.volSfx, ui: settings.volUi, music: settings.volMusic, ambience: settings.volAmb, hrtf: settings.hrtf });
syncAudio();
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
  menu.querySelectorAll<HTMLElement>('.topnav [data-go]').forEach((b) => b.classList.toggle('on', b.dataset.go === id));
  menu.dataset.screen = id;
  const t = menu.querySelector('.tb-title');
  if (t) t.textContent = TITLES[id] ?? '';
  const nm = menu.querySelector('.tb-name');
  if (nm) nm.textContent = settings.name || 'Jogador';
  fillSettings();
  menu.classList.add('on');
  syncScene();
}

// ----------------------------------------------------------- personagem 3D do menu
/** Todas as armas de fogo que o time pode comprar (rifles primeiro), mais a faca. */
const agentList = (t: Team): WeaponId[] => {
  const order = ['rifle', 'sniper', 'smg', 'shotgun', 'lmg', 'pistol'];
  const guns = SHOP.filter((s) => s.id in WEAPONS && (!s.team || s.team === t)).map((s) => s.id as WeaponId)
    .filter((id) => order.includes(WEAPONS[id].cls))
    .sort((a, b) => order.indexOf(WEAPONS[a].cls) - order.indexOf(WEAPONS[b].cls));
  const lead: WeaponId = t === 'T' ? 'ak47' : 'm4a1';
  return [lead, ...guns.filter((g) => g !== lead), 'knife'];
};
const AGENT_WEAPONS: Record<Team, WeaponId[]> = { T: agentList('T'), CT: agentList('CT') };
const SWAP: Partial<Record<WeaponId, WeaponId>> = { ak47: 'm4a1', m4a1: 'ak47', glock: 'usp', usp: 'glock' };
let menuScene: MenuScene | null = null;
let sceneFailed = false;

/** Liga a cena 3D só quando o menu principal está à mostra (nunca durante a partida). */
function syncScene() {
  const want = menu.classList.contains('on') && !menu.classList.contains('ingame') && !game;
  if (want && !menuScene && !sceneFailed) {
    try { menuScene = new MenuScene(document.getElementById('menu-3d') as HTMLCanvasElement, settings); }
    catch { sceneFailed = true; menu.classList.add('no3d'); }
  }
  if (!menuScene) return;
  if (want) { applyAgent(); menuScene.start(); } else menuScene.stop();
}

function applyAgent() {
  const team = settings.menuTeam;
  if (!AGENT_WEAPONS[team].includes(settings.menuWeapon)) settings.menuWeapon = SWAP[settings.menuWeapon] ?? AGENT_WEAPONS[team][0];
  menuScene?.setLook(team, settings.menuWeapon);
  menu.querySelectorAll<HTMLElement>('[data-agent]').forEach((b) => b.classList.toggle('on', b.dataset.agent === team));
  const wn = menu.querySelector('.ag-wname');
  if (wn) wn.textContent = WEAPONS[settings.menuWeapon].name;
  const tn = menu.querySelector('.ag-team');
  if (tn) tn.textContent = team === 'T' ? 'Terrorista' : 'Contra-Terrorista';
  menu.querySelector('.agent')?.setAttribute('data-team', team);
}

function esc(s: string) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); }

const row = (label: string, control: string) => `<label class="srow"><span>${label}</span><div class="sctl">${control}</div></label>`;
const range = (k: string, min: number, max: number, step: number, fmt = '') => `<input data-k="${k}" type="range" min="${min}" max="${max}" step="${step}"${fmt ? ` data-fmt="${fmt}"` : ''}><output></output>`;
const sel = (k: string, opts: [string | number, string][]) => `<select data-k="${k}">${opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`;
const L3: [string, string][] = [['low', 'Baixa'], ['medium', 'Média'], ['high', 'Alta']];
/** Opções que só valem a partir da próxima partida. */
const NEXT = '<i class="next" title="Aplicado na próxima partida">*</i>';
function fmtVal(inp: Element, v: unknown) {
  const f = (inp as HTMLElement).dataset.fmt;
  if (f === 'pct') return `${Math.round(Number(v) * 100)}%`;
  if (f === 'fps') return Number(v) === 0 ? 'Sem limite' : `${v}`;
  return String(v);
}
const check = (k: string) => `<input data-k="${k}" type="checkbox" class="tgl">`;
const DIFF = '<option value="0">Fácil</option><option value="1">Normal</option><option value="2">Difícil</option><option value="3">Expert</option>';
const ROUNDS = '<option value="8">8 (rápida)</option><option value="16">16</option><option value="24">24 (MR12)</option>';

menu.innerHTML = `
<canvas id="menu-3d" class="menu-3d"></canvas>
<div class="menu-shade"></div>
<header class="topnav">
  <div class="tn-logo">EBRA<span>SHOT</span></div>
  <button class="tn-play" data-go="scr-play"><b>▶</b> JOGAR</button>
  <nav class="tn-tabs">
    <button data-go="scr-main"><b>⌂</b><span>Início</span></button>
    <button data-go="scr-crosshair"><b>⌖</b><span>Mira</span></button>
    <button data-go="hud"><b>✥</b><span>HUD</span></button>
    <button data-go="scr-settings"><b>⚙</b><span>Configurações</span></button>
  </nav>
  <div class="tn-right"><span class="tb-title"></span><span class="tb-name"></span><span class="tb-avatar">☺</span></div>
</header>
<div class="screens">
<section class="screen on" id="scr-main">
  <div class="home">
    <div class="news">
      <div class="news-head">Novidades</div>
      <div class="card feature">
        <div class="map-art"><i></i><i></i><i></i><i></i></div>
        <div class="card-body"><small class="card-tag-in">Mapa em destaque</small><b>Sahel</b><span>Bombsites A e B, meio, túnel e passarela. Defuse 5v5 com economia por rounds.</span></div>
      </div>
      <div class="card">
        <div class="card-body"><small class="card-tag-in">Controles · PC</small></div>
        <ul class="keys">
          <li><kbd>WASD</kbd> mover</li><li><kbd>B</kbd> loja</li><li><kbd>Tab</kbd> placar</li>
          <li><kbd>E</kbd> plantar / desarmar</li><li><kbd>G</kbd> dropar</li><li><kbd>Esc</kbd> menu</li>
        </ul>
      </div>
      <div class="card">
        <div class="card-body"><small class="card-tag-in">Mobile</small><span>Joystick dinâmico, botão de tiro que também mira e HUD totalmente editável.</span>
        <button class="ghost" data-go="hud">Abrir editor de HUD</button></div>
      </div>
    </div>
    <div class="agent" data-team="T">
      <div class="ag-head"><small>Seu personagem</small><b class="ag-team">Terrorista</b></div>
      <div class="ag-teams"><button data-agent="T">TR</button><button data-agent="CT">CT</button></div>
      <div class="ag-weapon">
        <button class="ag-prev" title="Arma anterior">◀</button>
        <span class="ag-wname">AK-47</span>
        <button class="ag-next" title="Próxima arma">▶</button>
      </div>
      <div class="ag-hint">Arraste o personagem para girar</div>
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
    <div class="sgroup"><h3>Vídeo</h3>
      ${row('Brilho', range('gBright', 0.6, 1.6, 0.05, 'pct'))}
      ${row('Contraste', range('gContrast', 0.7, 1.4, 0.05, 'pct'))}
      ${row('Saturação (vibração de cores)', range('gSat', 0, 2, 0.05, 'pct'))}
      ${row('Limite de FPS', range('gFpsCap', 0, 240, 30, 'fps'))}
      ${row('Mostrar FPS', check('showFps'))}
    </div>
    <div class="sgroup"><h3>Vídeo avançado</h3>
      ${row('Predefinição global', sel('gPreset', [['low', 'Baixa'], ['medium', 'Média'], ['high', 'Alta'], ['ultra', 'Muito alta'], ['custom', 'Personalizada']]))}
      ${row('Escala de renderização', range('gScale', 0.5, 2, 0.05, 'pct'))}
      ${row('Resolução dinâmica (reduz a escala se o FPS cair)', check('gDynRes'))}
      ${row(`Antialiasing (MSAA) ${NEXT}`, check('gMsaa'))}
      ${row('Qualidade das sombras', sel('gShadows', [['off', 'Desligadas'], ['low', 'Baixa'], ['medium', 'Média'], ['high', 'Alta (suaves)']]))}
      ${row(`Qualidade dos efeitos (partículas, marcas de tiro, fogo) ${NEXT}`, sel('gEffects', L3))}
      ${row(`Iluminação dinâmica (disparos e explosões) ${NEXT}`, check('gDynLights'))}
      ${row('Distância de visão', sel('gViewDist', L3))}
      ${row('Filtragem de textura', sel('gAniso', [[1, 'Bilinear'], [2, 'Anisotrópica 2x'], [4, 'Anisotrópica 4x'], [8, 'Anisotrópica 8x'], [16, 'Anisotrópica 16x']]))}
      ${row('Sangue', check('gBlood'))}
      <p class="muted sg-note">${NEXT} aplicado na próxima partida. O resto muda na hora.</p>
    </div>
    <div class="sgroup"><h3>Arma em primeira pessoa (viewmodel)</h3>
      ${row('Campo de visão da arma', range('vmFov', 54, 68, 1))}
      ${row('Deslocamento X (lado)', range('vmX', -2, 2.5, 0.5))}
      ${row('Deslocamento Y (frente/trás)', range('vmY', -2, 2, 0.5))}
      ${row('Deslocamento Z (altura)', range('vmZ', -2, 2, 0.5))}
      ${row('Balanço ao andar', range('vmBob', 0, 1, 0.1, 'pct'))}
      <div class="srow"><span>Predefinições do CS</span><div class="sctl"><button type="button" class="ghost" data-vm="desktop">Desktop</button><button type="button" class="ghost" data-vm="couch">Sofá</button><button type="button" class="ghost" data-vm="classic">Clássico</button></div></div>
    </div>
    <div class="sgroup"><h3>Áudio</h3>
      ${row('Volume geral', range('volume', 0, 1, 0.05, 'pct'))}
      ${row('Efeitos (tiros, passos, granadas)', range('volSfx', 0, 1, 0.05, 'pct'))}
      ${row('Interface (menus, loja, acertos)', range('volUi', 0, 1, 0.05, 'pct'))}
      ${row('Música e vinhetas de round', range('volMusic', 0, 1, 0.05, 'pct'))}
      ${row('Ambiente (vento)', range('volAmb', 0, 1, 0.05, 'pct'))}
      ${row('Áudio 3D para fones (HRTF)', check('hrtf'))}
      <p class="muted sg-note">Com fones, o HRTF ajuda a saber se o som vem da frente, de trás, de cima ou de baixo. Sons atrás de paredes chegam abafados.</p>
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

// ----------------------------------------------------------- personagem (time e arma)
menu.querySelectorAll<HTMLButtonElement>('[data-agent]').forEach((b) => {
  b.onclick = () => { settings.menuTeam = b.dataset.agent as Team; saveSettings(settings); audio.ui('click'); applyAgent(); };
});
const cycleAgentWeapon = (dir: number) => {
  const l = AGENT_WEAPONS[settings.menuTeam];
  const i = l.indexOf(settings.menuWeapon);
  settings.menuWeapon = l[(i + dir + l.length) % l.length];
  saveSettings(settings); audio.ui('click'); applyAgent();
};
(menu.querySelector('.ag-prev') as HTMLButtonElement).onclick = () => cycleAgentWeapon(-1);
(menu.querySelector('.ag-next') as HTMLButtonElement).onclick = () => cycleAgentWeapon(1);

// ----------------------------------------------------------- mira
const xhEditor = createCrosshairEditor(menu.querySelector('.xh-root') as HTMLElement, () => settings.xh, (c) => { settings.xh = c; saveSettings(settings); });
document.getElementById('xh-back')!.onclick = () => { audio.ui('click'); show(xhBack); };

// som ao passar o mouse nos botões do menu (com limite para não metralhar)
let hoverT = 0;
menu.addEventListener('mouseover', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b || b.contains(e.relatedTarget as Node) || !audio.ctx) return;
  const now = performance.now();
  if (now - hoverT < 60) return;
  hoverT = now;
  audio.ui('hover');
});

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
  if (go === 'hud') { menu.classList.remove('on'); syncScene(); openHudEditor(() => show('scr-main')); }
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
    if (out) out.textContent = fmtVal(inp, v);
    inp.oninput = inp.onchange = async () => {
      let val: unknown;
      if (inp instanceof HTMLInputElement && inp.type === 'checkbox') val = inp.checked;
      else if (inp instanceof HTMLInputElement && inp.type === 'range') val = Number(inp.value);
      else if (typeof settings[k] === 'number') val = Number(inp.value);
      else val = inp.value;
      (settings as any)[k] = val;
      if (out) out.textContent = fmtVal(inp, val);
      // predefinição global preenche as opções; mexer numa opção vira "Personalizada"
      if (k === 'gPreset' && val !== 'custom') { applyGfxPreset(settings, val as Exclude<GfxPreset, 'custom'>); fillSettings(); }
      else if ((GFX_CORE_KEYS as string[]).includes(k) && settings.gPreset !== 'custom') {
        settings.gPreset = 'custom';
        const ps = menu.querySelectorAll<HTMLSelectElement>('[data-k="gPreset"]');
        ps.forEach((p) => { p.value = 'custom'; });
      }
      game?.applyGraphics();
      if (k === 'gyro' && val === true) {
        const ok = await requestGyroPermission();
        if (!ok) { settings.gyro = false; (inp as HTMLInputElement).checked = false; alert('Giroscópio não disponível ou permissão negada.'); }
        else game?.input.enableGyro();
      }
      if (k === 'volume' || k.startsWith('vol') || k === 'hrtf') syncAudio();
      saveSettings(settings);
    };
  });
}
// predefinições de viewmodel do CS:GO (viewmodel_presetpos 1/2/3)
const VM_PRESETS: Record<string, Partial<Settings>> = {
  desktop: { vmFov: 60, vmX: 1, vmY: 1, vmZ: -1 },
  couch: { vmFov: 54, vmX: 0, vmY: 0, vmZ: -2 },
  classic: { vmFov: 54, vmX: 2.5, vmY: 0, vmZ: -1.5 },
};
menu.querySelectorAll<HTMLButtonElement>('[data-vm]').forEach((b) => {
  b.onclick = () => { Object.assign(settings, VM_PRESETS[b.dataset.vm!]); saveSettings(settings); fillSettings(); game?.applyGraphics(); };
});

document.getElementById('set-back')!.onclick = () => {
  saveSettings(settings);
  if (settingsDone) { const d = settingsDone; settingsDone = null; menu.classList.remove('on', 'ingame'); d(); }
  else show('scr-main');
};

function openSettingsInGame(done: () => void) {
  settingsDone = done;
  menu.classList.add('ingame');
  menuScene?.stop();
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
  menuScene?.stop();
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
