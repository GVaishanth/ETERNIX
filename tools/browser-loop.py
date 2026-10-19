"""
Browser verification for the looping world (wrap Stage B). Runs in the running DEV app. The car is started near one of the
four edges with the DEV-only ?devStart=x,z,yaw parameter, then driven straight with a real W key hold until it crosses
the seam. Nothing moves the car during the crossing. Each run checks:
  start      the DEV start pose was applied (the car is where the URL says)
  crossed    the wrapped base position jumps across the edge, and the logical position keeps moving the same way
  no-jump    the logical position never steps further than the speed allows, across the seam or elsewhere
  camera     the chase camera's offset from the car changes smoothly across the seam (no snap in the camera)
  road       the car stays on a road segment after the crossing, and no recovery fired
  errors     no page errors or console errors (known GL and three.js warnings are listed, not counted)

Usage:
  python3 tools/browser-loop.py [base_url] [outdir]
Defaults: base_url=http://localhost:5173/play.html  outdir=browser-output/loop_stageB
"""
import json
import math
import os
import sys
import time

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173/play.html"
OUT = sys.argv[2] if len(sys.argv) > 2 else "browser-output/loop_stageB"
PERIOD = 2400.0
KNOWN_WARNINGS = ("THREE.Clock", "GL Driver Message", "GPU stall")
MAX_RUN_SECONDS = 150.0

RUNS = [
    {"name": "east", "start": (1000.0, -401.8, math.pi / 2), "axis": "x", "dir": +1, "edge": 1200.0},
    {"name": "west", "start": (-1000.0, -398.2, -math.pi / 2), "axis": "x", "dir": -1, "edge": -1200.0},
    {"name": "north", "start": (-398.2, 1000.0, 0.0), "axis": "z", "dir": +1, "edge": 1200.0},
    {"name": "south", "start": (-401.8, -1000.0, math.pi), "axis": "z", "dir": -1, "edge": -1200.0},
]

results = []
console_issues = []
page_errors = []


