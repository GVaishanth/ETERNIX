import { chooseGoal } from '../navigation/navigationGoal';
import type { RaceController } from '../race/raceController';
import { readoutOf, NavigationRuntime, type NavigationReadout, type NavigationWorld } from '../navigation/navigationRuntime';
import { setMinimapGarage, setMinimapRoute } from '../ui/minimapNavigation';
import { NavigationVisuals } from './navigationVisuals';

/*
 * Navigation for the mounted world: the route runtime, its 3-D visuals, and the minimap marks, wired together. The goal
 * comes from chooseGoal: the career target's race marker, the next checkpoint while a race runs, or the garage. The
 * career target is read through a callback, so this module does not depend on the career service.
 */

export class NavigationScene {
  readonly visuals: NavigationVisuals;
  private readonly runtime: NavigationRuntime;
  /** Reused by the checkpoint query every recompute, so the query allocates nothing. */
  private readonly gateScratch = { x: 0, z: 0, yaw: 0 };

  constructor(world: NavigationWorld, careerTargetId: () => string | null, race: RaceController | null) {
    this.visuals = new NavigationVisuals(world.garage?.position ?? null, world.periodMeters);
    setMinimapGarage(world.garage ? { x: world.garage.position.x, z: world.garage.position.z } : null);
    this.runtime = new NavigationRuntime(
      world,
      (graph, garage) => {
        const checkpoint = race !== null && race.nextGatePose(this.gateScratch) ? { x: this.gateScratch.x, z: this.gateScratch.z } : null;
        return chooseGoal(graph, {
          phase: race?.phase ?? 'FREE_ROAM',
          careerEventId: careerTargetId(),
          checkpoint,
          garage: garage?.position ?? null,
        });
      },
      (route) => {
        this.visuals.setRoute(route);
        setMinimapRoute(route);
      },
    );
  }

  /** Per frame. Cheap: the route itself is recomputed at a low rate inside the runtime. */
  update(seconds: number, car: { readonly x: number; readonly z: number }): void {
    this.runtime.update(seconds, car);
    this.visuals.sync(car);
  }

  /** DEV read-out for browser tests. */
  readout(): NavigationReadout | null {
    return readoutOf(this.runtime.current);
  }

  dispose(): void {
    setMinimapRoute(null);
    setMinimapGarage(null);
    this.visuals.dispose();
  }
}
