/*
 * Camera orbit for the garage view. Angles are in radians around the car's vertical axis. 0 puts the camera on the nose
 * side (+z). Angles grow toward +x, so pi/2 is the car's right side. Pure functions, so they are tested without WebGL.
 */

export type ShowroomView = 'threeQuarter' | 'side' | 'front' | 'rear';

export interface ShowroomViewOption {
  readonly id: ShowroomView;
  readonly label: string;
  readonly angleRadians: number;
}

/** The four views. The 3/4 view is the rear-left quarter, the same side the landing shows. */
export const SHOWROOM_VIEWS: readonly ShowroomViewOption[] = [
  { id: 'threeQuarter', label: '3/4', angleRadians: (5 * Math.PI) / 4 },
  { id: 'side', label: 'Side', angleRadians: Math.PI / 2 },
  { id: 'front', label: 'Front', angleRadians: 0 },
  { id: 'rear', label: 'Rear', angleRadians: Math.PI },
];

export function viewAngle(view: ShowroomView): number {
  const option = SHOWROOM_VIEWS.find((candidate) => candidate.id === view);
  return option ? option.angleRadians : 0;
}

/** Wraps an angle into (-pi, pi]. */
export function wrapAngle(angle: number): number {
  const twoPi = 2 * Math.PI;
  const wrapped = (((angle + Math.PI) % twoPi) + twoPi) % twoPi;
  return wrapped - Math.PI;
}

/** Camera position on the orbit, in metres. y is the height. */
export function orbitPosition(angle: number, radius: number, height: number): readonly [number, number, number] {
  return [radius * Math.sin(angle), height, radius * Math.cos(angle)];
}

/**
 * Moves an angle toward its goal by the short way round. The step is exponential, so the motion slows as it arrives
 * and does not overshoot. The rate is in 1/s and dt in s.
 */
export function approachAngle(current: number, goal: number, ratePerSecond: number, dt: number): number {
  const remaining = wrapAngle(goal - current);
  const fraction = 1 - Math.exp(-ratePerSecond * dt);
  return current + remaining * fraction;
}
