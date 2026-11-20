// Escala: 1 unidade Source ~= 0.0254 m. Valores de movimento derivados do CS:GO.
const U = 0.0254;

export const TICK_RATE = 64;
export const DT = 1 / TICK_RATE;
export const SNAPSHOT_EVERY = 3; // ~21 Hz online

export const GRAVITY = 800 * U;
export const JUMP_VELOCITY = 301.993 * U;
export const MAX_SPEED = 250 * U;
export const ACCELERATE = 5.5;
export const AIR_ACCELERATE = 12;
export const FRICTION = 5.2;
export const STOP_SPEED = 80 * U;
export const AIR_WISH_CAP = 30 * U;
export const WALK_MULT = 0.52;
export const CROUCH_MULT = 0.34;
export const STEP_HEIGHT = 0.45;
export const PLAYER_RADIUS = 0.4;
export const STAND_HEIGHT = 1.83;
export const CROUCH_HEIGHT = 1.37;
export const EYE_STAND = 1.63;
export const EYE_CROUCH = 1.17;
export const DUCK_SPEED = 7;

export const FREEZE_TIME = 8;
export const ROUND_TIME = 115;
export const POST_ROUND_TIME = 5;
export const BUY_TIME = 20;
export const BOMB_TIMER = 40;
export const PLANT_TIME = 4;
export const DEFUSE_TIME = 10;
export const DEFUSE_TIME_KIT = 5;
export const START_MONEY = 800;
export const MAX_MONEY = 16000;
export const MAX_ROUNDS = 24; // MR12: troca de lado no round 12, vence quem fizer 13

export const REWARD_WIN_ELIM = 3250;
export const REWARD_WIN_BOMB = 3500;
export const REWARD_WIN_DEFUSE = 3500;
export const REWARD_WIN_TIME = 3250;
export const LOSS_BONUS = [1400, 1900, 2400, 2900, 3400];
export const PLANT_BONUS_TEAM = 800;
export const PLANT_REWARD = 300;
export const DEFUSE_REWARD = 300;

export type Team = 'T' | 'CT';
export const otherTeam = (t: Team): Team => (t === 'T' ? 'CT' : 'T');

// Botões do comando (bitmask)
export const BTN_FIRE = 1;
export const BTN_ALT = 2;
export const BTN_JUMP = 4;
export const BTN_CROUCH = 8;
export const BTN_WALK = 16;
export const BTN_RELOAD = 32;
export const BTN_USE = 64;
export const BTN_DROP = 128;
