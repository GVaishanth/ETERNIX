import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { AmbientLight, DirectionalLight, Fog, Color } from 'three';
import { QUALITY_PRESETS } from '../config/qualityConfig';
import { lightingGoal, startingLive, stepLiveLighting } from './liveLighting';
import { applyNightLevel, lampLevelFor } from './nightLights';
import { useEnvironmentStore } from '../state/environmentStore';
import { useQualityStore } from '../state/qualityStore';
import { applyAsphaltWetness } from './surfaceRegistry';
import { RainField } from './rainField';

/*
 * Lighting, fog, sky, and rain for the gameplay world (Part 10). It owns the scene's lights and fog, so there is one set.
 * Live values approach their targets each frame by time constant, so a change of time or weather is gradual at any frame
 * rate (liveLighting.ts). Rain is a single bounded LineSegments built once at the highest quality count; the quality
 * preset sets how many of its streaks are drawn. Streaks are anchored in the world and wrap around the camera, so they do
 * not swim with the car.
 */

const RAIN_CAP = Math.max(...Object.values(QUALITY_PRESETS).map((preset) => preset.rainStreaks));

export function Environment() {
  const timeOfDay = useEnvironmentStore((state) => state.timeOfDay);
  const weather = useEnvironmentStore((state) => state.weather);
  const quality = useQualityStore((state) => state.quality);
  const streakBudget = QUALITY_PRESETS[quality].rainStreaks;

  // The first frame starts at the current environment, so a load does not blend in from day.
  const [start] = useState(() => startingLive(timeOfDay, weather));
  const live = useRef(start);

  const ambientRef = useRef<AmbientLight>(null);
  const sunRef = useRef<DirectionalLight>(null);
  const fogRef = useRef<Fog>(null);
  const skyRef = useRef<Color>(null);

  // Rain: one bounded buffer, allocated once and disposed with the component.
  const rainField = useMemo(() => new RainField(RAIN_CAP), []);
  useEffect(() => () => rainField.dispose(), [rainField]);

  useFrame((state, dt) => {
    const goal = lightingGoal(timeOfDay, weather);
    const l = live.current;
    stepLiveLighting(l, goal, dt);
    applyNightLevel(lampLevelFor(l.lampMultiplier));

    if (fogRef.current) {
      fogRef.current.color.copy(l.fog);
      fogRef.current.near = l.fogNear;
      fogRef.current.far = l.fogFar;
    }
    if (skyRef.current) skyRef.current.copy(l.sky);
    if (ambientRef.current) {
      ambientRef.current.color.copy(l.ambient);
      ambientRef.current.intensity = l.ambientIntensity;
    }
    if (sunRef.current) {
      sunRef.current.color.copy(l.sun);
      sunRef.current.intensity = l.sunIntensity;
    }
    applyAsphaltWetness(l.wetness);
    rainField.update(state.camera.position, state.clock.elapsedTime, l.wetness, streakBudget);
  });

  return (
    <>
      {/* Fog and background are declarative: R3F attaches them to the scene, and the frame loop updates their values. */}
      <fog ref={fogRef} attach="fog" args={[start.fog, start.fogNear, start.fogFar]} />
      <color ref={skyRef} attach="background" args={[start.sky]} />
      <ambientLight ref={ambientRef} intensity={start.ambientIntensity} />
      <directionalLight ref={sunRef} position={[60, 120, 40]} intensity={start.sunIntensity} />
      <primitive object={rainField.object} />
    </>
  );
}
