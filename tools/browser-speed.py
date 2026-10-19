"""
Top-speed check for the 2.5x AI speed rules (DEV app, real keyboard input for the car).

  race     one Sprint, the player only drives it to the finish with the race script's pure-pursuit driver. The race
           rivals' speeds are sampled in the page all the way through. Expect the peak to reach the 2.5x pace caps.
  pursuit  a real witnessed offence: the player is placed in view of a patrol, the offence is reported, and the player
           holds W to drive away. The pursuing units' speeds are sampled in the page. Expect the peak to rise above the
           pre-change caps, toward the 2.5x cap.

Usage:
  python3 tools/browser-speed.py [url] [outdir] [race pursuit]
Defaults: url=http://localhost:5173/play.html  outdir=browser-output/speed-check  steps=race pursuit
Writes outdir/speed_report.json. Exit code 0 when every step ran and reported a speed.
"""

import importlib.util
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


HERE = os.path.dirname(os.path.abspath(__file__))
R = load("browser_race", os.path.join(HERE, "browser-race.py"))

ARGS = sys.argv[1:]
URL = ARGS[0] if ARGS and ARGS[0].startswith("http") else "http://localhost:5173/play.html"
OUT = next((a for a in ARGS if a.startswith("browser-output") or a.startswith("/")), "browser-output/speed-check")
STEPS = [a for a in ARGS if a in ("race", "pursuit")] or ["race", "pursuit"]
os.makedirs(OUT, exist_ok=True)

report = {"url": URL, "steps": {}}
page_errors = []
console_errors = []
KNOWN = ("GL Driver Message", "GPU stall", "WebGL", "THREE.WebGLRenderer", "THREE.Clock")


def check(name, passed, detail=""):
    print(("PASS " if passed else "FAIL ") + name + (" -- " + detail if detail else ""), flush=True)
    return passed


def run_race(page):
    print("== Race: rival top speed ==", flush=True)
    page.evaluate(
        """() => {
          window.__rivalMax = 0; window.__rivalSamples = 0; window.__rivalNonZero = 0;
          window.__rivalTimer = setInterval(() => {
            const d = window.__STREET_RACER_DEBUG__;
            if (!d || !d.race) return;
            for (const r of d.race.rivalSpeeds()) {
              window.__rivalMax = Math.max(window.__rivalMax, r.speedMps);
              if (r.speedMps > 1) window.__rivalNonZero += 1;
            }
            window.__rivalSamples += 1;
          }, 50);
        }"""
    )
    R.stage_at_route_start(page)
    R.drive(page, {"EVENT_APPROACH"}, timeout=90.0)
    page.keyboard.press("KeyE")
    R.wait_phase(page, {"RACING"}, timeout=R.GO_TIMEOUT)
    final = R.drive(page, {"FINISHED", "FAILED"}, timeout=1200.0)
    R.release_all(page)
    peak = page.evaluate("() => window.__rivalMax")
    samples = page.evaluate("() => window.__rivalSamples")
    page.evaluate("() => clearInterval(window.__rivalTimer)")
    result = {
        "phase": final["phase"] if final else None,
        "rivalPeakMps": round(peak, 2),
        "rivalPeakKph": round(peak * 3.6, 1),
        "samples": samples,
    }
    report["steps"]["race"] = result
    print(f"  result: {json.dumps(result)}", flush=True)
    check("race: the sprint ran to an end (finished or failed)", final is not None and final["phase"] in ("FINISHED", "FAILED"), result["phase"] or "")
    return check("race: rivals were sampled and reached a speed", samples > 20 and peak > 5.0, f"peak {peak:.1f} m/s over {samples} samples")


