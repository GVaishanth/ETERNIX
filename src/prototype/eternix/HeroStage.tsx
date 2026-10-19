import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { BoxGeometry, CanvasTexture, Color, Matrix4, MeshStandardMaterial, Quaternion, RepeatWrapping, SRGBColorSpace, Vector3, type InstancedMesh } from 'three';
import { registerAsphalt } from '../../render/surfaceRegistry';
import { ETERNIX_PROTOTYPE_CONFIG as C } from '../../config/eternixPrototypeConfig';
import { ActiveCar } from './ActiveCar';
import { HeroEnvironment } from './HeroEnvironment';
import { StudioEnvironment } from './StudioEnvironment';
import { buildHeroScenery, mulberry32, type BoxSpec } from './heroLayout';
import { BACK_VIEW_INDEX, HERO_VIEWS, heroViewPose, type HeroViewPose } from './heroViews';
import { approachAngle, wrapAngle } from './showroomOrbit';
import { poseAlong, sweepDelta, type CameraMove, type CameraPose } from './cameraMove';
import type { CarSummary } from './saveSnapshot';

/*
 * The landing's hero: the player's active car in their paint (VehicleVisual, through ActiveCar), on a procedural street
 * in the game's road dimensions. It is not a gameplay vehicle, so there is no simulation here. Everything is static
 * geometry or a generated texture. The page sets the view the camera settles on (heroViews.ts) and sends one-off camera
 * moves: to the back view when the game is entered, and back again on return. Drift is slow. Under reduced motion the
 * views and moves cut instead of swinging, and the canvas renders only when something changes.
 */

const CAR_LANE_X = C.road.laneCentreMeters;
function toCameraPose(pose: HeroViewPose): CameraPose {
  return { angle: pose.angleRadians, radius: pose.radiusMeters, height: pose.heightMeters };
}

/** All street geometry is planned once, from the config and the seed. Pure, so the same on every load. */
const SCENERY = buildHeroScenery({
  seed: C.scenery.seed,
  lengthMeters: C.road.lengthMeters,
  roadWidthMeters: C.road.widthMeters,
  kerbWidthMeters: C.road.kerbWidthMeters,
  kerbHeightMeters: C.road.kerbHeightMeters,
  lineWidthMeters: C.road.lineWidthMeters,
  edgeInsetMeters: C.road.edgeInsetMeters,
  centreGapMeters: C.road.centreLineGapMeters,
  dashLengthMeters: C.road.dashLengthMeters,
  dashPeriodMeters: C.road.dashPeriodMeters,
  buildingSetbackMeters: C.scenery.buildingSetbackMeters,
  buildingSpacingMeters: C.scenery.buildingSpacingMeters,
  buildingMinHeightMeters: C.scenery.buildingMinHeightMeters,
  buildingMaxHeightMeters: C.scenery.buildingMaxHeightMeters,
  buildingMinDepthMeters: C.scenery.buildingMinDepthMeters,
  buildingMaxDepthMeters: C.scenery.buildingMaxDepthMeters,
  windowRowMeters: C.scenery.windowRowMeters,
  windowColumnMeters: C.scenery.windowColumnMeters,
  windowLitChance: C.scenery.windowLitChance,
  farSetbackMeters: C.scenery.farSetbackMeters,
  farSpacingMeters: C.scenery.farSpacingMeters,
  farMinHeightMeters: C.scenery.farMinHeightMeters,
  farMaxHeightMeters: C.scenery.farMaxHeightMeters,
  farLitChance: C.scenery.farLitChance,
  lampSpacingMeters: C.scenery.lampSpacingMeters,
  lampHeightMeters: C.scenery.lampHeightMeters,
  lampSetbackMeters: C.scenery.lampSetbackMeters,
  trailSpacingMeters: C.scenery.trailSpacingMeters,
  trailMinLengthMeters: C.scenery.trailMinLengthMeters,
  trailMaxLengthMeters: C.scenery.trailMaxLengthMeters,
  trailHeightMeters: C.scenery.trailHeightMeters,
  trailWidthMeters: C.scenery.trailWidthMeters,
  trailZMinMeters: C.scenery.trailZMinMeters,
  trailZMaxMeters: C.scenery.trailZMaxMeters,
  laneOffsetsMeters: C.road.laneOffsetsMeters,
});

