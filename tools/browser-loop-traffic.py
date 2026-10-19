"""
Browser verification for traffic on the looping world (wrap Stage D, step 2). Runs in the running DEV app. The player
car is parked at a DEV start 50 m before the east seam of the loop with no input, so the ambient traffic within range of the car
is the only thing moving. Each run checks:
  spawned      ambient traffic spawns on the loop (traffic is enabled there)
  continuity   each traffic vehicle moves no further between two samples than its speed allows, in base coordinates,
               and a recycle between samples is excluded (it is counted, not a continuity failure)
  transitions  no lane transition was counted as invalid (a seam mismatch would be counted here)
  crossing     at least one traffic vehicle crosses the seam (base x from > +1000 to < -1000) with the same id and no
               recycle in between. Reported with its count; not assumed.
  errors       no page errors or console errors other than the known warnings

Usage:
  python3 tools/browser-loop-traffic.py [base_url] [outdir]
Defaults: base_url=http://localhost:5173/play.html  outdir=browser-output/loop_stageD2
"""
import json
import math
import os
import sys
import time

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173/play.html"
OUT = sys.argv[2] if len(sys.argv) > 2 else "browser-output/loop_stageD2"
PERIOD = 2400.0
HALF = PERIOD / 2
KNOWN_WARNINGS = ("THREE.Clock", "GL Driver Message", "GPU stall")
START = (1150.0, -401.8, math.pi / 2)
WATCH_SECONDS = 120.0
SPAWN_TIMEOUT = 45.0
SAMPLE_EVERY = 0.1

results = []
console_issues = []
page_errors = []


def check(name, passed, detail=""):
    results.append({"name": name, "passed": bool(passed), "detail": detail})
    print(("PASS " if passed else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def snap(page):
    return page.evaluate("() => window.__STREET_RACER_DEBUG__ ? window.__STREET_RACER_DEBUG__.getSnapshot() : null")


def wrapped(a, b):
    d = (b - a) % PERIOD
    return d - PERIOD if d >= HALF else d


def main():
    os.makedirs(OUT, exist_ok=True)
    sx, sz, syaw = START
    url = f"{BASE}?world=loop&devStart={sx},{sz},{syaw}"
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"])
        page = browser.new_page(viewport={"width": 1280, "height": 760})
        page.on("console", lambda m: console_issues.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_function("() => { const s = window.__STREET_RACER_DEBUG__ && window.__STREET_RACER_DEBUG__.getSnapshot(); return !!s && !!s.vehicle; }", timeout=120000)

        # Wait for ambient spawns. The car does not move, so this is traffic time alone.
        t0 = time.time()
        first = None
        while time.time() - t0 < SPAWN_TIMEOUT:
            st = snap(page)
            traffic = st.get("traffic") if st else None
            if traffic and traffic.get("enabled") and traffic.get("stats") and traffic["stats"]["spawned"] > 0:
                first = traffic
                break
            time.sleep(0.5)
        check("spawned: ambient traffic spawns on the loop", first is not None,
              "" if first is None else f"spawned={first['stats']['spawned']} active={first['activeTraffic']}")

        last = {}
        crossings = []
        max_ratio = 0.0
        worst = None
        samples = 0
        prev_stats = None
        t_start = time.time()
        while time.time() - t_start < WATCH_SECONDS:
            st = snap(page)
            traffic = st.get("traffic") if st else None
            if not traffic:
                time.sleep(SAMPLE_EVERY)
                continue
            now = time.time()
            stats = traffic["stats"] or {"recycled": 0}
            recycled_now = stats["recycled"] != (prev_stats["recycled"] if prev_stats else stats["recycled"])
            prev_stats = stats
            current = {}
            for v in traffic["vehicles"]:
                if v["kind"] != "traffic" or not v.get("position"):
                    continue
                current[v["id"]] = (v["position"]["x"], v["position"]["z"], v["laneId"], v["speedMps"])
            for vid, (x, z, lane, speed) in current.items():
                if vid in last and not recycled_now:
                    px, pz, plane, pspeed = last[vid][:4]
                    dt = last[vid][4]
                    dt_now = now - dt
                    dx = wrapped(px, x)
                    dz = wrapped(pz, z)
                    allowed = max(speed, pspeed) * 1.5 * max(dt_now, 0.0) + 1.0
                    moved = math.hypot(dx, dz)
                    ratio = moved / allowed if allowed > 0 else 0.0
                    if ratio > max_ratio:
                        max_ratio = ratio
                        worst = {"id": vid, "moved": round(moved, 3), "allowed": round(allowed, 3), "lane": lane}
                    # A crossing: the base x changes sign from beyond +-1000 m, and the wrapped step is short.
                    if px * x < 0 and abs(px) > 1000 and abs(x) > 1000 and abs(dx) < 50:
                        crossings.append({"id": vid, "from": px, "to": x, "lane": lane, "laneBefore": plane})
                last[vid] = (x, z, lane, speed, now)
            for vid in list(last):
                if vid not in current:
                    del last[vid]
            samples += 1
            time.sleep(SAMPLE_EVERY)

        final = snap(page)
        ftraffic = final.get("traffic") if final else None
        samples_ok = samples > 50
        check("continuity: traffic moves no further than its speed allows (base frame, seam included)",
              samples_ok and max_ratio <= 1.0,
              f"samples={samples} worst_ratio={max_ratio:.3f} worst={worst}")
        if ftraffic and ftraffic["stats"]:
            check("transitions: no invalid lane transition counted (seam continuity holds)",
                  ftraffic["stats"]["invalidTransitions"] == 0,
                  f"invalidTransitions={ftraffic['stats']['invalidTransitions']} recycled={ftraffic['stats']['recycled']}")
        if ftraffic and ftraffic["stats"]:
            print(f"stats at end: {json.dumps(ftraffic['stats'])}", flush=True)
        check("crossing: a traffic vehicle crosses the seam (same id, no recycle)",
              len(crossings) > 0,
              f"crossings={len(crossings)} first={crossings[:1]} samples={samples}")
        shot = os.path.join(OUT, "traffic_loop.png")
        page.screenshot(path=shot)
        browser.close()

    hard_console = [m for m in console_issues if not any(w in m for w in KNOWN_WARNINGS)]
    check("errors: no page errors", len(page_errors) == 0, "; ".join(page_errors[:3]))
    check("errors: no console errors other than known warnings", len(hard_console) == 0, "; ".join(hard_console[:3]))
    passed = sum(1 for r in results if r["passed"])
    print(f"\n{passed}/{len(results)} checks passed")
    with open(os.path.join(OUT, "report.json"), "w") as fh:
        json.dump({"results": results, "console_errors": console_issues, "page_errors": page_errors, "crossings": crossings[:20]}, fh, indent=2)
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
