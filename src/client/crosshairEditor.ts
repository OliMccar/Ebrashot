import {
  COLOR_PRESETS, CROSSHAIR_PRESETS, type CrossStyle, type CrosshairCfg, DEFAULT_CROSSHAIR, STYLE_LABEL,
  crossHex, crosshairConsole, decodeCrosshair, drawCrosshair, encodeCrosshair, isDynamic, sanitizeCrosshair,
} from './crosshair';

type Key = keyof CrosshairCfg;

const slider = (k: Key, label: string, min: number, max: number, step: number) =>
  `<label class="srow"><span>${label}</span><div class="sctl"><input data-x="${k}" type="range" min="${min}" max="${max}" step="${step}"><output data-o="${k}"></output></div></label>`;
const toggle = (k: Key, label: string) =>
  `<label class="srow"><span>${label}</span><div class="sctl"><input data-x="${k}" type="checkbox" class="tgl"></div></label>`;

const BGS = [
  { id: 'sky', name: 'Céu' }, { id: 'wall', name: 'Parede' }, { id: 'sand', name: 'Areia' },
  { id: 'dark', name: 'Escuro' }, { id: 'light', name: 'Claro' },
];

export interface CrosshairEditor { show(): void; hide(): void }

/**
 * Tela de personalização de mira (todas as opções do CS:GO).
 * @param root   <section> da tela
 * @param get    lê a configuração atual
 * @param set    grava a nova configuração (e salva)
 */
