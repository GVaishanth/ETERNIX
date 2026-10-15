import { useRef } from 'react';
import type { Group } from 'three';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import type { GameSimulation } from '../engine/gameSimulation';
import type { InputController } from '../input/inputController';
import { GameLoopDriver } from './GameLoopDriver';
import { Ground, Road } from './WorldGeometry';
import { SimRoot } from './SimRoot';
import { VehicleModel } from './VehicleModel';

/**
 * The complete 3D scene: lights, the mirrored simulation root, and the loop driver.
 * Must be rendered as a child of <Canvas>.
 */
export interface RenderLayerProps {
  simulation: GameSimulation;
  input: InputController;
}

export function RenderLayer({ simulation, input }: RenderLayerProps) {
  const vehicleRef = useRef<Group>(null);

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[60, 120, 40]} intensity={1.1} />
      <SimRoot>
        <Ground />
        <Road />
        <VehicleModel ref={vehicleRef} config={VEHICLE_CONFIG} />
      </SimRoot>
      <GameLoopDriver simulation={simulation} input={input} vehicleRef={vehicleRef} />
    </>
  );
}
