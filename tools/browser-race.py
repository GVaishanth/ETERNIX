"""
Browser verification for Part 6 (racing events). Runs in the running DEV app and drives the car with real keyboard events.

Steps (select with arguments; default runs all implemented steps in order):
  C  one complete Sprint, player only: marker, preview (approach card), start (E), cancel (Q), re-arm after cancel,
     countdown hold, abort (Q while racing), pause and resume during a run, reset locked during a race, leave to free roam
  D  countdown and grid: 3, 2, 1, GO shown in order, the car stays on the grid during the hold, the timer starts at GO
  E  ordered checkpoints and finish: each gate passed in order, the finish counts once, results shown, provisional
     reward granted once, retry places the car on the grid and does not duplicate the reward
  errors  no page errors or console errors (known GL/three.js warnings are listed, not counted)

Staging: the car starts at the spawn, far from the sprint. The test places it at the first sample of the sprint route
(about 40 m behind the start line) through the DEV race API, then drives with the keyboard from there. That placement is
a staging step only. Every drive after it uses keyboard input and a pure-pursuit controller that reads the route
polyline and the live car pose from the DEV API.

Usage:
  python3 tools/browser-race.py [url] [outdir] [steps...]
Defaults: url=http://localhost:5173/play.html  outdir=browser-output/part6  steps=C D E errors
"""

import json
import math
import os
import sys
import time

from playwright.sync_api import sync_playwright

ARGS = sys.argv[1:]
URL = ARGS[0] if len(ARGS) > 0 and ARGS[0].startswith("http") else "http://localhost:5173/play.html?world=city"
REST = [a for a in ARGS if not a.startswith("http")]
OUT = REST[0] if len(REST) > 0 and REST[0].startswith("/") else "browser-output/part6"
STEPS = [a for a in REST if not a.startswith("/")] or ["C", "D", "E", "J", "errors"]
os.makedirs(OUT, exist_ok=True)

WHEELBASE = 2.7
STEER_RAD = 0.35           # full steer input maps to this front angle for the controller (keyboard is binary)
KNOWN_WARNINGS = ("THREE.Clock", "GL Driver Message", "GPU stall")

results = []
console_issues = []
page_errors = []
held = set()
notices_seen = []


# Provisional reward multiplier by final place, 1st to 6th (RACE_CONFIG.placeRewardMultiplier). Places 5 and 6 pay nothing.
REWARD_TABLE = [1, 0.6, 0.35, 0.2, 0, 0]

