/**
 * Mira personalizável no estilo CS:GO.
 * Unidades seguem as do console do CS (size, thickness, gap, outline...) e são convertidas
 * para pixels relativos a uma tela de 1080p.
 */

export type CrossStyle = 'default' | 'defaultStatic' | 'classic' | 'classicDynamic' | 'classicStatic';

export interface CrosshairCfg {
  style: CrossStyle;
  size: number; // cl_crosshairsize (0.5..10)
  thickness: number; // cl_crosshairthickness (0..6)
  gap: number; // cl_crosshairgap (-5..5)
  outline: boolean; // cl_crosshair_drawoutline
  outlineThickness: number; // cl_crosshair_outlinethickness (0..3)
  dot: boolean; // cl_crosshairdot
  tStyle: boolean; // cl_crosshair_t
  color: number; // cl_crosshaircolor: 0 vermelho, 1 verde, 2 amarelo, 3 azul, 4 ciano, 5 personalizado
  r: number; g: number; b: number; // cl_crosshaircolor_r/g/b
  useAlpha: boolean; // cl_crosshairusealpha
  alpha: number; // cl_crosshairalpha (0..255)
  splitDist: number; // cl_crosshair_dynamic_splitdist (0..15)
  innerAlpha: number; // cl_crosshair_dynamic_splitalpha_innermod (0..1)
  outerAlpha: number; // cl_crosshair_dynamic_splitalpha_outermod (0.3..1)
  splitRatio: number; // cl_crosshair_dynamic_maxdist_splitratio (0..1)
  recoil: boolean; // cl_crosshair_recoil (seguir o recoil)
  weaponGap: boolean; // cl_crosshairgap_useweaponvalue
  sniperWidth: number; // cl_crosshair_sniper_width (1..5)
  showSpectating: boolean; // mostrar a mira ao assistir alguém
}

export const DEFAULT_CROSSHAIR: CrosshairCfg = {
  style: 'classicStatic', size: 2.5, thickness: 1, gap: -1, outline: true, outlineThickness: 1, dot: false, tStyle: false,
  color: 1, r: 50, g: 250, b: 50, useAlpha: true, alpha: 255,
  splitDist: 7, innerAlpha: 1, outerAlpha: 0.5, splitRatio: 0.3,
  recoil: false, weaponGap: false, sniperWidth: 1, showSpectating: true,
};

export const STYLE_LABEL: Record<CrossStyle, string> = {
  default: 'Padrão (dinâmica)',
  defaultStatic: 'Padrão estática',
  classic: 'Clássica (dividida)',
  classicDynamic: 'Clássica dinâmica',
  classicStatic: 'Clássica estática',
};

export const COLOR_PRESETS: { name: string; rgb: [number, number, number] }[] = [
  { name: 'Vermelho', rgb: [250, 50, 50] },
  { name: 'Verde', rgb: [50, 250, 50] },
  { name: 'Amarelo', rgb: [250, 250, 50] },
  { name: 'Azul', rgb: [50, 50, 250] },
  { name: 'Ciano', rgb: [50, 250, 250] },
];

/** Miras prontas para começar. */
export const CROSSHAIR_PRESETS: { name: string; cfg: Partial<CrosshairCfg> }[] = [
  { name: 'Padrão do jogo', cfg: {} },
  { name: 'Pequena verde', cfg: { style: 'classicStatic', size: 2, thickness: 0.5, gap: -2, outline: true, color: 1 } },
  { name: 'Ponto', cfg: { style: 'classicStatic', size: 0, thickness: 1, gap: -2, dot: true, outline: true, color: 4 } },
  { name: 'Cruz grande', cfg: { style: 'classicStatic', size: 5, thickness: 1, gap: 1, outline: true, color: 2 } },
  { name: 'Estilo T', cfg: { style: 'classicStatic', size: 3, thickness: 1, gap: -1, tStyle: true, outline: true, color: 0 } },
  { name: 'Dinâmica', cfg: { style: 'classicDynamic', size: 3, thickness: 1, gap: 0, outline: true, color: 1 } },
  { name: 'Clássica dividida', cfg: { style: 'classic', size: 4, thickness: 1, gap: 0, outline: false, color: 1 } },
  { name: 'Branca fina', cfg: { style: 'classicStatic', size: 2.5, thickness: 0.5, gap: -1.5, outline: true, color: 5, r: 255, g: 255, b: 255 } },
  { name: 'Rosa', cfg: { style: 'classicStatic', size: 2, thickness: 1, gap: -2, outline: true, dot: true, color: 5, r: 255, g: 80, b: 220 } },
];

