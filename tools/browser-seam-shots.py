"""
Stage E visual check: screenshots while the car crosses the loop seam at x = -1200 m (west edge). Runs in the DEV app.

The car starts at the DEV-only ?devStart pose and is held on W. A frame is saved each time the car's base position has
moved another SHOT_STEP_METERS, from before the seam to after it. The frames are for a human to look at, and the script
writes a manifest with the base x of each frame. It does not judge a pass.

Usage:
  python3 tools/browser-seam-shots.py [base_url] [outdir]
Defaults: base_url=http://localhost:5173/play.html  outdir=browser-output/stage_e/seam_shots
"""
import json
import math
import os
import sys
import time

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173/play.html"
OUT = sys.argv[2] if len(sys.argv) > 2 else "browser-output/stage_e/seam_shots"
PERIOD = 2400.0
START = (-1080.0, -398.2, -math.pi / 2)
SHOT_STEP_METERS = 30.0
FIRST_SHOT_X = -1140.0
LAST_SHOT_X = -1260.0
MAX_WALL_SECONDS = 240.0


def wrap_base(v):
    return ((v + PERIOD / 2) % PERIOD) - PERIOD / 2


def snap(page):
    return page.evaluate("() => window.__STREET_RACER_DEBUG__ ? window.__STREET_RACER_DEBUG__.getSnapshot() : null")


def main():
    os.makedirs(OUT, exist_ok=True)
    url = f"{BASE}?world=loop&devStart={START[0]},{START[1]},{START[2]}"
    manifest = []
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"])
        page = browser.new_page(viewport={"width": 1280, "height": 760})
        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_function(
            "() => { const s = window.__STREET_RACER_DEBUG__ && window.__STREET_RACER_DEBUG__.getSnapshot(); return !!s && !!s.vehicle; }",
            timeout=180000,
            polling=100,
        )
        page.wait_for_timeout(1500)
        page.keyboard.down("KeyW")
        t0 = time.time()
        index = 0
        # Shots are taken at logical x thresholds, which keep counting across the seam (the seam is at base x = -1200).
        targets = [FIRST_SHOT_X - SHOT_STEP_METERS * k for k in range(int((FIRST_SHOT_X - LAST_SHOT_X) / SHOT_STEP_METERS) + 1)]
        try:
            while time.time() - t0 < MAX_WALL_SECONDS and index < len(targets):
                s = snap(page)
                if s is None:
                    page.wait_for_timeout(200)
                    continue
                pos = s["vehicle"]["positionSim"]
                if pos["x"] <= targets[index]:
                    base = wrap_base(pos["x"])
                    path = os.path.join(OUT, f"seam_{index:02d}_logicalX{pos['x']:.0f}.png")
                    page.screenshot(path=path)
                    manifest.append({"file": os.path.basename(path), "logicalX": round(pos["x"], 2), "baseX": round(base, 2), "z": round(pos["z"], 2), "speed": round(s["vehicle"]["speedMps"], 2)})
                    print(f"shot {index} logical x={pos['x']:.1f} base x={base:.1f} z={pos['z']:.1f} speed={s['vehicle']['speedMps']:.1f}", flush=True)
                    index += 1
                page.wait_for_timeout(150)
        finally:
            page.keyboard.up("KeyW")
        browser.close()
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump({"url": url, "frames": manifest}, f, indent=1)
    print(f"saved {len(manifest)} frames to {OUT}", flush=True)


if __name__ == "__main__":
    main()
