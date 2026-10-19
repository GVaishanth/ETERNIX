# Career expansion: audit, plan, and phase scope

This document is written before the expansion code. It records what the career already does, what this phase builds,
what it defers, and the decisions that were made without asking. Status is recorded in PROJECT_CONTEXT.md section 26.

## 1. Audit of the existing career (as found)

Source: PROJECT_CONTEXT.md sections 21 to 22 (Part 9), and the code under `src/career/`, `src/race/`, `src/pursuit/`,
`src/save/`, `src/garage/`, `src/ui/CareerHub.tsx`.

What already works, and is covered by tests and a browser run in Part 9:

- One authoritative progression rule: `applyRaceOutcome` in `careerModel.ts`. Every race result goes through
  `careerService.applyRaceResult` on the one garage commit path, so credits and progress land in one save write.
- Idempotency: each attempt is keyed `<raceEventId>#<sessionId>.<attemptId>` (the session id is per page load), so a
  reload cannot replay an attempt. Rank rewards, milestone rewards and objective rewards are recorded in
  `grantedRewards` before they are paid. `settleCareer` pays what is due and nothing twice.
- Reputation separate from credits. Ranks are derived from reputation (`CAREER_RANKS`, five ranks).
- Event prerequisites are data (`Prerequisite` union: reputation, event completed, rival defeated, vehicle owned).
- Locked events return a reason per unmet condition.
- Rivals: four (Mara Quill, Teo Varga, Juno Ashdown, Kai Mensah). Each is a race built on the Sprint or Circuit base with
  a named opponent and a different opponent pace (`opponentTopSpeedMps`) and difficulty.
- Race engine: two base types, sprint and circuit (`RaceEventType`). A time limit ends the race as a timeout failure
  (`timeLimitSeconds`). Routes are lane ids on the road graph, validated by `buildRaceRoute`.
- Milestones (five, credits only), evaluated by `milestoneViews`.
- Car unlocks already follow career rank: `vehicleUnlock.ts` compares reputation with the rank each tier requires
  (`RequiredRankId`). Reputation therefore already gates cars.
- Save: career is one section of schema 2 (`saveFile.ts`), with `CAREER_DATA_VERSION = 1`, repair-by-field, backup of a
  damaged section, and read-only mode for a newer version.

What is missing for the brief:

- No division structure. There is one chain, not five divisions with requirements, completion and links.
- Event formats: only Sprint (finish), Circuit (finish) and rival wins. No checkpoint challenge, no time attack (best
  time), no championship (cumulative scoring), no police objective.
- No best times or records. The finish time is in the race result but not stored.
- Rival identity is only pace and body shape. The AI has one control: a speed cap (`AiDriverPolicy.speedCapMps`) and
  the per-opponent speed. There is no defensive, drift or line-holding behaviour in the AI.
- No crews. Rivals have no crew affiliation.
- No career pursuit hook. The pursuit session records its end reason (`lastEndReason`), but emits no event, so the
  career cannot react to an escape without polling.
- The hub has no division view, no championship view, and no best time.
- Race routes do not preload their chunks. Streaming is not connected to career events.

## 2. Decisions made for this phase

- D1. Existing rivals and their chain are kept exactly as saved. Mara, Teo, Juno and Kai keep their ids, ladder
  positions, prerequisites and rewards. No existing save loses an unlock. Mara's challenge is part of Division 1.
  Teo, Juno and Kai remain playable challenges outside the divisions. Mapping them into Divisions 2 to 5 changes the
  ladder and needs a decision (see section 6).
- D2. Divisions: five are defined as data with the brief's names, intros and requirement text. Only Division 1 has
  content and is `open`. Divisions 2 to 5 are `planned`: the hub shows the name and the intro, and says they are not in
  this build. They have no events, so no event leads nowhere.
- D3. Event formats built on the existing engine:
  - Sprint and circuit: existing bases.
  - Checkpoint challenge: a sprint route with a time limit (reach the finish within the limit or the attempt times out).
  - Time attack: a solo sprint (no opponents). It records the best finish time. It pays its reputation once.
  - Rival challenge: existing (win).
  - Championship: a cup of three Division 1 events, with points by place, best finish per event, and a cup reward once.
  - Police escape: a one-time milestone. It is not a race and does not start a pursuit.