const clampN = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/** Normaliza valores vindos do localStorage ou de um código colado. */
export function sanitizeCrosshair(raw: Partial<CrosshairCfg> | undefined): CrosshairCfg {
  const d = DEFAULT_CROSSHAIR;
  const c = raw ?? {};
  return {
    style: (Object.keys(STYLE_LABEL) as CrossStyle[]).includes(c.style as CrossStyle) ? c.style as CrossStyle : d.style,
    size: clampN(c.size, 0, 10, d.size),
    thickness: clampN(c.thickness, 0, 6, d.thickness),
    gap: clampN(c.gap, -5, 5, d.gap),
    outline: typeof c.outline === 'boolean' ? c.outline : d.outline,
    outlineThickness: clampN(c.outlineThickness, 0, 3, d.outlineThickness),
    dot: typeof c.dot === 'boolean' ? c.dot : d.dot,
    tStyle: typeof c.tStyle === 'boolean' ? c.tStyle : d.tStyle,
    color: Math.round(clampN(c.color, 0, 5, d.color)),
    r: Math.round(clampN(c.r, 0, 255, d.r)), g: Math.round(clampN(c.g, 0, 255, d.g)), b: Math.round(clampN(c.b, 0, 255, d.b)),
    useAlpha: typeof c.useAlpha === 'boolean' ? c.useAlpha : d.useAlpha,
    alpha: Math.round(clampN(c.alpha, 0, 255, d.alpha)),
    splitDist: clampN(c.splitDist, 0, 15, d.splitDist),
    innerAlpha: clampN(c.innerAlpha, 0, 1, d.innerAlpha),
    outerAlpha: clampN(c.outerAlpha, 0.3, 1, d.outerAlpha),
    splitRatio: clampN(c.splitRatio, 0, 1, d.splitRatio),
    recoil: typeof c.recoil === 'boolean' ? c.recoil : d.recoil,
    weaponGap: typeof c.weaponGap === 'boolean' ? c.weaponGap : d.weaponGap,
    sniperWidth: Math.round(clampN(c.sniperWidth, 1, 5, d.sniperWidth)),
    showSpectating: typeof c.showSpectating === 'boolean' ? c.showSpectating : d.showSpectating,
  };
}

export function crossRgb(c: CrosshairCfg): [number, number, number] {
  return c.color >= 0 && c.color < 5 ? COLOR_PRESETS[c.color].rgb : [c.r, c.g, c.b];
}

export function crossHex(c: CrosshairCfg) {
  return '#' + crossRgb(c).map((v) => v.toString(16).padStart(2, '0')).join('');
}

export const isDynamic = (s: CrossStyle) => s === 'default' || s === 'classic' || s === 'classicDynamic';

// ------------------------------------------------------------------ código de compartilhamento
const CODE_KEYS: (keyof CrosshairCfg)[] = [
  'style', 'size', 'thickness', 'gap', 'outline', 'outlineThickness', 'dot', 'tStyle', 'color', 'r', 'g', 'b', 'useAlpha', 'alpha',
  'splitDist', 'innerAlpha', 'outerAlpha', 'splitRatio', 'recoil', 'weaponGap', 'sniperWidth', 'showSpectating',
];
const STYLES = Object.keys(STYLE_LABEL) as CrossStyle[];

