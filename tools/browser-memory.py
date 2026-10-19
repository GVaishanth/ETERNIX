"""
Browser measurement for Stage E (memory over repeated loops). Runs in the running DEV app on the looping world.

The car is started at the DEV-only ?devStart pose on the west side and held on W, so it drives straight through the
seam at x = -1200 m, again and again. The script samples, at a fixed wall-clock interval:
  - the logical car position and the number of seam crossings (base position wraps),
  - the streamer counts (mounted, active, started, unloaded, failed, peak mounted, teleports),
  - the renderer counts (draw calls, triangles, GPU geometries, GPU textures),
  - the JavaScript heap, after a forced garbage collection over CDP (Runtime.getHeapUsage).

It writes memory.json with every sample and a per-crossing summary, and prints the summary. It does not judge a pass:
these are measurements. The numbers are compared by reading the output, and the report says so.

Usage:
  python3 tools/browser-memory.py [base_url] [outdir] [crossings]
Defaults: base_url=http://localhost:5173/play.html  outdir=browser-output/stage_e/memory  crossings=3
"""
import json
import math
import os
import sys
import time

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173/play.html"
OUT = sys.argv[2] if len(sys.argv) > 2 else "browser-output/stage_e/memory"
CROSSINGS = int(sys.argv[3]) if len(sys.argv) > 3 else 3
PERIOD = 2400.0
START = (-1000.0, -398.2, -math.pi / 2)
SAMPLE_SECONDS = 4.0
GC_EVERY = 5  # samples
MAX_WALL_SECONDS = 1500.0
KNOWN_WARNINGS = ("THREE.Clock", "GL Driver Message", "GPU stall")

samples = []
page_errors = []
console_errors = []


def wrap_base(v):
    return ((v + PERIOD / 2) % PERIOD) - PERIOD / 2


def snap(page):
    return page.evaluate("() => window.__STREET_RACER_DEBUG__ ? window.__STREET_RACER_DEBUG__.getSnapshot() : null")


def heap_after_gc(cdp):
    cdp.send("HeapProfiler.collectGarbage")
    usage = cdp.send("Runtime.getHeapUsage")
    return {"usedBytes": usage["usedSize"], "totalBytes": usage["totalSize"]}


def main():
    os.makedirs(OUT, exist_ok=True)
    url = f"{BASE}?world=loop&devStart={START[0]},{START[1]},{START[2]}"
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"])
        page = browser.new_page(viewport={"width": 1280, "height": 760})
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" and not any(k in m.text for k in KNOWN_WARNINGS) else None)
        cdp = page.context.new_cdp_session(page)
        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_function(
            "() => { const s = window.__STREET_RACER_DEBUG__ && window.__STREET_RACER_DEBUG__.getSnapshot(); return !!s && !!s.vehicle; }",
            timeout=180000,
            polling=100,
        )
        page.wait_for_timeout(1500)
        first = snap(page)
        start_x = first["vehicle"]["positionSim"]["x"]
        print(f"start logical x={start_x:.2f} z={first['vehicle']['positionSim']['z']:.2f}", flush=True)
        heap0 = heap_after_gc(cdp)

        page.keyboard.down("KeyW")
        t0 = time.time()
        crossings = 0
        last_base = wrap_base(start_x)
        n = 0
        try:
            while time.time() - t0 < MAX_WALL_SECONDS and crossings < CROSSINGS:
                page.wait_for_timeout(int(SAMPLE_SECONDS * 1000))
                s = snap(page)
                if s is None:
                    continue
                pos = s["vehicle"]["positionSim"]
                base = wrap_base(pos["x"])
                if abs(base - last_base) > PERIOD / 4:
                    crossings += 1
                last_base = base
                st = s.get("streaming") or {}
                rd = s.get("renderer") or {}
                entry = {
                    "wall_s": round(time.time() - t0, 1),
                    "crossings": crossings,
                    "logical": {"x": round(pos["x"], 2), "z": round(pos["z"], 2)},
                    "base": {"x": round(base, 2), "z": round(pos["z"], 2)},
                    "speed_mps": round(s["vehicle"]["speedMps"], 2),
                    "streaming": {k: st.get(k) for k in ("mounted", "active", "peakMounted", "started", "unloaded", "failed", "unloadedAhead", "teleports", "queued", "loading", "unloading")},
                    "renderer": {k: rd.get(k) for k in ("drawCallsLastFrame", "triangles", "geometries", "textures")},
                }
                if n % GC_EVERY == 0:
                    entry["heap"] = heap_after_gc(cdp)
                samples.append(entry)
                n += 1
                print(f"t={entry['wall_s']:>7}s x={pos['x']:>9.1f} v={entry['speed_mps']:>5} cross={crossings} mounted={entry['streaming']['mounted']} "
                      f"geo={entry['renderer']['geometries']} tex={entry['renderer']['textures']} calls={entry['renderer']['drawCallsLastFrame']}"
                      + (f" heap={entry['heap']['usedBytes'] / 1e6:.1f}MB" if "heap" in entry else ""), flush=True)
        finally:
            page.keyboard.up("KeyW")
        heap1 = heap_after_gc(cdp)
        browser.close()

    out = {
        "url": url,
        "crossingsTarget": CROSSINGS,
        "crossingsReached": crossings,
        "wallSeconds": round(time.time() - t0, 1),
        "heapStart": heap0,
        "heapEnd": heap1,
        "samples": samples,
        "pageErrors": page_errors,
        "consoleErrors": console_errors,
    }
    with open(os.path.join(OUT, "memory.json"), "w") as f:
        json.dump(out, f, indent=1)
    print("---- summary ----", flush=True)
    print(f"crossings reached {crossings} of {CROSSINGS} in {out['wallSeconds']} s wall; samples {len(samples)}", flush=True)
    print(f"heap start {heap0['usedBytes'] / 1e6:.1f} MB, end {heap1['usedBytes'] / 1e6:.1f} MB (both after GC)", flush=True)
    seen = set()
    for e in samples:
        if e["crossings"] in seen:
            continue
        seen.add(e["crossings"])
        print(f"first sample at crossing {e['crossings']}: mounted={e['streaming']['mounted']} started={e['streaming']['started']} "
              f"unloaded={e['streaming']['unloaded']} geo={e['renderer']['geometries']} tex={e['renderer']['textures']}", flush=True)
    print(f"page errors: {len(page_errors)}; console errors: {len(console_errors)}", flush=True)


if __name__ == "__main__":
    main()