interface HeroStageProps {
  readonly car: CarSummary;
  readonly reducedMotion: boolean;
  /** The view the camera settles on: an index into HERO_VIEWS. */
  readonly view: number;
  /** A one-off camera move. Each new token starts a new move. */
  readonly move: CameraMove;
  /** Written every frame with the camera's pose, so the page can return to it. */
  readonly poseRef: { current: CameraPose | null };
}

/** A soft, seeded grain for the asphalt. Generated on a canvas, so no image file is needed. */
function createSpeckleTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = '#c8c8c8';
    context.fillRect(0, 0, size, size);
    const random = mulberry32(C.scenery.seed + 7);
    for (let i = 0; i < 320; i += 1) {
      const shade = random() > 0.5 ? 255 : 40;
      context.fillStyle = `rgba(${shade},${shade},${shade},${(0.1 + random() * 0.2).toFixed(3)})`;
      context.fillRect(random() * size, random() * size, 1 + random() * 1.5, 1 + random() * 1.5);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(C.road.widthMeters / 4, C.road.lengthMeters / 6);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

interface BoxesProps {
  readonly boxes: readonly BoxSpec[];
  /** The colour before each box's tone is applied. */
  readonly base: string;
  /** How far a box's tone moves its colour, from 0 (no variation) upward. */
  readonly variance: number;
  readonly children: ReactNode;
}

/**
 * Draws many boxes as one instanced mesh. The geometry is shared by the instances and is disposed on unmount. The
 * matrices and tints are written once when the layout changes, not per frame.
 */
function Boxes({ boxes, base, variance, children }: BoxesProps) {
  const ref = useRef<InstancedMesh>(null);
  const geometry = useMemo(() => new BoxGeometry(1, 1, 1), []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new Matrix4();
    const position = new Vector3();
    const scale = new Vector3();
    const rotation = new Quaternion();
    const baseColour = new Color(base);
    const tint = new Color();
    boxes.forEach((box, index) => {
      position.set(box.x, box.y, box.z);
      scale.set(box.sx, box.sy, box.sz);
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(index, matrix);
      tint.copy(baseColour).multiplyScalar(1 + (box.tone - 0.5) * variance);
      mesh.setColorAt(index, tint);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [boxes, base, variance]);

  return (
    <instancedMesh ref={ref} args={[geometry, undefined, boxes.length]} frustumCulled={false}>
      {children}
    </instancedMesh>
  );
}

function Street({ speckle }: { readonly speckle: CanvasTexture }) {
  const length = C.road.lengthMeters;
  const roadWidth = C.road.widthMeters;
  const asphaltRef = useRef<MeshStandardMaterial>(null);
  // The road takes the shared wetness, like the game's asphalt (surfaceRegistry).
  useEffect(() => (asphaltRef.current ? registerAsphalt(asphaltRef.current) : undefined), []);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 0]}>
        <planeGeometry args={[600, length]} />
        <meshStandardMaterial color={C.colours.ground} roughness={0.95} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[roadWidth, length]} />
        <meshStandardMaterial ref={asphaltRef} color={C.colours.asphalt} map={speckle} roughness={C.road.asphaltRoughness} metalness={0} />
      </mesh>
      <Boxes boxes={SCENERY.pavements} base={C.colours.pavement} variance={0.2}>
        <meshStandardMaterial roughness={0.9} />
      </Boxes>
      <Boxes boxes={SCENERY.kerbs} base={C.colours.kerb} variance={0.2}>
        <meshStandardMaterial roughness={0.85} />
      </Boxes>
      <Boxes boxes={SCENERY.markings} base={C.colours.paint} variance={0}>
        <meshStandardMaterial roughness={0.55} />
      </Boxes>
      <Boxes boxes={SCENERY.centreMarkings} base={C.colours.centreLine} variance={0}>
        <meshStandardMaterial roughness={0.5} />
      </Boxes>
      <Boxes boxes={SCENERY.dashes} base={C.colours.paint} variance={0}>
        <meshStandardMaterial roughness={0.55} />
      </Boxes>
      <Boxes boxes={SCENERY.lampPosts} base="#2b313b" variance={0.1}>
        <meshStandardMaterial roughness={0.6} metalness={0.2} />
      </Boxes>
      <Boxes boxes={SCENERY.lampHeads} base={C.colours.lampLight} variance={0.15}>
        <meshBasicMaterial color="#ffffff" />
      </Boxes>
      <Boxes boxes={SCENERY.farBuildings} base={C.colours.buildingBase} variance={0.5}>
        <meshStandardMaterial roughness={0.85} />
      </Boxes>
      <Boxes boxes={SCENERY.farWindows} base={C.colours.windowWarm} variance={0.8}>
        <meshBasicMaterial color="#ffffff" />
      </Boxes>
      <Boxes boxes={SCENERY.buildings} base={C.colours.buildingBase} variance={0.6}>
        <meshStandardMaterial roughness={0.85} />
      </Boxes>
      <Boxes boxes={SCENERY.windows} base={C.colours.windowWarm} variance={0.8}>
        <meshBasicMaterial color="#ffffff" />
      </Boxes>
      {/* Light trails are unlit: they are light sources in the scene, drawn at full brightness. */}
      <Boxes boxes={SCENERY.trailsRed} base={C.colours.trailRed} variance={0.25}>
        <meshBasicMaterial color="#ffffff" />
      </Boxes>
      <Boxes boxes={SCENERY.trailsWhite} base={C.colours.trailWhite} variance={0.25}>
        <meshBasicMaterial color="#ffffff" />
      </Boxes>
    </group>
  );
}

