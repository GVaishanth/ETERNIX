import { useEffect, useMemo, useRef } from 'react';
import { Object3D, type SpotLight } from 'three';
import { headlightSpotIntensity, registerNightLight } from './nightLights';

/*
 * The player's two headlights: shadowless spotlights that sit on the car and follow it, because they are children of the
 * car's root group. Their intensity follows the night level, so they are off by day. Both are always mounted, so the
 * number of lights, and the shader they need, never changes during play. Positions are in the car's own frame: the
 * nose is at +Z (VehicleVisual.tsx). Only the player's car has these; traffic and rivals use emissive headlights only.
 */

const HEADLIGHT_X_M = 0.6;
const HEADLIGHT_Y_M = 0.6;
const HEADLIGHT_Z_M = 2.4;
const BEAM_LENGTH_M = 30;
const BEAM_ANGLE_RADIANS = 0.42;
const BEAM_PENUMBRA = 0.5;
const BEAM_DISTANCE_M = 70;
const BEAM_DECAY = 1.6;
const BEAM_COLOUR = '#fff1d0';

export function HeadlightRig() {
  const target = useMemo(() => new Object3D(), []);
  const left = useRef<SpotLight>(null);
  const right = useRef<SpotLight>(null);

  useEffect(() => {
    return registerNightLight((level) => {
      const intensity = headlightSpotIntensity(level);
      if (left.current) left.current.intensity = intensity;
      if (right.current) right.current.intensity = intensity;
    });
  }, []);

  return (
    <>
      <primitive object={target} position={[0, HEADLIGHT_Y_M * 0.5, BEAM_LENGTH_M]} />
      <spotLight
        ref={left}
        position={[-HEADLIGHT_X_M, HEADLIGHT_Y_M, HEADLIGHT_Z_M]}
        target={target}
        angle={BEAM_ANGLE_RADIANS}
        penumbra={BEAM_PENUMBRA}
        distance={BEAM_DISTANCE_M}
        decay={BEAM_DECAY}
        color={BEAM_COLOUR}
        intensity={0}
      />
      <spotLight
        ref={right}
        position={[HEADLIGHT_X_M, HEADLIGHT_Y_M, HEADLIGHT_Z_M]}
        target={target}
        angle={BEAM_ANGLE_RADIANS}
        penumbra={BEAM_PENUMBRA}
        distance={BEAM_DISTANCE_M}
        decay={BEAM_DECAY}
        color={BEAM_COLOUR}
        intensity={0}
      />
    </>
  );
}
