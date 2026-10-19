"""
Browser verification for Part 9 (career). Runs in the running DEV app and uses real keyboard and mouse input.

Steps (select with arguments; default runs all steps in order):
  hub     C opens the career hub. A new player sees the intro, the locked events with their reasons, and the locked rival
          with its reason. Start career starts it once. The leaderboard shows the rival order. Close and C shut the hub.
  race    The Harbour Warm-Up (a career race): stage the car at its marker through the DEV API (staging only, not gameplay),
          E starts from the approach card, the car is driven to the finish with the keyboard, and the result is recorded
          once: reputation, credits, and the completed event appear in the save and in the result card.
  retry   Retry after the result (E), then abort (Q) while racing. An abort grants nothing and changes no balance.
  reload  Reload the page. The saved career (reputation, completed event, balance) is the same, and nothing is paid twice.
  errors  No page errors or console errors (the known GL and three.js warnings are listed, not counted).

Staging: the car is placed at the marker of the race (the DEV API placeForTest). Every drive after that is keyboard input
and the pure-pursuit driver from browser-race.py, which reads the race route and the live car pose.

Usage:
  python3 tools/browser-career.py [url] [outdir] [steps...]
Defaults: url=http://localhost:5173/play.html  outdir=browser-output/part9  steps=hub race retry reload errors
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
REST = [a for a in ARGS if not a.startswith("http")]
OUT = REST[0] if len(REST) > 0 and REST[0].startswith("/") else "browser-output/part9"
STEPS = [a for a in REST if not a.startswith("/")] or ["hub", "race", "rival", "retry", "reload", "errors"]
os.makedirs(OUT, exist_ok=True)

# Reuse the Part 6 driver and staging helpers. Loaded by path, because the file name has a dash.
_SPEC = importlib.util.spec_from_file_location("browser_race", os.path.join(os.path.dirname(__file__), "browser-race.py"))
br = importlib.util.module_from_spec(_SPEC)
_SAVED_ARGV = sys.argv
sys.argv = ["browser-race.py", URL, OUT]
_SPEC.loader.exec_module(br)
sys.argv = _SAVED_ARGV

KNOWN_WARNINGS = ("THREE.Clock", "GL Driver Message", "GPU stall")
SAVE_KEY = "street-racer.save"

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


def reputation_text(page):
    return page.locator(".career-stat").first.locator(".career-value").inner_text()


def step_hub(page):
    print("== Step hub: the career hub for a new player ==", flush=True)
    open_hub(page)
    body = page.locator(".career-overlay").inner_text()
    check("hub: opens on C and shows the intro for a new career", "Start career" in body and "Newcomer" in body, body[:120].replace("\n", " | "))
    check("hub: before the career starts, every event is locked with the start reason", "Harbour Warm-Up" in body and "Locked: Start your career in the career hub first." in body)
    check("hub: a locked rival shows the reason it is locked", "Start your career in the career hub first." in body and "Locked" in body)
    page.screenshot(path=os.path.join(OUT, "H01_hub_new_player.png"))

    page.get_by_role("button", name="Start career", exact=True).click()
    page.wait_for_function("() => document.querySelector('.career-summary') && document.querySelector('.career-summary').innerText.includes('Harbour Warm-Up at')", timeout=5000)
    s = save(page)
    check("hub: Start career saves the career as started", s is not None and s.get("career", {}).get("started") is True, json.dumps(s and s.get("career", {}).get("started")))
    check("hub: start sets the target to the first event", "Harbour Warm-Up at Market Row" in page.locator(".career-overlay").inner_text())

    page.get_by_role("button", name="Leaderboard", exact=True).click()
    board = page.locator(".career-board").inner_text()
    # Every rival still stands above you. The rival nearest you on the ladder (Mara, ladder 4) is the next target.
    order = ["Kai Mensah", "Juno Ashdown", "Teo Varga", "Mara Quill", "You"]
    positions = [board.find(name) for name in order]
    check("leaderboard: standing rivals above you, in ladder order, the first target next", all(p >= 0 for p in positions) and positions == sorted(positions) and "next" in board, board.replace("\n", " | ")[:160])
    page.get_by_role("button", name="Mara Quill").click()
    card = page.locator(".career-challenge").inner_text()
    check("challenge: Mara's card shows the locked requirement and a disabled accept", "Needs: Complete Harbour Warm-Up first." in card and page.get_by_role("button", name="Accept challenge").is_disabled())
    page.screenshot(path=os.path.join(OUT, "H02_leaderboard_challenge.png"))
    page.get_by_role("button", name="Cancel", exact=True).click()

    page.get_by_role("button", name="Milestones", exact=True).click()
    check("milestones: the list shows the first-result milestone", "First Result" in page.locator('[aria-label="Milestones"]').inner_text())
    page.get_by_role("button", name="Events", exact=True).click()

    close_hub(page)
    check("hub: Close leaves the hub and the car is free", not hub_open(page))
    open_hub(page)
    page.keyboard.press("KeyC")
    page.wait_for_selector(".career-overlay", state="detached", timeout=20000)
    check("hub: C closes the hub again", not hub_open(page))


def step_race(page):
    print("== Step race: Harbour Warm-Up through the existing race pipeline ==", flush=True)
    warm_index = br.route_index(page, "career-warmup-race")
    route = br.route(page, warm_index) if warm_index is not None else None
    check("race: the warm-up is a valid career route with a marker", route is not None and route.get("eventId") == "career-warmup-race" and route.get("marker") is not None, f"event {route and route.get('eventId')}")
    if route is None:
        return
    page.evaluate(f"() => window.__STREET_RACER_DEBUG__.race.placeForTest({route['marker']['x']}, {route['marker']['z']}, 0)")
    deadline = time.time() + 15
    snap = None
    while time.time() < deadline:
        snap = br.race(page)
        if snap and snap.get("approach"):
            break
        time.sleep(0.1)
    approach = snap and snap.get("approach")
    check("race: the approach card names the warm-up with its reward", approach is not None and approach.get("name") == "Harbour Warm-Up", json.dumps(approach)[:160])
    if approach is None:
        return
    page.screenshot(path=os.path.join(OUT, "R01_approach_card.png"))
    before = save(page)
    credits_before = before["garage"]["credits"]
    page.keyboard.press("KeyE")
    snap = br.wait_phase(page, {"COUNTDOWN", "RACING"}, timeout=8.0)
    check("race: E starts the countdown from the career approach card", snap is not None and snap["phase"] == "COUNTDOWN", f"phase {snap and snap['phase']}")
    snap = br.drive(page, {"FINISHED", "FAILED"}, timeout=900.0, index=warm_index)
    phase = snap and snap["phase"]
    check("race: the car drives the warm-up to a result", phase == "FINISHED", f"phase {phase}")
    page.wait_for_selector(".career-outcome", timeout=8000)
    text = page.locator(".career-outcome").inner_text()
    # Finished under 200 s, so the objective (+5) is met as well as the completion (+10).
    check("result: the career result card reports the completed event, reputation, and the objective", "Harbour Warm-Up complete." in text and "+15 reputation." in text and "Objective met" in text, text.replace("\n", " | ")[:200])
    page.screenshot(path=os.path.join(OUT, "R02_result_card.png"))
    after = save(page)
    career = after["career"]
    check("save: the warm-up is completed once and reputation is recorded", career["completedEvents"].count("career-warmup") == 1 and career["reputation"] >= 10, json.dumps({"events": career["completedEvents"], "rep": career["reputation"]}))
    gained = after["garage"]["credits"] - credits_before
    shown = re.search(r"\+(\d+) credits", text)
    check("economy: the balance rose by exactly the credits the result card shows (race credits plus the first-result milestone)", shown is not None and gained == int(shown.group(1)), f"balance +{gained}, card {shown and shown.group(1)}")


def step_rival(page):
    print("== Step rival: Mara Quill, a win or a loss from the official result ==", flush=True)
    # The warm-up result is still on screen. Leave it with Q (the Part 6 rule), as a player would, before the next race.
    page.keyboard.press("KeyQ")
    left = br.wait_phase(page, {"FREE_ROAM"}, timeout=6.0)
    check("rival: Q leaves the warm-up result", left is not None and left["phase"] == "FREE_ROAM", f"phase {left and left['phase']}")
    # Look the route up by event id: the route list order changes as career races are added.
    mara_index = br.route_index(page, "rival-mara-race")
    route = br.route(page, mara_index) if mara_index is not None else None
    check("rival: Mara's race is a valid career route with a marker", route is not None and route.get("eventId") == "rival-mara-race", f"event {route and route.get('eventId')}")
    if route is None:
        return
    page.evaluate(f"() => window.__STREET_RACER_DEBUG__.race.placeForTest({route['marker']['x']}, {route['marker']['z']}, 0)")
    # Wait for THIS challenge's card. The previous race's card can still be shown for a moment after the car moves.
    deadline = time.time() + 20
    snap = None
    while time.time() < deadline:
        snap = br.race(page)
        if snap and snap.get("approach") and snap["approach"].get("eventId") == "rival-mara-race":
            break
        time.sleep(0.1)
    approach = snap and snap.get("approach")
    check("rival: the approach card names the challenge", approach is not None and approach.get("name") == "Mara Quill: Dock Run", json.dumps(approach)[:160])
    if approach is None:
        return
    before = save(page)
    rep_before = before["career"]["reputation"]
    page.keyboard.press("KeyE")
    snap = br.wait_phase(page, {"COUNTDOWN", "RACING"}, timeout=8.0)
    check("rival: E starts the challenge", snap is not None, f"phase {snap and snap['phase']}")
    snap = br.drive(page, {"FINISHED", "FAILED"}, timeout=900.0, index=mara_index)
    check("rival: the car drives the challenge to a result", snap is not None and snap["phase"] == "FINISHED", f"phase {snap and snap['phase']}")
    page.wait_for_selector(".career-outcome", timeout=8000)
    time.sleep(0.5)
    text = page.locator(".career-outcome").inner_text()
    after = save(page)
    career = after["career"]
    if "Mara Quill beaten." in text:
        check("rival win: Mara is defeated exactly once", career["defeatedRivals"] == ["mara-quill"], json.dumps(career["defeatedRivals"]))
        check("rival win: the defeat reward (40 reputation) is paid with the event's own reputation", career["reputation"] - rep_before == 40, f"rep {rep_before}->{career['reputation']}")
        check("rival win: the result names the next rival", "Next rival: Teo Varga." in text, text.replace("\n", " | ")[:200])
    else:
        check("rival loss: Mara is not defeated and no defeat reward is paid", "mara-quill" not in career["defeatedRivals"] and career["reputation"] == rep_before, f"rep {rep_before}->{career['reputation']}")
        check("rival loss: the result says the rival stands and grants nothing", "beaten" not in text, text.replace("\n", " | ")[:200])
    page.screenshot(path=os.path.join(OUT, "R04_rival_result.png"))


def step_retry(page):
    print("== Step retry: retry and abort grant nothing ==", flush=True)
    before = save(page)
    rep_before = before["career"]["reputation"]
    credits_before = before["garage"]["credits"]
    count_before = len(before["career"]["processedAttempts"])
    page.keyboard.press("KeyE")
    snap = br.wait_phase(page, {"COUNTDOWN", "RACING"}, timeout=8.0)
    check("retry: E on the results starts a new attempt", snap is not None, f"phase {snap and snap['phase']}")
    snap = br.wait_phase(page, {"RACING"}, timeout=10.0)
    if snap is not None and snap["phase"] == "RACING":
        time.sleep(1.0)
        page.keyboard.press("KeyQ")
        snap = br.wait_phase(page, {"FAILED", "FINISHED"}, timeout=8.0)
    check("retry: Q aborts the attempt into a result", snap is not None and snap["phase"] == "FAILED", f"phase {snap and snap['phase']}")
    time.sleep(0.5)
    after = save(page)
    check("retry: an abort changes reputation and balance by nothing", after["career"]["reputation"] == rep_before and after["garage"]["credits"] == credits_before, f"rep {rep_before}->{after['career']['reputation']}, credits {credits_before}->{after['garage']['credits']}")
    check("retry: the aborted attempt is recorded once as processed", len(after["career"]["processedAttempts"]) == count_before + 1, f"{count_before} -> {len(after['career']['processedAttempts'])}")
    page.keyboard.press("KeyQ")
    br.wait_phase(page, {"EVENT_APPROACH", "FREE_ROAM"}, timeout=6.0)


def step_reload(page, url):
    print("== Step reload: the career survives a reload ==", flush=True)
    before = save(page)
    page.reload(wait_until="domcontentloaded")
    page.wait_for_function("() => window.__STREET_RACER_DEBUG__ && window.__STREET_RACER_DEBUG__.race", timeout=120000)
    time.sleep(1.0)
    after = save(page)
    check("reload: the saved career is unchanged by a reload", after["career"] == before["career"], f"rep {after['career']['reputation']}")
    check("reload: the balance is unchanged by a reload", after["garage"]["credits"] == before["garage"]["credits"], f"credits {after['garage']['credits']}")
    open_hub(page)
    body = page.locator(".career-overlay").inner_text()
    check("reload: the hub shows the completed warm-up and the next step", "Completed" in body and "Mara Quill" in body, body[:100].replace("\n", " | "))
    page.screenshot(path=os.path.join(OUT, "R03_hub_after_reload.png"))
    close_hub(page)


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
        try:
            if "hub" in STEPS:
                step_hub(page)
            if "race" in STEPS:
                step_race(page)
            if "rival" in STEPS:
                step_rival(page)
            if "retry" in STEPS:
                step_retry(page)
            if "reload" in STEPS:
                step_reload(page, URL)
        except Exception as error:  # Keep the report; a failed step is a failed check, not a silent pass.
            check("run: no exception during the steps", False, repr(error)[:300])
        browser.close()

    if "errors" in STEPS:
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
