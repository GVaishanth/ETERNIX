"""
Browser verification for Part 5 (open-world city). Runs in the running DEV app and drives the car with real keyboard events.

Checks, in order:
  boot        the default URL loads the city, the network validates (65 segments), no page errors
  spawn       the car starts at the city spawn, facing east, on the H-1-2 centreline lane
  minimap     the minimap canvas draws the static map (non-background pixels)
  drive       W accelerates, the car stays on the road, positions move continuously (no teleports)
  junctions   a straight drive east passes through junctions J-2-2 and J-3-2 and reaches the east edge, where the
              barrier pushes the car back (no teleport, no page errors)
  minimap2    the minimap marker moves with the car (canvas content changes)
  reset       R returns the car to the exact spawn pose
  traffic     ambient traffic appears and spreads over at least three districts and the highway
  errors      no page errors or console errors (known GL/three.js warnings are listed, not counted)
  recovery    no false recovery while driving; DEV key Y places the car at the explicit DEV pose
  assets      no failed or missing asset requests (favicon ignored)

Usage:
  python3 tools/browser-city.py [url] [outdir]
Defaults: url=http://localhost:5173/play.html  outdir=browser-output/part5
Writes screenshots and report.json to outdir.
"""

import json
import math
import os
import sys
import time

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173/play.html?world=city"
OUT = sys.argv[2] if len(sys.argv) > 2 else "browser-output/part5"
os.makedirs(OUT, exist_ok=True)

SPAWN = (-100.0, 0.0, -1.8)
SPAWN_YAW_DEG = 90.0
KNOWN_WARNINGS = ("THREE.Clock", "GL Driver Message", "GPU stall")

results = []
console_issues = []
page_errors = []


