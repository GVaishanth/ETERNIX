"""
Browser verification for Part 1 (first playable driving scene).

Runs against the DEV server (the __STREET_RACER_DEBUG__ hook is DEV-only).
Reads authoritative simulation state through the hook, drives the car with real keyboard events,
and writes screenshots and a JSON report.

Usage:
  python3 tools/browser-smoke.py [url] [outdir]
Defaults: url=http://localhost:5173/  outdir=/home/user/verification/part1
"""

import json
import os
import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173/"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/home/user/verification/part1"
os.makedirs(OUT, exist_ok=True)

# Spawn pose from src/config/simulationConfig.ts: right lane x = laneWidth/2 = 1.8 m, z = 0, yaw = 0.
SPAWN_X = 1.8
TOL = 1e-3

results = []
console_errors = []


def check(name, passed, detail=""):
    results.append({"name": name, "passed": bool(passed), "detail": detail})
    print(("PASS " if passed else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


# Installed before the app loads. Counts live window/document listeners for the input types we own.
LISTENER_TRACKER = """
(() => {
  const sets = {};
  window.__listenerSets = sets;
  const names = new Map([[window, 'window'], [document, 'document']]);
  const origAdd = EventTarget.prototype.addEventListener;
  const origRemove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    const name = names.get(this);
    if (name && listener) {
      const key = name + ':' + type;
      (sets[key] = sets[key] || new Set()).add(listener);
    }
    return origAdd.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    const name = names.get(this);
    if (name && listener && sets[name + ':' + type]) sets[name + ':' + type].delete(listener);
    return origRemove.call(this, type, listener, options);
  };
})();
"""

SNAP = "() => window.__STREET_RACER_DEBUG__ ? window.__STREET_RACER_DEBUG__.getSnapshot() : null"


def snap(page):
    return page.evaluate(SNAP)


def pos(s):
    return s["vehicle"]["positionSim"]


def listener_count(page, key):
    return page.evaluate(f"() => (window.__listenerSets['{key}'] || new Set()).size")


def wait_snap(page, js_predicate, timeout_ms=60000):
    """Waits until a predicate over the snapshot `s` holds. Polls inside the page."""
    page.wait_for_function(
        f"() => {{ const s = window.__STREET_RACER_DEBUG__ && window.__STREET_RACER_DEBUG__.getSnapshot(); return !!s && ({js_predicate}); }}",
        timeout=timeout_ms,
        polling=100,
    )


def settle(page, ms=350):
    # The diagnostics snapshot publishes about every 0.2 s of frame time. Give it a beat.
    page.wait_for_timeout(ms)


def reset_via_key(page):
    page.keyboard.press("KeyR")
    settle(page)


with sync_playwright() as p:
    browser = p.chromium.launch(
        args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
    )
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    page.add_init_script(LISTENER_TRACKER)
    page.on("console", lambda m: console_errors.append(f"[{m.type}] {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: console_errors.append(f"[pageerror] {e}"))

    page.goto(URL, wait_until="networkidle", timeout=180000)
    page.wait_for_function("() => !!window.__STREET_RACER_DEBUG__ && !!window.__STREET_RACER_DEBUG__.getSnapshot()", timeout=180000)
    settle(page, 800)

    # ---------- Launch state ----------
    s0 = snap(page)
    check("canvas renders", page.locator("canvas").count() >= 1)
    check("spawn in right lane at x=+1.8, z=0", abs(pos(s0)["x"] - SPAWN_X) < TOL and abs(pos(s0)["z"]) < TOL,
          f"x={pos(s0)['x']:.3f} z={pos(s0)['z']:.3f}")
    check("spawn yaw 0 and speed 0", abs(s0["vehicle"]["yawDegrees"]) < 0.01 and abs(s0["vehicle"]["speedMps"]) < 1e-9)
    check("camera is chase camera named ChaseCamera", s0["camera"]["name"] == "ChaseCamera")
    check("road segment and vehicle are in view at launch",
          s0["visibility"]["roadInFrustum"] and s0["visibility"]["vehicleInFrustum"],
          f"road={s0['visibility']['roadInFrustum']} vehicle={s0['visibility']['vehicleInFrustum']}")

    hud_text = page.locator(".hud").inner_text()
    check("HUD shows speed, direction, and hints", "km/h" in hud_text and "N" in hud_text.split(),
          hud_text.replace("\n", " | ")[:120])
    check("HUD status shows RUNNING at launch", "RUNNING" in page.locator(".hud-controls").inner_text())
    check("HUD has Pause and Reset controls",
          page.locator(".hud-button", has_text="Pause").count() == 1 and page.locator(".hud-button", has_text="Reset").count() == 1)

    page.screenshot(path=f"{OUT}/01_launch.png")

    # ---------- Single listener per input type ----------
    kd = listener_count(page, "window:keydown")
    ku = listener_count(page, "window:keyup")
    bl = listener_count(page, "window:blur")
    vc = listener_count(page, "document:visibilitychange")
    check("exactly one window keydown listener (no duplicates after StrictMode double-mount)", kd == 1, f"count={kd}")
    check("exactly one window keyup listener", ku == 1, f"count={ku}")
    check("exactly one window blur listener", bl == 1, f"count={bl}")
    check("exactly one visibilitychange listener", vc == 1, f"count={vc}")

    # ---------- Acceleration and speed display ----------
    page.keyboard.down("KeyW")
    wait_snap(page, "s.vehicle.speedMps >= 12")
    s_w = snap(page)
    check("throttle accelerates the car forward (+Z)", s_w["vehicle"]["speedMps"] >= 12 and pos(s_w)["z"] > 1.0,
          f"speed={s_w['vehicle']['speedMps']:.2f} m/s z={pos(s_w)['z']:.2f}")
    check("direction readout is D while driving forward", s_w["control"]["direction"] == "drive")
    page.screenshot(path=f"{OUT}/02_driving_forward.png")

    # ---------- MANDATORY steering-sign test (W held, then A and D) ----------
    x0, yaw0 = pos(s_w)["x"], s_w["vehicle"]["yawDegrees"]
    page.keyboard.down("KeyA")
    wait_snap(page, f"s.vehicle.yawDegrees < {yaw0 - 8:.4f}", timeout_ms=20000)
    page.wait_for_timeout(400)
    page.keyboard.up("KeyA")
    settle(page)
    s_left = snap(page)
    dyaw_left = s_left["vehicle"]["yawDegrees"] - yaw0
    dx_left = pos(s_left)["x"] - x0
    check("STEERING SIGN: A (left) while rolling gives a heading DECREASE", dyaw_left < -8, f"dyaw={dyaw_left:.2f} deg")
    check("STEERING SIGN: A (left) while rolling moves the car toward -X", dx_left < -0.1, f"dx={dx_left:.3f} m")
    page.screenshot(path=f"{OUT}/03_steer_left.png")

    # Reset to a known pose, then D.
    # Reset while W is still physically held: reset must not clear held keys, so the car rolls again.
    reset_via_key(page)
    wait_snap(page, "s.vehicle.speedMps > 0.5", timeout_ms=15000)
    check("reset does not clear held keys (W still drives after reset)", True,
          f"speed after reset={snap(page)['vehicle']['speedMps']:.2f} m/s")
    # Release W, then reset to the exact spawn pose.
    page.keyboard.up("KeyW")
    settle(page, 150)
    reset_via_key(page)
    s_r = snap(page)
    check("reset (R) restores the spawn pose after steering",
          abs(pos(s_r)["x"] - SPAWN_X) < TOL and abs(pos(s_r)["z"]) < TOL and abs(s_r["vehicle"]["yawDegrees"]) < 0.01
          and abs(s_r["vehicle"]["speedMps"]) < 1e-9,
          f"x={pos(s_r)['x']:.3f} z={pos(s_r)['z']:.3f} yaw={s_r['vehicle']['yawDegrees']:.3f}")
    page.keyboard.up("KeyW")
    settle(page)

    page.keyboard.down("KeyW")
    wait_snap(page, "s.vehicle.speedMps >= 12")
    s_w2 = snap(page)
    x1, yaw1 = pos(s_w2)["x"], s_w2["vehicle"]["yawDegrees"]
    page.keyboard.down("KeyD")
    wait_snap(page, f"s.vehicle.yawDegrees > {yaw1 + 8:.4f}", timeout_ms=20000)
    page.wait_for_timeout(400)
    page.keyboard.up("KeyD")
    settle(page)
    s_right = snap(page)
    dyaw_right = s_right["vehicle"]["yawDegrees"] - yaw1
    dx_right = pos(s_right)["x"] - x1
    check("STEERING SIGN: D (right) while rolling gives a heading INCREASE", dyaw_right > 8, f"dyaw={dyaw_right:.2f} deg")
    check("STEERING SIGN: D (right) while rolling moves the car toward +X", dx_right > 0.1, f"dx={dx_right:.3f} m")
    page.screenshot(path=f"{OUT}/04_steer_right.png")

    # Left and right arrow keys map to the same steering.
    page.keyboard.up("KeyW")
    settle(page)

    # ---------- Speed display matches simulation (paused freezes both) ----------
    page.keyboard.down("KeyW")
    wait_snap(page, "s.vehicle.speedMps >= 10")
    page.keyboard.up("KeyW")
    page.keyboard.press("Escape")
    settle(page, 600)
    s_p = snap(page)
    hud_kph = page.evaluate("() => window.__STREET_RACER_DEBUG__.getHud().speedKph")
    sim_kph = abs(s_p["vehicle"]["speedKph"])
    check("speed readout matches simulated speed (paused, within 1 km/h)", abs(hud_kph - sim_kph) <= 1.0,
          f"hud={hud_kph:.2f} sim={sim_kph:.2f} km/h")
    check("pause status reports PAUSED", s_p["control"]["paused"] and "PAUSED" in page.locator(".hud-controls").inner_text())

    # Paused: holding W must not move the car, and the camera must stay put.
    pz_before = pos(s_p)["z"]
    page.keyboard.down("KeyW")
    page.wait_for_timeout(1000)
    page.keyboard.up("KeyW")
    settle(page)
    s_p2 = snap(page)
    check("pause freezes the simulation (holding W does not move the car)", abs(pos(s_p2)["z"] - pz_before) < 1e-6,
          f"dz={pos(s_p2)['z'] - pz_before:.6f}")
    cam_before = s_p["camera"]["positionSim"]
    cam_after = s_p2["camera"]["positionSim"]
    check("pause freezes the camera", all(abs(cam_before[k] - cam_after[k]) < 1e-6 for k in "xyz"))
    page.screenshot(path=f"{OUT}/05_paused.png")
    page.keyboard.press("Escape")
    settle(page)
    check("Escape resumes from pause", not snap(page)["control"]["paused"])

    # ---------- Braking and reverse ----------
    reset_via_key(page)
    page.keyboard.down("KeyW")
    wait_snap(page, "s.vehicle.speedMps >= 15")
    page.keyboard.up("KeyW")
    page.keyboard.down("KeyS")
    min_speed = 1e9
    went_negative_early = False
    for _ in range(400):
        s_b = snap(page)
        if s_b is None:
            page.wait_for_timeout(50)
            continue
        v = s_b["vehicle"]["speedMps"]
        min_speed = min(min_speed, v)
        if v < -1e-6 and s_b["control"]["direction"] != "reverse":
            went_negative_early = True
        if v <= 0 and s_b["control"]["direction"] == "reverse" and v < -0.5:
            break
        page.wait_for_timeout(50)
    page.keyboard.up("KeyS")
    s_rev = snap(page)
    check("brake from speed decelerates to a stop before reversing (no jump into reverse)",
          not went_negative_early, f"min speed observed={min_speed:.3f}")
    check("holding S at standstill reverses the car (R readout)",
          s_rev["vehicle"]["speedMps"] < -0.5 and s_rev["control"]["direction"] == "reverse",
          f"speed={s_rev['vehicle']['speedMps']:.2f} m/s")
    check("reverse speed stays inside the reverse limit", s_rev["vehicle"]["speedMps"] >= -12.0 - 1e-6)
    page.screenshot(path=f"{OUT}/06_reverse.png")

    # Throttle while reversing brakes the car back to a stop.
    page.keyboard.down("KeyW")
    wait_snap(page, "Math.abs(s.vehicle.speedMps) < 0.05 || s.vehicle.speedMps > 0", timeout_ms=30000)
    page.keyboard.up("KeyW")
    settle(page)

    # ---------- Handbrake ----------
    reset_via_key(page)
    page.keyboard.down("KeyW")
    wait_snap(page, "s.vehicle.speedMps >= 15")
    page.keyboard.up("KeyW")
    page.keyboard.down("Space")
    wait_snap(page, "s.vehicle.speedMps === 0", timeout_ms=30000)
    page.keyboard.down("KeyS")
    page.wait_for_timeout(500)
    page.keyboard.up("KeyS")
    page.keyboard.up("Space")
    settle(page)
    s_hb = snap(page)
    check("handbrake stops the car and blocks reverse creep while S is held",
          s_hb["vehicle"]["speedMps"] == 0 and abs(s_hb["vehicle"]["speedMps"]) < 1e-9,
          f"speed={s_hb['vehicle']['speedMps']:.3f}")

    # ---------- Blur and visibility clear held keys ----------
    reset_via_key(page)
    page.keyboard.down("KeyW")
    wait_snap(page, "s.vehicle.speedMps >= 5")
    page.evaluate("() => window.dispatchEvent(new Event('blur'))")
    # Poll for the published snapshot instead of sleeping: the sandbox renders at a few fps.
    wait_snap(page, "s.input.throttle === 0", timeout_ms=10000)
    s_blur = snap(page)
    check("window blur clears held keys (throttle released)", s_blur["input"]["throttle"] == 0 and "KeyW" not in s_blur["input"]["pressedKeys"],
          f"throttle={s_blur['input']['throttle']} keys={s_blur['input']['pressedKeys']}")
    v_after_blur = s_blur["vehicle"]["speedMps"]
    page.wait_for_timeout(500)
    v_later = snap(page)["vehicle"]["speedMps"]
    check("car stops accelerating after blur while W is still physically down", v_later <= v_after_blur + 1e-6,
          f"{v_after_blur:.2f} -> {v_later:.2f}")
    page.keyboard.up("KeyW")

    page.keyboard.down("KeyW")
    settle(page, 200)
    page.evaluate("""() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    }""")
    wait_snap(page, "s.input.throttle === 0", timeout_ms=10000)
    s_hide = snap(page)
    check("hidden tab clears held keys", s_hide["input"]["throttle"] == 0)
    page.evaluate("""() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    }""")
    page.keyboard.up("KeyW")
    settle(page)

    # ---------- Form-control suppression ----------
    reset_via_key(page)
    page.focus(".hud-button >> text=Pause")
    page.keyboard.down("KeyW")
    page.wait_for_timeout(800)
    page.keyboard.up("KeyW")
    settle(page)
    s_focus = snap(page)
    check("driving keys ignored while a menu button has focus", abs(s_focus["vehicle"]["speedMps"]) < 1e-9,
          f"speed={s_focus['vehicle']['speedMps']:.3f}")
    page.keyboard.press("Escape")  # Escape still pauses from a focused control
    settle(page)
    check("Escape still pauses while a control has focus", snap(page)["control"]["paused"])
    page.keyboard.press("Escape")
    settle(page)

    # Clicking Reset must not leave focus on the button, so Space drives the handbrake again.
    page.click(".hud-button >> text=Reset")
    settle(page)
    active_tag = page.evaluate("() => document.activeElement && document.activeElement.tagName")
    check("HUD buttons release focus after click (keys reach the car again)", active_tag in ("BODY", None),
          f"active={active_tag}")

    # ---------- Pause button mouse path ----------
    page.click(".hud-button >> text=Pause")
    settle(page)
    check("Pause button pauses via the shared action path", snap(page)["control"]["paused"])
    page.click(".hud-button >> text=Resume")
    settle(page)
    check("Resume button resumes", not snap(page)["control"]["paused"])

    # ---------- Debug panel toggle (DEV) ----------
    before_panel = page.locator(".debug-panel").count()
    page.keyboard.press("Backquote")
    settle(page, 200)
    after_panel = page.locator(".debug-panel").count()
    check("backtick toggles the debug panel through the input controller", before_panel != after_panel,
          f"before={before_panel} after={after_panel}")
    page.keyboard.press("Backquote")
    settle(page, 200)

    # ---------- Errors ----------
    errs = page.evaluate("() => window.__STREET_RACER_DEBUG__.getErrors()")
    check("no runtime errors captured by the app", len(errs) == 0, f"{len(errs)} captured")
    fatal = [m for m in console_errors if "pageerror" in m or m.startswith("[error]")]
    check("no uncaught page errors or console errors", len(fatal) == 0,
          "; ".join(fatal[:3]) if fatal else "none")

    page.screenshot(path=f"{OUT}/07_final.png")
    browser.close()

passed = sum(1 for r in results if r["passed"])
report = {
    "url": URL,
    "passed": passed,
    "total": len(results),
    "results": results,
    "console_warnings_and_errors": console_errors,
}
with open(os.path.join(OUT, "report.json"), "w") as f:
    json.dump(report, f, indent=2)
print(f"\n{passed}/{len(results)} checks passed. Report: {OUT}/report.json")
sys.exit(0 if passed == len(results) else 1)