def check(name, passed, detail=""):
    results.append({"name": name, "passed": bool(passed), "detail": detail})
    print(("PASS " if passed else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def api(page, expr):
    return page.evaluate(f"() => {{ const d = window.__STREET_RACER_DEBUG__; return d && d.race ? ({expr}) : null; }}")


def race(page):
    return api(page, "d.race.getRace()")


def pose(page):
    return api(page, "d.race.getPose()")


def route(page, index=0):
    return api(page, f"d.race.getRoute({index})")


def set_key(page, code, on):
    if on and code not in held:
        page.keyboard.down(code)
        held.add(code)
    elif not on and code in held:
        page.keyboard.up(code)
        held.discard(code)


def release_all(page):
    for code in list(held):
        set_key(page, code, False)


def record_notices(snapshot):
    # The snapshot carries the last three notices. Notices are seconds apart, so the newest one is the only new one.
    items = (snapshot or {}).get("notices", [])
    if items and (not notices_seen or notices_seen[-1] != items[-1]):
        notices_seen.append(items[-1])


# Race timers run in game time. Headless Chromium advances about 16-24 fixed steps per second (1/60 s each), so one
# game second takes about 2.5-3 wall seconds. The 3-2-1 countdown is 3 game seconds, so GO needs about 8-10 wall
# seconds, and the earlier 6-8 s budgets expired during the countdown (fix_pursuit: loop/finite run 1 failures).
# The budget is wall-clock and generous. The countdown itself (config: countdownStepSeconds) is unchanged.
GO_TIMEOUT = 40.0


def sim_rate(page):
    # The fixed-step counter is read from the pursuit debug hook (same simulation, same counter).
    count = "() => { const d = window.__STREET_RACER_DEBUG__ && window.__STREET_RACER_DEBUG__.pursuit; return d ? d.stepCount() : null; }"
    a = page.evaluate(count)
    time.sleep(1.0)
    b = page.evaluate(count)
    return None if a is None or b is None else b - a


def wait_race_clock(page, seconds, timeout):
    end = time.time() + timeout
    snap = race(page)
    while time.time() < end:
        snap = race(page)
        if snap and snap["raceSeconds"] > seconds:
            return snap
        time.sleep(0.1)
    return snap


def wait_phase(page, phases, timeout=30.0, poll=0.05):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        snap = race(page)
        if snap:
            record_notices(snap)
            last = snap["phase"]
            if last in phases:
                return snap
        time.sleep(poll)
    return None


def stage_at_route_start(page, index=0):
    r = route(page, index)
    xs, zs = r["polyline"]["x"], r["polyline"]["z"]
    yaw = math.atan2(xs[1] - xs[0], zs[1] - zs[0])
    page.evaluate(f"() => window.__STREET_RACER_DEBUG__.race.placeForTest({xs[0]}, {zs[0]}, {yaw})")
    time.sleep(0.3)


def nearest_index(xs, zs, x, z, start=0, window=None):
    end = len(xs) if window is None else min(len(xs), start + window)
    best, best_d = start, float("inf")
    for k in range(start, end):
        d = (xs[k] - x) ** 2 + (zs[k] - z) ** 2
        if d < best_d:
            best, best_d = k, d
    return best


def along(xs, zs, k, distance):
    acc = 0.0
    while k + 1 < len(xs) and acc < distance:
        acc += math.hypot(xs[k + 1] - xs[k], zs[k + 1] - zs[k])
        k += 1
    return k


def curve_speed_limit(xs, zs, k_near, cruise=12.0):
    """The same rule as the game's AI (src/ai/aiController.ts): v = sqrt(a_lat / kappa), with kappa the sharpest curvature
    over 45 m ahead, measured on 4 m arcs. A long averaging window hides a tight junction, so the bot overshoots it."""
    arc, sensing, a_lat = 4.0, 45.0, 3.2
    idx = [k_near]
    d = arc
    while d <= sensing + arc:
        idx.append(along(xs, zs, k_near, d))
        d += arc
    kappa = 0.0
    for a, b, c in zip(idx, idx[1:], idx[2:]):
        if a == b or b == c:
            continue
        h1 = math.atan2(xs[b] - xs[a], zs[b] - zs[a])
        h2 = math.atan2(xs[c] - xs[b], zs[c] - zs[b])
        turn = abs((h2 - h1 + math.pi) % (2 * math.pi) - math.pi)
        kappa = max(kappa, turn / arc)
    if kappa < 1e-4:
        return cruise
    return min(cruise, math.sqrt(a_lat / kappa))


def unwrap_polyline(xs, zs, period):
    """The route polyline is in the base domain, so a seam route has one step about a period long. The car's logical
    position keeps increasing past the seam (positionSim is unwrapped), so the driven path must too."""
    ux, uz = [xs[0]], [zs[0]]
    shift = 0.0
    for i in range(1, len(xs)):
        step = xs[i] - xs[i - 1]
        if abs(step) > period / 2:
            shift -= math.copysign(period, step)
        ux.append(xs[i] + shift)
        uz.append(zs[i])
    return ux, uz


def route_index(page, event_id):
    for i in range(60):
        r = route(page, i)
        if r is None:
            return None
        if r.get("eventId") == event_id:
            return i
    return None


def drive(page, until_phases, timeout=240.0, state=None, stop_when=None, index=0, laps=1, log_every=None, unwrap=False):
    """Pure pursuit along a route with keyboard steering. For a circuit, `laps` repeats the lap polyline. Returns the snapshot when a phase is reached."""
    r = route(page, index)
    xs, zs = r["polyline"]["x"], r["polyline"]["z"]
    if unwrap:
        xs, zs = unwrap_polyline(xs, zs, LOOP_PERIOD_METERS)
    # A lap is a closed loop: its last sample repeats its first. Drop the repeat, repeat the lap, close once at the end,
    # so every lap is a full copy and the path is long enough for all laps.
    base_len = len(xs) - 1
    if laps > 1:
        xs = xs[:base_len] * laps + [xs[0]]
        zs = zs[:base_len] * laps + [zs[0]]
    st = state if state is not None else {}
    p = pose(page)
    # The start line is both the first and the last sample of a lap, so the first pick stays on the first lap.
    st.setdefault("i", nearest_index(xs[:base_len], zs[:base_len], p["x"], p["z"]))
    end = time.time() + timeout
    last_log = 0.0
    while time.time() < end:
        snap = race(page)
        if snap:
            record_notices(snap)
            if snap["phase"] in until_phases:
                release_all(page)
                return snap
            if log_every and time.time() - last_log > log_every:
                last_log = time.time()
                pz = pose(page)
                full = page.evaluate("() => window.__STREET_RACER_DEBUG__ && window.__STREET_RACER_DEBUG__.getSnapshot()")
                tr = (full or {}).get("traffic") or {}
                opps = [f"{v['id']}:{v['laneId']}:{v['aiState']}:v{v['speedMps']:.1f}:tgt{(v.get('targetSpeedMps') or 0):.1f}:pos({v['pose']['x']:.0f},{v['pose']['z']:.0f}):yaw{v['pose']['yawDeg']:.0f}:stall{v['pose']['stalledSeconds']:.0f}:rel{v['pose']['releaseSeconds']:.0f}:th{v['pose']['throttle']:.2f}:br{v['pose']['brake']:.2f}:hb{v['pose']['handbrake']:.2f}:src{v['pose']['src']}" for v in tr.get("vehicles", []) if v.get("kind") == "opponent" and v.get("pose")]
                print(f"  drive clk={snap['raceSeconds']:.1f} lap={snap['lap']} next={snap['nextGate']} pos=({pz['x']:.1f},{pz['z']:.1f}) yawdeg={math.degrees(pz['yaw']):.0f} spd={pz['speed']:.1f} idx={st.get('i')} opps={opps} contacts={tr.get('contacts')} notices={notices_seen[-1:]} rec={((full or {}).get("road") or {}).get("recoveryCount")} trace={snap.get("playerTrace")} last={((full or {}).get("road") or {}).get("lastRecovery")}", flush=True)
        if stop_when and stop_when(snap):
            release_all(page)
            return snap
        p = pose(page)
        st["i"] = nearest_index(xs, zs, p["x"], p["z"], start=max(0, st["i"] - 5), window=80)
        k_near = st["i"]
        look = 6.0 + 0.3 * abs(p["speed"])
        k_t = along(xs, zs, k_near, look)
        tx, tz = xs[k_t], zs[k_t]
        # Curvature ahead decides the speed: the game's AI rule, so the bot slows for junction connectors.
        target = curve_speed_limit(xs, zs, k_near)
        yaw = p["yaw"]
        dx, dz = tx - p["x"], tz - p["z"]
        right = dx * math.cos(yaw) - dz * math.sin(yaw)
        fwd = dx * math.sin(yaw) + dz * math.cos(yaw)
        ld2 = right * right + fwd * fwd
        curvature = 2.0 * right / max(ld2, 1e-6)
        delta = math.atan(WHEELBASE * curvature)
        steer = max(-1.0, min(1.0, delta / STEER_RAD))
        set_key(page, "KeyD", steer > 0.12)
        set_key(page, "KeyA", steer < -0.12)
        speed = p["speed"]
        set_key(page, "KeyW", speed < target - 0.3)
        set_key(page, "KeyS", speed > target + 1.0)
        time.sleep(0.02)
    release_all(page)
    return race(page)


def hold_keys(page, codes, seconds):
    for c in codes:
        set_key(page, c, True)
    time.sleep(seconds)
    for c in codes:
        set_key(page, c, False)


def dist_to_marker(page, r):
    p = pose(page)
    return math.hypot(p["x"] - r["marker"]["x"], p["z"] - r["marker"]["z"])


def step_C(page):
    print("== Step C: one Sprint, player only ==", flush=True)
    r = route(page)
    check("C boot: race route 0 is valid with 3 gates and a marker", r is not None and len(r["gates"]) == 3 and r["marker"] is not None,
          f"event {r['eventId'] if r else None}, gates {len(r['gates']) if r else 0}")
    snap = race(page)
    check("C boot: free roam, no card, no race strip", snap is not None and snap["phase"] == "FREE_ROAM" and snap["approach"] is None,
          f"phase {snap and snap['phase']}")
    page.screenshot(path=os.path.join(OUT, "C01_free_roam_marker_far.png"))

    # Preview: stage 40 m behind the start line, then drive forward until the card opens.
    stage_at_route_start(page)
    snap = drive(page, {"EVENT_APPROACH"}, timeout=90.0)
    ok = snap is not None and snap["phase"] == "EVENT_APPROACH"
    d = dist_to_marker(page, r) if ok else None
    check("C preview: approach card opens inside the approach radius (18 m) while driving", ok and d is not None and d <= 18.5,
          f"phase {snap and snap['phase']}, marker distance {d and round(d, 2)} m")
    if ok:
        check("C preview: card names the event and reports the reward and the rivals", snap["approach"]["name"] == "Eastside Sprint" and snap["approach"]["rewardCredits"] == 300 and snap["approach"]["opponentCount"] == 5,
              json.dumps(snap["approach"]))
    time.sleep(0.2)
    page.screenshot(path=os.path.join(OUT, "C02_preview_card.png"))

    # Start from the card (E): the car is placed on the grid, with zero speed.
    page.keyboard.press("KeyE")
    snap = wait_phase(page, {"COUNTDOWN", "RACING"}, timeout=5.0)
    ok = snap is not None and snap["phase"] == "COUNTDOWN"
    check("C start: E from the card starts the countdown", ok, f"phase {snap and snap['phase']}")
    p0 = pose(page)
    # The player starts on the last row (playerGrid), behind the front rival's row (grid is the anchor, row 0). The grid
    # exists once the attempt is built, so the route is read again here.
    grid = route(page)["playerGrid"]
    gd = math.hypot(p0["x"] - grid["x"], p0["z"] - grid["z"])
    check("C start: the car is placed on the grid slot with zero speed", gd < 0.5 and abs(p0["speed"]) < 0.01,
          f"distance to grid {gd:.3f} m, speed {p0['speed']:.4f} m/s")
    # Full throttle during the hold must not move the car (hold is in the step, not a transform).
    hold_keys(page, ["KeyW"], 1.2)
    p1 = pose(page)
    moved = math.hypot(p1["x"] - p0["x"], p1["z"] - p0["z"])
    still_counting = race(page)["phase"] == "COUNTDOWN"
    check("C start: the car stays on the grid during the countdown, even with throttle held", moved < 0.05 and still_counting,
          f"moved {moved:.4f} m, phase {race(page)['phase']}")
    page.screenshot(path=os.path.join(OUT, "C03_countdown.png"))

    # Cancel during the countdown (Q): nothing is granted, traffic is restored, and the car is free to drive.
    page.keyboard.press("KeyQ")
    snap = wait_phase(page, {"FREE_ROAM"}, timeout=3.0)
    check("C cancel: Q during the countdown returns to free roam with no result", snap is not None and snap["result"] is None and snap["sessionCredits"] == 0,
          f"phase {snap and snap['phase']}, credits {snap and snap['sessionCredits']}")
    check("C cancel: traffic spawning is restored", api(page, "d.race.trafficSuspended()") is False)

    # Re-arm: the card closed on cancel, so it must not reopen while the car is still in the exit radius.
    time.sleep(0.8)
    snap = race(page)
    check("C re-arm: a cancelled card does not reopen while the car stays in range", snap["phase"] == "FREE_ROAM", f"phase {snap['phase']}")

    # Restage behind the start (outside the exit radius), then drive back in: the card must open again.
    stage_at_route_start(page)
    snap = drive(page, {"EVENT_APPROACH"}, timeout=90.0)
    check("C re-arm: the card opens again after the car leaves and re-enters the radius", snap is not None and snap["phase"] == "EVENT_APPROACH",
          f"phase {snap and snap['phase']}")

    # Start again, reach GO, then abort (Q while racing). An abort is a failure and grants nothing.
    page.keyboard.press("KeyE")
    snap = wait_phase(page, {"RACING"}, timeout=GO_TIMEOUT)
    check("C start again: GO reached and the race is running", snap is not None and snap["phase"] == "RACING", f"phase {snap and snap['phase']}")
    snap = wait_race_clock(page, 0.5, GO_TIMEOUT)
    check("C timer: the race clock is running after GO", snap["raceSeconds"] > 0.5, f"raceSeconds {snap['raceSeconds']:.2f}")

    # Pause and resume during the race: the clock freezes while paused, and resuming does not restart the countdown.
    page.keyboard.press("Escape")
    paused = wait_phase(page, {"PAUSED"}, timeout=3.0)
    t0 = paused["raceSeconds"] if paused else None
    time.sleep(2.0)
    s_pause = race(page)
    check("C pause: the phase is PAUSED and the race clock does not advance", paused is not None and s_pause["phase"] == "PAUSED" and t0 is not None and abs(s_pause["raceSeconds"] - t0) < 0.02,
          f"phase {s_pause['phase']}, clock {t0} -> {s_pause['raceSeconds']}")
    page.keyboard.press("Escape")
    time.sleep(0.3)
    s_res = race(page)
    check("C resume: back to RACING with no countdown restart", s_res["phase"] == "RACING" and s_res["countdown"] is None and s_res["raceSeconds"] >= s_pause["raceSeconds"],
          f"phase {s_res['phase']}, countdown {s_res['countdown']}, clock {s_res['raceSeconds']:.2f}")

    # Reset (R) is locked during a race, and the HUD says why. The car does not move.
    p_before = pose(page)
    page.keyboard.press("KeyR")
    time.sleep(0.4)
    s_r = race(page)
    p_after = pose(page)
    rd = math.hypot(p_after["x"] - p_before["x"], p_after["z"] - p_before["z"])
    check("C reset: R during a race is refused with a message and does not move the car", s_r["refusal"] is not None and "Reset is locked" in s_r["refusal"] and rd < 30 and s_r["phase"] == "RACING",
          f"refusal {s_r['refusal']!r}, moved {rd:.2f} m")
    page.screenshot(path=os.path.join(OUT, "C04_racing_strip.png"))

    page.keyboard.press("KeyQ")
    snap = wait_phase(page, {"FAILED"}, timeout=3.0)
    check("C abort: Q while racing ends as a failure, with no reward", snap is not None and snap["result"] is not None and snap["result"]["outcome"] == "aborted" and snap["result"]["rewardCredits"] is None and snap["sessionCredits"] == 0,
          f"phase {snap and snap['phase']}, outcome {snap and snap['result'] and snap['result']['outcome']}")
    page.screenshot(path=os.path.join(OUT, "C05_abort_result.png"))

    # Leave the results (Q): back to free roam, traffic restored, and the car drives normally.
    page.keyboard.press("KeyQ")
    snap = wait_phase(page, {"FREE_ROAM"}, timeout=3.0)
    check("C leave: Q on the results returns to free roam", snap is not None and snap["phase"] == "FREE_ROAM" and snap["result"] is None)
    check("C leave: traffic spawning is restored after the attempt", api(page, "d.race.trafficSuspended()") is False)
    v0 = pose(page)
    hold_keys(page, ["KeyW"], 2.0)
    v1 = pose(page)
    check("C free roam: throttle moves the car again after leaving the race", abs(v1["speed"]) > 3.0 or math.hypot(v1["x"] - v0["x"], v1["z"] - v0["z"]) > 5.0,
          f"speed {v1['speed']:.2f} m/s")


def step_D(page):
    print("== Step D: countdown and grid ==", flush=True)
    r = route(page)
    stage_at_route_start(page)
    drive(page, {"EVENT_APPROACH"}, timeout=90.0)
    # GO evidence. A 30 ms poll can miss the brief goVisible window, so GO is judged from the phase change: the countdown
    # shows 3, 2, 1, then the phase becomes RACING while the race clock is still under 0.5 s. goVisible is recorded as a
    # separate observation. It is not required, because a poll can miss it.
    seen = []
    go_visible_seen = False
    page.keyboard.press("KeyE")
    start_pose = None
    racing_snap = None
    end = time.time() + GO_TIMEOUT
    while time.time() < end:
        snap = race(page)
        if snap:
            if snap["phase"] == "COUNTDOWN" and start_pose is None:
                start_pose = pose(page)
            if snap["goVisible"]:
                go_visible_seen = True
            if snap["phase"] == "COUNTDOWN":
                value = snap["countdown"]
                if not seen or seen[-1] != value:
                    seen.append(value)
            if snap["phase"] == "RACING":
                racing_snap = snap
                break
        time.sleep(0.03)
    check("D countdown: 3, 2, 1 shown in order before the race starts", seen[:3] == [3, 2, 1], f"seen {seen}")
    print(f"  observed goVisible during the poll: {go_visible_seen} (recorded, not required)", flush=True)
    go_pose = pose(page)
    snap = racing_snap or race(page)
    check("D timer: RACING reached with the race clock under 0.5 s (about 0 at GO, then running)", snap is not None and snap["phase"] == "RACING" and snap["raceSeconds"] < 0.5,
          f"raceSeconds at detection {snap and round(snap['raceSeconds'], 3)}")
    moved = math.hypot(go_pose["x"] - start_pose["x"], go_pose["z"] - start_pose["z"]) if start_pose else None
    check("D hold: no transform jump between the countdown and GO (the car only waits on the grid)", moved is not None and moved < 0.05,
          f"moved {moved and round(moved, 4)} m")
    check("D grid: the car starts on the player's grid slot (the last row)", start_pose is not None and math.hypot(start_pose["x"] - route(page)["playerGrid"]["x"], start_pose["z"] - route(page)["playerGrid"]["z"]) < 0.5,
          f"at {start_pose and round(start_pose['x'], 2)}, {start_pose and round(start_pose['z'], 2)}")
    page.keyboard.press("KeyQ")
    wait_phase(page, {"FAILED"}, timeout=3.0)
    page.keyboard.press("KeyQ")
    wait_phase(page, {"FREE_ROAM"}, timeout=3.0)


def step_E(page):
    print("== Step E: checkpoints and finish ==", flush=True)
    r = route(page)
    gates = [g["label"] for g in r["gates"]]
    stage_at_route_start(page)
    drive(page, {"EVENT_APPROACH"}, timeout=90.0)
    notices_seen.clear()
    page.keyboard.press("KeyE")
    snap = wait_phase(page, {"RACING"}, timeout=GO_TIMEOUT)
    check("E start: race running", snap is not None and snap["phase"] == "RACING")
    # Wall-clock budget. The race's own limit (240 s of game time) is unchanged. At about 0.5 game seconds per wall second,
    # a 600 s budget ended the run at 173.8 s of race time, just before the finish (fix_pursuit/loop_race2.log).
    # The two-lap circuit (J) needs longer: 1200 s of wall time ended it at 336 s of race time, still on route (loop_race3.log).
    final = drive(page, {"FINISHED", "FAILED"}, timeout=1200.0, log_every=4.0)
    record_notices(final)
    finished = final is not None and final["phase"] == "FINISHED"
    check("E finish: the car reaches the finish and the race ends as finished", finished, f"phase {final and final['phase']}, clock {final and round(final['raceSeconds'], 2)}")
    order = [n for n in notices_seen if n.endswith(" passed") or n == "GO"]
    expected = ["GO", "Checkpoint 1 passed", "Checkpoint 2 passed", "Finish passed"]
    check("E order: gates pass in order, each once", order == expected, f"notices {order}")
    if finished:
        res = final["result"]
        check("E result: finished with a valid place among six racers, time recorded", res["outcome"] == "finished" and res["place"] is not None and res["totalRacers"] == 6 and res["finishSeconds"] is not None,
              f"place {res['place']} of {res['totalRacers']}, time {res['finishSeconds']}")
        expected = round(300 * REWARD_TABLE[res["place"] - 1]) if res["place"] is not None else None
        check("E reward: provisional credits granted once, by place multiplier", res["rewardCredits"] == expected and final["sessionCredits"] == expected,
              f"place {res['place']} expected {expected}, reward {res['rewardCredits']}, session {final['sessionCredits']}")
        standings = res["standings"]
        check("E standings: the player's row and five rivals, with DNF for rivals who did not finish", len(standings) == 6 and any(row["isPlayer"] for row in standings),
              json.dumps(standings))
    page.screenshot(path=os.path.join(OUT, "E01_result.png"))
    if finished:
        page.keyboard.press("KeyE")
        snap = wait_phase(page, {"COUNTDOWN"}, timeout=4.0)
        check("E retry: E on the results starts a new attempt on the grid", snap is not None and snap["result"] is None, f"phase {snap and snap['phase']}")
        p = pose(page)
        check("E retry: the car is back on the grid", math.hypot(p["x"] - route(page)["playerGrid"]["x"], p["z"] - route(page)["playerGrid"]["z"]) < 0.5, f"at {p['x']:.2f}, {p['z']:.2f}")
        check("E retry: no duplicate reward (session total unchanged)", snap is not None and snap["sessionCredits"] == final["sessionCredits"], f"session {snap and snap['sessionCredits']}")
        page.keyboard.press("KeyQ")
        wait_phase(page, {"FREE_ROAM"}, timeout=3.0)


# The loop period, for the harness only (WORLD_WRAP_CONFIG: 12 nodes x 200 m). Used to unwrap seam routes.
LOOP_PERIOD_METERS = 2400.0


def step_S(page):
    """Seam Sprint (loop only): one run east across the seam, from the east side to the west side."""
    print("== Step S: Seam Sprint across the loop seam ==", flush=True)
    idx = route_index(page, "seam-sprint")
    check("S boot: the seam sprint is listed (loop world only)", idx is not None, f"index {idx}")
    if idx is None:
        return
    r = route(page, idx)
    xs, zs = r["polyline"]["x"], r["polyline"]["z"]
    steps = [math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]) for i in range(1, len(xs))]
    seam_steps = [k for k, d in enumerate(steps) if d > LOOP_PERIOD_METERS / 2]
    check("S boot: the route is valid and crosses the seam once (one period-length step)", len(seam_steps) == 1,
          f"seam steps {len(seam_steps)}, samples {len(xs)}")
    gates = [g["label"] for g in r["gates"]]
    check("S boot: gates are Checkpoint 1 then Finish", gates == ["Checkpoint 1", "Finish"], f"gates {gates}")
    stage_at_route_start(page, idx)
    drive(page, {"EVENT_APPROACH"}, timeout=90.0, index=idx, unwrap=True)
    notices_seen.clear()
    page.keyboard.press("KeyE")
    snap = wait_phase(page, {"RACING"}, timeout=GO_TIMEOUT)
    check("S start: race running", snap is not None and snap["phase"] == "RACING", f"phase {snap and snap['phase']}")
    if snap is None:
        return
    credits_before = race(page)["sessionCredits"]
    final = drive(page, {"FINISHED", "FAILED"}, timeout=1200.0, index=idx, unwrap=True, log_every=4.0)
    record_notices(final)
    finished = final is not None and final["phase"] == "FINISHED"
    check("S finish: the car crosses the seam and the race ends as finished", finished,
          f"phase {final and final['phase']}, clock {final and round(final['raceSeconds'], 2)}")
    order = [n for n in notices_seen if n.endswith(" passed") or n == "GO"]
    check("S order: checkpoint then finish, each once, after the seam", order == ["GO", "Checkpoint 1 passed", "Finish passed"],
          f"notices {order}")
    trace = final.get("playerTrace") if final else None
    relocations = trace.get("relocations") if trace else None
    check("S seam: no relocation at the seam (the car drove through it)", relocations == 0,
          f"relocations {relocations}, relocationsHeld {trace and trace.get('relocationsHeld')}")
    if finished and final["result"] is not None:
        res = final["result"]
        expected = round(300 * REWARD_TABLE[res["place"] - 1]) if res["place"] is not None else None
        check("S reward: provisional credits granted once, by place multiplier",
              res["rewardCredits"] == expected and final["sessionCredits"] - credits_before == expected,
              f"place {res['place']}, reward {res['rewardCredits']}, session change {final['sessionCredits'] - credits_before}")
    wait_phase(page, {"FREE_ROAM"}, timeout=3.0)


