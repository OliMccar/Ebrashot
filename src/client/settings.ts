import type { Team } from '../shared/constants';
import type { WeaponId } from '../shared/weapons';
import { type CrosshairCfg, DEFAULT_CROSSHAIR, sanitizeCrosshair } from './crosshair';

export type GfxPreset = 'low' | 'medium' | 'high' | 'ultra' | 'custom';
export type Level3 = 'low' | 'medium' | 'high';
export type ShadowQ = 'off' | 'low' | 'medium' | 'high';

/** Opções gráficas que a predefinição global controla. */
export interface GfxCore {
  gScale: number; // escala de renderização (multiplica o devicePixelRatio)
  gMsaa: boolean; // antialiasing MSAA (próxima partida)
  gShadows: ShadowQ; // sombras em tempo real
  gEffects: Level3; // partículas, decals e fogo (próxima partida)
  gDynLights: boolean; // luz do disparo e das explosões
  gViewDist: Level3; // neblina / distância de visão
  gAniso: number; // filtragem anisotrópica
}

export interface Settings extends GfxCore {
  name: string;
  sens: number; // CS-like: graus = contagens * 0.022 * sens
  touchSens: number;
  fov: number; // FOV vertical
  volume: number;
  autoFire: boolean;
  autoFireDelay: number; // ms
  gyro: boolean;
  gyroSens: number;
  gyroInvert: boolean;
  forceMobile: boolean;
  difficulty: number;
  botsPerTeam: number;
  maxRounds: number;
  showFps: boolean;
  xh: CrosshairCfg;
  invertY: boolean;
  // áudio (volume = master)
  volSfx: number;
  volUi: number;
  volMusic: number;
  volAmb: number;
  hrtf: boolean; // áudio 3D binaural (fones)
  // personagem mostrado no menu principal
  menuTeam: Team;
  menuWeapon: WeaponId;
  // vídeo
  gPreset: GfxPreset;
  gDynRes: boolean; // resolução dinâmica (baixa a escala quando o FPS cai)
  gFpsCap: number; // 0 = sem limite
  gBright: number;
  gContrast: number;
  gSat: number;
  gBlood: boolean;
  // viewmodel (arma em primeira pessoa)
  vmFov: number; // viewmodel_fov
  vmX: number; // viewmodel_offset_x
  vmY: number; // viewmodel_offset_y
  vmZ: number; // viewmodel_offset_z
  vmBob: number; // cl_bob (0..1)
}

export const GFX_PRESETS: Record<Exclude<GfxPreset, 'custom'>, GfxCore> = {
  low: { gScale: 0.75, gMsaa: false, gShadows: 'off', gEffects: 'low', gDynLights: false, gViewDist: 'low', gAniso: 1 },
  medium: { gScale: 1, gMsaa: false, gShadows: 'low', gEffects: 'medium', gDynLights: true, gViewDist: 'medium', gAniso: 4 },
  high: { gScale: 1, gMsaa: true, gShadows: 'medium', gEffects: 'high', gDynLights: true, gViewDist: 'high', gAniso: 8 },
  ultra: { gScale: 1.25, gMsaa: true, gShadows: 'high', gEffects: 'high', gDynLights: true, gViewDist: 'high', gAniso: 16 },
};
export const GFX_CORE_KEYS = Object.keys(GFX_PRESETS.low) as (keyof GfxCore)[];

const KEY = 'ebrashot.settings.v1';

export const isTouchDevice = () =>
  typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0) && matchMedia('(pointer: coarse)').matches;

const defaultPreset = (): Exclude<GfxPreset, 'custom'> => (isTouchDevice() ? 'medium' : 'high');

export const DEFAULT_SETTINGS: Settings = {
  name: 'Jogador',
  sens: 2.0,
  touchSens: 1.0,
  fov: 74,
  volume: 0.7,
  autoFire: false,
  autoFireDelay: 120,
  gyro: false,
  gyroSens: 1.0,
  gyroInvert: false,
  forceMobile: false,
  difficulty: 1,
  botsPerTeam: 5,
  maxRounds: 24,
  showFps: true,
  xh: { ...DEFAULT_CROSSHAIR },
  invertY: false,
  volSfx: 1,
  volUi: 0.8,
  volMusic: 0.7,
  volAmb: 0.5,
  hrtf: true,
  menuTeam: 'T',
  menuWeapon: 'ak47',
  gPreset: defaultPreset(),
  ...GFX_PRESETS[defaultPreset()],
  gDynRes: true,
  gFpsCap: 0,
  gBright: 1,
  gContrast: 1,
  gSat: 1,
  gBlood: true,
  vmFov: 60,
  vmX: 1,
  vmY: 1,
  vmZ: -1,
  vmBob: 1,
};

/** Aplica uma predefinição global (não mexe em brilho, FPS e viewmodel). */
export function applyGfxPreset(s: Settings, p: Exclude<GfxPreset, 'custom'>) {
  Object.assign(s, GFX_PRESETS[p]);
  s.gPreset = p;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const o = JSON.parse(raw);
      const s: Settings = { ...DEFAULT_SETTINGS, ...o };
      // migração: versões antigas só tinham a cor da mira (crosshairColor)
      if (!o.xh && typeof o.crosshairColor === 'string' && /^#[0-9a-f]{6}$/i.test(o.crosshairColor)) {
        const n = parseInt(o.crosshairColor.slice(1), 16);
        s.xh = { ...DEFAULT_CROSSHAIR, color: 5, r: n >> 16, g: (n >> 8) & 255, b: n & 255 };
      }
      // migração: a antiga "qualidade gráfica" (auto/low/high) vira uma predefinição
      if (!o.gPreset && typeof o.quality === 'string') {
        applyGfxPreset(s, o.quality === 'low' ? 'low' : o.quality === 'high' ? 'ultra' : defaultPreset());
        s.gDynRes = o.quality === 'auto';
      }
      s.xh = sanitizeCrosshair(s.xh);
      delete (s as any).crosshairColor;
      delete (s as any).quality;
      return s;
    }
  } catch { /* storage indisponível */ }
  return { ...DEFAULT_SETTINGS, xh: { ...DEFAULT_CROSSHAIR } };
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignora */ }
}