- D4. Not built this phase: high-speed run, drift challenge, survival or endurance. High-speed needs a speed statistic
  that the race progress does not record. Drift scoring needs reliable drift telemetry, and the vehicle state has only
  `drifting` and slip angle, so no drift score is defined. Survival needs a condition system the race engine does not
  have. Each is listed in section 6, not faked.
- D5. Championship points: 10, 6, 4, 3, 2, 1 for places 1 to 6, and 0 after. A cup event counts once, at its best
  finish. A replay can raise the event's points but pays no reputation. A cup is complete when every event in it has a
  finish recorded. The cup reward is paid once.
- D6. Division 1 completion: all four Division 1 events completed (warm-up, block laps, checkpoint run, clock run), the
  Mara Quill challenge won, and the cup complete. The completion reward is paid once.
- D7. Police escape: the pursuit session reports when a session ends with reason `cooldown`, through an optional
  `onEnd` callback. The career counts escapes and pays the "Shake the Tail" milestone once, at one escape. It counts
  escapes only after the career starts. It never starts a pursuit.
- D8. Save: career data version 1 to 2. New fields: `bestTimes`, `cupScores`, `pursuitEscapes`, `completedDivisions`.
  A version 1 career migrates with the new fields at safe defaults. Nothing else is reset. Older saves still read.
- D9. Vehicles: no new vehicle reward in this phase. Cars keep unlocking by rank. Division rewards add reputation, so
  they can unlock cars through the existing rank rule. The brief's top-car gating is not changed here.
- D10. Tuning numbers that are not content go in `src/config/careerConfig.ts` (cup points, the escape count).

## 3. Scope of this phase

Built and tested in this phase:

1. Division data and the division view (Division 1 open, 2 to 5 planned).
2. Four Division 1 events: warm-up (existing), block laps, checkpoint run, clock run, plus the Mara challenge (existing).
3. Championship (Street Origins Cup) with points and a cup reward.
4. Best times for finished career races.
5. Police escape milestone through the pursuit `onEnd` hook.
6. Division completion reward.
7. Save version 2 and migration from version 1.
8. Hub: division header, cup standings, best times, and the new events, through the existing views.
9. Tests for each rule above, and for migration and malformed data.

Not built in this phase: Divisions 2 to 5 content, rivals beyond the existing four, crews, police objectives other than
the escape milestone, high-speed, drift and survival events, chunk preloading for career routes, vehicle-tier reward
gating, cosmetic rewards and liveries. Each is listed in PROJECT_CONTEXT.md section 26 as not built.

## 4. Verification plan

- Automated: type check, `eslint .`, full Vitest, production build, with the commands and results recorded.
- Route validity: every new race event is built with `buildRaceRoute` against the real graph in a test.
- Browser: not run for this phase. A career race needs real-time driving on the city, and this sandbox renders the city
  at about 1 frame per second (see WORLD_STREAMING_PLAN.md, Stage B status). A browser run cannot finish a race here.
  The browser career harness must be run on a GPU machine before the events are called playable in the browser.

## 5. Migration strategy

- Version 1 careers keep started, reputation, completed events, defeated rivals, milestones, granted rewards, attempts
  and the tracked event, with their existing values validated as before.
- New fields default to empty or zero. Unknown event, cup or division ids are dropped with a repair line.
- A version 2 career read by an older build is not expected. The version check already refuses a newer version.

## 6. Open decisions for the user

- Ladder mapping: Teo, Juno and Kai are outside the divisions. Options are to assign them to Divisions 2 to 4, to keep
  Kai as the Crown Series champion and move him, or to leave the ladder unchanged. Their current names and tuning are
  not changed until this is decided.
- Division 2 entry requirement: a reputation threshold, a defeated rival, or a vehicle tier (the brief allows all three).
- Whether the championship should be a required step for Division 2, or optional.
