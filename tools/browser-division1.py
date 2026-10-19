"""
Full Division 1 playthrough (Street Origins) in the running DEV app, with a fresh save.

Order: Harbour Warm-Up, Block Laps (two laps), Checkpoint Run, Clock Run, then Mara Quill: Dock Run. After each event the
result is read from the save. Checks at the end: the Street Origins Cup is won, Mara is defeated, Division 1 is complete
and its reward is paid once, and the career hub shows the Division 2 lead only now.

Staging: each event's car is placed at its route marker through the DEV API (placeForTest). This is the same staging the
other browser checks use. Every drive after that is keyboard input with the pure-pursuit driver from browser-race.py.
A failed attempt is retried through the approach card, up to MAX_ATTEMPTS per event.

Usage:
  python3 tools/browser-division1.py [url] [outdir]
Defaults: url=http://localhost:5173/play.html?world=city  outdir=browser-output/division1
"""

import importlib.util
import json
import os
import re
import sys
import time

from playwright.sync_api import sync_playwright

ARGS = sys.argv[1:]
URL = ARGS[0] if len(ARGS) > 0 and ARGS[0].startswith("http") else "http://localhost:5173/play.html?world=city"
OUT = ARGS[1] if len(ARGS) > 1 else "browser-output/division1"
os.makedirs(OUT, exist_ok=True)

# Reuse the Part 6 driver and route helpers. Loaded by path, because the file name has a dash.
_SPEC = importlib.util.spec_from_file_location("browser_race", os.path.join(os.path.dirname(__file__), "browser-race.py"))
br = importlib.util.module_from_spec(_SPEC)
_SAVED_ARGV = sys.argv
sys.argv = ["browser-race.py", URL, OUT]
_SPEC.loader.exec_module(br)
sys.argv = _SAVED_ARGV

KNOWN_WARNINGS = ("THREE.Clock", "GL Driver Message", "GPU stall")
SAVE_KEY = "street-racer.save"
MAX_ATTEMPTS = 4
DRIVE_TIMEOUT = 1200.0

# Event id (career), race event id (route), laps, label the approach card should show.
SEQUENCE = [
    ("career-warmup", "career-warmup-race", 1, "Harbour Warm-Up"),
    ("career-block-laps", "career-block-race", 2, "Block Laps"),
    ("career-checkpoint-run", "career-checkpoint-race", 1, "Checkpoint Run"),
    ("career-clock-run", "career-clock-race", 1, "Clock Run"),
    ("rival-mara-challenge", "rival-mara-race", 1, "Mara Quill: Dock Run"),
]

results = []
console_issues = []
page_errors = []


def check(name, passed, detail=""):
    results.append((name, bool(passed), detail))
    print(("PASS " if passed else "FAIL ") + name + (f" :: {detail}" if detail else ""), flush=True)


def save(page):
    text = page.evaluate(f"() => window.localStorage.getItem('{SAVE_KEY}')")
    return json.loads(text) if text else None


def hub_open(page):
    return page.locator(".career-overlay").count() > 0


def open_hub(page):
    page.evaluate("() => document.activeElement && document.activeElement.blur && document.activeElement.blur()")
    page.keyboard.press("KeyC")
    page.wait_for_selector(".career-overlay", timeout=20000)


def close_hub(page):
    page.get_by_role("button", name="Close", exact=True).first.click()
    page.wait_for_selector(".career-overlay", state="detached", timeout=20000)


def wait_free_roam(page, timeout=8.0):
    return br.wait_phase(page, {"FREE_ROAM"}, timeout=timeout)


def approach_for(page, event_id, timeout=20.0):
    deadline = time.time() + timeout
    snap = None
    while time.time() < deadline:
        snap = br.race(page)
        if snap and snap.get("approach") and snap["approach"].get("eventId") == event_id:
            return snap["approach"]
        time.sleep(0.1)
    return None