def step_R(page):
    """Reliability: repeated start and cancel, pause and resume in a race, abort and retry, and input after exit."""
    print("== Step R: reliability ==", flush=True)
    # Rewards are session-only and accumulate across steps. R checks that nothing is added, so it compares with the
    # credits at its own start, not with zero (which holds only when R runs alone).
    baseline = (race(page) or {}).get("sessionCredits", 0)
    stage_at_route_start(page)
    drive(page, {"EVENT_APPROACH"}, timeout=90.0)

    # R1: repeated start and cancel on the card. Each cancel from the countdown must leave no reward and no race.
    cancel_results = []
    for i in range(3):
        page.keyboard.press("KeyE")
        started = wait_phase(page, {"COUNTDOWN"}, timeout=6.0)
        page.keyboard.press("KeyQ")
        after = wait_phase(page, {"FREE_ROAM", "EVENT_APPROACH"}, timeout=6.0)
        cancel_results.append((started is not None, after["phase"] if after else None, after["sessionCredits"] if after else None))
        if after and after["phase"] == "EVENT_APPROACH":
            page.keyboard.press("KeyQ")  # leave the card if it re-opened
            wait_phase(page, {"FREE_ROAM"}, timeout=4.0)
        stage_at_route_start(page)
        drive(page, {"EVENT_APPROACH"}, timeout=90.0)
    check("R cancel: three start and cancel cycles reach the countdown and return cleanly",
          all(c[0] and c[1] in ("FREE_ROAM", "EVENT_APPROACH") for c in cancel_results), f"cycles {cancel_results}")
    check("R cancel: cancel grants no reward (session credits unchanged from R start)", all(c[2] == baseline for c in cancel_results), f"credits {[c[2] for c in cancel_results]}")

    # R2: pause and resume during a race. The clock freezes while paused and continues, without restarting, on resume.
    page.keyboard.press("KeyE")
    snap = wait_phase(page, {"RACING"}, timeout=GO_TIMEOUT)
    check("R pause: race running before pause", snap is not None)
    time.sleep(3.0)
    page.screenshot(path=os.path.join(OUT, "R01_racing_hud_minimap.png"))
    page.keyboard.press("Escape")
    paused = wait_phase(page, {"PAUSED"}, timeout=4.0)
    c1 = paused["raceSeconds"] if paused else None
    time.sleep(2.0)
    held_snap = race(page)
    c2 = held_snap["raceSeconds"] if held_snap else None
    check("R pause: phase PAUSED and the race clock is frozen for 2 s", paused is not None and c1 is not None and c2 is not None and abs(c2 - c1) < 0.05,
          f"phase {paused and paused['phase']}, clock {c1} -> {c2}")
    page.keyboard.press("Escape")
    resumed = wait_phase(page, {"RACING"}, timeout=4.0)
    time.sleep(1.5)
    after_resume = race(page)
    check("R resume: back to RACING, clock continues from the paused value (no countdown restart)",
          resumed is not None and after_resume is not None and c1 is not None and after_resume["raceSeconds"] > c1 and after_resume["raceSeconds"] < c1 + 5.0,
          f"phase {after_resume and after_resume['phase']}, clock {c1} -> {after_resume and round(after_resume['raceSeconds'], 2)}")

    # R3: abort during the race, then retry. Abort grants nothing. Retry starts a new attempt with no duplicate reward.
    page.keyboard.press("KeyQ")
    failed = wait_phase(page, {"FAILED"}, timeout=6.0)
    res = failed["result"] if failed else None
    check("R abort: abort ends the race as aborted, with no reward", res is not None and res["outcome"] == "aborted" and failed["sessionCredits"] == baseline,
          f"outcome {res and res['outcome']}, credits {failed and failed['sessionCredits']}")
    page.keyboard.press("KeyE")
    retry = wait_phase(page, {"COUNTDOWN"}, timeout=6.0)
    check("R retry: E on the results starts a new attempt on the grid with no result carried over",
          retry is not None and retry["result"] is None and retry["sessionCredits"] == baseline, f"phase {retry and retry['phase']}, credits {retry and retry['sessionCredits']}, baseline {baseline}")
    page.keyboard.press("KeyQ")
    wait_phase(page, {"FREE_ROAM", "EVENT_APPROACH"}, timeout=6.0)

    # R4: no input lock after leaving the race. Hold W and check the car moves.
    stage_at_route_start(page)
    time.sleep(0.5)
    before = pose(page)
    hold_keys(page, ["KeyW"], 2.0)
    after_w = race(page)
    p = pose(page)
    moved = math.hypot(p["x"] - before["x"], p["z"] - before["z"]) if before and p else 0.0
    check("R exit: after leaving the race, W still drives the car (no input lock)", moved > 3.0 and after_w is not None and after_w["phase"] in ("FREE_ROAM", "EVENT_APPROACH"),
          f"moved {moved:.2f} m, phase {after_w and after_w['phase']}")


