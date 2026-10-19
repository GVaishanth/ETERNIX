import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import type { Group } from 'three';
import type { VehicleConfig } from '../config/vehicleConfig';
import { VehicleVisual } from '../render/VehicleVisual';
import type { VehicleDesignProfile } from '../vehicles/designProfile';

/*
 * Garage preview: the real procedural car model. It is a separate small canvas that exists only while the garage is
 * open. It is NOT a gameplay vehicle: it has no simulation, no collision, and no physics. It is unmounted when the
 * garage closes, and React Three Fiber releases its renderer on unmount. Changing the car disposes the old body
 * geometry (VehicleVisual owns it).
 *
 * Views: Turn spins the car on the turntable. Front, side, rear, and three-quarter hold the car still and move the
 * camera. The car is centred on the origin in both cases.
 */
export type PreviewView = 'turn' | 'three-quarter' | 'front' | 'side' | 'rear';

const VIEWS: ReadonlyArray<{ id: PreviewView; label: string }> = [
  { id: 'turn', label: 'Turn' },
  { id: 'three-quarter', label: '3/4' },
  { id: 'front', label: 'Front' },
  { id: 'side', label: 'Side' },
  { id: 'rear', label: 'Rear' },
];

/** Camera positions in world space, looking at the car centre. The nose is +Z, so the front view is on +Z. */
const VIEW_CAMERA: Record<Exclude<PreviewView, 'turn'>, [number, number, number]> = {
  'three-quarter': [2.6, 1.5, 4.4],
  front: [0, 0.95, 4.8],
  side: [4.8, 0.95, 0],
  rear: [0, 0.95, -4.8],
};

/** The car spans z -0.8..3.7 in sim space. Shifting it back by its midpoint centres it on the origin. */
const CAR_CENTRE_Z = -1.45;

interface GaragePreviewProps {
  config: VehicleConfig;
  design: VehicleDesignProfile;
  paintColor: string;
}

function Turntable({ config, design, paintColor, view }: GaragePreviewProps & { view: PreviewView }) {
  const spin = useRef<Group>(null);
  useFrame((_, delta) => {
    if (view === 'turn' && spin.current) spin.current.rotation.y += Math.min(delta, 0.1) * 0.6;
  });
  // A fixed view puts the car back at its zero heading, so the camera sees the same face every time.
  useEffect(() => {
    if (view !== 'turn' && spin.current) spin.current.rotation.y = 0;
  }, [view]);
  return (
    <group ref={spin} position={[0, 0, CAR_CENTRE_Z]}>
      <VehicleVisual config={config} design={design} paintColor={paintColor} />
    </group>
  );
}

/** Moves the camera for the chosen fixed view. Turn leaves the camera where the default put it. */
function CameraRig({ view }: { view: PreviewView }) {
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    if (view === 'turn') return;
    const [x, y, z] = VIEW_CAMERA[view];
    camera.position.set(x, y, z);
    camera.lookAt(0, 0.55, 0);
  }, [camera, view]);
  return null;
}

/** Shows a text fallback when the 3D preview cannot start. The garage around it keeps working. */
class PreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Logged for diagnosis. The fallback text is shown instead of the 3D view.
    console.warn('Garage preview unavailable', error.message, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className="garage-preview garage-preview-fallback" role="status">
          The 3D preview could not start on this device. The car's stats and prices are still shown.
        </div>
      );
    }
    return this.props.children;
  }
}

export function GaragePreview({ config, design, paintColor }: GaragePreviewProps) {
  const [view, setView] = useState<PreviewView>('turn');
  return (
    <div className="garage-preview-wrap">
      <div className="garage-views" role="group" aria-label="Preview view">
        {VIEWS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={view === option.id ? 'garage-view garage-view-on' : 'garage-view'}
            aria-pressed={view === option.id}
            onClick={(event) => {
              event.currentTarget.blur();
              setView(option.id);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      <PreviewBoundary>
        <div className="garage-preview" aria-label="Vehicle preview">
          <Canvas
            dpr={[1, 2]}
            gl={{ antialias: true }}
            camera={{ position: [2.6, 1.5, 4.4], fov: 30, near: 0.1, far: 100 }}
            onCreated={({ camera }) => camera.lookAt(0, 0.55, 0)}
          >
            <color attach="background" args={['#1b2330']} />
            <ambientLight intensity={0.7} />
            <directionalLight position={[4, 6, 3]} intensity={1.2} />
            <CameraRig view={view} />
            <Turntable config={config} design={design} paintColor={paintColor} view={view} />
          </Canvas>
        </div>
      </PreviewBoundary>
    </div>
  );
}
