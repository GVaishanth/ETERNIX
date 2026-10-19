import { describe, expect, it } from 'vitest';
import { TIME_OF_DAY_PRESETS, WEATHER_PRESETS } from '../../config/environmentConfig';
import { ETERNIX_PROTOTYPE_CONFIG as C } from '../../config/eternixPrototypeConfig';
import { lightingGoal } from '../../render/liveLighting';
import { heroLightLevels, type HeroRigSettings } from './heroLightLevels';

const RIG: HeroRigSettings = {
  hemisphereIntensity: C.light.hemisphereIntensity,
  keyIntensity: C.light.keyIntensity,
  tailLightIntensity: C.tailLight.intensity,
  fogNearMeters: C.fog.nearMeters,
  fogFarMeters: C.fog.farMeters,
};

function levelsFor(timeOfDay: 'day' | 'evening' | 'night', weather: 'clear' | 'rain') {
  const goal = lightingGoal(timeOfDay, weather);
  return heroLightLevels(
    { ambientIntensity: goal.ambientIntensity, sunIntensity: goal.sunIntensity, lampMultiplier: goal.lampMultiplier, fogNear: goal.fogNear, fogFar: goal.fogFar },
    RIG,
  );
}

describe('hero light levels', () => {
  it('leaves the rig as configured at day in clear weather', () => {
    const day = levelsFor('day', 'clear');
    expect(day.hemisphere).toBeCloseTo(RIG.hemisphereIntensity, 9);
    expect(day.key).toBeCloseTo(RIG.keyIntensity, 9);
    expect(day.tailLight).toBeCloseTo(RIG.tailLightIntensity, 9);
    expect(day.fogNear).toBeCloseTo(RIG.fogNearMeters, 9);
    expect(day.fogFar).toBeCloseTo(RIG.fogFarMeters, 9);
  });

  it('dims the key light at night more than at evening, and the evening more than the day', () => {
    const day = levelsFor('day', 'clear');
    const evening = levelsFor('evening', 'clear');
    const night = levelsFor('night', 'clear');
    expect(night.key).toBeLessThan(evening.key);
    expect(evening.key).toBeLessThan(day.key);
  });

  it('brightens the tail lights after dusk, when the lamps read as lit', () => {
    expect(levelsFor('night', 'clear').tailLight).toBeGreaterThan(levelsFor('day', 'clear').tailLight);
  });

  it('thickens the fog in rain, so the far end is closer', () => {
    const clear = levelsFor('day', 'clear');
    const rain = levelsFor('day', 'rain');
    expect(rain.fogFar).toBeLessThan(clear.fogFar);
    expect(rain.fogNear).toBeLessThan(clear.fogNear);
  });

  it('keeps every level finite and non-negative for every environment', () => {
    for (const timeOfDay of Object.keys(TIME_OF_DAY_PRESETS) as Array<'day' | 'evening' | 'night'>) {
      for (const weather of Object.keys(WEATHER_PRESETS) as Array<'clear' | 'rain'>) {
        const levels = levelsFor(timeOfDay, weather);
        for (const value of Object.values(levels)) {
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});
