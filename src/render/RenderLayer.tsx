import { lazy, Suspense, useRef } from 'react';
import type { Group } from 'three';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import type { GameSimulation } from '../engine/gameSimulation';
import type { InputController } from '../input/inputController';
import type { WorldDefinition } from '../world/worlds';
import { GameLoopDriver } from './GameLoopDriver';
import { NetworkGround, RoadNetworkScene } from './RoadNetworkScene';
import { Scenery } from './Scenery';
import { SimRoot } from './SimRoot';
import { Ground, Road } from './WorldGeometry';
import { VehicleVisual } from './VehicleVisual';

// The road debug overlay exists only in DEV builds. In production this resolves to null, so its chunk is not emitted.
const RoadDebugOverlay = import.meta.env.DEV
  ? lazy(() => import('./RoadDebugOverlay'))
  : null;

/**
 * The complete 3D scene: lights, the mirrored simulation root, and the loop driver.
 * Must be rendered as a child of <Canvas>. The world decides which road is drawn.
 */
export interface RenderLayerProps {
  simulation: GameSimulation;
  input: InputController;
  world: WorldDefinition;
}

export function RenderLayer({ simulation, input, world }: RenderLayerProps) {
  const vehicleRef = useRef<Group>(null);
  const network = world.network;
  const bounds = world.bounds;

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[60, 120, 40]} intensity={1.1} />
      <SimRoot>
        {network && bounds ? (
          <>
            <NetworkGround bounds={bounds} />
            <RoadNetworkScene network={network} />
            {RoadDebugOverlay ? (
              <Suspense fallback={null}>
                <RoadDebugOverlay network={network} />
              </Suspense>
            ) : null}
          </>
        ) : (
          <>
            <Ground />
            <Road />
            <Scenery />
          </>
        )}
        <VehicleVisual ref={vehicleRef} config={VEHICLE_CONFIG} />
      </SimRoot>
      <GameLoopDriver simulation={simulation} input={input} vehicleRef={vehicleRef} world={world} />
    </>
  );
}