def check(name, passed, detail=""):
    results.append({"name": name, "passed": bool(passed), "detail": detail})
    print(("PASS " if passed else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def snap(page):
    return page.evaluate("() => window.__STREET_RACER_DEBUG__ ? window.__STREET_RACER_DEBUG__.getSnapshot() : null")


def wrap_base(v):
    """Shortest-path base coordinate in [-period/2, period/2), as the simulation's torus does."""
    return ((v + PERIOD / 2) % PERIOD) - PERIOD / 2


def run_one(p, run):
    name = run["name"]
    sx, sz, syaw = run["start"]
    url = f"{BASE}?world=loop&devStart={sx},{sz},{syaw}"
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1280, "height": 760})
    page.on("console", lambda m: console_issues.append(f"{name}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: page_errors.append(f"{name}: {e}"))
    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_function(
        "() => { const s = window.__STREET_RACER_DEBUG__ && window.__STREET_RACER_DEBUG__.getSnapshot(); return !!s && !!s.vehicle; }",
        timeout=90000,
        polling=100,
    )
    page.wait_for_timeout(800)
    first = snap(page)
    px = first["vehicle"]["positionSim"]["x"]
    pz = first["vehicle"]["positionSim"]["z"]
    check(f"{name}/start: DEV start pose applied", abs(px - sx) < 1.5 and abs(pz - sz) < 1.5, f"pos=({px:.2f}, {pz:.2f}) want=({sx}, {sz})")
    page.screenshot(path=os.path.join(OUT, f"{name}_00_start.png"))

    samples = []
    t0 = time.time()
    page.keyboard.down("KeyW")
    crossed_at = None
    try:
        while time.time() - t0 < MAX_RUN_SECONDS:
            page.wait_for_timeout(80)
            st = snap(page)
            if st is None:
                continue
            v = st["vehicle"]["positionSim"]
            cam = st["camera"]["positionSim"]
            coord = v[run["axis"]]
            samples.append({
                "t": time.time(),
                "x": v["x"],
                "z": v["z"],
                "cx": cam["x"],
                "cz": cam["z"],
                "speed": st["vehicle"]["speedMps"],
                "segment": st["road"]["currentSegmentId"],
                "streaming": st.get("streaming"),
                "t0": t0,
            })
            if crossed_at is None and (coord - run["edge"]) * run["dir"] > 0:
                crossed_at = len(samples) - 1
            if crossed_at is not None and len(samples) - crossed_at > 25:
                break
    finally:
        page.keyboard.up("KeyW")
    page.wait_for_timeout(400)
    final = snap(page)
    page.screenshot(path=os.path.join(OUT, f"{name}_01_after.png"))

    check(f"{name}/crossed: the car reaches the edge in its driving direction", crossed_at is not None,
          f"samples={len(samples)} seconds={time.time() - t0:.1f}")
    if crossed_at is None:
        browser.close()
        return

    # Wrapped base coordinate on the crossing axis: must jump from one side of the base domain to the other.
    before_base = wrap_base(samples[crossed_at - 1][run["axis"]])
    after_base = wrap_base(samples[crossed_at][run["axis"]])
    jumped = abs(after_base - before_base) > PERIOD * 0.9
    check(f"{name}/crossed: the wrapped base position jumps across the seam", jumped, f"base {before_base:.1f} -> {after_base:.1f}")

    # Logical progress keeps the same direction through the seam.
    logical = [s[run["axis"]] for s in samples]
    monotone = all((b - a) * run["dir"] >= -0.05 for a, b in zip(logical, logical[1:]))
    check(f"{name}/crossed: logical progress never reverses", monotone)

    # No teleport: each step is bounded by the speed (plus slack). Checked on the logical position, so a seam is not hidden.
    worst = 0.0
    worst_at = None
    for i, (a, b) in enumerate(zip(samples, samples[1:])):
        dt = max(b["t"] - a["t"], 1e-3)
        step = math.hypot(b["x"] - a["x"], b["z"] - a["z"])
        allowed = (max(b["speed"], 0.0) + 2.0) * dt * 1.5 + 1.0
        if step - allowed > worst:
            worst = step - allowed
            worst_at = i
    check(f"{name}/no-jump: no logical step beyond the speed allows", worst <= 0.0, f"worst excess={worst:.3f} m at sample {worst_at}")

    # Camera continuity: the chase camera's offset from the car, sample by sample. A camera snap would show here.
    offsets = [(s["cx"] - s["x"], s["cz"] - s["z"]) for s in samples]
    jumps = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(offsets, offsets[1:])]
    seam_jump = jumps[crossed_at - 1] if crossed_at - 1 < len(jumps) else 0.0
    typical = sorted(jumps)[len(jumps) // 2] if jumps else 0.0
    max_jump = max(jumps) if jumps else 0.0
    check(f"{name}/camera: offset change across the seam is typical", seam_jump <= max(3.0 * typical, 1.5),
          f"seam={seam_jump:.3f} m median={typical:.3f} m max={max_jump:.3f} m")

    # Road: still on a segment after the crossing, and no recovery.
    after_segments = [s["segment"] for s in samples[crossed_at:] if s["segment"]]
    check(f"{name}/road: the car stays on a road segment after the crossing", len(after_segments) > 0 and after_segments[-1] is not None,
          f"last segment={after_segments[-1] if after_segments else None}")
    road = final["road"] if final else {}
    check(f"{name}/road: no recovery fired", road.get("recoveryCount") == 0,
          f"recoveryCount={road.get('recoveryCount')} lastRecovery={road.get('lastRecovery')}")

    # Streaming (Stage C): the strip ahead is built and the chunk under the car is active, after the first 2 s settle.
    # Measured at the browser's own (slow) drive speed. This is not a high-speed result; see the simulation tests.
    streamed = [s for s in samples if s["streaming"] is not None and s["t"] - s["t0"] > 2.0]
    check(f"{name}/stream: streaming stats are published", len(streamed) > 0, f"samples={len(streamed)}")
    gaps = [s["streaming"]["unloadedAhead"] for s in streamed]
    unseen = [s["streaming"]["underCarActive"] for s in streamed]
    check(f"{name}/stream: no unloaded chunk ahead of the car", len(gaps) > 0 and max(gaps) == 0,
          f"max unloadedAhead={max(gaps) if gaps else None} over {len(gaps)} samples")
    check(f"{name}/stream: the chunk under the car is always active", len(unseen) > 0 and all(v is True for v in unseen),
          f"misses={sum(1 for v in unseen if v is not True)} over {len(unseen)} samples")
    failed = final["streaming"]["failures"] if final and final.get("streaming") else None
    check(f"{name}/stream: no chunk load failed", failed == 0, f"failures={failed}")
    browser.close()


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        for run in RUNS:
            run_one(p, run)

    errors_ok = len(page_errors) == 0
    hard_console = [m for m in console_issues if not any(w in m for w in KNOWN_WARNINGS)]
    check("errors: no page errors", errors_ok, "; ".join(page_errors[:3]))
    check("errors: no console errors other than known warnings", len(hard_console) == 0, "; ".join(hard_console[:3]))
    passed = sum(1 for r in results if r["passed"])
    print(f"\n{passed}/{len(results)} checks passed")
    with open(os.path.join(OUT, "report.json"), "w") as fh:
        json.dump({"results": results, "console_warnings": console_issues, "page_errors": page_errors}, fh, indent=2)
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
