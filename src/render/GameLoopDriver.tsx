import { useFrame, useThree } from '@react-three/fiber';
import { useState, type RefObject } from 'react';
import { PerspectiveCamera, type Group } from 'three';
import type { GameSimulation } from '../engine/gameSimulation';
import type { InputController } from '../input/inputController';
import type { WorldDefinition } from '../world/worlds';
import { RenderLoop } from './renderLoop';
import type { TrafficVisualPool } from './trafficVisuals';
import type { RaceController } from '../race/raceController';
import type { RaceVisualPool } from './raceVisuals';
import type { NavigationScene } from './navigationScene';
import type { PursuitController } from '../pursuit/pursuitController';
import type { PoliceVisualPool } from './policeVisuals';
import type { WorldStreamer } from '../world/streaming/streamer';
import type { WorldOriginTargets } from './worldOrigin';

/**
 * Bridges R3F's frame callback to the RenderLoop. This is the only useFrame in the app,
 * so there is exactly one authoritative per-frame update.
 */
export interface GameLoopDriverProps {
  simulation: GameSimulation;
  input: InputController;
  vehicleRef: RefObject<Group | null>;
  world: WorldDefinition;
  /** Traffic visual pool, or null when the world has no traffic. */
  trafficVisuals: TrafficVisualPool | null;
  /** Opponent visual pool, or null when there are no opponents. */
  opponentVisuals: TrafficVisualPool | null;
  /** Race controller, or null when the world has no races. */
  race: RaceController | null;
  raceVisuals: RaceVisualPool | null;
  /** Police pursuit controller, or null when the world has no pursuit. */
  pursuit: PursuitController | null;
  policeVisuals: PoliceVisualPool | null;
  /** World streamer for the chunked city, or null when the world is not streamed. */
  streamer: WorldStreamer | null;
  /** Floating-origin targets. Moved each frame; see worldOrigin.ts. */
  origin: WorldOriginTargets;
  /** Navigation route and visuals, or null where the world has no lane graph. */
  navigation: NavigationScene | null;
}

export function GameLoopDriver({ simulation, input, vehicleRef, world, trafficVisuals, opponentVisuals, race, raceVisuals, pursuit, policeVisuals, streamer, origin, navigation }: GameLoopDriverProps): null {
  const camera = useThree((state) => state.camera);
  const renderer = useThree((state) => state.gl);
  const [loop] = useState(() => new RenderLoop(simulation, input, world, trafficVisuals, opponentVisuals, race, raceVisuals, pursuit, policeVisuals, streamer, origin, navigation));

  useFrame((_state, deltaSeconds) => {
    if (!(camera instanceof PerspectiveCamera)) return;
    loop.tick({ deltaSeconds, camera, renderer, vehicle: vehicleRef.current });
  });

  return null;
}
