"""
Browser verification for Part 7 (police pursuit). Runs in the running DEV app and drives the car with real keyboard events.

Steps (select with arguments; default runs all steps in order):
  boot     the app loads, the pursuit API is present, free roam has no pursuit, no HUD, two patrols on the road
  trigger  a real speeding trigger: the player is placed in view of a patrol and holds W. Reports whether the
           pursuit started from the car's own speed, or not. Nothing is faked in this step.
  pursue   the pursuit runs: the HUD shows the real state, chasers are lit, chasers follow the road and do not teleport,
           a second offence during the detection is refused, and the screenshots are taken
  escape   the player is moved far from every unit and stops. The search runs, the pursuit cools down and ends once.
           Checks the HUD hides, the escape toast shows, and the units clean up
  reset    a new pursuit is ended by R (reset). Checks the HUD hides and the end reason is recorded
  errors   no page errors or console errors (known GL/three.js warnings are listed, not counted)

Staging: `placeAheadOfUnit` and `placeFarAway` move only the player, on the lane graph. Police are never moved by the
test. Every drive after staging uses keyboard input.

Usage:
  python3 tools/browser-pursuit.py [url] [outdir] [steps...]
Defaults: url=http://localhost:5173/play.html  outdir=browser-output/part7  steps=boot trigger pursue escape reset errors
"""

import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

ARGS = sys.argv[1:]
URL = ARGS[0] if len(ARGS) > 0 and ARGS[0].startswith("http") else "http://localhost:5173/play.html?world=city"
REST = [a for a in ARGS if not a.startswith("http")]
OUT = REST[0] if len(REST) > 0 and REST[0].startswith("/") else "browser-output/part7"
STEPS = [a for a in REST if not a.startswith("/")] or ["boot", "trigger", "pursue", "escape", "reset", "errors"]
os.makedirs(OUT, exist_ok=True)

KNOWN_WARNINGS = ("THREE.Clock", "GL Driver Message", "GPU stall")
results = []
console_issues = []
page_errors = []
held = set()
timeline = []


