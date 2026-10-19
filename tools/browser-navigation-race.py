"""Navigation through a race, in the default loop world.

  career    after starting the career, the route goes to the race marker of the target (not the grid start)
  turn      a car on the forward side still gets a route to the marker on the reverse side (one turn at the start)
  countdown the race start ends the navigation
  racing    the route points to the next checkpoint
  after     after the race ends, the career route returns

Usage: python3 tools/browser-navigation-race.py [base-url] [outdir]
"""
import json
import math
import os
import sys
import time

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173/play.html"
OUT = sys.argv[2] if len(sys.argv) > 2 else "browser-output/navigation_race"
os.makedirs(OUT, exist_ok=True)
results = []


def check(name, ok, detail=""):
    results.append({"name": name, "ok": bool(ok), "detail": str(detail)})
    print(("PASS " if ok else "FAIL ") + name + ("  [" + str(detail) + "]" if detail != "" else ""), flush=True)


def dist(a, b):
    return math.hypot(a["x"] - b["x"], a["z"] - b["z"])


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
    page = browser.new_page(viewport={"width": 1280, "height": 760})
    page_errors = []
    console_errors = []
    page.on("pageerror", lambda e: page_errors.append(str(e)))
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_function("() => window.__STREET_RACER_DEBUG__ && window.__STREET_RACER_DEBUG__.navigation && window.__STREET_RACER_DEBUG__.race", timeout=60000)
    time.sleep(3)

    def D(expr):
        return page.evaluate(f"() => window.__STREET_RACER_DEBUG__.{expr}")

    def route():
        return D("navigation.getRoute()")

    def wait_for(pred, timeout):
        t0 = time.time()
        while time.time() - t0 < timeout:
            if pred():
                return True
            time.sleep(0.5)
        return False

    # Career target: Harbour Warm-Up (the route index 2 is its race).
    page.keyboard.press("KeyC")
    time.sleep(1.5)
    page.get_by_text("Start career", exact=True).click()
    time.sleep(1.0)
    page.keyboard.press("KeyC")
    time.sleep(1.0)
    marker = D("race.getRoute(2)")["marker"]
    grid = D("race.getRoute(2)")["grid"]
    check("career: the route is to Harbour Warm-Up", wait_for(lambda: (route() or {}).get("goalLabel") == "Harbour Warm-Up", 15), (route() or {}).get("goalLabel"))
    r = route() or {}
    end = r.get("end") or {"x": 1e9, "z": 1e9}
    check("career: the route ends at the race marker, not the grid start", dist(end, marker) < 15 and dist(end, grid) > 30,
          f'end ({end["x"]:.0f},{end["z"]:.0f}) marker ({marker["x"]:.0f},{marker["z"]:.0f}) grid ({grid["x"]:.0f},{grid["z"]:.0f})')
    page.screenshot(path=f"{OUT}/career_to_marker.png")

    # Facing the other way: the grid is on the forward lanes and the marker on the reverse side, so the route from the
    # grid needs one turn-around at the start. It must still get a route to the marker.
    D(f"race.placeForTest({grid['x']}, {grid['z']}, {grid['yaw']})")
    check("turn: a route exists from the grid side to the marker", wait_for(lambda: (route() or {}).get("goalLabel") == "Harbour Warm-Up", 10), route())
    rt = route() or {}
    if rt:
        check("turn: the route still ends at the marker", dist(rt["end"], marker) < 15, f'end ({rt["end"]["x"]:.0f},{rt["end"]["z"]:.0f})')

    # Back at the marker to start the race.
    D(f"race.placeForTest({marker['x']}, {marker['z']}, 0)")
    time.sleep(2.5)

    # Race start ends the navigation.
    page.keyboard.press("KeyE")
    check("countdown: the race starts", wait_for(lambda: D("race.getRace()")["phase"] == "COUNTDOWN", 10), D("race.getRace()")["phase"])
    check("countdown: navigation is ended when the race starts", wait_for(lambda: route() is None, 10), route())
    page.screenshot(path=f"{OUT}/countdown_no_route.png")

    # Racing: the route points to the next checkpoint.
    check("racing: GO is reached", wait_for(lambda: D("race.getRace()")["phase"] == "RACING", 150), D("race.getRace()")["phase"])
    check("racing: the route goes to the next checkpoint", wait_for(lambda: (route() or {}).get("goalKind") == "checkpoint", 10), (route() or {}).get("goalKind"))
    gate = D("race.getRoute(2)")["gates"][0]
    rc = route() or {}
    if rc:
        end = rc["end"]
        check("racing: the checkpoint route ends at the first gate", dist(end, gate) < 15, f'end ({end["x"]:.0f},{end["z"]:.0f}) gate ({gate["x"]:.0f},{gate["z"]:.0f})')
    page.screenshot(path=f"{OUT}/racing_checkpoint.png")

    # Abort: the race fails, and the career route returns.
    page.keyboard.press("KeyQ")
    check("after: the race fails on Q", wait_for(lambda: D("race.getRace()")["phase"] == "FAILED", 10), D("race.getRace()")["phase"])
    check("after: the career route returns", wait_for(lambda: (route() or {}).get("goalLabel") == "Harbour Warm-Up", 10), (route() or {}).get("goalLabel"))

    check("no page errors", len(page_errors) == 0, "; ".join(page_errors)[:300])
    unexpected = [m for m in console_errors if "DevTools" not in m]
    check("no unexpected console errors", len(unexpected) == 0, "; ".join(unexpected)[:300])
    browser.close()

passed = sum(1 for r_ in results if r_["ok"])
with open(f"{OUT}/report.json", "w") as handle:
    json.dump({"url": BASE, "passed": passed, "total": len(results), "results": results}, handle, indent=2)
print(f"\n{passed}/{len(results)} checks passed. Report: {OUT}/report.json", flush=True)
sys.exit(0 if passed == len(results) else 1)