export function createCrosshairEditor(root: HTMLElement, get: () => CrosshairCfg, set: (c: CrosshairCfg) => void): CrosshairEditor {
  root.innerHTML = `
  <div class="xh">
    <div class="xh-left">
      <div class="xh-preview bg-sky">
        <canvas class="xh-canvas"></canvas>
        <canvas class="xh-zoom" title="Zoom 4x"></canvas>
      </div>
      <div class="xh-bgs">${BGS.map((b) => `<button class="xh-bg ${b.id === 'sky' ? 'on' : ''}" data-bg="${b.id}"><i class="bg-${b.id}"></i>${b.name}</button>`).join('')}</div>
      <label class="srow xh-sim"><span>Simular disparo / movimento</span><div class="sctl"><input type="checkbox" class="tgl xh-simt" checked></div></label>
      <div class="sgroup"><h3>Miras prontas</h3><div class="xh-presets"></div></div>
      <div class="sgroup"><h3>Compartilhar</h3>
        <div class="xh-code">
          <input class="xh-codein" spellcheck="false" placeholder="Cole um código EBX-...">
          <button class="xh-copy">Copiar</button><button class="xh-import">Importar</button>
        </div>
        <div class="xh-code"><button class="ghost xh-cons">Copiar comandos de console (estilo CS)</button></div>
        <p class="muted xh-msg"></p>
      </div>
    </div>
    <div class="xh-right">
      <div class="sgroup"><h3>Estilo</h3>
        <label class="srow"><span>Estilo da mira</span><div class="sctl"><select data-x="style">${(Object.keys(STYLE_LABEL) as CrossStyle[]).map((s) => `<option value="${s}">${STYLE_LABEL[s]}</option>`).join('')}</select></div></label>
        ${toggle('tStyle', 'Estilo T (sem a linha de cima)')}
        ${toggle('dot', 'Ponto central')}
      </div>
      <div class="sgroup"><h3>Formato</h3>
        ${slider('size', 'Tamanho', 0, 10, 0.5)}
        ${slider('thickness', 'Espessura', 0, 6, 0.5)}
        ${slider('gap', 'Espaçamento (gap)', -5, 5, 0.5)}
        ${toggle('outline', 'Contorno')}
        ${slider('outlineThickness', 'Espessura do contorno', 0, 3, 0.5)}
      </div>
      <div class="sgroup"><h3>Cor</h3>
        <div class="xh-swatches">${COLOR_PRESETS.map((c, i) => `<button class="xh-sw" data-c="${i}" title="${c.name}" style="--c: rgb(${c.rgb.join(',')})"><i></i><span>${c.name}</span></button>`).join('')}
          <button class="xh-sw" data-c="5" title="Personalizada"><i class="xh-custom"></i><span>Personalizada</span></button></div>
        <div class="xh-rgb">
          ${slider('r', 'Vermelho (R)', 0, 255, 1)}
          ${slider('g', 'Verde (G)', 0, 255, 1)}
          ${slider('b', 'Azul (B)', 0, 255, 1)}
          <label class="srow"><span>Seletor de cor</span><div class="sctl"><input type="color" class="xh-pick"></div></label>
        </div>
        ${toggle('useAlpha', 'Usar transparência (alpha)')}
        ${slider('alpha', 'Alpha', 0, 255, 1)}
      </div>
      <div class="sgroup xh-dyn"><h3>Dinâmica</h3>
        <p class="muted xh-dynoff">Disponível nos estilos dinâmicos (Padrão, Clássica e Clássica dinâmica).</p>
        ${slider('splitDist', 'Distância de divisão', 0, 15, 1)}
        ${slider('innerAlpha', 'Alpha da parte interna', 0, 1, 0.05)}
        ${slider('outerAlpha', 'Alpha da parte externa', 0.3, 1, 0.05)}
        ${slider('splitRatio', 'Proporção da divisão', 0, 1, 0.05)}
      </div>
      <div class="sgroup"><h3>Avançado</h3>
        ${toggle('recoil', 'Seguir o recoil (mira mostra onde a bala vai)')}
        ${toggle('weaponGap', 'Usar espaçamento da arma')}
        ${slider('sniperWidth', 'Largura da linha da luneta', 1, 5, 1)}
        ${toggle('showSpectating', 'Mostrar mira ao assistir')}
      </div>
      <button class="ghost xh-reset">Restaurar mira padrão</button>
    </div>
  </div>`;

  const q = <T extends Element>(s: string) => root.querySelector(s) as T;
  const canvas = q<HTMLCanvasElement>('.xh-canvas');
  const zoom = q<HTMLCanvasElement>('.xh-zoom');
  const ctx = canvas.getContext('2d')!;
  const zctx = zoom.getContext('2d')!;
  const preview = q<HTMLElement>('.xh-preview');
  const sim = q<HTMLInputElement>('.xh-simt');
  const msg = q<HTMLElement>('.xh-msg');
  const codeIn = q<HTMLInputElement>('.xh-codein');
  let raf = 0;
  let t0 = performance.now();

  const fmt = (k: Key, v: number) => (k === 'innerAlpha' || k === 'outerAlpha' || k === 'splitRatio' ? v.toFixed(2) : String(v));

  /** Atualiza todos os controles a partir da configuração. */
  const fill = () => {
    const c = get();
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-x]').forEach((inp) => {
      const k = inp.dataset.x as Key;
      const v = c[k];
      if (inp instanceof HTMLInputElement && inp.type === 'checkbox') inp.checked = !!v;
      else inp.value = String(v);
      const o = root.querySelector(`[data-o="${k}"]`);
      if (o) o.textContent = fmt(k, Number(v));
    });
    root.querySelectorAll<HTMLElement>('.xh-sw').forEach((b) => b.classList.toggle('on', Number(b.dataset.c) === c.color));
    q<HTMLElement>('.xh-custom').style.background = `rgb(${c.r},${c.g},${c.b})`;
    q<HTMLInputElement>('.xh-pick').value = crossHex({ ...c, color: 5 });
    root.querySelector('.xh-rgb')!.classList.toggle('off', c.color !== 5);
    const dyn = isDynamic(c.style);
    root.querySelector('.xh-dyn')!.classList.toggle('off', !dyn);
    const split = c.style === 'classic' || c.style === 'default';
    root.querySelectorAll('.xh-dyn .srow').forEach((r) => r.classList.toggle('dis', !split));
    q<HTMLElement>('.xh-dynoff').textContent = split
      ? 'A parte interna se separa da externa quando a arma perde precisão.'
      : dyn ? 'A mira abre conforme a imprecisão; as opções de divisão valem só para Padrão e Clássica.' : 'Disponível nos estilos dinâmicos (Padrão, Clássica e Clássica dinâmica).';
    root.querySelectorAll('[data-x="outlineThickness"]').forEach((e) => e.closest('.srow')!.classList.toggle('dis', !c.outline));
    root.querySelectorAll('[data-x="alpha"]').forEach((e) => e.closest('.srow')!.classList.toggle('dis', !c.useAlpha));
    codeIn.value = encodeCrosshair(c);
  };

  const update = (patch: Partial<CrosshairCfg>) => {
    set(sanitizeCrosshair({ ...get(), ...patch }));
    fill();
  };

  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-x]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const k = inp.dataset.x as Key;
      let v: unknown;
      if (inp instanceof HTMLInputElement && inp.type === 'checkbox') v = inp.checked;
      else if (inp instanceof HTMLInputElement && inp.type === 'range') v = Number(inp.value);
      else v = inp.value;
      const patch: Partial<CrosshairCfg> = { [k]: v };
      // mexer em R/G/B passa a cor para "personalizada"
      if (k === 'r' || k === 'g' || k === 'b') patch.color = 5;
      update(patch);
    });
  });
  root.querySelectorAll<HTMLButtonElement>('.xh-sw').forEach((b) => {
    b.onclick = () => {
      const i = Number(b.dataset.c);
      if (i < 5) { const [r, g, bl] = COLOR_PRESETS[i].rgb; update({ color: i, r, g, b: bl }); }
      else update({ color: 5 });
    };
  });
  q<HTMLInputElement>('.xh-pick').addEventListener('input', (e) => {
    const n = parseInt((e.target as HTMLInputElement).value.slice(1), 16);
    update({ color: 5, r: n >> 16, g: (n >> 8) & 255, b: n & 255 });
  });
  root.querySelectorAll<HTMLButtonElement>('.xh-bg').forEach((b) => {
    b.onclick = () => {
      root.querySelectorAll('.xh-bg').forEach((x) => x.classList.toggle('on', x === b));
      preview.className = `xh-preview bg-${b.dataset.bg}`;
    };
  });
  const presets = q<HTMLElement>('.xh-presets');
  presets.innerHTML = CROSSHAIR_PRESETS.map((p, i) => `<button class="xh-preset" data-p="${i}"><canvas width="64" height="64"></canvas><span>${p.name}</span></button>`).join('');
  presets.querySelectorAll<HTMLButtonElement>('.xh-preset').forEach((b) => {
    const p = CROSSHAIR_PRESETS[Number(b.dataset.p)];
    const cfg = sanitizeCrosshair({ ...DEFAULT_CROSSHAIR, ...p.cfg });
    drawCrosshair(b.querySelector('canvas')!.getContext('2d')!, cfg, 0, 1);
    b.onclick = () => { set(cfg); fill(); say(`Mira "${p.name}" aplicada.`); };
  });

  const say = (t: string) => { msg.textContent = t; };
  const copy = async (text: string, ok: string) => {
    try { await navigator.clipboard.writeText(text); say(ok); }
    catch { codeIn.value = text; codeIn.select(); say('Não deu para copiar automaticamente: o texto está selecionado, use Ctrl+C.'); }
  };
  q<HTMLButtonElement>('.xh-copy').onclick = () => void copy(encodeCrosshair(get()), 'Código copiado!');
  q<HTMLButtonElement>('.xh-cons').onclick = () => void copy(crosshairConsole(get()), 'Comandos copiados!');
  q<HTMLButtonElement>('.xh-import').onclick = () => {
    const c = decodeCrosshair(codeIn.value);
    if (!c) { say('Código inválido. Ele deve começar com EBX-.'); return; }
    set(c); fill(); say('Mira importada!');
  };
  q<HTMLButtonElement>('.xh-reset').onclick = () => { set({ ...DEFAULT_CROSSHAIR }); fill(); say('Mira restaurada para o padrão.'); };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(preview.clientWidth * dpr), h = Math.round(preview.clientHeight * dpr);
    if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const c = get();
    // simulação: rajadas curtas que abrem a mira e recuperam
    let spread = 0;
    if (sim.checked) {
      const t = ((now - t0) / 1000) % 2.4;
      spread = t < 0.6 ? t / 0.6 * 34 : Math.max(0, 34 * (1 - (t - 0.6) / 0.5));
    }
    const scale = (window.innerHeight / 1080) * dpr;
    drawCrosshair(ctx, c, spread * dpr, scale, c.weaponGap ? 6 * dpr : 0);
    // zoom 4x do centro, sem suavização (para ver pixel a pixel)
    const zs = Math.round(zoom.clientWidth * dpr) || 1;
    if (zoom.width !== zs) { zoom.width = zoom.height = zs; }
    const src = zs / 4;
    zctx.imageSmoothingEnabled = false;
    zctx.clearRect(0, 0, zs, zs);
    zctx.drawImage(canvas, Math.floor(w / 2 - src / 2), Math.floor(h / 2 - src / 2), src, src, 0, 0, zs, zs);
  };

  return {
    show() { fill(); say(''); t0 = performance.now(); if (!raf) raf = requestAnimationFrame(frame); },
    hide() { cancelAnimationFrame(raf); raf = 0; },
  };
}