def run_event(page, event_id, race_id, laps, label):
    """Play one event until it is completed, up to MAX_ATTEMPTS attempts. Returns True when it is completed."""
    index = br.route_index(page, race_id)
    route = br.route(page, index) if index is not None else None
    check(f"{label}: the route is a valid career route with a marker", route is not None and route.get("eventId") == race_id and route.get("marker") is not None, f"index {index}")
    if route is None:
        return False
    for attempt in range(1, MAX_ATTEMPTS + 1):
        if save(page)["career"]["completedEvents"].count(event_id) > 0:
            return True
        page.evaluate(f"() => window.__STREET_RACER_DEBUG__.race.placeForTest({route['marker']['x']}, {route['marker']['z']}, 0)")
        approach = approach_for(page, race_id)
        if approach is None:
            check(f"{label}: the approach card is shown", False, f"attempt {attempt}")
            return False
        if attempt == 1:
            check(f"{label}: the approach card names the event", approach.get("name") == label, json.dumps(approach)[:200])
        page.keyboard.press("KeyE")
        started = br.wait_phase(page, {"COUNTDOWN", "RACING"}, timeout=10.0)
        if started is None:
            check(f"{label}: E starts the event", False, f"attempt {attempt}")
            return False
        snap = br.drive(page, {"FINISHED", "FAILED"}, timeout=DRIVE_TIMEOUT, index=index, laps=laps, log_every=20.0)
        phase = snap and snap["phase"]
        print(f"  {label} attempt {attempt}: phase {phase}, race clock {snap and round(snap.get('raceSeconds', 0), 1)}", flush=True)
        if phase != "FINISHED":
            page.keyboard.press("KeyQ")
            wait_free_roam(page)
            continue
        page.wait_for_selector(".career-outcome", timeout=10000)
        time.sleep(0.5)
        page.locator(".career-outcome").inner_text()
        done = save(page)["career"]["completedEvents"].count(event_id) > 0
        page.keyboard.press("KeyQ")
        wait_free_roam(page)
        if done:
            return True
    return save(page)["career"]["completedEvents"].count(event_id) > 0


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
        page = browser.new_page(viewport={"width": 1280, "height": 760})
        page.on("console", lambda msg: console_issues.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda err: page_errors.append(str(err)))
        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_function("() => window.__STREET_RACER_DEBUG__ && window.__STREET_RACER_DEBUG__.race", timeout=180000)
        page.wait_for_function("() => window.__STREET_RACER_DEBUG__.race.getRace().phase === 'FREE_ROAM'", timeout=90000)
        time.sleep(1.0)
        try:
            # 1. Start the career from the hub (fresh save).
            open_hub(page)
            page.get_by_role("button", name=re.compile("^Start career", re.I)).first.click()
            page.wait_for_function(f"() => JSON.parse(localStorage.getItem('{SAVE_KEY}') || '{{}}').career?.started === true", timeout=20000)
            check("start: Start career saves the career", save(page)["career"]["started"] is True)
            close_hub(page)

            # 2. The first four events, in order. The lead must not show before Division 1 is complete.
            for event_id, race_id, laps, label in SEQUENCE[:4]:
                ok = run_event(page, event_id, race_id, laps, label)
                check(f"{label}: completed", ok)
                if not ok:
                    raise RuntimeError(f"{label} was not completed")
                if event_id == "career-clock-run":
                    open_hub(page)
                    has_lead = page.locator(".career-lead").count() > 0
                    page.screenshot(path=os.path.join(OUT, "hub-before-mara.png"))
                    close_hub(page)
                    check("lead: no Division 2 lead while Division 1 is unfinished", not has_lead)

            # 3. Championship (three races) is won once the three cup events are done.
            cup = save(page)["career"]
            check("cup: Street Origins Cup is won after its three races", "championship:street-origins-cup:complete" in cup["grantedRewards"], json.dumps(cup["grantedRewards"])[:200])

            # 4. Mara Quill: the champion rival. Division 1 needs her defeated.
            ok = run_event(page, "rival-mara-challenge", "rival-mara-race", 1, "Mara Quill: Dock Run")
            career = save(page)["career"]
            check("mara: the challenge is completed", ok)
            check("mara: Mara Quill is defeated", "mara-quill" in career["defeatedRivals"], json.dumps(career["defeatedRivals"]))

            # 5. Division 1 is complete, its reward is paid once, and the hub shows the lead.
            career = save(page)["career"]
            check("division: Division 1 is complete and its reward is recorded", "division:division-1-street-origins:complete" in career["grantedRewards"], json.dumps(career["grantedRewards"])[:300])
            check("division: Division 2 has no events or progress", not any(e.startswith("division-2") or e.startswith("career-urban") for e in career["completedEvents"]), json.dumps(career["completedEvents"]))
            open_hub(page)
            lead = page.locator(".career-lead").inner_text() if page.locator(".career-lead").count() > 0 else ""
            division_text = page.locator('[aria-label="Division list"]').inner_text()
            page.screenshot(path=os.path.join(OUT, "hub-after-division1.png"))
            check("lead: the Division 2 lead is shown after Division 1", "Division 2: Urban Syndicate is next." in lead, lead[:200])
            check("lead: Division 2 is still listed as not in this build", "Urban Syndicate" in division_text and "Not in this build" in division_text, division_text.replace("\n", " | ")[:200])
            close_hub(page)
            final = save(page)["career"]
            print(json.dumps({"reputation": final["reputation"], "completedEvents": final["completedEvents"], "defeatedRivals": final["defeatedRivals"], "grantedRewards": final["grantedRewards"]}, indent=1), flush=True)
            with open(os.path.join(OUT, "division1_save.json"), "w") as handle:
                json.dump(save(page), handle, indent=1)
        except Exception as error:  # Keep the report; a failed step is a failed check, not a silent pass.
            check("run: no exception during the playthrough", False, repr(error)[:300])
        browser.close()

    real = [text for text in console_issues if not any(known in text for known in KNOWN_WARNINGS)]
    check("errors: no page errors", not page_errors, "; ".join(page_errors)[:200])
    check("errors: no console errors other than the known warnings", not real, "; ".join(real)[:200])

    failed = [name for name, passed, _ in results if not passed]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed", flush=True)
    if failed:
        print("Failed: " + "; ".join(failed), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