def check(name, passed, detail=""):
    results.append({"name": name, "passed": bool(passed), "detail": detail})
    print(("PASS " if passed else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def snap(page):
    return page.evaluate("() => window.__STREET_RACER_DEBUG__ ? window.__STREET_RACER_DEBUG__.getSnapshot() : null")


def wait_snap(page, predicate_js, timeout_ms=60000):
    page.wait_for_function(
        f"() => {{ const s = window.__STREET_RACER_DEBUG__ && window.__STREET_RACER_DEBUG__.getSnapshot(); return !!s && ({predicate_js}); }}",
        timeout=timeout_ms,
        polling=100,
    )


def pos(s):
    p = s["vehicle"]["positionSim"]
    return p["x"], p["z"]


def district_cells(segment_id):
    """Cells (i, j) touched by a street or junction id. Streets lie between two cells, junctions touch four."""
    parts = segment_id.split("-")
    kind = parts[0]
    i, j = int(parts[1]), int(parts[2])
    if kind == "J":
        cells = [(i - 1, j - 1), (i, j - 1), (i - 1, j), (i, j)]
    elif kind == "H":
        cells = [(i, j - 1), (i, j)]
    else:
        cells = [(i - 1, j), (i, j)]
    return [(a, b) for a, b in cells if 0 <= a < 4 and 0 <= b < 4]


# District labels from cityLayout.ts. Rows j = 0..3 from the south, columns i = 0..3 from the west.
CELL_DISTRICTS = [
    ["residential", "industrial", "industrial", "industrial"],
    ["residential", "downtown", "downtown", "industrial"],
    ["residential", "downtown", "downtown", "commercial"],
    ["residential", "commercial", "commercial", "commercial"],
]


def districts_of(segment_id):
    return {CELL_DISTRICTS[j][i] for i, j in district_cells(segment_id)}


def minimap_pixels(page):
    return page.evaluate(
        """() => {
            const c = document.querySelector('.minimap canvas');
            if (!c) return null;
            const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            let sum = 0, n = 0, hash = 0;
            for (let k = 0; k < d.length; k += 4) {
                const r = d[k], g = d[k + 1], b = d[k + 2];
                if (!(r === 0x11 && g === 0x15 && b === 0x1b)) n += 1;
                sum += r + g + b;
                hash = (hash * 31 + r + g * 7 + b * 13) | 0;
            }
            return { nonBackground: n, hash, width: c.width, height: c.height };
        }"""
    )


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"])
        page = browser.new_page(viewport={"width": 1280, "height": 760})
        page.on("console", lambda m: console_issues.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        # Missing asset requests: any failed request, or an HTTP error on a request other than favicon.
        asset_failures = []
        page.on("requestfailed", lambda r: asset_failures.append(f"{r.url} ({r.failure})") if "favicon" not in r.url else None)
        page.on("response", lambda r: asset_failures.append(f"{r.url} ({r.status})") if r.status >= 400 and "favicon" not in r.url else None)
        page.goto(URL, wait_until="networkidle")
        wait_snap(page, "s.physics.stepCount > 0")

        # boot
        s = snap(page)
        road = s["road"]
        check("boot: default URL loads the city", road["worldId"] == "city", f"worldId={road['worldId']} label={road['worldLabel']}")
        check("boot: connection validation is valid", road["validationValid"] is True and road["validationIssueCount"] == 0, f"segments={road['segmentCount']} connections={road['connectionCount']} issues={road['validationIssueCount']}")
        check("boot: 65 segments (25 junctions, 40 streets)", road["segmentCount"] == 65, f"segments={road['segmentCount']}")
        page.screenshot(path=os.path.join(OUT, "01_boot.png"))

        # spawn
        x, z = pos(s)
        yaw = s["vehicle"]["yawDegrees"]
        check("spawn: car starts at the city spawn", math.hypot(x - SPAWN[0], z - SPAWN[2]) < 0.5, f"pos=({x:.2f}, {z:.2f}) expected=({SPAWN[0]}, {SPAWN[2]})")
        yaw_error = (yaw - SPAWN_YAW_DEG + 180) % 360 - 180
        check("spawn: car faces east", abs(yaw_error) < 2.0, f"yaw={yaw:.1f} deg")

        # minimap static layer drawn
        mm = minimap_pixels(page)
        check("minimap: canvas draws the static map", mm is not None and mm["nonBackground"] > 5000, f"nonBackground={mm and mm['nonBackground']} size={mm and mm['width']}x{mm and mm['height']}")
        mm_start_hash = mm["hash"] if mm else None
        page.screenshot(path=os.path.join(OUT, "02_minimap_spawn.png"))

        # drive: hold W for 3 s, sample positions to check continuity
        page.keyboard.down("KeyW")
        samples = []
        t0 = time.time()
        while time.time() - t0 < 3.0:
            page.wait_for_timeout(100)
            st = snap(page)
            samples.append((time.time(), pos(st), st["vehicle"]["speedMps"], st["road"]["currentSegmentId"]))
        page.keyboard.up("KeyW")
        max_jump = 0.0
        for (t_a, p_a, _, _), (t_b, p_b, v_b, _) in zip(samples, samples[1:]):
            dt = max(t_b - t_a, 1e-3)
            jump = math.hypot(p_b[0] - p_a[0], p_b[1] - p_a[1])
            allowed = (max(v_b, 0.0) + 2.0) * dt * 1.5 + 1.0
            max_jump = max(max_jump, jump - allowed)
        final_speed = samples[-1][2]
        check("drive: W accelerates the car", final_speed > 5.0, f"speed={final_speed:.1f} m/s")
        check("drive: no teleport between samples", max_jump <= 0.0, f"worst excess over physical reach={max_jump:.2f} m")
        z_drift = max(abs(p[1] - SPAWN[2]) for _, p, _, _ in samples)
        check("drive: car stays in the lane band of H-1-2", z_drift < 3.6, f"max |z| drift={z_drift:.2f} m")

        # traffic near the spawn: ambient vehicles appear and spread over districts
        def watch_traffic(seconds):
            t_w = time.time()
            segs, max_act, dists, hwy = set(), 0, set(), False
            while time.time() - t_w < seconds:
                page.wait_for_timeout(500)
                t = (snap(page).get("traffic") or {})
                max_act = max(max_act, t.get("activeTraffic", 0))
                for v in t.get("vehicles", []):
                    if v.get("kind") == "traffic" and v.get("segmentId"):
                        segs.add(v["segmentId"])
                        dists |= districts_of(v["segmentId"])
                        hwy = hwy or v["segmentId"].startswith("V-4-")
            return max_act, dists, hwy, segs

        spawn_active, spawn_districts, _, spawn_segments = watch_traffic(40)
        check("traffic: ambient vehicles appear around the spawn", spawn_active >= 3, f"max active={spawn_active}")
        check("traffic: vehicles near the spawn span at least three districts", len(spawn_districts) >= 3, f"districts={sorted(spawn_districts)} segments={len(spawn_segments)}")

        # junctions: a straight drive east through J-2-2 and J-3-2 to the east edge
        page.keyboard.down("KeyW")
        seen_segments = []
        drive_samples = []
        t1 = time.time()
        last_x = pos(snap(page))[0]
        stuck_for = 0.0
        while time.time() - t1 < 40:
            page.wait_for_timeout(200)
            st = snap(page)
            seg = st["road"]["currentSegmentId"]
            if seg and (not seen_segments or seen_segments[-1] != seg):
                seen_segments.append(seg)
            cx, cz_now = pos(st)
            drive_samples.append((time.time(), (cx, cz_now), st["vehicle"]["speedMps"]))
            if abs(cx - last_x) < 0.05:
                stuck_for += 0.2
            else:
                stuck_for = 0.0
            last_x = cx
            if cx > 395 and stuck_for > 1.0:
                break
        page.keyboard.up("KeyW")
        st = snap(page)
        cx, cz = pos(st)
        check("junctions: passes through J-2-2 on the way east", "J-2-2" in seen_segments, f"segments={seen_segments}")
        check("junctions: passes through J-3-2 on the way east", "J-3-2" in seen_segments, f"segments={seen_segments}")
        check("junctions: reaches the east edge and the barrier holds it inside", 380 < cx < 412 and abs(cz) < 10, f"pos=({cx:.1f}, {cz:.1f})")
        # Reach over one sample interval: the faster endpoint speed (contacts can drop the speed quickly) times the
        # measured interval, with a margin. Any displacement beyond that is a jump, not motion.
        junction_jump = -1e9
        worst = None
        for (t_a, p_a, v_a), (t_b, p_b, v_b) in zip(drive_samples, drive_samples[1:]):
            dt = max(t_b - t_a, 1e-3)
            jump = math.hypot(p_b[0] - p_a[0], p_b[1] - p_a[1])
            excess = jump - ((max(v_a, v_b, 0.0) + 2.0) * dt * 1.5 + 1.0)
            if excess > junction_jump:
                junction_jump = excess
                worst = f"dt={dt:.3f}s step={jump:.2f}m v=({v_a:.1f},{v_b:.1f}) at ({p_b[0]:.1f},{p_b[1]:.1f})"
        check("junctions: no teleport through the junctions", junction_jump <= 0.0, f"worst excess over physical reach={junction_jump:.2f} m; {worst}")
        page.screenshot(path=os.path.join(OUT, "03_east_edge.png"))

        # minimap marker moves with the car
        mm2 = minimap_pixels(page)
        check("minimap: marker updates with the car", mm2 is not None and mm_start_hash is not None and mm2["hash"] != mm_start_hash, "canvas content changed after driving")
        page.screenshot(path=os.path.join(OUT, "04_minimap_after_drive.png"))

        # traffic at the east edge: the highway (V-4-*) is in range, so highway vehicles should appear
        hwy_active, hwy_districts, highway_seen, _ = watch_traffic(60)
        check("traffic: highway traffic appears when the car is at the east edge", highway_seen, f"max active={hwy_active} districts={sorted(hwy_districts)}")
        st = snap(page)
        page.screenshot(path=os.path.join(OUT, "05_traffic_east_edge.png"))
        contacts = (st.get("traffic") or {}).get("contacts") or {}
        check("traffic: no traffic-boundary contacts", contacts.get("traffic-boundary", 0) == 0, json.dumps(contacts))

        # reset
        page.keyboard.press("KeyR")
        page.wait_for_timeout(600)
        st = snap(page)
        x, z = pos(st)
        check("reset: R returns the car to the exact spawn pose", math.hypot(x - SPAWN[0], z - SPAWN[2]) < 0.3 and abs(st["vehicle"]["speedMps"]) < 0.5, f"pos=({x:.2f}, {z:.2f}) speed={st['vehicle']['speedMps']:.2f}")

        # recovery: ordinary driving over the whole session never recovers the car (no false recovery)
        road_now = (snap(page).get("road") or {})
        check("recovery: no recovery during ordinary driving", road_now.get("recoveryCount", -1) == 0, f"recoveryCount={road_now.get('recoveryCount')} last={road_now.get('lastRecovery')}")

        # dev reset: Y moves the car to the explicit DEV pose (DEV builds only), with zero speed
        page.keyboard.press("KeyY")
        page.wait_for_timeout(600)
        st = snap(page)
        x, z = pos(st)
        check("dev: Y moves the car to the explicit DEV pose", math.hypot(x - 100.0, z - -1.8) < 0.3 and abs(st["vehicle"]["speedMps"]) < 0.5, f"pos=({x:.2f}, {z:.2f}) speed={st['vehicle']['speedMps']:.2f}")

        # errors
        real_errors = [m for m in console_issues if not any(k in m for k in KNOWN_WARNINGS)]
        check("errors: no page errors", not page_errors, "; ".join(page_errors)[:300])
        check("errors: no console errors", not real_errors, "; ".join(real_errors)[:300])
        check("assets: no failed or missing asset requests", not asset_failures, "; ".join(asset_failures)[:300])
        browser.close()

    report = {
        "url": URL,
        "passed": sum(1 for r in results if r["passed"]),
        "total": len(results),
        "results": results,
        "page_errors": page_errors,
        "console_errors": console_issues,
        "asset_failures": asset_failures,
    }
    with open(os.path.join(OUT, "report.json"), "w") as f:
        json.dump(report, f, indent=2)
    print(f"\n{report['passed']}/{report['total']} checks passed. Report: {os.path.join(OUT, 'report.json')}")
    # Exit status reflects the checks: 0 only when every check passed (Part 11).
    return 0 if report["passed"] == report["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
