/*
 * Plain, mutable race marks for the minimap (Part 6). The race visuals write them: the event markers once when the
 * world is built, the visibility of each event as its career state changes, and the active state and next gate each
 * frame. The minimap reads them in its own draw loop. No React state, no allocation per frame. Simulation coordinates:
 * x east, z north.
 *
 * Indices follow the race controller's route order. A hidden event keeps its index, so the active-event index still
 * points at the right marker.
 */

export interface MinimapMarkPoint {
  x: number;
  z: number;
}

const eventMarkers: MinimapMarkPoint[] = [];
/** One flag per event marker. False means the event is not shown (locked, or its division is retired). */
const eventVisible: boolean[] = [];
let hiddenEventIndex: number | null = null;
const nextGate: MinimapMarkPoint = { x: 0, z: 0 };
let hasNextGate = false;

/** Sets the event markers. Called once per world (and cleared on dispose). Every event starts visible. */
export function setRaceEventMarkers(points: readonly MinimapMarkPoint[]): void {
  eventMarkers.length = 0;
  eventVisible.length = 0;
  for (const point of points) {
    eventMarkers.push({ x: point.x, z: point.z });
    eventVisible.push(true);
  }
}

/** Shows or hides one event marker. The index is the event's position in the race list. */
export function setRaceEventVisibility(index: number, visible: boolean): void {
  if (index >= 0 && index < eventVisible.length) eventVisible[index] = visible;
}

/** Per frame. `hiddenEvent` is the index of the event in progress (its marker is not drawn), or null. */
export function setRaceActiveMarks(hiddenEvent: number | null, gate: MinimapMarkPoint | null): void {
  hiddenEventIndex = hiddenEvent;
  hasNextGate = gate !== null;
  if (gate) {
    nextGate.x = gate.x;
    nextGate.z = gate.z;
  }
}

export interface RaceMarks {
  readonly eventMarkers: readonly MinimapMarkPoint[];
  /** Same length as eventMarkers. False for an event that must not be drawn. */
  readonly eventVisible: readonly boolean[];
  readonly hiddenEventIndex: number | null;
  readonly nextGate: MinimapMarkPoint | null;
}

const view: { eventMarkers: readonly MinimapMarkPoint[]; eventVisible: readonly boolean[]; hiddenEventIndex: number | null; nextGate: MinimapMarkPoint | null } = {
  eventMarkers,
  eventVisible,
  hiddenEventIndex: null,
  nextGate: null,
};

/** Read-only view for the minimap. The next gate is null when no gate is due. */
export function getRaceMarks(): RaceMarks {
  view.hiddenEventIndex = hiddenEventIndex;
  view.nextGate = hasNextGate ? nextGate : null;
  return view;
}
