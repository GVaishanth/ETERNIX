/*
 * The per-tick vehicle snapshot for presentation effects (tire smoke). The render loop writes it once per tick as plain
 * numbers, and effect components read it. No React state, so the feed causes no re-renders.
 */
export interface EffectFeed {
  active: boolean;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  lateralSpeed: number;
  handbrake: boolean;
  throttle: number;
  wheelSpin: number;
}

export const effectFeed: EffectFeed = {
  active: false,
  x: 0,
  z: 0,
  yaw: 0,
  speed: 0,
  lateralSpeed: 0,
  handbrake: false,
  throttle: 0,
  wheelSpin: 0,
};
