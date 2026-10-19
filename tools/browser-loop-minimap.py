"""
Browser verification for the minimap on the looping world (wrap Stage D, minimap step). Runs in the running DEV app.
The minimap canvas is read pixel by pixel. "Empty" means the background colour. Each run checks:
  parked       with the car parked at the centre, on each side of the seam, and at the middle of the map, the share of
               empty pixels is the same within a tolerance. A blank strip beyond the static layer would raise it.
  drive        while the car drives across the east seam, the share of empty pixels never rises above the parked level by
               more than the tolerance, and the minimap canvas is never blank beyond the layer edge.
  errors       no page errors or console errors other than the known warnings

Usage:
  python3 tools/browser-loop-minimap.py [base_url] [outdir]
Defaults: base_url=http://localhost:5173/play.html  outdir=browser-output/loop_minimap
"""
import json
import math
import os
import sys
import time

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173/play.html"
OUT = sys.argv[2] if len(sys.argv) > 2 else "browser-output/loop_minimap"
KNOWN_WARNINGS = ("THREE.Clock", "GL Driver Message", "GPU stall")
TOLERANCE = 0.06
Z = -401.8
PARKED = [("centre", 0.0), ("east-of-seam", 1199.0), ("west-of-seam", -1199.0)]

results = []
console_issues = []
page_errors = []

EMPTY_JS = """
() => {
  const canvas = document.querySelector('.minimap canvas');
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let empty = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] === 0x11 && data[i + 1] === 0x15 && data[i + 2] === 0x1b) empty += 1;
  }
  return { share: empty / (width * height), width, height };
}
"""


MINIMAP_PNG_JS = """
() => {
  const canvas = document.querySelector('.minimap canvas');
  return canvas ? canvas.toDataURL('image/png') : null;
}
"""


def save_minimap(page, path):
    """Saves the minimap canvas itself. An element screenshot would include any DEV panel drawn over it."""
    import base64
    url = page.evaluate(MINIMAP_PNG_JS)
    if url:
        with open(path, "wb") as fh:
            fh.write(base64.b64decode(url.split(",", 1)[1]))


def check(name, passed, detail=""):
    results.append({"name": name, "passed": bool(passed), "detail": detail})
    print(("PASS " if passed else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def snap(page):
    return page.evaluate("() => window.__STREET_RACER_DEBUG__ ? window.__STREET_RACER_DEBUG__.getSnapshot() : null")


def open_page(p, x, yaw=math.pi / 2):
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1280, "height": 760})
    page.on("console", lambda m: console_issues.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: page_errors.append(str(e)))
    page.goto(f"{BASE}?world=loop&devStart={x},{Z},{yaw}", wait_until="domcontentloaded")
    page.wait_for_function("() => { const s = window.__STREET_RACER_DEBUG__ && window.__STREET_RACER_DEBUG__.getSnapshot(); return !!s && !!s.vehicle; }", timeout=120000, polling=100)
    page.wait_for_timeout(1500)
    return browser, page


def main():
    os.makedirs(OUT, exist_ok=True)
    shares = {}
    with sync_playwright() as p:
        for name, x in PARKED:
            browser, page = open_page(p, x)
            reading = None
            for _ in range(5):
                reading = page.evaluate(EMPTY_JS)
                page.wait_for_timeout(200)
            save_minimap(page, os.path.join(OUT, f"parked_{name}.png"))
            shares[name] = reading["share"] if reading else None
            browser.close()
        centre = shares["centre"]
        for name in ("east-of-seam", "west-of-seam"):
            s = shares[name]
            check(f"parked: {name} minimap empty share matches the centre",
                  s is not None and centre is not None and abs(s - centre) <= TOLERANCE,
                  f"centre={centre:.3f} {name}={s:.3f}" if s is not None and centre is not None else "no minimap canvas")

        browser, page = open_page(p, 1150.0)
        page.keyboard.down("KeyW")
        t0 = time.time()
        worst_excess = 0.0
        samples = []
        crossed = False
        prev_x = None
        try:
            while time.time() - t0 < 60:
                page.wait_for_timeout(250)
                st = snap(page)
                if not st:
                    continue
                x = st["vehicle"]["positionSim"]["x"]
                # positionSim is logical (unwrapped), so the east seam is passed at x > 1200 (half of the 2400 m period).
                # A wrapped reading would show as a jump of about a period between two samples; a car moves well under
                # 1000 m between samples, so either signal counts as a crossing.
                if x > 1215 or (prev_x is not None and abs(x - prev_x) > 1000):
                    crossed = True
                prev_x = x
                reading = page.evaluate(EMPTY_JS)
                if reading:
                    samples.append({"x": round(x, 1), "share": round(reading["share"], 4)})
                    excess = reading["share"] - (centre or 0.0)
                    worst_excess = max(worst_excess, excess)
                if crossed:
                    break
        finally:
            page.keyboard.up("KeyW")
        page.wait_for_timeout(300)
        save_minimap(page, os.path.join(OUT, "drive_after_seam.png"))
        browser.close()
        with open(os.path.join(OUT, "samples.json"), "w") as fh:
            json.dump(samples, fh, indent=1)
        check("drive: the car crosses the east seam in the minimap run", crossed, f"samples={len(samples)}")
        check("drive: the empty share never exceeds the parked level by more than the tolerance",
              worst_excess <= TOLERANCE, f"worst_excess={worst_excess:.3f} tolerance={TOLERANCE}")

    hard_console = [m for m in console_issues if not any(w in m for w in KNOWN_WARNINGS)]
    check("errors: no page errors", len(page_errors) == 0, "; ".join(page_errors[:3]))
    check("errors: no console errors other than known warnings", len(hard_console) == 0, "; ".join(hard_console[:3]))
    passed = sum(1 for r in results if r["passed"])
    print(f"\n{passed}/{len(results)} checks passed")
    with open(os.path.join(OUT, "report.json"), "w") as fh:
        json.dump({"results": results, "shares": shares, "console_errors": console_issues, "page_errors": page_errors}, fh, indent=2)
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
