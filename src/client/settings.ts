import { type CrosshairCfg, DEFAULT_CROSSHAIR, sanitizeCrosshair } from './crosshair';

export interface Settings {
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
  quality: 'auto' | 'low' | 'high';
  showFps: boolean;
  xh: CrosshairCfg;
  invertY: boolean;
}

const KEY = 'ebrashot.settings.v1';

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
  quality: 'auto',
  showFps: true,
  xh: { ...DEFAULT_CROSSHAIR },
  invertY: false,
};

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
      s.xh = sanitizeCrosshair(s.xh);
      delete (s as any).crosshairColor;
      return s;
    }
  } catch { /* storage indisponível */ }
  return { ...DEFAULT_SETTINGS, xh: { ...DEFAULT_CROSSHAIR } };
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignora */ }
}

export const isTouchDevice = () =>
  typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0) && matchMedia('(pointer: coarse)').matches;