/** The rig's own copy of the pose. It is updated in place each frame. */
type MutableCameraPose = { angle: number; radius: number; height: number };

interface ActiveMove {
  readonly from: MutableCameraPose;
  readonly to: CameraPose;
  readonly angleDelta: number;
  elapsed: number;
}

/**
 * Holds the camera on its view, and runs the one-off moves (to the back view, and back). The car's body centre is the
 * orbit centre. The view is aimed at the car, shifted so the car sits right of centre on wide screens. Drift is added
 * on top. The pose is written to poseRef every frame, so the page can return to exactly where the camera was.
 */
function CameraRig({ reducedMotion, view, move, poseRef, carLengthMeters }: {
  readonly reducedMotion: boolean;
  readonly view: number;
  readonly move: CameraMove;
  readonly poseRef: { current: CameraPose | null };
  readonly carLengthMeters: number;
}) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const elapsed = useRef(0);
  const pose = useRef<MutableCameraPose | null>(null);
  const active = useRef<ActiveMove | null>(null);
  // The move token already handled. The first frame records the current token without acting on it, so a remount does
  // not replay an old move.
  const handled = useRef<number | null>(null);
  const screenRight = useRef(new Vector3());

  // Under demand rendering (reduced motion), a new view or move must draw even though nothing else is running.
  useEffect(() => {
    invalidate();
  }, [view, move.token, invalidate]);

  useFrame((_, delta) => {
    // The page's timers run in real time, so a move is timed by the real frame time (not capped by the drift step).
    const real = Math.min(delta, 1);
    const step = Math.min(delta, 0.1);
    elapsed.current += step;
    const narrow = size.height > 0 && size.width / size.height < C.camera.narrowAspectRatio;
    const zoom = narrow ? C.camera.narrowZoomScale : 1;
    const goal = toCameraPose(
      heroViewPose(HERO_VIEWS[view] ?? HERO_VIEWS[0]!, carLengthMeters, C.heroViews.distanceInCarLengths, zoom),
    );
    const back = toCameraPose(
      heroViewPose(HERO_VIEWS[BACK_VIEW_INDEX] ?? HERO_VIEWS[0]!, carLengthMeters, C.heroViews.distanceInCarLengths, zoom),
    );
    if (pose.current === null) pose.current = { ...goal };
    if (handled.current === null) handled.current = move.token;
    if (move.token !== handled.current) {
      handled.current = move.token;
      const destination = move.kind === 'toBack' ? back : move.kind === 'fromBack' ? move.to : null;
      // A 'none' token (cancel, or the page settling) stops any move still running.
      if (destination === null) active.current = null;
      if (destination !== null && !reducedMotion) {
        const from = { ...pose.current };
        active.current = {
          from,
          to: destination,
          angleDelta: sweepDelta(from.angle, destination.angle, C.handoffBackViewRadians),
          elapsed: 0,
        };
      } else if (destination !== null) {
        pose.current = { ...destination };
        active.current = null;
      }
    }

    const current = pose.current;
    const moving = active.current;
    if (moving !== null) {
      moving.elapsed += real;
      const fraction = Math.min(1, moving.elapsed / C.handoffMoveSeconds);
      const next = poseAlong(moving.from, moving.to, moving.angleDelta, fraction);
      current.angle = next.angle;
      current.radius = next.radius;
      current.height = next.height;
      if (fraction >= 1) {
        current.angle = wrapAngle(moving.to.angle);
        current.radius = moving.to.radius;
        current.height = moving.to.height;
        active.current = null;
      }
      invalidate();
    } else if (reducedMotion) {
      current.angle = goal.angle;
      current.radius = goal.radius;
      current.height = goal.height;
    } else {
      const rate = C.heroViews.swingRatePerSecond;
      const fraction = 1 - Math.exp(-rate * step);
      current.angle = approachAngle(current.angle, goal.angle, rate, step);
      current.radius += (goal.radius - current.radius) * fraction;
      current.height += (goal.height - current.height) * fraction;
      const settled =
        Math.abs(wrapAngle(goal.angle - current.angle)) < 1e-3 &&
        Math.abs(goal.radius - current.radius) < 1e-3 &&
        Math.abs(goal.height - current.height) < 1e-3;
      if (!settled) invalidate();
    }
    poseRef.current = current;

    const drift = reducedMotion ? 0 : Math.sin((elapsed.current / C.heroDriftPeriodSeconds) * Math.PI * 2) * C.heroDriftRadians;
    const angle = current.angle + drift;
    const centreY = narrow ? C.camera.targetNarrowMeters[1] : C.camera.targetWideMeters[1];
    camera.position.set(CAR_LANE_X + current.radius * Math.sin(angle), current.height, current.radius * Math.cos(angle));
    camera.lookAt(CAR_LANE_X, centreY, 0);
    // Aim a little to the camera's left, so the car lands right of centre. This only changes where the lens points.
    screenRight.current.set(1, 0, 0).applyQuaternion(camera.quaternion);
    const shift = narrow ? C.camera.targetNarrowMeters[0] - CAR_LANE_X : C.camera.targetWideMeters[0] - CAR_LANE_X;
    camera.lookAt(
      CAR_LANE_X - screenRight.current.x * shift,
      centreY - screenRight.current.y * shift,
      -screenRight.current.z * shift,
    );
  });
  return null;
}

