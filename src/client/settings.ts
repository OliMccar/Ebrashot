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
  crosshairColor: string;
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
  crosshairColor: '#4dff7a',
  invertY: false,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* storage indisponível */ }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignora */ }
}

export const isTouchDevice = () =>
  typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0) && matchMedia('(pointer: coarse)').matches;
