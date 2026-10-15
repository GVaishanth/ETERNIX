/**
 * Central vehicle tuning. Every handling value lives here. Components and simulation code must not
 * hardcode gameplay numbers.
 *
 * Units: SI throughout. Meters, seconds, m/s, m/s^2, radians, and 1/s where marked.
 *
 * Model scope: an arcade single-track model. Accelerations are specified directly in m/s^2, so vehicle
 * mass cancels out and is deliberately NOT a parameter. Yaw inertia is represented by `yawResponseSeconds`.
 * Tire behavior is a linear grip stiffness with a saturating force limit, not a Pacejka curve.
 * All values are placeholders for tuning, not measured data.
 */
export interface VehicleConfig {
  // ---- Dimensions (meters). Origin is the rear-axle center on the ground. Nose is +Z. ----
  readonly wheelbaseMeters: number;
  readonly trackWidthMeters: number;
  readonly bodyLengthMeters: number;
  readonly bodyWidthMeters: number;
  readonly bodyHeightMeters: number;
  /** Wheel radius. Drives wheel spin: spin (rad) = distance traveled / radius. */
  readonly wheelRadiusMeters: number;

  // ---- Pedal response. Pedals ramp toward their target; they do not jump. (1/s) ----
  /** How fast the throttle pedal rises toward full. */
  readonly throttleRisePerSecond: number;
  /** How fast the throttle pedal releases when the key is up. */
  readonly throttleReleasePerSecond: number;
  readonly brakeRisePerSecond: number;
  readonly brakeReleasePerSecond: number;

  // ---- Longitudinal model (m/s, m/s^2) ----
  /** Forward speed hard cap. */
  readonly maxForwardSpeedMps: number;
  /** Reverse speed hard cap, as a positive magnitude. */
  readonly maxReverseSpeedMps: number;
  /** Engine acceleration at standstill, at full throttle. */
  readonly engineAccelerationMps2: number;
  /**
   * Speed at which engine acceleration fades to zero, with a linear taper. Placed above the top speed so
   * the aero/rolling equilibrium lands near `maxForwardSpeedMps`. The hard cap rarely engages.
   */
  readonly engineFadeSpeedMps: number;
  /** Deceleration at full brake while moving forward. Brakes stop exactly at zero, never into reverse. */
  readonly brakeDecelerationMps2: number;
  /** Acceleration in reverse at full brake while stopped (the brake must be held after the car stops). */
  readonly reverseAccelerationMps2: number;
  /** Constant rolling resistance, opposing motion. Gives natural coasting. */
  readonly rollingResistanceMps2: number;
  /**
   * Aerodynamic drag coefficient, 1/m. Resistance adds airDragPerMeter * v^2 (m/s^2).
   * Derived as 0.5 * rho * Cd * A / m with a representative road car.
   */
  readonly airDragPerMeter: number;
  /** Deceleration while the handbrake is held and the car is moving. The handbrake never reverses the car. */
  readonly handbrakeDecelerationMps2: number;

  // ---- Steering ----
  /** Maximum front-wheel angle at standstill (low-speed steering). Radians. */
  readonly steerAngleLowSpeedRadians: number;
  /** Maximum front-wheel angle at top speed (high-speed steering). Radians. */
  readonly steerAngleHighSpeedRadians: number;
  /** Rate at which the front wheels move toward the commanded angle. Radians/s. */
  readonly steerRateRadiansPerSecond: number;
  /**
   * Time constant of the yaw response. The yaw rate chases the kinematic target with this lag, so
   * heading changes are smooth. Acts as the effective yaw inertia.
   */
  readonly yawResponseSeconds: number;

