import { useFrame, useThree } from '@react-three/fiber';
import { useState, type RefObject } from 'react';
import { PerspectiveCamera, type Group } from 'three';
import type { GameSimulation } from '../engine/gameSimulation';
import type { InputController } from '../input/inputController';
import type { WorldDefinition } from '../world/worlds';
import { RenderLoop } from './renderLoop';

/**
 * Bridges R3F's frame callback to the RenderLoop. This is the only useFrame in the app,
 * so there is exactly one authoritative per-frame update.
 */
export interface GameLoopDriverProps {
  simulation: GameSimulation;
  input: InputController;
  vehicleRef: RefObject<Group | null>;
  world: WorldDefinition;
}

export function GameLoopDriver({ simulation, input, vehicleRef, world }: GameLoopDriverProps): null {
  const camera = useThree((state) => state.camera);
  const renderer = useThree((state) => state.gl);
  const [loop] = useState(() => new RenderLoop(simulation, input, world));

  useFrame((_state, deltaSeconds) => {
    if (!(camera instanceof PerspectiveCamera)) return;
    loop.tick({ deltaSeconds, camera, renderer, vehicle: vehicleRef.current });
  });

  return null;
}
