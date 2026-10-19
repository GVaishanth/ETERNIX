import type { PursuitHeatLevelConfig } from '../config/pursuitConfig';

/*
 * Pursuit heat (Part 7). Heat is the intensity of one pursuit session. It is not a persistent value: the session resets
 * it to zero when it ends. Pure functions only. The rules: heat rises while the pursuit runs, and falls only in
 * cooldown, and only at a set rate. It never drops at once.
 */

/** Returns the problems with a level table, or an empty list when it is valid. Checked by tests and at start-up. */
export function validateHeatLevels(levels: readonly PursuitHeatLevelConfig[], maxHeat: number): string[] {
  const issues: string[] = [];
  if (levels.length !== 5) issues.push(`expected 5 heat levels, found ${levels.length}`);
  levels.forEach((level, index) => {
    if (level.level !== index + 1) issues.push(`level at index ${index} is numbered ${level.level}, expected ${index + 1}`);
    if (level.maxUnits < 1) issues.push(`level ${level.level} has no units`);
    if (level.speedCapMps <= 0) issues.push(`level ${level.level} has a non-positive speed cap`);
    if (level.searchSeconds <= 0) issues.push(`level ${level.level} has a non-positive search time`);
    if (level.heatThreshold < 0 || level.heatThreshold >= maxHeat) issues.push(`level ${level.level} threshold is outside 0..max`);
    const previous = levels[index - 1];
    if (index === 0 && level.heatThreshold !== 0) issues.push('level 1 must start at heat 0');
    if (previous && level.heatThreshold <= previous.heatThreshold) issues.push(`level ${level.level} threshold must rise`);
    if (previous && level.maxUnits < previous.maxUnits) issues.push(`level ${level.level} has fewer units than the level before`);
  });
  return issues;
}

/** The level for a heat value: the highest level whose threshold is reached. Heat below level 1 is level 1. */
export function heatLevelFor(heat: number, levels: readonly PursuitHeatLevelConfig[]): PursuitHeatLevelConfig {
  let found = levels[0];
  if (!found) throw new Error('No heat levels are configured');
  for (const level of levels) {
    if (heat >= level.heatThreshold) found = level;
  }
  return found;
}

/** Heat after adding a gain, capped. Negative gains are not allowed here: decay has its own function. */
export function addHeat(current: number, gain: number, maxHeat: number): number {
  if (gain <= 0) return current;
  return Math.min(maxHeat, current + gain);
}

/** Heat after decay over `seconds`, floored at zero. Used only in cooldown. */
export function decayHeat(current: number, perSecond: number, seconds: number): number {
  return Math.max(0, current - perSecond * Math.max(0, seconds));
}
