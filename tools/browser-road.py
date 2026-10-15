"""
Browser verification for Part 3 (road network). Runs in the running DEV app and drives the car with real keyboard events.

Checks, in order:
  boot        circuit loads, connection check valid, no page errors
  drive       W accelerates the car forward on S1
  steer       D turns right (+yaw, +X), A turns left (-yaw, -X)
  overlay     G toggles the road debug overlay (screenshot)
  overview    O toggles the overview camera (screenshot)
  boundary    holding W+D into the right shoulder produces boundary contact and keeps the car inside the rail
  reset       R returns to the exact spawn pose
  lap         one full lap of the test circuit, keyboard-style binary steering, pure pursuit on the lane line:
              visits all ten loop segments, no teleporting, no stall, junction control, camera stays behind
  errors      no page errors or console errors (known GL/three.js warnings are listed, not counted)

Usage:
  python3 tools/browser-road.py [url] [outdir]
Defaults: url=http://localhost:5173/  outdir=/home/user/verification/part3
Writes screenshots and report.json to outdir.
"""

import json
import math
import os
import sys
import time

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173/"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/home/user/verification/part3"
os.makedirs(OUT, exist_ok=True)

FIXED_DT = 1.0 / 60.0
WHEELBASE = 2.7            # src/config/vehicleConfig.ts wheelbaseMeters
STEER_LOW = 0.55           # steerAngleLowSpeedRadians
STEER_HIGH = 0.2           # steerAngleHighSpeedRadians
MAX_FWD = 62.0             # maxForwardSpeedMps
LANE_R = 61.8              # corner radius 60 + lane offset 1.8 (lane runs on the outside of the left turns)
SPAWN = (1.8, 0.0, 6.0)
LOOP = ["S1", "T1", "S2a", "J1", "S2b", "T2", "S3", "T3", "S4", "T4"]
KNOWN_WARNINGS = ("THREE.Clock", "GL Driver Message", "GPU stall")

results = []
console_issues = []
page_errors = []


def check(name, passed, detail=""):
    results.append({"name": name, "passed": bool(passed), "detail": detail})
    print(("PASS " if passed else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def snap(page):
    return page.evaluate("() => window.__STREET_RACER_DEBUG__ ? window.__STREET_RACER_DEBUG__.getSnapshot() : null")


def wait_snap(page, predicate_js, timeout_ms=120000):
    page.wait_for_function(
        f"() => {{ const s = window.__STREET_RACER_DEBUG__ && window.__STREET_RACER_DEBUG__.getSnapshot(); return !!s && ({predicate_js}); }}",
        timeout=timeout_ms,
        polling=50,
    )


def hold(page, keys, seconds):
    for k in keys:
        page.keyboard.down(k)
    page.wait_for_timeout(int(seconds * 1000))
    for k in keys:
        page.keyboard.up(k)


def reset(page):
    page.keyboard.press("KeyR")
    page.wait_for_timeout(300)


def lane_polyline():
    """Lane line the car should follow: right lane of every segment, sampled at ~1 m. Built from the circuit geometry."""
    pts = []

    def line(a, b, n):
        for i in range(n):
            t = i / n
            pts.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))

    def arc(cx, cz, a0, a1, n):
        for i in range(n):
            a = a0 + (a1 - a0) * i / n
            pts.append((cx + LANE_R * math.cos(a), cz + LANE_R * math.sin(a)))

    line((1.8, 0.0), (1.8, 200.0), 200)                       # S1 northbound, lane x=+1.8
    arc(-60.0, 200.0, 0.0, math.pi / 2, 100)                   # T1
    line((-60.0, 261.8), (-300.0, 261.8), 240)                 # S2 westbound, lane z=+261.8 (crosses the pad)
    arc(-300.0, 200.0, math.pi / 2, math.pi, 100)              # T2
    line((-361.8, 200.0), (-361.8, 0.0), 200)                  # S3 southbound, lane x=-361.8
    arc(-300.0, 0.0, math.pi, 3 * math.pi / 2, 100)            # T3
    line((-300.0, -61.8), (-60.0, -61.8), 240)                 # S4 eastbound, lane z=-61.8
    arc(-60.0, 0.0, 3 * math.pi / 2, 2 * math.pi, 100)         # T4 back to start
    # Cumulative arc length, for lookahead.
    s = [0.0]
    for i in range(1, len(pts)):
        s.append(s[-1] + math.dist(pts[i - 1], pts[i]))
    closing = math.dist(pts[-1], pts[0])
    return pts, s, s[-1] + closing


