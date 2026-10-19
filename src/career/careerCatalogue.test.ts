/*
 * Automated checks on the immutable career catalogue (Part 9), run against the real vehicle catalogue, the real career
 * race definitions, and the real city road graph. A failure here is a content error, and it fails the build.
 */
import { describe, expect, it } from 'vitest';
import { CATALOGUE } from '../vehicles/catalogue';
import { getWorldDefinition } from '../world/worlds';
import { buildRaceRoute, formatRouteIssues } from '../race/raceRoute';
import { CAREER_EVENTS, CAREER_RANKS, DIVISIONS, MILESTONES, RIVALS, completedDivisionLead, validateCareerCatalogue } from './careerCatalogue';
import { CAREER_RACE_EVENTS, CAREER_RACE_IDS, CAREER_WARMUP_RACE_ID } from './careerRaces';

function cityGraph() {
  const world = getWorldDefinition('city');
  if (!world.lanes) throw new Error('city world has no lane graph');
  return world.lanes;
}

const REFERENCES = {
  vehicleIds: new Set<string>(CATALOGUE.map((vehicle) => vehicle.id)),
  raceEventIds: CAREER_RACE_IDS,
};

describe('career catalogue: references and rules', () => {
  it('validates with no issues against the real vehicle and race ids', () => {
    expect(validateCareerCatalogue(REFERENCES)).toEqual([]);
  });

  it('every rival vehicle exists in the vehicle catalogue', () => {
    for (const rival of RIVALS) expect(REFERENCES.vehicleIds.has(rival.vehicleId), rival.id).toBe(true);
  });

  it('refuses a rank table that does not start at zero reputation', () => {
    const issues = validateCareerCatalogue(REFERENCES, {
      ranks: [{ id: 'r', name: 'R', minReputation: 5, creditReward: 0 }],
      events: [],
      rivals: [],
      milestones: [],
    });
    expect(issues.join(' ')).toMatch(/must start at 0/);
  });

  it('refuses a missing race route and names it', () => {
    const issues = validateCareerCatalogue({ vehicleIds: REFERENCES.vehicleIds, raceEventIds: new Set() });
    expect(issues.some((issue) => issue.includes('unknown race'))).toBe(true);
  });

  it('refuses an unknown vehicle on a rival and names it', () => {
    const issues = validateCareerCatalogue({ vehicleIds: new Set(), raceEventIds: CAREER_RACE_IDS });
    expect(issues.some((issue) => issue.includes('unknown vehicle'))).toBe(true);
  });

  it('refuses a prerequisite cycle', () => {
    const [first, second] = CAREER_EVENTS;
    if (!first || !second) throw new Error('catalogue needs two events');
    const cyclic = [
      { ...first, prerequisites: [{ kind: 'event-completed' as const, eventId: second.id }] },
      { ...second, prerequisites: [{ kind: 'event-completed' as const, eventId: first.id }] },
      ...CAREER_EVENTS.slice(2),
    ];
    const issues = validateCareerCatalogue(REFERENCES, { ranks: CAREER_RANKS, events: cyclic, rivals: RIVALS, milestones: MILESTONES });
    expect(issues.some((issue) => issue.includes('cycle'))).toBe(true);
  });

  it('refuses a duplicate event id', () => {
    const [first] = CAREER_EVENTS;
    if (!first) throw new Error('catalogue needs an event');
    const issues = validateCareerCatalogue(REFERENCES, { ranks: CAREER_RANKS, events: [first, first], rivals: RIVALS, milestones: MILESTONES });
    expect(issues.some((issue) => issue.includes('duplicated'))).toBe(true);
  });
});

describe('career races: every career race is a valid route', () => {
  it('defines the warm-up, the Division 1 and Division 2 races, and one race per rival', () => {
    expect(CAREER_RACE_EVENTS.map((event) => event.id)).toEqual([
      CAREER_WARMUP_RACE_ID,
      'career-block-race',
      'career-checkpoint-race',
      'career-clock-race',
      'career-warehouse-race',
      'career-seam-race',
      'career-tight-race',
      'rival-mara-race',
      'rival-teo-race',
      'rival-juno-race',
      'rival-kai-race',
      'rival-adair-race',
    ]);
  });

  it.each(CAREER_RACE_EVENTS.map((event) => [event.id, event] as const))('%s builds a valid route with its marker', (_id, event) => {
    const result = buildRaceRoute(event, cityGraph());
    expect(formatRouteIssues(result)).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('gives each rival race its rival as the named opponent', () => {
    for (const rival of RIVALS) {
      const raceId = CAREER_EVENTS.find((event) => event.rivalId === rival.id)?.raceEventId;
      const race = CAREER_RACE_EVENTS.find((event) => event.id === raceId);
      expect(race?.opponents?.[0]?.name, rival.id).toBe(rival.name);
    }
  });

  it('keeps career race ids separate from the free-roam ids', () => {
    expect(CAREER_RACE_IDS.has('sprint-eastside')).toBe(false);
    expect(CAREER_RACE_IDS.has('circuit-block')).toBe(false);
  });
});

describe('division lead (cliffhanger into Division 2)', () => {
  it('Division 1 has a lead that points at Division 2, and Division 2 is open with its own events', () => {
    const one = DIVISIONS.find((division) => division.number === 1);
    const two = DIVISIONS.find((division) => division.number === 2);
    expect(one?.lead).toMatch(/Division 2: Urban Syndicate is next\./);
    expect(two?.status).toBe('open');
    expect(two?.eventIds).toHaveLength(4);
  });

  it('shows the lead only once Division 1 is complete, and never for an unfinished or unknown division', () => {
    expect(completedDivisionLead([])).toBeNull();
    expect(completedDivisionLead(['division-1-street-origins'])).toBe(DIVISIONS[0]!.lead);
    expect(completedDivisionLead(['division-2-urban-syndicate'])).toBeNull();
    expect(DIVISIONS[1]!.lead).toBeUndefined();
    expect(completedDivisionLead(['not-a-division'])).toBeNull();
  });
});
