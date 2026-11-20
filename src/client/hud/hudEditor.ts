import { type ControlId, type Layout, CONTROL_LABEL, DEFAULT_LAYOUT, applyControlLayout, createControlEl, loadLayout, saveLayout } from './layout';

/** Editor de HUD estilo Standoff 2: arrastar, redimensionar e opacidade por botão. */
export function openHudEditor(onClose: () => void) {
  const layout: Layout = loadLayout();
  const root = document.createElement('div');
  root.className = 'hud-editor';
  root.innerHTML = `
    <div class="he-bg"><div class="he-cross"></div></div>
    <div class="he-panel panel">
      <div class="he-title">Editor de HUD <small>arraste os botões; toque para selecionar</small></div>
      <div class="he-sel">Selecionado: <b class="he-name">—</b></div>
      <label>Tamanho <input type="range" class="he-size" min="30" max="220" step="1"><span class="he-size-v"></span></label>
      <label>Opacidade <input type="range" class="he-op" min="0.1" max="1" step="0.05"><span class="he-op-v"></span></label>
      <div class="he-btns"><button class="he-reset">Restaurar padrão</button><button class="he-save primary">Salvar e sair</button><button class="he-cancel">Cancelar</button></div>
    </div>`;
  document.body.appendChild(root);
  const bg = root.querySelector('.he-bg') as HTMLElement;
  const els = new Map<ControlId, HTMLElement>();
  let sel: ControlId | null = null;
  const size = root.querySelector('.he-size') as HTMLInputElement;
  const op = root.querySelector('.he-op') as HTMLInputElement;
  const refreshPanel = () => {
    (root.querySelector('.he-name') as HTMLElement).textContent = sel ? CONTROL_LABEL[sel] : '—';
    size.disabled = op.disabled = !sel;
    if (sel) {
      size.value = String(layout[sel].size); op.value = String(layout[sel].opacity);
      (root.querySelector('.he-size-v') as HTMLElement).textContent = `${layout[sel].size}px`;
      (root.querySelector('.he-op-v') as HTMLElement).textContent = `${Math.round(layout[sel].opacity * 100)}%`;
    }
    for (const [id, e] of els) e.classList.toggle('sel', id === sel);
  };
  const build = () => {
    bg.querySelectorAll('.tc').forEach((e) => e.remove());
    els.clear();
    for (const id of Object.keys(layout) as ControlId[]) {
      const e = createControlEl(id, layout[id]);
      e.style.opacity = String(Math.max(0.25, layout[id].opacity));
      bg.appendChild(e);
      els.set(id, e);
      let drag: { px: number; py: number; x: number; y: number } | null = null;
      e.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        e.setPointerCapture(ev.pointerId);
        sel = id; refreshPanel();
        drag = { px: ev.clientX, py: ev.clientY, x: layout[id].x, y: layout[id].y };
      });
      e.addEventListener('pointermove', (ev) => {
        if (!drag) return;
        const W = bg.clientWidth, H = bg.clientHeight;
        layout[id].x = Math.max(0, Math.min(100, drag.x + ((ev.clientX - drag.px) / W) * 100));
        layout[id].y = Math.max(0, Math.min(100, drag.y + ((ev.clientY - drag.py) / H) * 100));
        applyControlLayout(e, id, layout[id]);
        e.style.opacity = String(Math.max(0.25, layout[id].opacity));
      });
      e.addEventListener('pointerup', () => { drag = null; });
    }
    refreshPanel();
  };
  size.oninput = () => { if (!sel) return; layout[sel].size = Number(size.value); applyControlLayout(els.get(sel)!, sel, layout[sel]); refreshPanel(); };
  op.oninput = () => { if (!sel) return; layout[sel].opacity = Number(op.value); applyControlLayout(els.get(sel)!, sel, layout[sel]); els.get(sel)!.style.opacity = String(Math.max(0.25, layout[sel].opacity)); refreshPanel(); };
  (root.querySelector('.he-reset') as HTMLElement).onclick = () => { Object.assign(layout, structuredClone(DEFAULT_LAYOUT)); sel = null; build(); };
  (root.querySelector('.he-save') as HTMLElement).onclick = () => { saveLayout(layout); root.remove(); onClose(); };
  (root.querySelector('.he-cancel') as HTMLElement).onclick = () => { root.remove(); onClose(); };
  build();
}
