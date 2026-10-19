"""
Car overhaul in-game driving check (DEV app, legacy straight road).

For each car it seeds a save that owns and selects that car, loads the app, and drives it with real keyboard input:
  - W from rest to 100 km/h: the time is read from the simulation clock (physics.stepCount x fixedStepSeconds).
  - The 0-100 time must match the simulation table (src/vehicles/carDriving.test.ts) within 0.5 s. This proves the car
    in the world is the car the garage shows, and that the same stats drive it.
  - S from about 25 m/s to a stop: the stopping distance is measured from the car's position.
  - No page errors or console errors.

Usage:
  python3 tools/browser-cars.py [url] [outdir] [roster numbers...]
Defaults: url=http://localhost:5173/play.html?world=legacy  outdir=browser-output/car-overhaul/driving  roster=1 6 11 16 20
"""

import json
import os
import sys

from playwright.sync_api import sync_playwright

ARGS = sys.argv[1:]
URL = ARGS[0] if len(ARGS) > 0 and ARGS[0].startswith("http") else "http://localhost:5173/play.html?world=legacy"
REST = [a for a in ARGS if not a.startswith("http")]
OUT = REST[0] if REST and REST[0].startswith("/") else "browser-output/car-overhaul/driving"
ROSTER = [int(a) for a in REST if not a.startswith("/")] or [1, 6, 11, 16, 20]
os.makedirs(OUT, exist_ok=True)

# Roster number -> (id, name). Ids are the catalogue ids; names are the roster display names.
CARS = {
    1: ("kestrel-hatch", "Finch S1"), 6: ("vandal-r", "Vandal R"), 11: ("phantom-lx", "Phantom LX"),
    16: ("obsidian-x", "Obsidian X"), 20: ("zenith-one", "Zenith One"),
    2: ("vesper-c2", "Vesper C2"), 3: ("rook-rs", "Rook RS"), 4: ("ember-gt", "Ember GT"), 5: ("strata-s", "Strata S"),
    7: ("halcyon-gt", "Nightfall GT"), 8: ("kestrel-mr", "Kestrel MR"), 9: ("grit-coupe", "Talon V8"), 10: ("meridian-xr", "Meridian XR"),
    12: ("apex-t", "Apex T"), 13: ("volt-e", "Voltaris E"), 14: ("bastion-sedan", "Sovereign S"), 15: ("tarn-roadster", "Zephyr R"),
    17: ("tempest-r", "Tempest R"), 18: ("havoc-awd", "Havoc AWD"), 19: ("solstice-lm", "Solstice LM"),
}
# The simulation table (carDriving.test.ts run, seconds to 100 km/h) for the cross-check.
SIM_0_100 = {
    1: 4.8, 6: 3.6, 11: 3.5, 16: 3.1, 20: 2.9,
}
KPH100 = 100 / 3.6
SAVE_KEY = "street-racer.save"
results = []
page_errors = []
console_errors = []
KNOWN = ("THREE.Clock", "GL Driver Message", "GPU stall", "WebGL")


def check(name, passed, detail=""):
    results.append({"name": name, "passed": bool(passed), "detail": detail})
    print(("PASS " if passed else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def seed(car_id):
    paints = {car_id: {"upgrades": {"engine": 0, "transmission": 0, "tires": 0, "brakes": 0}, "paintId": "cherry"}}
    return json.dumps({"schemaVersion": 2, "garage": {"credits": 99999, "selectedVehicleId": car_id, "vehicles": paints}})


def snap(page):
    return page.evaluate("() => window.__STREET_RACER_DEBUG__ && window.__STREET_RACER_DEBUG__.getSnapshot()")


def sim_time(s):
    return s["physics"]["stepCount"] * s["physics"]["fixedStepSeconds"]


def drive_car(browser, roster):
    car_id, name = CARS[roster]
    context = browser.new_context(viewport={"width": 1280, "height": 720})
    page = context.new_page()
    page.add_init_script(f"localStorage.setItem('{SAVE_KEY}', {json.dumps(seed(car_id))});")
    local_errors = []
    page.on("pageerror", lambda e: local_errors.append(f"[pageerror] {e}"))
    page.on("console", lambda m: local_errors.append(f"[{m.type}] {m.text}") if m.type == "error" and not any(k in m.text for k in KNOWN) else None)
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.__STREET_RACER_DEBUG__ && !!window.__STREET_RACER_DEBUG__.getSnapshot()", timeout=180000)
    page.wait_for_timeout(800)
    s0 = snap(page)
    z0 = s0["vehicle"]["positionSim"]["z"]

    # 0-100 km/h, throttle held, timed on the simulation clock.
    page.keyboard.down("w")
    t100 = None
    deadline = 400
    while deadline > 0:
        page.wait_for_timeout(250)
        s = snap(page)
        if s["vehicle"]["speedMps"] >= KPH100:
            t100 = sim_time(s) - sim_time(s0)
            break
        deadline -= 1
    # Hold to 25 m/s, then release, then brake to a stop.
    while True:
        page.wait_for_timeout(200)
        s = snap(page)
        if s["vehicle"]["speedMps"] >= 25 or deadline <= 0:
            break
        deadline -= 1
    page.keyboard.up("w")
    page.wait_for_timeout(100)
    s_brake0 = snap(page)
    z_brake0 = s_brake0["vehicle"]["positionSim"]["z"]
    v_brake0 = s_brake0["vehicle"]["speedMps"]
    # Brake until the car is nearly stopped, then release S at about 2 m/s so the car cannot reverse past the check.
    # The distance is taken after it coasts to rest with no keys held.
    page.keyboard.down("s")
    stop_dist = None
    for _ in range(600):
        page.wait_for_timeout(100)
        s = snap(page)
        if s["vehicle"]["speedMps"] <= 2.0:
            break
    page.keyboard.up("s")
    for _ in range(100):
        page.wait_for_timeout(200)
        s = snap(page)
        if abs(s["vehicle"]["speedMps"]) < 0.3:
            stop_dist = abs(s["vehicle"]["positionSim"]["z"] - z_brake0)
            break

    check(f"{name}: reaches 100 km/h", t100 is not None, f"0-100 = {t100:.2f} s" if t100 else "not reached")
    if roster in SIM_0_100 and t100 is not None:
        check(f"{name}: in-game 0-100 matches the simulation table within 0.5 s", abs(t100 - SIM_0_100[roster]) <= 0.5,
              f"in-game {t100:.2f} s, simulation {SIM_0_100[roster]:.1f} s")
    check(f"{name}: braked from about 25 m/s to a stop", stop_dist is not None,
          f"from {v_brake0:.1f} m/s, stopping distance {stop_dist:.1f} m" if stop_dist is not None else f"from {v_brake0:.1f} m/s, did not stop")
    check(f"{name}: no page or console errors", not local_errors, "; ".join(local_errors[:2]))
    page_errors.extend(local_errors)
    context.close()
    return {"roster": roster, "name": name, "zeroToHundredS": t100, "brakeFromMps": v_brake0, "stopDistanceM": stop_dist}


def main():
    rows = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
        try:
            for roster in ROSTER:
                rows.append(drive_car(browser, roster))
        finally:
            browser.close()
    passed = sum(1 for r in results if r["passed"])
    summary = {"passed": passed, "total": len(results), "cars": rows, "results": results}
    with open(os.path.join(OUT, "report_cars.json"), "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2)
    print(f"RESULT {passed}/{len(results)} checks passed", flush=True)


if __name__ == "__main__":
    main()
