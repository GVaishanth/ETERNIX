/**
 * Central vehicle tuning. Every value is SI and documented here; do not duplicate
 * these numbers in components. All values are PLACEHOLDERS for Phase 0 and must be
 * re-tuned in the vehicle-handling phase.
 */
export interface VehicleConfig {
  /** Distance between front and rear axles. Meters. */
  readonly wheelbaseMeters: number;
  /** Distance between left and right wheels. Meters. */
  readonly trackWidthMeters: number;
  /** Overall body length, bumper to bumper. Meters. */
  readonly bodyLengthMeters: number;
  /** Overall body width. Meters. */
  readonly bodyWidthMeters: number;
  /** Height of the lower body above the wheel bottoms. Meters. */
  readonly bodyHeightMeters: number;
  /** Wheel radius. Meters. */
  readonly wheelRadiusMeters: number;

  /** Maximum front-wheel angle at standstill. Radians. */
  readonly maxSteerAngleRadians: number;
  /** Fraction of steer authority removed at top speed (0 = none, 1 = all). */
  readonly steerReductionAtTopSpeed: number;
  /** How fast the front wheels move toward the commanded angle. Radians per second. */
  readonly steerRateRadiansPerSecond: number;
  /** Lateral acceleration limit that caps yaw rate at speed. m/s^2. */
  readonly maxLateralAccelerationMps2: number;

  /** Forward speed limit. m/s. (62 m/s is about 223 km/h.) */
  readonly maxForwardSpeedMps: number;
  /** Reverse speed limit, as a positive magnitude. m/s. */
  readonly maxReverseSpeedMps: number;
  /** Acceleration at full throttle, scaled down near top speed. m/s^2. */
  readonly engineAccelerationMps2: number;
  /** Acceleration while reversing at full brake input. m/s^2. */
  readonly reverseAccelerationMps2: number;
  /** Deceleration at full brake input while moving forward. m/s^2. */
  readonly brakeDecelerationMps2: number;
  /** Passive deceleration when no drive input is held. m/s^2. */
  readonly coastDecelerationMps2: number;
}

export const VEHICLE_CONFIG: VehicleConfig = {
  wheelbaseMeters: 2.7,
  trackWidthMeters: 1.6,
  bodyLengthMeters: 4.5,
  bodyWidthMeters: 1.85,
  bodyHeightMeters: 0.6,
  wheelRadiusMeters: 0.33,

  maxSteerAngleRadians: 0.55,
  steerReductionAtTopSpeed: 0.5,
  steerRateRadiansPerSecond: 2.8,
  maxLateralAccelerationMps2: 14,

  maxForwardSpeedMps: 62,
  maxReverseSpeedMps: 12,
  engineAccelerationMps2: 9,
  reverseAccelerationMps2: 4,
  brakeDecelerationMps2: 18,
  coastDecelerationMps2: 1.2,
};