def step_J(page):
    print("== Step J: Block Circuit, two laps ==", flush=True)
    r = route(page, 1)
    gates = [g["label"] for g in r["gates"]]
    check("J boot: circuit route is valid, two laps, gates per lap in order",
          r is not None and gates == ["Checkpoint A", "Checkpoint B", "Start / Finish"] and [g["closesLap"] for g in r["gates"]] == [False, False, True],
          f"gates {gates}")
    xs, zs = r["polyline"]["x"], r["polyline"]["z"]
    k = len(xs) - 26
    yaw = math.atan2(xs[k + 1] - xs[k], zs[k + 1] - zs[k])
    page.evaluate(f"() => window.__STREET_RACER_DEBUG__.race.placeForTest({xs[k]}, {zs[k]}, {yaw})")
    time.sleep(0.3)
    snap = drive(page, {"EVENT_APPROACH"}, timeout=90.0, index=1)
    check("J preview: the circuit card opens near its marker while driving",
          snap is not None and snap["phase"] == "EVENT_APPROACH" and snap["approach"]["name"] == "Block Circuit" and snap["approach"]["laps"] == 2,
          f"phase {snap and snap['phase']}, card {snap and snap['approach'] and snap['approach']['name']}")
    page.screenshot(path=os.path.join(OUT, "J01_circuit_card.png"))
    notices_seen.clear()
    # The session total can already hold credits from earlier steps (the Sprint pays into the same session). The reward
    # check therefore compares the change from this point, not the absolute total. Fix: loop_race3 / finite_race2 logs.
    credits_before = race(page)["sessionCredits"]
    page.keyboard.press("KeyE")
    snap = wait_phase(page, {"RACING"}, timeout=GO_TIMEOUT)
    check("J start: E starts the circuit, GO reached", snap is not None and snap["phase"] == "RACING", f"phase {snap and snap['phase']}")
    check("J laps: the race shows lap 1 of 2 at the start", snap is not None and snap["lap"] == 1 and snap["laps"] == 2, f"lap {snap and snap['lap']} of {snap and snap['laps']}")
    # The circuit has no time limit. The headless browser runs the simulation slower than real time, so the wall-clock budget is generous.
    final = drive(page, {"FINISHED", "FAILED"}, timeout=2400.0, index=1, laps=2, log_every=4.0)
    record_notices(final)
    finished = final is not None and final["phase"] == "FINISHED"
    check("J finish: the race ends as finished after both laps", finished, f"phase {final and final['phase']}, clock {final and round(final['raceSeconds'], 2)}")
    page.screenshot(path=os.path.join(OUT, "J02_circuit_result.png"))
    # A closing gate announces its completed lap ("Lap N of M"), so the sequence is checkpoints, then the lap line, per lap.
    seq = [n for n in notices_seen if n.endswith(" passed") or n.startswith("Lap ")]
    # The last lap ends at the finish: its closing gate is announced as the finish, not as a lap count.
    expected_seq = ["Checkpoint A passed", "Checkpoint B passed", "Lap 1 of 2", "Checkpoint A passed", "Checkpoint B passed", "Start / Finish passed"]
    check("J gates: each lap passes A, B, then the start/finish line in order, and the race ends after lap 2", seq == expected_seq and finished, f"sequence {seq}")
    if finished:
        res = final["result"]
        expected_reward = round(400 * REWARD_TABLE[res["place"] - 1]) if res["place"] is not None else None
        check("J reward: provisional credits by place multiplier, granted once",
              res["rewardCredits"] == expected_reward and final["sessionCredits"] - credits_before == expected_reward,
              f"place {res['place']}, reward {res['rewardCredits']}, session {final['sessionCredits']} (before J {credits_before})")
        page.keyboard.press("KeyE")
        snap = wait_phase(page, {"COUNTDOWN"}, timeout=4.0)
        check("J retry: lap counter and gates reset on a new attempt", snap is not None and snap["lap"] == 1 and snap["result"] is None,
              f"lap {snap and snap['lap']}, phase {snap and snap['phase']}")
        page.keyboard.press("KeyQ")
        wait_phase(page, {"FAILED"}, timeout=3.0)
        page.keyboard.press("KeyQ")
        wait_phase(page, {"FREE_ROAM"}, timeout=3.0)
        check("J leave: back to free roam after the circuit", race(page)["phase"] == "FREE_ROAM")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
        page = browser.new_page(viewport={"width": 1280, "height": 760})
        page.on("console", lambda msg: console_issues.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda err: page_errors.append(str(err)))
        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_function("() => window.__STREET_RACER_DEBUG__ && window.__STREET_RACER_DEBUG__.race", timeout=120000)
        page.wait_for_function("() => window.__STREET_RACER_DEBUG__.race.getRace().phase === 'FREE_ROAM'", timeout=60000)
        time.sleep(1.0)
        print(f"  sim rate in this run: {sim_rate(page)} fixed steps per second (game time = steps / 60 per wall second)", flush=True)
        page.evaluate("() => document.activeElement && document.activeElement.blur && document.activeElement.blur()")
        try:
            if "C" in STEPS:
                step_C(page)
            if "D" in STEPS:
                step_D(page)
            if "E" in STEPS:
                step_E(page)
            if "J" in STEPS:
                step_J(page)
            if "R" in STEPS:
                step_R(page)
            if "S" in STEPS:
                step_S(page)
        finally:
            release_all(page)
        known = [m for m in console_issues if any(w in m for w in KNOWN_WARNINGS)]
        unknown = [m for m in console_issues if m not in known]
        check("errors: no page errors", len(page_errors) == 0, "; ".join(page_errors)[:300])
        check("errors: no unexpected console errors", len(unknown) == 0, "; ".join(unknown)[:300])
        browser.close()

    passed = sum(1 for r in results if r["passed"])
    report = {
        "url": URL,
        "steps": STEPS,
        "passed": passed,
        "total": len(results),
        "results": results,
        "notices": notices_seen,
        "known_warnings": sorted(set(m[:120] for m in console_issues if any(w in m for w in KNOWN_WARNINGS))),
    }
    with open(os.path.join(OUT, "report_race.json"), "w") as f:
        json.dump(report, f, indent=2)
    print(f"\n{passed}/{len(results)} checks passed. Report: {os.path.join(OUT, 'report_race.json')}", flush=True)
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