def speed_target_for(segment):
    # Keyboard-only throttle is full or off, so the lap sets its own speed envelope: slower on arcs and the pad.
    if segment.startswith("T"):
        return 11.0
    if segment in ("J1", "JN", "JS"):
        return 9.0
    return 16.0


def max_steer(speed):
    ratio = min(max(abs(speed) / MAX_FWD, 0.0), 1.0)
    return STEER_LOW + (STEER_HIGH - STEER_LOW) * ratio


def run_lap(page, shots_dir):
    pts, cum, total = lane_polyline()
    n = len(pts)
    progress = 0
    metrics = {
        "segments": set(),
        "max_lane_error": 0.0,
        "min_speed_after_start": 1e9,
        "junction_min_speed": 1e9,
        "stall_seconds": 0.0,
        "teleport_violations": 0,
        "camera_behind_violations": 0,
        "contact_steps_start": None,
        "contact_steps_end": None,
        "max_poll_displacement_m": 0.0,
        "worst": None,
        "trace": [],
        "polls": 0,
        "elapsed_wall_s": 0.0,
        "lap_sim_seconds": 0.0,
        "junction_shot": False,
    }
    held = {"KeyW": False, "KeyS": False, "KeyA": False, "KeyD": False}

    def s_at(k):
        return cum[k % n] + (k // n) * total

    def s_at_k(k):
        return s_at(k)

    def seg_now(st):
        return st["road"]["currentSegmentId"]

    def set_key(code, on):
        if held[code] != on:
            (page.keyboard.down if on else page.keyboard.up)(code)
            held[code] = on

    start = snap(page)
    metrics["contact_steps_start"] = start["road"]["contactSteps"]
    prev = start
    t0 = time.time()
    deadline = t0 + 900
    finished = False
    while time.time() < deadline:
        s = snap(page)
        if not s:
            page.wait_for_timeout(50)
            continue
        metrics["polls"] += 1
        x = s["vehicle"]["positionSim"]["x"]
        z = s["vehicle"]["positionSim"]["z"]
        yaw = math.radians(s["vehicle"]["yawDegrees"])
        speed = s["vehicle"]["speedMps"]
        steps = s["physics"]["stepCount"]
        prev_steps = prev["physics"]["stepCount"]

        # Teleport and step-size check: displacement may not exceed top speed times the simulated time elapsed.
        d_steps = steps - prev_steps
        if d_steps > 0:
            moved = math.hypot(s["vehicle"]["positionSim"]["x"] - prev["vehicle"]["positionSim"]["x"], s["vehicle"]["positionSim"]["z"] - prev["vehicle"]["positionSim"]["z"])
            bound = 22.0 * d_steps * FIXED_DT * 1.1 + 0.5
            metrics["max_poll_displacement_m"] = max(metrics["max_poll_displacement_m"], moved)
            if moved > bound:
                metrics["teleport_violations"] += 1
            metrics["lap_sim_seconds"] += d_steps * FIXED_DT

        # Progress: nearest lane point in a forward window.
        best_k, best_d = progress, 1e18
        for k in range(progress - 20, progress + 300):
            p = pts[k % n]
            d = math.hypot(p[0] - x, p[1] - z)
            if d < best_d:
                best_d, best_k = d, k
        progress = max(progress, best_k)
        if best_d > metrics["max_lane_error"]:
            metrics["max_lane_error"] = best_d
            metrics["worst"] = {"sim_s": round(metrics["lap_sim_seconds"], 2), "segment": seg_now(s), "speed": round(speed, 2), "x": round(x, 2), "z": round(z, 2), "yaw_deg": round(math.degrees(yaw), 2), "lane_s": round(s_at_k(best_k), 1)}
        metrics["trace"].append([round(metrics["lap_sim_seconds"], 2), seg_now(s), round(best_d, 3), round(speed, 2), round(x, 2), round(z, 2), round(math.degrees(yaw), 2)])

        seg = s["road"]["currentSegmentId"]
        if seg:
            metrics["segments"].add(seg)
        if seg == "J1":
            metrics["junction_min_speed"] = min(metrics["junction_min_speed"], speed)
            if not metrics["junction_shot"]:
                page.screenshot(path=os.path.join(shots_dir, "lap_junction.png"))
                metrics["junction_shot"] = True
        if metrics["lap_sim_seconds"] > 3:
            metrics["min_speed_after_start"] = min(metrics["min_speed_after_start"], speed)

        # Stall: throttle requested but the car has barely moved for a few simulated seconds.
        if held["KeyW"] and speed < 1.0:
            metrics["stall_seconds"] += d_steps * FIXED_DT

        # Camera stays behind the car: the car lies ahead of the camera along the car heading.
        cam = s["camera"]["positionSim"]
        ahead = (x - cam["x"]) * math.sin(yaw) + (z - cam["z"]) * math.cos(yaw)
        if metrics["lap_sim_seconds"] > 1 and ahead < 2.0:
            metrics["camera_behind_violations"] += 1

        # Controller: pure pursuit on the lane line, lookahead grows with speed. Steering is binary, as the keyboard is.
        lookahead = 8.0 + 0.45 * max(speed, 0.0)  # longer than the node driver: binary full-lock steering needs a gentler gain
        target_k = progress
        while s_at(target_k) - s_at(progress) < lookahead and target_k - progress < 600:
            target_k += 1
        tx, tz = pts[target_k % n]
        right_x, right_z = math.cos(yaw), -math.sin(yaw)
        dx, dz = tx - x, tz - z
        lateral = dx * right_x + dz * right_z
        dist = math.hypot(dx, dz)
        curvature = 2.0 * lateral / (dist * dist) if dist > 0.01 else 0.0
        analog = max(-1.0, min(1.0, math.atan(WHEELBASE * curvature) / max_steer(speed)))
        # Keyboard steering is on/off: the key is held while the analog command is beyond a small deadband.
        steer = 0.0 if abs(analog) < 0.15 else math.copysign(1.0, analog)
        set_key("KeyD", steer > 0)
        set_key("KeyA", steer < 0)

        tgt = speed_target_for(seg or "S1")
        if speed < tgt - 0.5:
            set_key("KeyS", False)
            set_key("KeyW", True)
        elif speed > tgt + 2.0:
            set_key("KeyW", False)
            set_key("KeyS", True)
        else:
            set_key("KeyW", False)
            set_key("KeyS", False)

        if progress >= total - 3 and s_at(progress) >= total - 3:
            finished = True
            break
        prev = s
        # Wait for the next rendered frame so the next decision uses fresh state.
        page.evaluate("() => new Promise(r => requestAnimationFrame(() => r(null)))")

    for code in held:
        set_key(code, False)
    metrics["elapsed_wall_s"] = round(time.time() - t0, 1)
    metrics["finished"] = finished
    metrics["lane_distance_m"] = round(s_at(progress), 1)
    end = snap(page)
    metrics["contact_steps_end"] = end["road"]["contactSteps"]
    metrics["segments"] = sorted(metrics["segments"])
    with open(os.path.join(shots_dir, "lap_trace.json"), "w") as f:
        json.dump({"worst": metrics["worst"], "columns": ["sim_s", "segment", "lane_err_m", "speed", "x", "z", "yaw_deg"], "trace": metrics["trace"]}, f)
    metrics.pop("trace")
    return metrics


def main():
    global lap
    lap = None
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"])
        page = browser.new_page(viewport={"width": 1280, "height": 760})
        page.on("console", lambda m: console_issues.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        page.goto(URL, wait_until="networkidle")
        wait_snap(page, "s.physics.stepCount > 0")

        # boot
        s = snap(page)
        road = s["road"]
        check("boot: circuit world loaded", road["worldId"] == "circuit", road["worldLabel"])
        check("boot: 12 segments and 12 connections", road["segmentCount"] == 12 and road["connectionCount"] == 12, f"{road['segmentCount']}/{road['connectionCount']}")
        check("boot: connection validation valid", road["validationValid"] and road["validationIssueCount"] == 0)
        check("boot: spawn on S1 in right lane", abs(s["vehicle"]["positionSim"]["x"] - SPAWN[0]) < 1e-3 and abs(s["vehicle"]["positionSim"]["z"] - SPAWN[2]) < 1e-3 and road["currentSegmentId"] == "S1", f"{s['vehicle']['positionSim']}")
        page.screenshot(path=os.path.join(OUT, "01_boot.png"))

        # drive
        z0 = s["vehicle"]["positionSim"]["z"]
        page.keyboard.down("KeyW")
        wait_snap(page, "s.vehicle.speedMps > 10", timeout_ms=60000)
        page.keyboard.up("KeyW")
        s = snap(page)
        check("drive: W accelerates forward on S1", s["vehicle"]["positionSim"]["z"] - z0 > 5 and s["vehicle"]["speedMps"] > 10, f"dz={s['vehicle']['positionSim']['z'] - z0:.1f} v={s['vehicle']['speedMps']:.1f}")
        wait_snap(page, "Math.abs(s.vehicle.speedMps) < 40", timeout_ms=60000)  # coast down before steering tests

        # steer sign
        reset(page)
        page.keyboard.down("KeyW")
        wait_snap(page, "s.vehicle.speedMps > 10", timeout_ms=60000)
        x_before = snap(page)["vehicle"]["positionSim"]["x"]
        yaw_before = snap(page)["vehicle"]["yawDegrees"]
        page.keyboard.down("KeyD")
        page.wait_for_timeout(900)
        page.keyboard.up("KeyD")
        s_right = snap(page)
        page.keyboard.up("KeyW")
        check("steer: D turns right (yaw increases)", s_right["vehicle"]["yawDegrees"] > yaw_before + 1.0, f"yaw {yaw_before:.1f} -> {s_right['vehicle']['yawDegrees']:.1f}")
        check("steer: D moves toward +X", s_right["vehicle"]["positionSim"]["x"] > x_before + 0.5, f"x {x_before:.2f} -> {s_right['vehicle']['positionSim']['x']:.2f}")
        wait_snap(page, "Math.abs(s.vehicle.speedMps) < 40", timeout_ms=60000)
        reset(page)
        page.keyboard.down("KeyW")
        wait_snap(page, "s.vehicle.speedMps > 10", timeout_ms=60000)
        yaw_before = snap(page)["vehicle"]["yawDegrees"]
        x_before = snap(page)["vehicle"]["positionSim"]["x"]
        page.keyboard.down("KeyA")
        page.wait_for_timeout(900)
        page.keyboard.up("KeyA")
        s_left = snap(page)
        page.keyboard.up("KeyW")
        check("steer: A turns left (yaw decreases)", s_left["vehicle"]["yawDegrees"] < yaw_before - 1.0, f"yaw {yaw_before:.1f} -> {s_left['vehicle']['yawDegrees']:.1f}")
        check("steer: A moves toward -X", s_left["vehicle"]["positionSim"]["x"] < x_before - 0.5, f"x {x_before:.2f} -> {s_left['vehicle']['positionSim']['x']:.2f}")
        wait_snap(page, "Math.abs(s.vehicle.speedMps) < 40", timeout_ms=60000)

        # overlay (G)
        reset(page)
        page.keyboard.press("KeyG")
        wait_snap(page, "s.road.roadDebugVisible === true")
        page.wait_for_timeout(600)
        page.screenshot(path=os.path.join(OUT, "02_road_debug_overlay.png"))
        page.keyboard.press("KeyG")
        wait_snap(page, "s.road.roadDebugVisible === false")
        check("overlay: G toggles the road debug overlay", True)

        # overview (O)
        page.keyboard.press("KeyO")
        wait_snap(page, "s.road.cameraMode === 'overview'")
        page.wait_for_timeout(600)
        page.screenshot(path=os.path.join(OUT, "03_overview.png"))
        page.keyboard.press("KeyO")
        wait_snap(page, "s.road.cameraMode === 'chase'")
        check("overview: O toggles the overview camera and returns to chase", True)

        # boundary: W+D into the right shoulder until contact
        reset(page)
        page.keyboard.down("KeyW")
        page.keyboard.down("KeyD")
        wait_snap(page, "s.road.contact === true", timeout_ms=120000)
        page.keyboard.up("KeyD")
        page.wait_for_timeout(400)
        page.keyboard.up("KeyW")
        s = snap(page)
        x = s["vehicle"]["positionSim"]["x"]
        yaw = math.radians(s["vehicle"]["yawDegrees"])
        front_x = x + math.sin(yaw) * 3.7 + math.cos(yaw) * 0.925
        rear_x = x - math.sin(yaw) * 0.8 + math.cos(yaw) * 0.925
        check("boundary: contact with the right guardrail", s["road"]["contactSteps"] > 0, f"contactSteps={s['road']['contactSteps']}")
        check("boundary: car footprint stays inside the rail (x <= 10.2)", max(front_x, rear_x) <= 10.2 + 0.05, f"front {front_x:.2f}, rear {rear_x:.2f}")
        check("boundary: car stays on a road segment after contact", s["road"]["currentSegmentId"] is not None)
        page.screenshot(path=os.path.join(OUT, "04_boundary_contact.png"))

        # reset
        reset(page)
        s = snap(page)
        ok = (
            abs(s["vehicle"]["positionSim"]["x"] - SPAWN[0]) < 1e-3
            and abs(s["vehicle"]["positionSim"]["z"] - SPAWN[2]) < 1e-3
            and abs(s["vehicle"]["yawDegrees"]) < 1e-3
            and abs(s["vehicle"]["speedMps"]) < 1e-6
        )
        check("reset: R returns to the exact spawn pose and zero speed", ok, f"{s['vehicle']['positionSim']}")

        # lap: the lap runs at a smaller viewport because keyboard steering needs a higher control rate than the
        # headless renderer gives at 1280x760 (about 12 fps). 800x475 gives about 20 fps.
        page.set_viewport_size({"width": 800, "height": 475})
        page.wait_for_timeout(500)
        lap = run_lap(page, OUT)
        page.set_viewport_size({"width": 1280, "height": 760})
        page.wait_for_timeout(300)
        all_loop = all(seg in lap["segments"] for seg in LOOP)
        check("lap: completes one lap", lap["finished"], f"travelled {lap['lane_distance_m']} m in {lap['elapsed_wall_s']} s wall")
        check("lap: visits every loop segment, including the junction", all_loop, ",".join(lap["segments"]))
        check("lap: no teleporting (displacement per poll bounded by top speed x simulated steps)", lap["teleport_violations"] == 0, f"max per poll {lap['max_poll_displacement_m']:.3f} m")
        check("lap: never stalls with throttle held", lap["stall_seconds"] < 3.0, f"stall {lap['stall_seconds']:.2f} s sim")
        check("lap: keeps control through the junction (speed > 5 m/s)", lap["junction_min_speed"] > 5.0, f"min {lap['junction_min_speed']:.1f} m/s")
        # Keyboard-only steering at about 20 fps is a different controller from the node analog/binary drivers.
        # Node holds the road geometry to 1.5 m (analog) and 1.44 m (binary). The browser limit is 3.0 m, stated here.
        check("lap: stays within 3.0 m of the driving lane (keyboard driver; node binary 1.44 m)", lap["max_lane_error"] < 3.0, f"max {lap['max_lane_error']:.2f} m")
        check("lap: camera stays behind the car throughout", lap["camera_behind_violations"] == 0, f"violations {lap['camera_behind_violations']}")
        check("lap: no boundary contact on the lane line (or only minor)", lap["contact_steps_end"] - lap["contact_steps_start"] <= 30, f"contact steps {lap['contact_steps_end'] - lap['contact_steps_start']}")

        page.screenshot(path=os.path.join(OUT, "05_after_lap.png"))
        ignored = [m for m in console_issues if not any(w in m for w in KNOWN_WARNINGS)]
        check("errors: no page errors", len(page_errors) == 0, "; ".join(page_errors)[:300])
        check("errors: no console errors", len(ignored) == 0, "; ".join(ignored)[:300])
        browser.close()

    report = {
        "url": URL,
        "passed": sum(1 for r in results if r["passed"]),
        "total": len(results),
        "results": results,
        "lap": lap,
        "console_errors": console_issues,
        "page_errors": page_errors,
    }
    with open(os.path.join(OUT, "report.json"), "w") as f:
        json.dump(report, f, indent=2, default=list)
    print(f"\n{report['passed']}/{report['total']} checks passed", flush=True)


if __name__ == "__main__":
    main()
