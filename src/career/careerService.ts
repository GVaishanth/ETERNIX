/*
 * Career service (Part 9): the one entry point for career changes. It is a thin layer over the garage service's
 * profile commit, so a career change and its credits land in the same save write, or in neither.
 *
 * - Start, track, and race results go through commitProfile. The career rules in careerModel decide.
 * - A race result is recorded once per attempt. The key includes this page load's session id, so attempt numbers
 *   restarting after a reload never match an older saved attempt.
 * - The UI reads the profile through the garage store (career slice) and the last outcome through noticeStore. It never
 *   changes reputation, defeats, or unlocks itself.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { RACE_EVENTS } from '../race/raceEvents';
import { CAREER_RACE_IDS } from './careerRaces';
import { garageService, type GarageService, type ProfileTx } from '../garage/garageService';
import {
  applyRaceOutcome,
  newSessionId,
  recordPursuitEscape,
  startCareer,
  trackEvent,
  type OutcomeSummary,
  type ProfileState,
  type RaceOutcomeInput,
} from './careerModel';

/** Every race id the game knows: free-roam races and career races. Used to refuse an unknown id. */
export const ALL_RACE_IDS: ReadonlySet<string> = new Set([...RACE_EVENTS.map((event) => event.id), ...CAREER_RACE_IDS]);

/** Unique to this page load. Race attempt keys include it (see RaceOutcomeInput.sessionId). */
export const CAREER_SESSION_ID: string = newSessionId();

export interface CareerNoticeStore {
  /** The summary of the last career result this session, shown on the results card. Not saved. */
  readonly lastOutcome: OutcomeSummary | null;
  /** Counts results, so a view can tell a new result from one it already showed. */
  readonly outcomeSeq: number;
  /** Why the last result was not recorded (for example a failed save), or null. Nothing was granted when this is set. */
  readonly error: string | null;
}

export interface CareerService {
  readonly noticeStore: UseBoundStore<StoreApi<CareerNoticeStore>>;
  profile(): ProfileState;
  /** Starts the career. Refused once started, so it never resets progress. */
  start(): ProfileTx<null>;
  /** Chooses the event the player is heading for, or clears it with null. */
  track(eventId: string | null): ProfileTx<null>;
  /** Records one official race result. Free-roam ids are refused here: their rewards go through the garage. */
  applyRaceResult(input: RaceOutcomeInput): ProfileTx<OutcomeSummary | null>;
  /**
   * Counts one pursuit escape. Called once when a pursuit ends with the police giving up. Does nothing before the career
   * starts. It is not a click, so it has no duplicate window.
   */
  recordEscape(): ProfileTx<null>;
  dismissOutcome(): void;
}

export function createCareerService(garage: GarageService, knownRaceIds: ReadonlySet<string>): CareerService {
  const noticeStore = create<CareerNoticeStore>()(() => ({ lastOutcome: null, outcomeSeq: 0, error: null }));

  return {
    noticeStore,
    profile: () => garage.getProfile(),
    start: () => garage.commitProfile((profile) => startCareer(profile), 'career:start', true),
    track: (eventId) => garage.commitProfile((profile) => trackEvent(profile, eventId), `career:track:${eventId ?? 'none'}`, true),
    applyRaceResult: (input) => {
      const tx = garage.commitProfile<OutcomeSummary | null>(
        (profile) => {
          const result = applyRaceOutcome(profile, input, knownRaceIds);
          if (!result.ok) return { ok: false, code: result.code, message: result.message };
          if (!result.changed || result.profile === profile) {
            return { ok: true, profile, message: '', detail: null };
          }
          return { ok: true, profile: result.profile, message: 'Career result recorded.', detail: result.summary };
        },
        null,
        false,
      );
      if (!tx.ok) {
        noticeStore.setState({ error: tx.message });
        return tx;
      }
      noticeStore.setState({ error: null });
      if (tx.detail !== null) {
        const summary = tx.detail;
        noticeStore.setState((state) => ({ lastOutcome: summary, outcomeSeq: state.outcomeSeq + 1 }));
      }
      return tx;
    },
    recordEscape: () =>
      garage.commitProfile<null>(
        (profile) => {
          const next = recordPursuitEscape(profile);
          return { ok: true, profile: next.profile, message: '', detail: null };
        },
        null,
        false,
      ),
    dismissOutcome: () => noticeStore.setState({ lastOutcome: null, error: null }),
  };
}

/** The app's career service, on the one garage commit path. */
export const careerService = createCareerService(garageService, ALL_RACE_IDS);
