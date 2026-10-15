/**
 * Display-unit conversions. Simulation code stays in SI units; convert only when showing values to a person.
 */
export const RAD_TO_DEG = 180 / Math.PI;
export const DEG_TO_RAD = Math.PI / 180;
export const MPS_TO_KPH = 3.6;

export function metersPerSecondToKph(speedMps: number): number {
  return speedMps * MPS_TO_KPH;
}
