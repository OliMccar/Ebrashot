export type ControlId =
  | 'joystick' | 'fire' | 'fireL' | 'jump' | 'crouch' | 'scope' | 'reload' | 'use' | 'nade'
  | 'buy' | 'weapons' | 'drop' | 'score' | 'inspect' | 'menu' | 'walk';

export interface ControlLayout { x: number; y: number; size: number; opacity: number }
export type Layout = Record<ControlId, ControlLayout>;

export const CONTROL_LABEL: Record<ControlId, string> = {
  joystick: 'Mover', fire: 'Atirar', fireL: 'Atirar', jump: 'Pular', crouch: 'Agachar', scope: 'Mira', reload: 'Recarregar',
  use: 'Usar', nade: 'Granada', buy: 'Comprar', weapons: 'Armas', drop: 'Dropar', score: 'Placar', inspect: 'Inspecionar',
  menu: 'Menu', walk: 'Andar',
};

export const CONTROL_ICON: Record<ControlId, string> = {
  joystick: '', fire: '✸', fireL: '✸', jump: '⤒', crouch: '⤓', scope: '◎', reload: '↻', use: 'E', nade: '●',
  buy: '$', weapons: '', drop: 'G', score: '☰', inspect: 'F', menu: '❚❚', walk: '⇣',
};

/** Posições em % da tela (centro do controle); tamanho base em px. */
export const DEFAULT_LAYOUT: Layout = {
  joystick: { x: 14, y: 70, size: 150, opacity: 0.55 },
  fire: { x: 87, y: 62, size: 86, opacity: 0.7 },
  fireL: { x: 9, y: 36, size: 62, opacity: 0.6 },
  jump: { x: 94, y: 40, size: 58, opacity: 0.6 },
  crouch: { x: 94, y: 84, size: 58, opacity: 0.6 },
  scope: { x: 78, y: 40, size: 52, opacity: 0.6 },
  reload: { x: 80, y: 85, size: 52, opacity: 0.6 },
  use: { x: 70, y: 70, size: 52, opacity: 0.6 },
  nade: { x: 31, y: 88, size: 50, opacity: 0.6 },
  walk: { x: 26, y: 64, size: 46, opacity: 0.5 },
  buy: { x: 26, y: 8, size: 46, opacity: 0.7 },
  weapons: { x: 52, y: 92, size: 54, opacity: 0.7 },
  drop: { x: 82, y: 7, size: 40, opacity: 0.55 },
  score: { x: 72, y: 7, size: 40, opacity: 0.55 },
  inspect: { x: 62, y: 7, size: 40, opacity: 0.55 },
  menu: { x: 94, y: 7, size: 40, opacity: 0.6 },
};

const KEY = 'ebrashot.hudlayout.v1';

export function loadLayout(): Layout {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Layout>;
      const out = structuredClone(DEFAULT_LAYOUT);
      for (const k of Object.keys(out) as ControlId[]) if (saved[k]) out[k] = { ...out[k], ...saved[k] };
      return out;
    }
  } catch { /* ignora */ }
  return structuredClone(DEFAULT_LAYOUT);
}

export function saveLayout(l: Layout) {
  try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* ignora */ }
}

/** Cria o elemento visual de um controle (usado no jogo e no editor). */
export function createControlEl(id: ControlId, l: ControlLayout): HTMLDivElement {
  const el = document.createElement('div');
  el.className = `tc tc-${id}`;
  el.dataset.id = id;
  applyControlLayout(el, id, l);
  if (id === 'joystick') {
    const knob = document.createElement('div');
    knob.className = 'tc-knob';
    el.appendChild(knob);
    const ring = document.createElement('div');
    ring.className = 'tc-ring';
    el.appendChild(ring);
  } else if (id === 'weapons') {
    el.innerHTML = '<span data-w="0">1</span><span data-w="1">2</span><span data-w="2">3</span><span data-w="3">4</span><span data-w="4">5</span>';
  } else {
    el.innerHTML = `<b>${CONTROL_ICON[id]}</b><small>${CONTROL_LABEL[id]}</small>`;
  }
  return el;
}

export function applyControlLayout(el: HTMLElement, id: ControlId, l: ControlLayout) {
  const w = id === 'weapons' ? l.size * 5.4 : l.size;
  const h = l.size;
  el.style.left = `calc(${l.x}% - ${w / 2}px)`;
  el.style.top = `calc(${l.y}% - ${h / 2}px)`;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  el.style.opacity = String(l.opacity);
  el.style.fontSize = `${Math.max(10, l.size * 0.3)}px`;
}