/** Gera um código curto ("EBX-...") para compartilhar a mira. */
export function encodeCrosshair(c: CrosshairCfg): string {
  const vals = CODE_KEYS.map((k) => {
    const v = c[k];
    if (k === 'style') return STYLES.indexOf(v as CrossStyle);
    if (typeof v === 'boolean') return v ? 1 : 0;
    return Math.round((v as number) * 100) / 100;
  });
  const b64 = btoa(vals.join(',')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `EBX-${b64}`;
}

export function decodeCrosshair(code: string): CrosshairCfg | null {
  try {
    const m = /^EBX-([A-Za-z0-9_-]+)$/.exec(code.trim());
    if (!m) return null;
    const txt = atob(m[1].replace(/-/g, '+').replace(/_/g, '/'));
    const vals = txt.split(',').map(Number);
    if (vals.length !== CODE_KEYS.length || vals.some((v) => !Number.isFinite(v))) return null;
    const raw: Record<string, unknown> = {};
    CODE_KEYS.forEach((k, i) => {
      const def = DEFAULT_CROSSHAIR[k];
      raw[k] = k === 'style' ? STYLES[vals[i]] : typeof def === 'boolean' ? vals[i] === 1 : vals[i];
    });
    return sanitizeCrosshair(raw as Partial<CrosshairCfg>);
  } catch { return null; }
}

/** Gera os comandos de console equivalentes (útil para quem vem do CS). */
export function crosshairConsole(c: CrosshairCfg) {
  const st = { default: 0, defaultStatic: 1, classic: 2, classicDynamic: 3, classicStatic: 4 }[c.style];
  return [
    `cl_crosshairstyle ${st}`, `cl_crosshairsize ${c.size}`, `cl_crosshairthickness ${c.thickness}`, `cl_crosshairgap ${c.gap}`,
    `cl_crosshair_drawoutline ${+c.outline}`, `cl_crosshair_outlinethickness ${c.outlineThickness}`, `cl_crosshairdot ${+c.dot}`,
    `cl_crosshair_t ${+c.tStyle}`, `cl_crosshaircolor ${c.color}`, `cl_crosshaircolor_r ${c.r}`, `cl_crosshaircolor_g ${c.g}`,
    `cl_crosshaircolor_b ${c.b}`, `cl_crosshairusealpha ${+c.useAlpha}`, `cl_crosshairalpha ${c.alpha}`,
    `cl_crosshair_dynamic_splitdist ${c.splitDist}`, `cl_crosshair_dynamic_splitalpha_innermod ${c.innerAlpha}`,
    `cl_crosshair_dynamic_splitalpha_outermod ${c.outerAlpha}`, `cl_crosshair_dynamic_maxdist_splitratio ${c.splitRatio}`,
    `cl_crosshair_recoil ${+c.recoil}`, `cl_crosshairgap_useweaponvalue ${+c.weaponGap}`, `cl_crosshair_sniper_width ${c.sniperWidth}`,
  ].join('; ');
}

// ------------------------------------------------------------------ desenho
/**
 * Desenha a mira centralizada no canvas.
 * @param spreadPx abertura dinâmica em pixels de tela (imprecisão atual da arma)
 * @param scale    pixels de tela por "pixel de 1080p" (altura da tela / 1080), já multiplicado pelo DPR
 * @param weaponGapPx gap extra da arma (quando "usar gap da arma" está ligado)
 */
export function drawCrosshair(ctx: CanvasRenderingContext2D, c: CrosshairCfg, spreadPx: number, scale: number, weaponGapPx = 0) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);
  const cx = Math.floor(W / 2), cy = Math.floor(H / 2);
  const k = scale * 2; // 1 unidade do CS ≈ 2 px em 1080p
  const t = Math.max(1, Math.round(c.thickness * k));
  const len = Math.round(c.size * k);
  let gap = Math.round((c.gap + 4) * scale * 1.0);
  if (c.weaponGap) gap += Math.round(weaponGapPx);
  const dyn = isDynamic(c.style) ? Math.round(spreadPx) : 0;
  const [r, g, b] = crossRgb(c);
  const baseA = c.useAlpha ? c.alpha / 255 : 1;
  const ol = c.outline ? Math.max(1, Math.round(c.outlineThickness * scale)) : 0;
  const h0 = Math.floor(t / 2);

  type Rect = [number, number, number, number, number]; // x, y, w, h, alpha
  const rects: Rect[] = [];
  /** Adiciona os 4 (ou 3) braços a uma distância `d` do centro com comprimento `l`. */
  const arms = (d: number, l: number, a: number) => {
    if (l <= 0) return;
    rects.push([cx - h0 - d - l, cy - h0, l, t, a]); // esquerda
    rects.push([cx - h0 + t + d, cy - h0, l, t, a]); // direita
    if (!c.tStyle) rects.push([cx - h0, cy - h0 - d - l, t, l, a]); // cima
    rects.push([cx - h0, cy - h0 + t + d, t, l, a]); // baixo
  };

  if (c.style === 'classic' || c.style === 'default') {
    // CS "clássica": parte interna se separa e se afasta até splitDist; parte externa fica fixa
    const innerLen = Math.round(len * c.splitRatio);
    const outerLen = len - innerLen;
    const split = Math.min(dyn, Math.round(c.splitDist * k));
    const moved = split > 0;
    arms(gap + split, innerLen, baseA * (moved ? c.innerAlpha : 1));
    arms(gap + innerLen, outerLen, baseA * (moved ? c.outerAlpha : 1));
  } else {
    arms(gap + dyn, len, baseA);
  }
  if (c.dot) rects.push([cx - h0, cy - h0, t, t, baseA]);

  if (ol) {
    for (const [x, y, w, h, a] of rects) {
      ctx.fillStyle = `rgba(0,0,0,${Math.min(1, a)})`;
      ctx.fillRect(x - ol, y - ol, w + ol * 2, h + ol * 2);
    }
  }
  for (const [x, y, w, h, a] of rects) {
    ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(1, a)})`;
    ctx.fillRect(x, y, w, h);
  }
}
