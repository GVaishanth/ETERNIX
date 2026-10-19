/* eslint-disable react-hooks/immutability, react-refresh/only-export-components -- dev-only audit harness; it sets a camera it owns and is not shipped. */
/*
 * Dev-only fleet preview. Renders one catalogue car through the real VehicleVisual, from a fixed camera. Used to audit
 * and compare the fleet. Not part of the production build (fleet.html is not a build input).
 *
 *   fleet.html?id=<vehicle id>&view=<front|rear|side|top|front3q|rear3q|silhouette>
 *
 * The canvas is 800 x 500 with a fixed orthographic frame, so every car uses the same scale and framing.
 */
import { StrictMode, useEffect, useRef, type RefObject } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useThree } from '@react-three/fiber';
import { Mesh, MeshStandardMaterial, Vector3, type Group, type OrthographicCamera } from 'three';
import { VehicleVisual } from '../../render/VehicleVisual';
import { VEHICLE_DESIGNS } from '../../config/vehicleDesigns';
import { VEHICLE_IDS } from '../../config/vehicleCatalogue';
import { vehicleDefinition } from '../../vehicles/catalogue';
import { deriveEffectiveSpecs, STOCK_UPGRADES } from '../../vehicles/effectiveSpecs';

const params = new URLSearchParams(window.location.search);
const id = params.get('id') ?? 'kestrel-hatch';
const view = params.get('view') ?? 'side3q';
const design = VEHICLE_DESIGNS[id as keyof typeof VEHICLE_DESIGNS];
/** The car's own config, so the visual uses the per-design hull (bodyLengthMeters, footprint) like the physics does. */
const definition = vehicleDefinition(id);
const config = definition ? deriveEffectiveSpecs(definition, STOCK_UPGRADES).config : null;

/** Camera direction from the car's centre, and the frustum half-height in metres. Car centre is at z ~ 1.45 m. */
const VIEWS: Record<string, { dir: [number, number, number]; up?: [number, number, number] }> = {
  side: { dir: [1, 0.12, 0] },
  side3q: { dir: [0.7, 0.42, 0.6] },
  front: { dir: [0, 0.12, 1] },
  front3q: { dir: [0.6, 0.38, 0.72] },
  rear: { dir: [0, 0.12, -1] },
  rear3q: { dir: [-0.6, 0.38, -0.72] },
  top: { dir: [0, 1, 0.0001], up: [0, 0, -1] },
  silhouette: { dir: [0.7, 0.42, 0.6] },
};
const FRUSTUM_HALF = 2.6;
const CENTRE = new Vector3(0, 0.7, 1.45);

function Framing({ target }: { target: RefObject<Group | null> }) {
  const { camera, scene, gl } = useThree();
  useEffect(() => {
    const cam = camera as OrthographicCamera;
    const spec = VIEWS[view] ?? VIEWS.side3q!;
    const dir = new Vector3(...spec.dir).normalize();
    cam.left = -FRUSTUM_HALF * 1.6;
    cam.right = FRUSTUM_HALF * 1.6;
    cam.top = FRUSTUM_HALF;
    cam.bottom = -FRUSTUM_HALF;
    cam.near = 0.1;
    cam.far = 60;
    cam.position.copy(CENTRE).addScaledVector(dir, 20);
    cam.up.set(...(spec.up ?? [0, 1, 0]));
    cam.lookAt(CENTRE);
    cam.updateProjectionMatrix();
    if (view === 'silhouette' && target.current) {
      const neutral = new MeshStandardMaterial({ color: '#2a2e35', roughness: 0.8, metalness: 0 });
      target.current.traverse((node) => {
        if (node instanceof Mesh) node.material = neutral;
      });
    }
    gl.setClearColor('#20242b', 1);
    scene.updateMatrixWorld(true);
    (window as unknown as { __fleetReady?: boolean }).__fleetReady = true;
  }, [camera, scene, gl, target]);
  return null;
}

function Scene() {
  const ref = useRef<Group>(null);
  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[6, 10, 8]} intensity={1.6} />
      <directionalLight position={[-6, 4, -5]} intensity={0.5} />
      <VehicleVisual ref={ref} config={config!} design={design} />
      <Framing target={ref} />
    </>
  );
}

function App() {
  if (!VEHICLE_IDS.includes(id as never) || !design || !config) {
    return <div style={{ color: '#fff', padding: 20 }}>unknown vehicle id: {id}</div>;
  }
  return (
    <Canvas orthographic camera={{ zoom: 1, position: [0, 0, 10] }} style={{ width: 800, height: 500 }} gl={{ antialias: true, preserveDrawingBuffer: true }}>
      <Scene />
    </Canvas>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
