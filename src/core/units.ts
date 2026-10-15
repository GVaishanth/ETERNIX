/**
 * Display-unit conversions. Simulation code stays in SI units; convert only when showing values to a person.
 * Every speed shown to the player or in telemetry goes through these functions, so there is one definition per unit.
 */
export const RAD_TO_DEG = 180 / Math.PI;
export const DEG_TO_RAD = Math.PI / 180;
export const MPS_TO_KPH = 3.6;
export const MPS_TO_MPH = 2.2369362920544;

export function metersPerSecondToKph(speedMps: number): number {
  return speedMps * MPS_TO_KPH;
}

export function metersPerSecondToMph(speedMps: number): number {
  return speedMps * MPS_TO_MPH;
}