def run_pursuit(page):
    print("== Pursuit: police top speed ==", flush=True)
    diag = page.evaluate("() => window.__STREET_RACER_DEBUG__.pursuit.getDiagnostics().units")
    patrol = next((u for u in diag if u.get("role") == "patrol" and u.get("active")), None)
    if patrol is None:
        return check("pursuit: a patrol is on the road", False, "no active patrol")
    placed = page.evaluate(f"() => window.__STREET_RACER_DEBUG__.pursuit.placeAheadOfUnit({patrol['id']}, 12)")
    check("pursuit: the player is placed in front of a patrol", bool(placed), f"patrol {patrol['id']}")
    page.evaluate(
        """() => {
          window.__policeMax = 0; window.__policeSamples = 0; window.__policeCap = 0;
          window.__policeTimer = setInterval(() => {
            const d = window.__STREET_RACER_DEBUG__;
            if (!d || !d.pursuit) return;
            for (const u of d.pursuit.getDiagnostics().units) {
              if (u.role === 'patrol' || !u.active) continue;
              window.__policeMax = Math.max(window.__policeMax, u.speedMps);
              window.__policeCap = Math.max(window.__policeCap, u.capMps ?? 0);
            }
            window.__policeSamples += 1;
          }, 50);
        }"""
    )
    page.evaluate("() => { window.__offence = window.__STREET_RACER_DEBUG__.pursuit.reportOffence('speeding'); }")
    offence = page.evaluate("() => window.__offence")
    check("pursuit: the witnessed offence starts a pursuit", offence == "started", f"reportOffence -> {offence}")
    # Drive away with W, straight ahead. The chasers come up behind at their caps.
    page.keyboard.down("KeyW")
    start = time.time()
    series = []
    active_seen = False
    while time.time() - start < 120.0:
        time.sleep(1.0)
        pursuit = page.evaluate("() => window.__STREET_RACER_DEBUG__.pursuit.getSnapshot()")
        player = R.pose(page)
        police = page.evaluate("() => window.__policeMax")
        cap = page.evaluate("() => window.__policeCap")
        series.append({"t": round(time.time() - start, 1), "player": round(player["speed"], 1), "policeMax": round(police, 1), "capMps": cap, "state": pursuit.get("state")})
        print(f"  t={series[-1]['t']:>5} player={series[-1]['player']:>5} policeMax={series[-1]['policeMax']:>5} cap={cap} state={series[-1]['state']}", flush=True)
        active_seen = active_seen or (pursuit is not None and pursuit.get("state") not in (None, "INACTIVE"))
        if active_seen and pursuit and pursuit.get("state") == "INACTIVE":
            break
    page.keyboard.up("KeyW")
    peak = page.evaluate("() => window.__policeMax")
    samples = page.evaluate("() => window.__policeSamples")
    page.evaluate("() => clearInterval(window.__policeTimer)")
    final = page.evaluate("() => window.__STREET_RACER_DEBUG__.pursuit.getSnapshot()")
    result = {
        "series": series,
        "policePeakMps": round(peak, 2),
        "appliedCapMaxMps": page.evaluate("() => window.__policeCap"),
        "policePeakKph": round(peak * 3.6, 1),
        "samples": samples,
        "endState": final.get("state") if final else None,
        "pursuingUnitsAtEnd": final.get("pursuingUnits") if final else None,
    }
    report["steps"]["pursuit"] = result
    print(f"  result: {json.dumps(result)}", flush=True)
    return check("pursuit: pursuing police were sampled and reached a speed", samples > 20 and peak > 5.0, f"peak {peak:.1f} m/s over {samples} samples")


with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
    page = browser.new_page(viewport={"width": 1280, "height": 760})
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" and not any(k in msg.text for k in KNOWN) else None)
    page.on("pageerror", lambda err: page_errors.append(str(err)))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_function("() => window.__STREET_RACER_DEBUG__ && window.__STREET_RACER_DEBUG__.race && window.__STREET_RACER_DEBUG__.pursuit", timeout=120000)
    page.wait_for_function("() => window.__STREET_RACER_DEBUG__.race.getRace().phase === 'FREE_ROAM'", timeout=60000)
    time.sleep(1.0)
    page.evaluate("() => document.activeElement && document.activeElement.blur && document.activeElement.blur()")
    ok = True
    try:
        if "race" in STEPS:
            ok = run_race(page) and ok
            page.screenshot(path=os.path.join(OUT, "race-end.png"), timeout=180000)
        if "pursuit" in STEPS:
            ok = run_pursuit(page) and ok
            page.screenshot(path=os.path.join(OUT, "pursuit.png"), timeout=180000)
    finally:
        R.release_all(page)
    ok = check("no page errors", not page_errors, "; ".join(page_errors)[:300]) and ok
    ok = check("no unexpected console errors", not console_errors, "; ".join(console_errors)[:300]) and ok
    browser.close()

with open(os.path.join(OUT, "speed_report.json"), "w") as handle:
    json.dump(report, handle, indent=2)
print(f"report: {os.path.join(OUT, 'speed_report.json')}", flush=True)
sys.exit(0 if ok else 1)
