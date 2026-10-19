/**
 * Part 8 performance upgrades. Each category has three tiers. A tier multiplies the base value of the keys it
 * touches, so an upgrade changes the real controller input, not a separate calculation.
 *
 * Rules (enforced in garage/garageModel.ts and vehicles/effectiveSpecs.ts):
 * - Tiers are bought one at a time, in order. Tier n needs tier n-1.
 * - No downgrades. A category only goes up.
 * - A vehicle can only take the categories listed in its `upgradeSupport`.
 * - Every effective value is clamped to SPEC_LIMITS, so stacked tiers cannot leave the safe envelope.
 *
 * Factors are multipliers on the vehicle's value, index 0 = tier 1. Transmission trades acceleration for top speed,
 * by design: the higher gearing gives a higher top speed at a small cost in initial pull.
 */
import type { TunableSpecKey } from './specLimits';

export const UPGRADE_CATEGORIES = ['engine', 'transmission', 'tires', 'brakes'] as const;
export type UpgradeCategory = (typeof UPGRADE_CATEGORIES)[number];

export const MAX_UPGRADE_TIER = 3;

export interface UpgradeEffect {
  readonly key: TunableSpecKey;
  /** Multipliers for tiers 1, 2, 3. */
  readonly factors: readonly [number, number, number];
}

export interface UpgradeDefinition {
  readonly id: UpgradeCategory;
  readonly label: string;
  readonly description: string;
  readonly effects: readonly UpgradeEffect[];
}

export const UPGRADES: Readonly<Record<UpgradeCategory, UpgradeDefinition>> = {
  engine: {
    id: 'engine',
    label: 'Engine',
    description: 'More pull from a standstill.',
    effects: [{ key: 'engineAccelerationMps2', factors: [1.06, 1.12, 1.18] }],
  },
  transmission: {
    id: 'transmission',
    label: 'Transmission',
    description: 'Longer gearing: higher top speed, slightly less initial pull.',
    effects: [
      { key: 'maxForwardSpeedMps', factors: [1.05, 1.1, 1.15] },
      { key: 'engineFadeSpeedMps', factors: [1.05, 1.1, 1.15] },
      { key: 'engineAccelerationMps2', factors: [0.99, 0.98, 0.97] },
    ],
  },
  tires: {
    id: 'tires',
    label: 'Tires',
    description: 'Stickier rubber: more lateral grip and cornering force.',
    effects: [
      { key: 'lateralGripPerSecond', factors: [1.06, 1.12, 1.18] },
      { key: 'maxLateralAccelerationMps2', factors: [1.05, 1.1, 1.15] },
    ],
  },
  brakes: {
    id: 'brakes',
    label: 'Brakes',
    description: 'Stronger braking and handbrake deceleration.',
    effects: [
      { key: 'brakeDecelerationMps2', factors: [1.08, 1.16, 1.24] },
      { key: 'handbrakeDecelerationMps2', factors: [1.08, 1.16, 1.24] },
    ],
  },
};
