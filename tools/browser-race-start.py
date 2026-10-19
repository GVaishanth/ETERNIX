"""Race start in the default loop world: the blocked card during a pursuit, and the stale-results release.

A  a witnessed speeding offence starts a pursuit. The approach card shows the block reason and Start is disabled.
   E is refused. Once the pursuit ends (INACTIVE), Start works.
B  a race ends in FAILED without Q. Driving to a different marker opens that marker's card, and E starts that race.

Usage: python3 tools/browser-race-start.py [base-url] [outdir]
"""
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173/play.html"
OUT = sys.argv[2] if len(sys.argv) > 2 else "browser-output/race_start"
os.makedirs(OUT, exist_ok=True)
results = []


def check(name, ok, detail=""):
    results.append({"name": name, "ok": bool(ok), "detail": str(detail)})
    print(("PASS " if ok else "FAIL ") + name + ("  [" + str(detail) + "]" if detail != "" else ""), flush=True)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
    page = browser.new_page(viewport={"width": 1280, "height": 760})
    page_errors = []
    console_errors = []
    page.on("pageerror", lambda e: page_errors.append(str(e)))
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_function("() => window.__STREET_RACER_DEBUG__ && window.__STREET_RACER_DEBUG__.pursuit && window.__STREET_RACER_DEBUG__.race", timeout=60000)
    time.sleep(3)

    def D(expr):
        return page.evaluate(f"() => window.__STREET_RACER_DEBUG__.{expr}")

    def marker(index):
        m = D(f"race.getRoute({index})")["marker"]
        return m["x"], m["z"]

    def place_at(index):
        x, z = marker(index)
        D(f"race.placeForTest({x}, {z}, 0)")
        time.sleep(1.5)

    def card_button_disabled():
        return page.evaluate("() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Start race')); return b ? b.disabled : null; }")

    def wait_for(predicate, timeout):
        t0 = time.time()
        while time.time() - t0 < timeout:
            if predicate():
                return True
            time.sleep(0.5)
        return False

    # ---- A: pursuit blocks the card ----
    D("pursuit.placeAheadOfUnit(0, 20)")
    time.sleep(1.0)
    report = D("pursuit.reportOffence('speeding')")
    check("A: a witnessed speeding offence starts a pursuit", report == "started", report)
    check("A: the pursuit reaches PURSUING", wait_for(lambda: D("pursuit.getSnapshot()")["state"] == "PURSUING", 60))

    place_at(0)
    check("A: the approach card opens at the marker", wait_for(lambda: D("race.getRace()")["phase"] == "EVENT_APPROACH", 10))
    page.evaluate("() => window.__STREET_RACER_DEBUG__.race.placeForTest(window.__STREET_RACER_DEBUG__.race.getRoute(0).marker.x, window.__STREET_RACER_DEBUG__.race.getRoute(0).marker.z, 0)")
    time.sleep(1.5)
    blocked_text = page.evaluate("() => { const el = document.querySelector('.race-blocked'); return el ? el.innerText : null; }")
    check("A: the card shows the block reason", blocked_text == "Lose the police before starting a race.", blocked_text)
    check("A: Start race is disabled while the police are after the player", card_button_disabled() is True, card_button_disabled())
    page.screenshot(path=f"{OUT}/card_blocked.png")
    page.keyboard.press("KeyE")
    time.sleep(1.0)
    check("A: E is refused during the pursuit (still on the approach card)", D("race.getRace()")["phase"] == "EVENT_APPROACH")

    D("pursuit.placeFarAway()")
    check("A: the pursuit ends (INACTIVE) once the player is far and out of sight",
          wait_for(lambda: D("pursuit.getSnapshot()")["state"] == "INACTIVE", 120))
    place_at(0)
    check("A: the card is no longer blocked after the pursuit", wait_for(lambda: card_button_disabled() is False, 10), card_button_disabled())
    page.keyboard.press("KeyE")
    check("A: Start race works after the pursuit", wait_for(lambda: D("race.getRace()")["phase"] == "COUNTDOWN", 10), D("race.getRace()")["phase"])
    page.keyboard.press("KeyQ")
    time.sleep(1.0)
    page.keyboard.press("KeyQ")
    time.sleep(0.5)
    check("A: the race can be cancelled back to free roam", wait_for(lambda: D("race.getRace()")["phase"] == "FREE_ROAM", 10), D("race.getRace()")["phase"])

    # ---- B: a failed race does not hold the next marker ----
    # A cancelled attempt disarms its marker until the car leaves the exit radius, so drive away first.
    D("pursuit.placeFarAway()")
    time.sleep(1.0)
    place_at(0)
    check("B: the card opens at Eastside Sprint", wait_for(lambda: D("race.getRace()")["phase"] == "EVENT_APPROACH", 10))
    page.keyboard.press("KeyE")
    check("B: the race starts", wait_for(lambda: D("race.getRace()")["phase"] == "COUNTDOWN", 10))
    check("B: GO is reached", wait_for(lambda: D("race.getRace()")["phase"] == "RACING", 150))
    page.keyboard.press("KeyQ")
    check("B: Q aborts the race (FAILED)", wait_for(lambda: D("race.getRace()")["phase"] == "FAILED", 10), D("race.getRace()")["phase"])
    page.screenshot(path=f"{OUT}/failed_results.png")

    place_at(1)
    snap = D("race.getRace()")
    check("B: driving to Block Circuit (no Q) opens its card", snap["phase"] == "EVENT_APPROACH" and (snap["approach"] or {}).get("eventId") == "circuit-block", f'{snap["phase"]} {(snap["approach"] or {}).get("eventId")}')
    page.keyboard.press("KeyE")
    check("B: E starts Block Circuit, not the old race", wait_for(lambda: D("race.getRace()")["phase"] == "COUNTDOWN", 10) and (D("race.getRace()")["approach"] or {}).get("eventId") == "circuit-block", str((D("race.getRace()")["approach"] or {}).get("eventId")))
    page.keyboard.press("KeyQ")
    time.sleep(1.0)
    page.keyboard.press("KeyQ")
    time.sleep(0.5)

    check("no page errors", len(page_errors) == 0, "; ".join(page_errors)[:300])
    unexpected = [m for m in console_errors if "DevTools" not in m]
    check("no unexpected console errors", len(unexpected) == 0, "; ".join(unexpected)[:300])
    browser.close()

passed = sum(1 for r in results if r["ok"])
with open(f"{OUT}/report.json", "w") as handle:
    json.dump({"url": BASE, "passed": passed, "total": len(results), "results": results}, handle, indent=2)
print(f"\n{passed}/{len(results)} checks passed. Report: {OUT}/report.json", flush=True)
sys.exit(0 if passed == len(results) else 1)
