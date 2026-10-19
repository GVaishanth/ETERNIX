/*
 * Contact log (Part 4). Records each contact once, when it starts, with the ids of the bodies involved. A contact
 * that continues over several steps is not recorded again. A contact counts as ended after a step with no overlap.
 */

export type ContactKind =
  | 'player-traffic'
  | 'traffic-traffic'
  | 'traffic-boundary'
  | 'player-guardrail'
  | 'opponent-traffic'
  | 'opponent-player'
  | 'opponent-boundary'
  | 'police-traffic'
  | 'police-player'
  | 'police-boundary';

export const CONTACT_KINDS: readonly ContactKind[] = [
  'player-traffic',
  'traffic-traffic',
  'traffic-boundary',
  'player-guardrail',
  'opponent-traffic',
  'opponent-player',
  'opponent-boundary',
  'police-traffic',
  'police-player',
  'police-boundary',
];

export interface ContactEvent {
  kind: ContactKind;
  /** Primary id: a traffic vehicle id, or 'player' for the player. */
  a: string;
  /** Second id, or null when the other body is the boundary. */
  b: string | null;
  /** Fixed-step index at which the contact started. */
  step: number;
}

export class ContactLog {
  readonly counts: Record<ContactKind, number> = {
    'player-traffic': 0,
    'traffic-traffic': 0,
    'traffic-boundary': 0,
    'player-guardrail': 0,
    'opponent-traffic': 0,
    'opponent-player': 0,
    'opponent-boundary': 0,
    'police-traffic': 0,
    'police-player': 0,
    'police-boundary': 0,
  };
  private current = new Set<string>();
  private next = new Set<string>();
  private readonly events: ContactEvent[] = [];
  private readonly capacity: number;
  private stepIndex = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  /** Marks a contact as present this step. Returns true only when it is new (the start of the event). */
  touch(kind: ContactKind, a: string, b: string | null): boolean {
    const key = `${kind}|${a}|${b ?? ''}`;
    this.next.add(key);
    if (this.current.has(key)) return false;
    this.counts[kind] += 1;
    this.events.push({ kind, a, b, step: this.stepIndex });
    if (this.events.length > this.capacity) this.events.shift();
    return true;
  }

  /** Ends the step: contacts that were not touched this step are over. */
  endStep(): void {
    const finished = this.current;
    this.current = this.next;
    this.next = finished;
    this.next.clear();
    this.stepIndex += 1;
  }

  get activeCount(): number {
    return this.current.size;
  }

  get recent(): readonly ContactEvent[] {
    return this.events;
  }

  clear(): void {
    this.current.clear();
    this.next.clear();
    this.events.length = 0;
    this.stepIndex = 0;
    for (const kind of CONTACT_KINDS) this.counts[kind] = 0;
  }
}
