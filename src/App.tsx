import { Canvas } from '@react-three/fiber';
import { lazy, Suspense, useEffect, useState } from 'react';
import { CHASE_CAMERA_CONFIG } from './config/cameraConfig';
import { VEHICLE_CONFIG } from './config/vehicleConfig';
import { GameSimulation } from './engine/gameSimulation';
import { getWorldDefinition, parseWorldId } from './world/worlds';
import { InputController } from './input/inputController';
import { RenderLayer } from './render/RenderLayer';
import { Hud } from './ui/Hud';

const SKY_COLOR = '#9cc3e0';

// In production builds this resolves to null at compile time, so the debug panel chunk is not emitted.
const DebugPanel = import.meta.env.DEV
  ? lazy(() => import('./diagnostics/DebugPanel').then((module) => ({ default: module.DebugPanel })))
  : null;

export function App() {
  // ?world=legacy loads the preserved straight road. Any other value loads the test circuit (Part 3 default).
  const [world] = useState(() => getWorldDefinition(parseWorldId(window.location.search)));
  const [simulation] = useState(() => new GameSimulation(VEHICLE_CONFIG, { spawn: world.spawn, boundary: world.boundary }));
  const [input] = useState(() => new InputController());

  // The only keyboard listeners in the app. Removed on unmount, and re-attached cleanly under StrictMode.
  useEffect(() => input.attach(window, document), [input]);

  return (
    <>
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true }}
        camera={{
          fov: CHASE_CAMERA_CONFIG.fovBaseDegrees,
          near: CHASE_CAMERA_CONFIG.nearMeters,
          far: CHASE_CAMERA_CONFIG.farMeters,
          position: [0, CHASE_CAMERA_CONFIG.heightMeters, 8],
        }}
      >
        <color attach="background" args={[SKY_COLOR]} />
        <fog attach="fog" args={[SKY_COLOR, 180, 1500]} />
        <RenderLayer simulation={simulation} input={input} world={world} />
      </Canvas>
      <Hud onAction={(action) => input.queueAction(action)} />
      {DebugPanel ? (
        <Suspense fallback={null}>
          <DebugPanel />
        </Suspense>
      ) : null}
    </>
  );
}
