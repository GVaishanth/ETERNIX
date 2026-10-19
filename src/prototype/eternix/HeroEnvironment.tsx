import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Color, DirectionalLight, Fog, HemisphereLight, PointLight } from 'three';
import { ETERNIX_PROTOTYPE_CONFIG as C } from '../../config/eternixPrototypeConfig';
import { QUALITY_PRESETS } from '../../config/qualityConfig';
import { applyAsphaltWetness } from '../../render/surfaceRegistry';
import { RainField } from '../../render/rainField';
import { lightingGoal, startingLive, stepLiveLighting } from '../../render/liveLighting';
import { applyNightLevel, lampLevelFor } from '../../render/nightLights';
import { useEnvironmentStore } from '../../state/environmentStore';
import { useQualityStore } from '../../state/qualityStore';
import { heroLightLevels, type HeroRigSettings } from './heroLightLevels';

/*
 * The landing's sky, fog, lights, and rain, driven by the shared environment (the same store the game uses). The hero
 * keeps its own studio rig: each shared value scales that rig (heroLightLevels.ts). Rain and the road's wetness use the
 * game's own code, so the look matches the game. The landing is not a gameplay scene, so nothing here affects physics.
 */

const RAIN_CAP = Math.max(...Object.values(QUALITY_PRESETS).map((preset) => preset.rainStreaks));
const RIG: HeroRigSettings = {
  hemisphereIntensity: C.light.hemisphereIntensity,
  keyIntensity: C.light.keyIntensity,
  tailLightIntensity: C.tailLight.intensity,
  fogNearMeters: C.fog.nearMeters,
  fogFarMeters: C.fog.farMeters,
};
const TAIL_LIGHT_POSITION = [C.road.laneCentreMeters, C.tailLight.heightMeters, -C.tailLight.rearMeters] as const;

export function HeroEnvironment() {
  const timeOfDay = useEnvironmentStore((state) => state.timeOfDay);
  const weather = useEnvironmentStore((state) => state.weather);
  const quality = useQualityStore((state) => state.quality);
  const invalidate = useThree((state) => state.invalidate);

  const [start] = useState(() => {
    const live = startingLive(timeOfDay, weather);
    return { live, levels: heroLightLevels(live, RIG) };
  });
  const live = useRef(start.live);

  const skyRef = useRef<Color>(null);
  const fogRef = useRef<Fog>(null);
  const hemisphereRef = useRef<HemisphereLight>(null);
  const keyRef = useRef<DirectionalLight>(null);
  const tailRef = useRef<PointLight>(null);

  const rainField = useMemo(() => new RainField(RAIN_CAP), []);
  useEffect(() => () => rainField.dispose(), [rainField]);

  // With on-demand rendering (reduced motion), a new environment must draw even though nothing else is running.
  useEffect(() => {
    invalidate();
  }, [timeOfDay, weather, invalidate]);

  useFrame((state, dt) => {
    const l = live.current;
    const settled = stepLiveLighting(l, lightingGoal(timeOfDay, weather), dt);
    applyNightLevel(lampLevelFor(l.lampMultiplier));
    const levels = heroLightLevels(l, RIG);
    if (skyRef.current) skyRef.current.copy(l.sky);
    if (fogRef.current) {
      fogRef.current.color.copy(l.fog);
      fogRef.current.near = levels.fogNear;
      fogRef.current.far = levels.fogFar;
    }
    if (hemisphereRef.current) {
      hemisphereRef.current.color.copy(l.ambient);
      hemisphereRef.current.intensity = levels.hemisphere;
    }
    if (keyRef.current) {
      keyRef.current.color.copy(l.sun);
      keyRef.current.intensity = levels.key;
    }
    if (tailRef.current) tailRef.current.intensity = levels.tailLight;
    applyAsphaltWetness(l.wetness);
    rainField.update(state.camera.position, state.clock.elapsedTime, l.wetness, QUALITY_PRESETS[quality].rainStreaks);
    if (!settled) invalidate();
  });

  return (
    <>
      <color ref={skyRef} attach="background" args={[start.live.sky]} />
      <fog ref={fogRef} attach="fog" args={[start.live.fog, start.levels.fogNear, start.levels.fogFar]} />
      <hemisphereLight ref={hemisphereRef} args={[start.live.ambient, C.light.groundHemisphere, start.levels.hemisphere]} />
      <directionalLight ref={keyRef} position={C.light.keyPosition} color={start.live.sun} intensity={start.levels.key} />
      <directionalLight position={C.light.rimPosition} color={C.light.colourRim} intensity={C.light.rimIntensity} />
      <pointLight
        ref={tailRef}
        position={TAIL_LIGHT_POSITION}
        color={C.colours.trailRed}
        intensity={start.levels.tailLight}
        distance={C.tailLight.distanceMeters}
        decay={2}
      />
      <primitive object={rainField.object} />
    </>
  );
}
