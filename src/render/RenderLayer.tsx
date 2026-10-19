import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { Group } from 'three';
import { paintDefinition } from '../config/paintConfig';
import { activeDesign, activePaint, activeSpecs } from '../garage/activeVehicle';
import { useGarageStore } from '../garage/garageService';
import { careerService } from '../career/careerService';
import { careerTargetEventId } from '../career/careerModel';
import { NavigationLayer } from './NavigationLayer';
import { NavigationScene } from './navigationScene';
import type { GameSimulation } from '../engine/gameSimulation';
import type { InputController } from '../input/inputController';
import type { WorldDefinition } from '../world/worlds';
import { GameLoopDriver } from './GameLoopDriver';
import { FollowingGround, NetworkGround, RoadNetworkScene } from './RoadNetworkScene';
import { WORLD_WRAP_CONFIG } from '../config/worldWrapConfig';
import { StreamedWorld } from './StreamedWorld';
import { CityScenery } from './CityScenery';
import { WORLD_STREAMING_CONFIG } from '../config/worldStreamingConfig';
import { createCityStreamingSet } from '../world/city/cityChunks';
import { CITY_PROP_BLOCKS } from '../world/city/cityProps';
import { Scenery } from './Scenery';
import { SimRoot } from './SimRoot';
import { Ground, Road } from './WorldGeometry';
import { VehicleVisual } from './VehicleVisual';
import { HeadlightRig } from './HeadlightRig';
import { TrafficLayer } from './TrafficLayer';
import { TrafficVisualPool } from './trafficVisuals';
import { RaceLayer } from './RaceLayer';
import { RaceVisualPool } from './raceVisuals';
import { Environment } from './Environment';
import { TireSmoke } from './TireSmoke';
import { PresentationProbe } from './PresentationProbe';
import type { RaceController } from '../race/raceController';
import { RACE_OPPONENT_CAPACITY } from '../config/raceConfig';
import type { PursuitController } from '../pursuit/pursuitController';
import { PoliceVisualPool } from './policeVisuals';
import { PoliceLayer } from './PoliceLayer';
import { roadElevationFor } from '../world/roadElevation';

// The road debug overlay exists only in DEV builds. In production this resolves to null, so its chunk is not emitted.
/** Side of the looping world's ground plane. Larger than twice the streaming reach (see worldWrapConfig.ts). */
const LOOP_GROUND_SIZE_METERS = WORLD_WRAP_CONFIG.loopGroundSizeMeters;

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
  /** Race controller, or null. When present, the opponent pool is sized for races and the race visuals are mounted. */
  race: RaceController | null;
  /** Police pursuit controller, or null. When present, the police visuals are mounted. */
  pursuit: PursuitController | null;
}

export function RenderLayer({ simulation, input, world, race, pursuit }: RenderLayerProps) {
  const vehicleRef = useRef<Group>(null);
  // The live car's config and paint come from the same garage state the simulation is driven by. Both selectors
  // return memoized values, so the car only rebuilds its layout when the handling changes, not on every paint change.
  const activeConfig = useGarageStore((state) => activeSpecs(state.garage).config);
  const design = useGarageStore((state) => activeDesign(state.garage));
  const paintId = useGarageStore((state) => activePaint(state.garage));
  const paintColor = paintDefinition(paintId)?.color ?? null;
  const network = world.network;
  const bounds = world.bounds;
  // One pool for traffic and one for opponents, per simulation. Each is disposed by its TrafficLayer on unmount.
  const [trafficVisuals] = useState(() =>
    simulation.traffic ? new TrafficVisualPool(simulation.traffic.system.vehicles.length) : null,
  );
  const [opponentVisuals] = useState(() => {
    // A race world sizes the pool for the most opponents a race can have, so opponents can start and stop without a rebuild.
    if (race) return new TrafficVisualPool(RACE_OPPONENT_CAPACITY);
    return simulation.opponents && simulation.opponents.opponents.length > 0
      ? new TrafficVisualPool(simulation.opponents.opponents.length)
      : null;
  });
  // The markers and gate sit on the road the car drives, so they read the same height lookup as the car.
  const [raceVisuals] = useState(() =>
    race ? new RaceVisualPool(race.routes, world.lanes ? roadElevationFor(world.lanes) : null) : null,
  );
  // Navigation needs the lane graph. Its goal comes from the race state and the career target (read through a callback).
  const [navigation] = useState(() =>
    world.lanes
      ? new NavigationScene(
          { lanes: world.lanes, periodMeters: world.periodMeters, garage: world.garage },
          () => careerTargetEventId(careerService.profile()),
          race,
        )
      : null,
  );
  // The police pool is sized for the pursuit's fixed unit pool. It is disposed by its PoliceLayer on unmount.
  const [policeVisuals] = useState(() => (pursuit ? new PoliceVisualPool(pursuit.capacity) : null));
  // The city is streamed in chunks (Stage B). The index, streamer, and chunk assignments are built once per mount and
  // disposed on unmount. The circuit and legacy worlds keep their whole-network renderers.
  // The looping world draws relative to the car (floating origin). These refs are moved each frame by the render loop.
  const worldRoot = useRef<Group>(null);
  const followGround = useRef<Group>(null);
  const [originTargets] = useState(() => ({ root: worldRoot, ground: followGround }));
  const [streaming] = useState(() =>
    WORLD_STREAMING_CONFIG.enabled && world.city && network
      ? createCityStreamingSet(network, world.city.scenery, CITY_PROP_BLOCKS)
      : null,
  );
  useEffect(() => {
    return () => streaming?.streamer.dispose();
  }, [streaming]);

  return (
    <>
      {/* Lights, fog, sky, and rain (Part 10). One set for the gameplay world. */}
      <Environment />
      {import.meta.env.DEV ? <PresentationProbe /> : null}
      <SimRoot groupRef={worldRoot}>
        {/* Tire smoke is in the car's frame (SimRoot flips z), so it lines up with the wheels. */}
        <TireSmoke />
        {network && bounds ? (
          <>
            {world.periodMeters !== null ? (
              <FollowingGround groupRef={followGround} sizeMeters={LOOP_GROUND_SIZE_METERS} />
            ) : (
              <NetworkGround bounds={bounds} />
            )}
            {streaming ? (
              <StreamedWorld network={network} set={streaming} />
            ) : (
              <>
                <RoadNetworkScene network={network} />
                {world.city ? <CityScenery scenery={world.city.scenery} /> : null}
              </>
            )}
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
        <VehicleVisual ref={vehicleRef} config={activeConfig} design={design} paintColor={paintColor}>
          <HeadlightRig />
        </VehicleVisual>
        {navigation ? <NavigationLayer scene={navigation} /> : null}
        {trafficVisuals ? <TrafficLayer pool={trafficVisuals} /> : null}
        {opponentVisuals ? <TrafficLayer pool={opponentVisuals} /> : null}
        {raceVisuals ? <RaceLayer pool={raceVisuals} /> : null}
        {policeVisuals ? <PoliceLayer pool={policeVisuals} /> : null}
      </SimRoot>
      <GameLoopDriver
        simulation={simulation}
        input={input}
        vehicleRef={vehicleRef}
        world={world}
        trafficVisuals={trafficVisuals}
        opponentVisuals={opponentVisuals}
        race={race}
        raceVisuals={raceVisuals}
        pursuit={pursuit}
        policeVisuals={policeVisuals}
        streamer={streaming?.streamer ?? null}
        origin={originTargets}
        navigation={navigation}
      />
    </>
  );
}
