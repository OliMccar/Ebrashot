import type { Team } from './constants';
import type { V3 } from './math';
import type { Mat } from './map';
import type { Cmd, PlayerState } from './player';
import type { BuyItemId, GrenadeId, WeaponId } from './weapons';

export type Phase = 'freeze' | 'live' | 'post' | 'over';

export interface PlayerNet {
  id: number; n: string; tm: Team; a: boolean; bot: boolean;
  x: number; y: number; z: number; vx: number; vz: number; og: boolean;
  yw: number; pt: number; dk: number; w: WeaponId;
  hp: number; ar: number; hm: boolean; kit: boolean; mo: number;
  k: number; d: number; as: number; c4: boolean; sp: boolean; ping: number;
}

export interface MePriv { st: PlayerState; money: number; hp: number; armor: number; helmet: boolean; kit: boolean; plantP: number; defuseP: number; canBuy: boolean; flashEnd: number }

export interface GrenadeNet { id: number; g: GrenadeId; x: number; y: number; z: number }
export interface SmokeNet { id: number; x: number; y: number; z: number; age: number; life: number }
export interface FireNet { id: number; x: number; y: number; z: number; r: number; age: number; life: number }
export interface ItemNet { id: number; w: WeaponId; x: number; y: number; z: number; yw: number }

export interface BombNet {
  st: 'carried' | 'dropped' | 'planted' | 'defused' | 'exploded' | 'none';
  x: number; y: number; z: number; site: 'A' | 'B' | ''; left: number; carrier: number; defuser: number;
}

export interface RoundNet {
  phase: Phase; left: number; round: number; sT: number; sCT: number; buyLeft: number; maxRounds: number;
}

export type GameEvent =
  | { e: 'shot'; id: number; w: WeaponId; o: V3; end: V3; sup?: boolean; pi?: number }
  /** decoy imitando um tiro da arma do dono */
  | { e: 'decoy'; p: V3; w: WeaponId }
  | { e: 'impact'; p: V3; n: V3; m: Mat; id: number }
  | { e: 'hit'; att: number; vic: number; dmg: number; hg: number; p: V3; armor: boolean }
  | { e: 'kill'; k: number; v: number; w: WeaponId | 'bomb' | 'world'; hs: boolean; wb: boolean }
  | { e: 'melee'; id: number; heavy: boolean; hit: boolean }
  | { e: 'throw'; id: number; g: GrenadeId }
  | { e: 'det'; g: GrenadeId | 'bomb'; p: V3 }
  | { e: 'flash'; id: number; dur: number }
  | { e: 'bounce'; p: V3 }
  | { e: 'reload'; id: number; w: WeaponId }
  | { e: 'dry'; id: number }
  | { e: 'jump'; id: number }
  | { e: 'land'; id: number }
  | { e: 'planted'; site: 'A' | 'B'; p: V3; by: number }
  | { e: 'defused'; by: number }
  | { e: 'plantStart'; id: number }
  | { e: 'defuseStart'; id: number; kit: boolean }
  | { e: 'roundStart'; round: number }
  | { e: 'live' }
  | { e: 'roundEnd'; win: Team; reason: string }
  | { e: 'matchEnd'; win: Team | 'draw' }
  | { e: 'halftime' }
  | { e: 'msg'; text: string }
  | { e: 'buy'; ok: boolean; item: BuyItemId; reason?: string }
  | { e: 'pickup'; id: number; w: WeaponId }
  | { e: 'drop'; id: number; w: WeaponId }
  | { e: 'money'; id: number; amount: number; why: string }
  | { e: 'join'; id: number; name: string; team: Team }
  | { e: 'leave'; id: number; name: string };

export interface Snapshot {
  tick: number;
  ack: number;
  you: number;
  me: MePriv | null;
  team: Team | null;
  players: PlayerNet[];
  gr: GrenadeNet[];
  sm: SmokeNet[];
  fi: FireNet[];
  it: ItemNet[];
  bomb: BombNet;
  round: RoundNet;
  ev: GameEvent[];
}

// --- mensagens de rede
export type ClientMsg =
  | { t: 'list' }
  | { t: 'join'; room: string; name: string; team?: Team | 'auto'; bots?: number; diff?: number }
  | { t: 'cmd'; c: Cmd[] }
  | { t: 'buy'; item: BuyItemId }
  | { t: 'team'; team: Team }
  | { t: 'ping'; ts: number; rtt: number }
  | { t: 'chat'; text: string };

export type ServerMsg =
  | { t: 'rooms'; rooms: { name: string; players: number; humans: number; max: number }[] }
  | { t: 'welcome'; id: number; room: string }
  | { t: 'snap'; s: Snapshot }
  | { t: 'pong'; ts: number }
  | { t: 'error'; msg: string }
  | { t: 'chat'; from: string; text: string };