  // ---- Lateral grip and drift ----
  /** Lateral tire stiffness with full grip. 1/s. Higher means less sideways slip. */
  readonly lateralGripPerSecond: number;
  /** Lateral tire stiffness while the handbrake is fully applied at drift speed. 1/s. */
  readonly lateralGripDriftPerSecond: number;
  /** Lateral force limit with full grip. m/s^2. Caps the yaw rate at speed: yaw <= limit / speed. */
  readonly maxLateralAccelerationMps2: number;
  /** Lateral force limit while drifting. m/s^2. Prevents unlimited sideways acceleration. */
  readonly maxDriftLateralAccelerationMps2: number;
  /** Hard cap on the slip angle (velocity direction vs. heading). Degrees. */
  readonly maxSlipAngleDegrees: number;
  /** Below this speed, the handbrake does not reduce grip, so it cannot initiate a drift. m/s. */
  readonly driftMinSpeedMps: number;
  /** Speed range over which the drift grip reduction ramps in above `driftMinSpeedMps`. m/s. */
  readonly driftSpeedRampMps: number;
  /** Time for the handbrake engagement to reach full effect. Seconds. */
  readonly handbrakeEngageSeconds: number;
  /** Time for the handbrake engagement to fade after release. Seconds. Longer than engage, for smooth recovery. */
  readonly handbrakeReleaseSeconds: number;
  /** A slip angle above this counts as drifting, for HUD and telemetry. Degrees. */
  readonly driftSlipThresholdDegrees: number;

  // ---- Visual body response (cosmetic only, never changes the vehicle root) ----
  /** Body pitch per unit longitudinal acceleration. Positive pitch is nose down. rad per (m/s^2). */
  readonly pitchPerAccelRadians: number;
  /** Body roll per unit lateral acceleration. Positive roll lifts the right side. rad per (m/s^2). */
  readonly rollPerLateralAccelRadians: number;
  readonly maxBodyPitchRadians: number;
  readonly maxBodyRollRadians: number;
  /** Body squat (rear down under acceleration) per unit longitudinal acceleration. m per (m/s^2). */
  readonly squatPerAccelMeters: number;
  readonly maxBodyHeaveMeters: number;
  /** Natural frequency of the visual suspension spring. rad/s. */
  readonly suspensionFrequencyRadPerSecond: number;
  /** Damping ratio of the visual suspension. 1 is critically damped. */
  readonly suspensionDampingRatio: number;
}

export const VEHICLE_CONFIG: VehicleConfig = {
  wheelbaseMeters: 2.7,
  trackWidthMeters: 1.6,
  bodyLengthMeters: 4.5,
  bodyWidthMeters: 1.85,
  bodyHeightMeters: 0.6,
  wheelRadiusMeters: 0.33,

  throttleRisePerSecond: 3.0,
  throttleReleasePerSecond: 5.0,
  brakeRisePerSecond: 6.0,
  brakeReleasePerSecond: 8.0,

  maxForwardSpeedMps: 62,
  maxReverseSpeedMps: 12,
  engineAccelerationMps2: 9,
  engineFadeSpeedMps: 79.4,
  brakeDecelerationMps2: 18,
  reverseAccelerationMps2: 4,
  rollingResistanceMps2: 1.2,
  airDragPerMeter: 0.0002,
  handbrakeDecelerationMps2: 6,

  steerAngleLowSpeedRadians: 0.55,
  steerAngleHighSpeedRadians: 0.2,
  steerRateRadiansPerSecond: 2.8,
  yawResponseSeconds: 0.12,

  lateralGripPerSecond: 8,
  lateralGripDriftPerSecond: 1.6,
  maxLateralAccelerationMps2: 14,
  maxDriftLateralAccelerationMps2: 10,
  maxSlipAngleDegrees: 50,
  driftMinSpeedMps: 8,
  driftSpeedRampMps: 4,
  handbrakeEngageSeconds: 0.25,
  handbrakeReleaseSeconds: 0.5,
  driftSlipThresholdDegrees: 6,

  pitchPerAccelRadians: 0.0025,
  rollPerLateralAccelRadians: 0.0025,
  maxBodyPitchRadians: 0.035,
  maxBodyRollRadians: 0.05,
  squatPerAccelMeters: 0.001,
  maxBodyHeaveMeters: 0.02,
  suspensionFrequencyRadPerSecond: 9,
  suspensionDampingRatio: 0.7,
};