/** Shows a quiet fallback if the 3D stage cannot render. The rest of the page keeps working. */
export class HeroBoundary extends Component<{ readonly children: ReactNode }, { readonly failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn('ETERNIX prototype: the hero stage could not render', error.message, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return <div className="ex-stage-fallback" role="status">The 3D view could not start on this device. The controls still work.</div>;
    }
    return this.props.children;
  }
}

export function HeroStage({ car, reducedMotion, view, move, poseRef }: HeroStageProps) {
  const cam = C.camera;
  const [speckle] = useState(() => createSpeckleTexture());
  useEffect(() => () => speckle.dispose(), [speckle]);
  return (
    <Canvas
      dpr={[1, C.maxPixelRatio]}
      frameloop={reducedMotion ? 'demand' : 'always'}
      gl={{ antialias: true }}
      camera={{ fov: cam.fovDegrees, near: cam.nearMeters, far: cam.farMeters, position: [cam.positionMeters[0], cam.positionMeters[1], cam.positionMeters[2]] }}
    >
      <HeroEnvironment />
      <StudioEnvironment intensity={C.light.environmentIntensity} />
      <CameraRig reducedMotion={reducedMotion} view={view} move={move} poseRef={poseRef} carLengthMeters={car.config.bodyLengthMeters} />
      <Street speckle={speckle} />
      <group position={[CAR_LANE_X, 0, 0]}>
        <ActiveCar car={car} />
      </group>
    </Canvas>
  );
}