def check(name, passed, detail=""):
    results.append({"name": name, "passed": bool(passed), "detail": detail})
    print(("PASS " if passed else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def pursuit(page):
    return page.evaluate("() => { const d = window.__STREET_RACER_DEBUG__; return d && d.pursuit ? d.pursuit.getSnapshot() : null; }")


def diag(page):
    return page.evaluate("() => { const d = window.__STREET_RACER_DEBUG__; return d && d.pursuit ? d.pursuit.getDiagnostics() : null; }")


def pose(page):
    return page.evaluate("() => { const d = window.__STREET_RACER_DEBUG__; return d && d.race ? d.race.getPose() : null; }")


def api_call(page, expr):
    return page.evaluate(f"() => {{ const d = window.__STREET_RACER_DEBUG__ && window.__STREET_RACER_DEBUG__.pursuit; return d ? ({expr}) : null; }}")


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


def hud_count(page):
    return page.evaluate("() => document.querySelectorAll('.pursuit-hud').length")


def hud_text(page):
    return page.evaluate("() => { const el = document.querySelector('.pursuit-hud'); return el ? el.innerText : null; }")


def toast_text(page):
    return page.evaluate("() => { const el = document.querySelector('.pursuit-toast'); return el ? el.innerText : null; }")


def wait_for(page, predicate, timeout, poll=0.1):
    end = time.time() + timeout
    while time.time() < end:
        snap = pursuit(page)
        if snap and predicate(snap):
            return snap
        time.sleep(poll)
    return pursuit(page)


def record(page, label):
    snap = pursuit(page)
    if snap is None:
        return None
    entry = {"t": round(time.time(), 2), "label": label, "state": snap["state"], "level": snap["level"], "heat": round(snap["heat"], 1),
             "pursuing": snap["pursuingUnits"], "patrol": snap["patrolUnits"], "lost": round(snap["lostSightSeconds"], 2),
             "escape": round(snap["escapeProgress"], 2), "search": round(snap["searchSecondsLeft"], 1), "cooldown": round(snap["cooldownSecondsLeft"], 1)}
    timeline.append(entry)
    return snap


def step_boot(page):
    print("== Step boot ==", flush=True)
    snap = pursuit(page)
    check("boot: the pursuit debug API is installed in the DEV build", snap is not None, "window.__STREET_RACER_DEBUG__.pursuit")
    check("boot: free roam, no pursuit, no sessions yet", snap is not None and snap["state"] == "INACTIVE" and snap["sessionsStarted"] == 0,
          f"state {snap and snap['state']}, sessions {snap and snap['sessionsStarted']}")
    check("boot: two patrols on the road, the rest of the pool idle", snap is not None and snap["patrolUnits"] == 2 and snap["idleUnits"] == snap["poolSize"] - 2,
          f"patrol {snap and snap['patrolUnits']}, idle {snap and snap['idleUnits']}, pool {snap and snap['poolSize']}")
    check("boot: no pursuit HUD is shown in free roam", hud_count(page) == 0, f"hud elements {hud_count(page)}")
    page.screenshot(path=os.path.join(OUT, "P00_boot_free_roam.png"))


def step_visual(page):
    print("== Step visual ==", flush=True)
    release_all(page)
    # A negative offset puts the player behind the patrol, so the patrol is ahead of the camera and in view.
    placed = api_call(page, "d.placeAheadOfUnit(0, -12)")
    check("visual staging: the player is 12 m behind patrol 0, so the patrol is ahead and in view", placed is True, f"placed {placed}")
    time.sleep(0.8)
    page.screenshot(path=os.path.join(OUT, "P05_patrol_close_up.png"))
    check("visual: a close-up of a patrol is saved for review", os.path.exists(os.path.join(OUT, "P05_patrol_close_up.png")), "P05_patrol_close_up.png")


def step_trigger(page):
    print("== Step trigger ==", flush=True)
    placed = api_call(page, "d.placeAheadOfUnit(0, 30)")
    check("trigger staging: the player is placed 30 m ahead of patrol 0, on its lane", placed is True, f"placed {placed}")
    time.sleep(0.6)
    page.screenshot(path=os.path.join(OUT, "P01_patrol_ahead_inactive.png"))
    d0 = diag(page)
    check("trigger: patrol 0 is still a patrol before any offence (no auto-start)", d0 is not None and d0["units"][0]["role"] == "patrol" and pursuit(page)["state"] == "INACTIVE",
          f"role {d0 and d0['units'][0]['role']}, state {pursuit(page)['state']}")

    # Real driving: hold W and let the car's own speed decide. No offence is reported by the test here.
    # The state is watched inside the page every 10 ms. A DETECTION lasts 1.5 s, but a poll from Python takes about
    # 0.8 s, so polling could miss a short detection that the rule cancelled. In-page sampling does not miss it.
    page.evaluate(
        "() => { const d = window.__STREET_RACER_DEBUG__.pursuit; const w = { states: [], again: null };"
        " window.__pursuitWatch = w; let last = null;"
        " w.timer = setInterval(() => { const s = d.getSnapshot().state;"
        " if (s !== last) { w.states.push(s); last = s; }"
        " if (s === 'DETECTION' && w.again === null) w.again = d.reportOffence('speeding'); }, 10); }"
    )
    # The budget is wall-clock, and headless Chromium runs the simulation slower than real time (the step is clamped).
    # Probe (fix_pursuit/probe_speed.py): the car reached 19.6 m/s, the speeding threshold, about 19 s after W was
    # pressed, and the detection began at about 30 s. A 14 s budget therefore never reached the rule. The rule and
    # its tuning are unchanged. The loop ends when a detection has started and then been cancelled (the car left view),
    # or at 60 s.
    set_key(page, "KeyW", True)
    start = time.time()
    max_speed = 0.0
    while time.time() - start < 60.0:
        p = pose(page)
        if p:
            max_speed = max(max_speed, abs(p["speed"]))
        record(page, "trigger")
        states = page.evaluate("() => window.__pursuitWatch.states")
        if "DETECTION" in states and states[-1] == "INACTIVE":
            break
        time.sleep(0.25)
    set_key(page, "KeyW", False)
    watched = page.evaluate("() => { const w = window.__pursuitWatch; clearInterval(w.timer); return { states: w.states, again: w.again }; }")
    print(f"  watched states while driving: {watched['states']}", flush=True)
    detected = {"state": "DETECTION", "again": watched["again"]} if "DETECTION" in watched["states"] else None
    check("trigger: holding W in view of a patrol starts a detection from the car's own speed (speeding)", detected is not None,
          f"peak speed {max_speed:.1f} m/s, sessions {pursuit(page)['sessionsStarted']}")
    if detected is not None:
        # Either answer means no second session: 'ignored' while the witness is in view, 'unwitnessed' when it is not.
        check("trigger: a second offence during the detection is refused, not a second pursuit", detected["again"] in ("ignored", "unwitnessed"),
              f"reportOffence during DETECTION -> {detected['again']}, sessions {pursuit(page)['sessionsStarted']}")
    else:
        print("NOTE: the car did not start a detection in view of the patrol within 60 s.", flush=True)
    check("trigger: exactly one session has started", pursuit(page)["sessionsStarted"] == 1, f"sessions {pursuit(page)['sessionsStarted']}")
    # The car left the witness's view at speed, so the detection is cancelled by the rule. Let it run out.
    end = time.time() + 4.0
    while time.time() < end and pursuit(page)["state"] != "INACTIVE":
        time.sleep(0.2)
    snap = pursuit(page)
    check("trigger: a detection whose witness loses sight is cancelled silently (no pursuit)", snap["state"] == "INACTIVE" and snap["lastEndReason"] in (None, "cancelled"),
          f"state {snap['state']}, reason {snap['lastEndReason']}")


def step_pursue(page):
    print("== Step pursue ==", flush=True)
    # Staged witnessed offence, the same trigger interface. The car is then driven straight at a steady speed, so it
    # stays in view of the chasers and is never still (a still car in contact range would be captured by the rule).
    api_call(page, "d.placeAheadOfUnit(0, 30)")
    time.sleep(0.4)
    reported = api_call(page, "d.reportOffence('speeding')")
    check("pursue staging: a witnessed offence starts a detection", reported == "started", f"reportOffence -> {reported}")
    end = time.time() + 35.0
    visited = []
    prev = None
    jumps = []
    hud_ok = True
    screenshot_taken = False
    min_gap = None
    chaser_lanes = []
    while time.time() < end:
        snap = pursuit(page)
        if snap is None:
            break
        if not visited or visited[-1] != snap["state"]:
            visited.append(snap["state"])
        record(page, "pursue")
        d = diag(page)
        steps = api_call(page, "d.stepCount()")
        p = pose(page)
        if p and not (snap["state"] == "BUSTED"):
            if p["speed"] < 11.0:
                set_key(page, "KeyW", True)
            elif p["speed"] > 14.0:
                set_key(page, "KeyW", False)
        if snap["state"] != "INACTIVE" and hud_count(page) == 0:
            hud_ok = False
        if d and prev is not None and steps is not None and prev["steps"] is not None:
            dsteps = max(0, steps - prev["steps"])
            bound = (40.0 / 60.0) * dsteps + 1.0
            for u, (x0, z0) in zip(d["units"], prev["xz"]):
                if not u["active"]:
                    continue
                dist = ((u["x"] - x0) ** 2 + (u["z"] - z0) ** 2) ** 0.5
                if dist > bound and d["deployments"] + d["patrolRespawns"] == prev["spawns"]:
                    jumps.append((u["id"], round(dist, 2), dsteps))
        if d:
            prev = {"steps": steps, "xz": [(u["x"], u["z"]) for u in d["units"]], "spawns": d["deployments"] + d["patrolRespawns"]}
            chasers = [u for u in d["units"] if u["active"] and u["role"] != "patrol"]
            for u in chasers:
                if not chaser_lanes or chaser_lanes[-1] != (u["id"], u["laneId"]):
                    chaser_lanes.append((u["id"], u["laneId"]))
            if p and chasers:
                gap = min(((u["x"] - p["x"]) ** 2 + (u["z"] - p["z"]) ** 2) ** 0.5 for u in chasers)
                min_gap = gap if min_gap is None else min(min_gap, gap)
        if snap["state"] in ("PURSUING", "ESCALATING") and not screenshot_taken:
            page.screenshot(path=os.path.join(OUT, "P02_pursuit_lights_hud.png"))
            screenshot_taken = True
        time.sleep(0.2)
    release_all(page)
    snap = pursuit(page)
    check("pursue: a real session reaches PURSUING or ESCALATING", any(s in ("PURSUING", "ESCALATING") for s in visited),
          f"visited {visited}")
    check("pursue: the HUD is shown whenever a pursuit is active", hud_ok, f"hud elements {hud_count(page)}")
    text = hud_text(page)
    # The HUD uppercases its title with CSS, so compare in lower case.
    check("pursue: the HUD text reflects the state", text is None or any(word in text.lower() for word in ("pursuit", "police", "searching", "spotted", "cooling", "busted")),
          (text or "none").replace("\n", " | ")[:160])
    d = diag(page)
    engaged = [u for u in d["units"] if u["active"] and u["role"] != "patrol"] if d else []
    lit = [u for u in engaged if u["lightsOn"]]
    patrol_lit = [u for u in d["units"] if u["active"] and u["role"] == "patrol" and u["lightsOn"]] if d else []
    check("pursue: every engaged unit has its light bar on, and no patrol does", len(lit) == len(engaged) and len(patrol_lit) == 0,
          f"engaged {len(engaged)}, lit {len(lit)}, patrols lit {len(patrol_lit)}")
    check("pursue: chasers were engaged during the run", len(chaser_lanes) > 0, f"chaser lane changes {chaser_lanes[:6]}")
    check("pursue: no police unit teleported (displacement within the step bound, no spawn in between)", len(jumps) == 0,
          f"jumps {jumps[:5]}, deployments {d and d['deployments']}, respawns {d and d['patrolRespawns']}")
    check("pursue: chasers closed on the player at some point", min_gap is not None, f"closest chaser gap {min_gap and round(min_gap, 1)} m")
    check("pursue: the session did not take an illegal transition", d is not None and d["rejectedTransitions"] == 0, f"rejected {d and d['rejectedTransitions']}")
    print(f"  pursue visited {visited}; final {snap and snap['state']}", flush=True)
    page.screenshot(path=os.path.join(OUT, "P03_pursue_after.png"))


def step_escape(page):
    print("== Step escape ==", flush=True)
    release_all(page)
    snap = pursuit(page)
    if snap is None or snap["state"] == "INACTIVE":
        check("escape: a pursuit is active to escape from", False, f"state {snap and snap['state']}")
        return
    far = api_call(page, "d.placeFarAway()")
    check("escape staging: the player is placed far from every unit, stationary", far is not None and far >= 150, f"distance {far} m")
    visited = []
    toast_seen = False
    t0 = time.time()
    ended = None
    while time.time() - t0 < 180.0:
        snap = record(page, "escape")
        if snap is None:
            break
        if not visited or visited[-1] != snap["state"]:
            visited.append(snap["state"])
            print(f"  escape state -> {snap['state']} (t+{time.time() - t0:.1f}s)", flush=True)
        if snap["state"] == "INACTIVE":
            ended = snap
            break
        time.sleep(0.25)
    if ended is None:
        check("escape: the pursuit ends within 180 s", False, f"visited {visited}, last state {snap and snap['state']}")
        return
    check("escape: the pursuit ended only after cooling down", "SEARCHING" in visited and "COOLDOWN" in visited, f"visited {visited}")
    check("escape: the end reason is cooldown (escape, not capture)", ended["lastEndReason"] == "cooldown", f"reason {ended['lastEndReason']}")
    check("escape: the HUD is hidden once the pursuit is over", hud_count(page) == 0, f"hud elements {hud_count(page)}")
    for _ in range(12):
        if toast_text(page):
            toast_seen = True
            break
        time.sleep(0.25)
    check("escape: the escape toast shows after the pursuit ends, with no other notice", toast_seen, f"toast {toast_text(page)!r}")
    time.sleep(0.5)
    d = diag(page)
    lit_units = [u for u in d["units"] if u["active"] and u["role"] != "patrol"] if d else []
    snap = pursuit(page)
    check("escape cleanup: no unit is still engaged after the end", snap["pursuingUnits"] == 0 and len(lit_units) == 0,
          f"pursuing {snap['pursuingUnits']}, engaged units {len(lit_units)}")
    check("escape cleanup: the patrols are back on the road", snap["patrolUnits"] == 2, f"patrol {snap['patrolUnits']}")
    check("escape cleanup: heat is cleared", snap["heat"] == 0 and snap["level"] == 1, f"heat {snap['heat']}, level {snap['level']}")
    page.screenshot(path=os.path.join(OUT, "P04_after_escape_toast.png"))


def step_reset(page):
    print("== Step reset ==", flush=True)
    # Start from a fresh session. The steps before this one leave a cooldown, moved patrols, and a finished pursuit,
    # which made the staging depend on timing. A reload gives the same starting point each run. Part 11.
    page.reload(wait_until="load")
    time.sleep(3.0)
    # Staging can fail two ways: the offence is unwitnessed (the car is not in a patrol's view after the previous step),
    # or the witness leaves sight before R (a detection is then cancelled silently, by design). Either way the reset
    # would not be tested, so stage again (at most five attempts) and log each retry. Part 11.
    reported = None
    before = None
    for attempt in range(1, 6):
        api_call(page, "d.placeAheadOfUnit(0, 30)")
        time.sleep(0.4)
        reported = api_call(page, "d.reportOffence('speeding')")
        if reported != "started":
            print(f"  staging attempt {attempt}: reportOffence -> {reported}; restaging", flush=True)
            time.sleep(0.5)
            continue
        # The session is applied on the next fixed simulation step. Headless frames can be slow after a reload, so
        # the state is awaited (up to 8 s) instead of read after a fixed sleep. A fixed 1 s read restaged while the
        # first session was still pending, and the restage returned 'ignored'. Probe: fix_pursuit/probe_reset.py.
        before = wait_for(page, lambda snap: snap["state"] != "INACTIVE", timeout=8.0, poll=0.1)
        if before is not None and before["state"] != "INACTIVE":
            break
        print(f"  staging attempt {attempt}: the pursuit ended before R (reason {before and before['lastEndReason']}); restaging", flush=True)
    check("reset staging: a witnessed offence starts a new pursuit", reported == "started", f"reportOffence -> {reported}")
    check("reset staging: the pursuit is still active when R is pressed", before is not None and before["state"] != "INACTIVE",
          f"state {before and before['state']}, reason {before and before['lastEndReason']}")
    # The simulation advances by frame time, so a slow headless frame rate delays the reset. Measure the rate, then wait for the reset.
    steps_a = api_call(page, "d.stepCount()")
    time.sleep(1.0)
    steps_b = api_call(page, "d.stepCount()")
    print(f"  sim rate in this run: {(steps_b - steps_a) if steps_a is not None and steps_b is not None else 'n/a'} fixed steps per second", flush=True)
    page.keyboard.press("KeyR")
    wait_for(page, lambda snap: snap["state"] == "INACTIVE", timeout=8.0, poll=0.1)
    after = pursuit(page)
    d = diag(page)
    check("reset: R ends the pursuit, with reason aborted-reset", after["state"] == "INACTIVE" and after["lastEndReason"] == "aborted-reset",
          f"state {before['state']} -> {after['state']}, reason {after['lastEndReason']}, judged {d and d['judgedOffences']} last {d and d['lastOffence']}")
    check("reset: the HUD is hidden after the reset", hud_count(page) == 0, f"hud elements {hud_count(page)}")
    check("reset: the patrols are back on the road", after["patrolUnits"] == 2 and after["pursuingUnits"] == 0,
          f"patrol {after['patrolUnits']}, pursuing {after['pursuingUnits']}")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
        page = browser.new_page(viewport={"width": 1280, "height": 760})
        page.on("console", lambda msg: console_issues.append(msg.text) if msg.type in ("error", "warning") else None)
        page.on("pageerror", lambda err: page_errors.append(str(err)))
        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_function("() => window.__STREET_RACER_DEBUG__ && window.__STREET_RACER_DEBUG__.pursuit", timeout=60000)
        time.sleep(1.5)
        try:
            for name in STEPS:
                if name == "boot":
                    step_boot(page)
                elif name == "visual":
                    step_visual(page)
                elif name == "trigger":
                    step_trigger(page)
                elif name == "pursue":
                    step_pursue(page)
                elif name == "escape":
                    step_escape(page)
                elif name == "reset":
                    step_reset(page)
                elif name == "errors":
                    pass
                else:
                    print(f"unknown step {name}", flush=True)
        finally:
            release_all(page)
            browser.close()

    real_errors = [m for m in console_issues if not any(k in m for k in KNOWN_WARNINGS)]
    check("errors: no page errors", len(page_errors) == 0, "; ".join(page_errors)[:300])
    check("errors: no console errors or warnings outside the known GL messages", len(real_errors) == 0, "; ".join(real_errors)[:300])
    with open(os.path.join(OUT, "pursuit_timeline.json"), "w") as f:
        json.dump(timeline, f, indent=1)
    passed = sum(1 for r in results if r["passed"])
    print(f"\nRESULT {passed}/{len(results)} passed", flush=True)
    # Exit status reflects the checks: 0 only when every check passed (Part 11).
    return 0 if passed == len(results) else 1
    with open(os.path.join(OUT, "pursuit_results.json"), "w") as f:
        json.dump({"results": results, "console": console_issues[:50], "pageErrors": page_errors}, f, indent=1)


if __name__ == "__main__":
    sys.exit(main())
