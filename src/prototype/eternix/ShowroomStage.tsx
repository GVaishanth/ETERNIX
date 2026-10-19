import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Color, DirectionalLight, MeshStandardMaterial, PointLight } from 'three';
import { Vector3 } from 'three';
import { ETERNIX_PROTOTYPE_CONFIG as C } from '../../config/eternixPrototypeConfig';
import { lightingGoal, startingLive, stepLiveLighting, type LiveLighting } from '../../render/liveLighting';
import { applyNightLevel, lampLevelFor } from '../../render/nightLights';
import { useEnvironmentStore } from '../../state/environmentStore';
import { ActiveCar } from './ActiveCar';
import type { CarSummary } from './saveSnapshot';
import { StudioEnvironment } from './StudioEnvironment';
import { applyStudioLighting, studioTargets, type StudioSettings } from './studioLighting';
import { approachAngle, orbitPosition, viewAngle, type ShowroomView } from './showroomOrbit';

/*
 * The garage view: the player's active car, on a dark glossy floor under a red rim. The key light, fill light,
 * background, and floor follow the shared day and weather (studioLighting.ts), so the studio matches the game and the
 * home page. The camera swings to the chosen view. Under reduced motion it jumps.
 */

interface ShowroomStageProps {
  readonly car: CarSummary;
  readonly view: ShowroomView;
  readonly reducedMotion: boolean;
}

const screenRight = new Vector3();
const FIXED_STUDIO_SETTINGS = (): StudioSettings => ({
  backgroundColour: C.showroom.backgroundColour,
  floorColour: C.showroom.floorColour,
  floorRoughness: C.showroom.floorRoughness,
  keyColour: C.showroom.keyColour,
  keyIntensity: C.showroom.keyIntensity,
  fillColour: C.showroom.fillColour,
  fillIntensity: C.showroom.fillIntensity,
});

/**
 * The studio's lights, background, and floor, driven each frame by the shared environment. The live values start at
 * the stored environment (no blend in from day), then move toward the goal like the game does.
 */
function StudioSet() {
  const cfg = C.showroom;
  const base = useMemo(() => studioTargets(FIXED_STUDIO_SETTINGS()), []);
  const out = useMemo(() => studioTargets(FIXED_STUDIO_SETTINGS()), []);
  const [live] = useState<LiveLighting>(() => {
    const { timeOfDay, weather } = useEnvironmentStore.getState();
    return startingLive(timeOfDay, weather);
  });
  const backgroundRef = useRef<Color>(null);
  const floorRef = useRef<MeshStandardMaterial>(null);
  const keyRef = useRef<DirectionalLight>(null);
  const fillRef = useRef<PointLight>(null);

  useFrame((_, delta) => {
    const { timeOfDay, weather } = useEnvironmentStore.getState();
    stepLiveLighting(live, lightingGoal(timeOfDay, weather), Math.min(delta, 0.1));
    applyNightLevel(lampLevelFor(live.lampMultiplier));
    applyStudioLighting(live, base, out);
    backgroundRef.current?.copy(out.background);
    if (floorRef.current) {
      floorRef.current.color.copy(out.floor);
      floorRef.current.roughness = out.floorRoughness;
    }
    if (keyRef.current) {
      keyRef.current.color.copy(out.key);
      keyRef.current.intensity = out.keyIntensity;
    }
    if (fillRef.current) {
      fillRef.current.color.copy(out.fill);
      fillRef.current.intensity = out.fillIntensity;
    }
  });

  return (
    <>
      <color ref={backgroundRef} attach="background" args={[cfg.backgroundColour]} />
      <StudioEnvironment intensity={C.light.environmentIntensity} />
      <hemisphereLight args={[C.light.skyHemisphere, C.light.groundHemisphere, 0.35]} />
      <directionalLight ref={keyRef} position={cfg.keyPosition} color={cfg.keyColour} intensity={cfg.keyIntensity} />
      <pointLight position={cfg.rimPosition} color={C.colours.trailRed} intensity={cfg.rimIntensity} distance={14} decay={2} />
      <pointLight ref={fillRef} position={cfg.fillPosition} color={cfg.fillColour} intensity={cfg.fillIntensity} distance={20} decay={2} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <circleGeometry args={[14, 72]} />
        <meshStandardMaterial ref={floorRef} color={cfg.floorColour} roughness={cfg.floorRoughness} metalness={0.15} />
      </mesh>
    </>
  );
}

function OrbitRig({ view, reducedMotion }: { readonly view: ShowroomView; readonly reducedMotion: boolean }) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const goal = useRef(viewAngle(view));
  const angle = useRef(viewAngle(view));
  useEffect(() => {
    goal.current = viewAngle(view);
  }, [view]);
  useFrame((_, delta) => {
    const step = Math.min(delta, 0.1);
    angle.current = reducedMotion
      ? goal.current
      : approachAngle(angle.current, goal.current, C.showroom.orbitRatePerSecond, step);
    // Narrow screens (phones) pull back and aim lower, so the car sits above the garage text rather than under it.
    const cfg = C.showroom;
    const portrait = size.width / size.height < cfg.portraitAspect;
    const radius = portrait ? cfg.radiusMeters * cfg.portraitRadiusScale : cfg.radiusMeters;
    const targetY = cfg.targetHeightMeters - (portrait ? cfg.portraitLiftMeters : 0);
    const [x, y, z] = orbitPosition(angle.current, radius, cfg.heightMeters);
    camera.position.set(x, y, z);
    camera.lookAt(0, targetY, 0);
    // Aim a little to the camera's left, so the car lands right of centre. This only changes where the lens points.
    screenRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    const shift = portrait ? cfg.portraitFramingShiftMeters : cfg.framingShiftMeters;
    camera.lookAt(-screenRight.x * shift, targetY - screenRight.y * shift, -screenRight.z * shift);
  });
  return null;
}

export function ShowroomStage({ car, view, reducedMotion }: ShowroomStageProps) {
  return (
    <Canvas
      dpr={[1, C.maxPixelRatio]}
      frameloop="always"
      gl={{ antialias: true }}
      camera={{ fov: C.camera.fovDegrees, near: C.camera.nearMeters, far: 80 }}
    >
      <StudioSet />
      <OrbitRig view={view} reducedMotion={reducedMotion} />
      <ActiveCar car={car} />
    </Canvas>
  );
}
