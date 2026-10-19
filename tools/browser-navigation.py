"""Navigation browser check (Stage D close-out follow-up). Run against a bare base URL: the default world is the loop.

Checks, in order:
  boot     the default URL mounts the looping world, and a navigation route exists to the career target
  boot     parked in the garage entrance with a fresh career: no route (arrived); the garage does not refuse
  garage   a car staged east of the seam with no career target: the route goes to the garage, from the car
  career   after starting the career, the route goes to the career target
  errors   no page errors, no unexpected console errors

Usage: python3 tools/browser-navigation.py [base-url] [outdir]
Writes screenshots and report.json to outdir.
"""
import json
import math
import os
import sys
import time

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173/play.html"
OUT = sys.argv[2] if len(sys.argv) > 2 else "browser-output/navigation"
os.makedirs(OUT, exist_ok=True)
results = []


def check(name, ok, detail=""):
    results.append({"name": name, "ok": bool(ok), "detail": str(detail)})
    print(("PASS " if ok else "FAIL ") + name + ("  [" + str(detail) + "]" if detail != "" else ""), flush=True)


def route(page):
    return page.evaluate("() => { const d = window.__STREET_RACER_DEBUG__; return d && d.navigation ? d.navigation.getRoute() : 'no-debug'; }")


def pose(page):
    return page.evaluate("() => { const d = window.__STREET_RACER_DEBUG__; return d && d.race ? d.race.getPose() : null; }")


def wait_route(page, timeout):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        last = route(page)
        if isinstance(last, dict):
            return last
        time.sleep(0.5)
    return last


console_issues = []
page_errors = []
KNOWN = ("Download the React DevTools",)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
    page = browser.new_page(viewport={"width": 1280, "height": 760})
    page.on("console", lambda m: console_issues.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: page_errors.append(str(e)))
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_function("() => window.__STREET_RACER_DEBUG__ && window.__STREET_RACER_DEBUG__.race", timeout=60000)
    page.evaluate("() => document.activeElement && document.activeElement.blur && document.activeElement.blur()")

    time.sleep(3)
    # Parked at the garage entrance with a fresh career: the garage is the goal and the car has arrived, so no route.
    r = route(page)
    check("boot: the default URL mounts the navigation read-out", isinstance(r, dict) or r is None, "no-debug" if r == "no-debug" else "")
    check("boot: parked in the garage entrance with a fresh career, there is no route (arrived)", r is None, f"route {r!r}")
    text = page.inner_text("body")
    check("boot: the garage does not refuse at the spawn (no 'Drive to the garage entrance')",
          "Drive to the garage entrance" not in text, "")
    page.screenshot(path=f"{OUT}/spawn_no_route.png")

    # Stage the car far east (logical x 1150, heading east). With no career target the route goes to the garage, through the seam.
    page.evaluate("() => window.__STREET_RACER_DEBUG__.race.placeForTest(1150, -201.8, Math.PI / 2)")
    time.sleep(4)
    rs = wait_route(page, 20)
    pz = pose(page)
    if isinstance(rs, dict) and pz is not None:
        check("garage route: the route starts at the car just east of the seam", math.hypot(rs["start"]["x"] - pz["x"], rs["start"]["z"] - pz["z"]) < 1.0,
              f'car ({pz["x"]:.1f}, {pz["z"]:.1f}), route start ({rs["start"]["x"]:.1f}, {rs["start"]["z"]:.1f})')
        check("garage route: the goal is the garage", rs["goalKind"] == "garage", f'{rs["goalKind"]}: {rs["goalLabel"]}, lanes {rs["laneCount"]}, length {rs["lengthMeters"]:.0f} m')
    else:
        check("garage route: a route exists from the seam", False, f"route {rs!r} pose {pz!r}")
    page.screenshot(path=f"{OUT}/garage_route.png")

    # Start the career and track the first event: the route now goes to the career target.
    page.keyboard.press("KeyC")
    time.sleep(1.5)
    page.get_by_text("Start career", exact=True).click()
    time.sleep(1.0)
    page.keyboard.press("KeyC")
    time.sleep(2.5)
    rc = wait_route(page, 20)
    if isinstance(rc, dict):
        check("career route: the goal is the career target", rc["goalKind"] == "career" and rc["goalLabel"] != "",
              f'{rc["goalKind"]}: {rc["goalLabel"]}, lanes {rc["laneCount"]}, length {rc["lengthMeters"]:.0f} m')
    else:
        check("career route: the goal is the career target", False, f"route {rc!r}")
    page.screenshot(path=f"{OUT}/career_route.png")

    check("errors: no page errors", len(page_errors) == 0, "; ".join(page_errors)[:300])
    unexpected = [m for m in console_issues if not any(k in m for k in KNOWN)]
    check("errors: no unexpected console errors", len(unexpected) == 0, "; ".join(unexpected)[:300])
    browser.close()

passed = sum(1 for item in results if item["ok"])
report = {"url": BASE, "passed": passed, "total": len(results), "results": results}
with open(f"{OUT}/report.json", "w") as handle:
    json.dump(report, handle, indent=2)
print(f"\n{passed}/{len(results)} checks passed. Report: {OUT}/report.json", flush=True)
sys.exit(0 if passed == len(results) else 1)
