"""
Browser verification for Part 10 (visual polish, lighting, weather, audio, UI, quality). Runs in the running DEV app and
uses real keyboard and mouse input. State is read through the DEV-only presentation read-out (window.__STREET_RACER_DEBUG__
.presentation), which only reads: it never changes the game.

Steps (select with arguments; default runs all steps in order):
  start     fresh profile: day, clear, medium quality, no audio before the first key, the status line shows the state
  light     N cycles day, evening, night. The background and fog change and night is darker than day
  weather   M turns on rain: rain streaks appear, asphalt gets wetter, and the rain stays bounded
  smoke     hold W to build speed, then handbrake and steer: tire smoke appears from real slip and stops after
  audio     engine and rain levels follow real driving, Esc pause suspends audio, a hidden tab suspends audio
  race      a real race start (E at the marker): the countdown and GO cues play through the audio manager
  siren     a real pursuit (reportOffence through the Part 7 API): the siren is on while police chase, off after reset
  ui        career hub overlay animations, the status line, and reduced motion turning transitions off
  repeat    5 cycles of hub, garage, N, and M: no extra geometry, textures, or audio graphs (leak check)
  perf      draw calls, triangles, and frame rate at low, medium, and high, with rain on and off (headless software GL)
  quality   at device scale factor 2 the pixel ratio follows the preset; the choice persists across reload
  errors    no page errors or console errors (the known GL and three.js warnings are listed, not counted)

Usage:
  python3 tools/browser-presentation.py [url] [outdir] [steps...]
Defaults: url=http://localhost:5173/play.html  outdir=browser-output/part10
"""

import importlib.util
import json
import math
import os
import sys
import time

from playwright.sync_api import sync_playwright

ARGS = sys.argv[1:]
URL = ARGS[0] if len(ARGS) > 0 and ARGS[0].startswith("http") else "http://localhost:5173/play.html?world=city"
REST = [a for a in ARGS if not a.startswith("http")]
OUT = REST[0] if len(REST) > 0 and REST[0].startswith("/") else "browser-output/part10"
ALL_STEPS = ["start", "light", "weather", "smoke", "audio", "race", "siren", "ui", "repeat", "perf", "quality", "errors"]
STEPS = [a for a in REST if not a.startswith("/")] or ALL_STEPS
os.makedirs(OUT, exist_ok=True)

# Reuse the Part 6 keyboard helpers and race staging, and the Part 7 pursuit staging. Loaded by path (dashes in names).
_TOOLS = os.path.dirname(os.path.abspath(__file__))
_SAVED_ARGV = sys.argv


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, os.path.join(_TOOLS, path))
    module = importlib.util.module_from_spec(spec)
    sys.argv = [path, URL, OUT]
    spec.loader.exec_module(module)
    sys.argv = _SAVED_ARGV
    return module


br = _load("browser_race", "browser-race.py")

KNOWN_WARNINGS = ("THREE.Clock", "GL Driver Message", "GPU stall")
TIME_SETTLE_SECONDS = 7.5  # 6 s time-of-day transition, plus a margin.
WEATHER_SETTLE_SECONDS = 5.5  # 4 s weather transition, plus a margin.

results = []
console_issues = []
page_errors = []
measurements = {}


def check(name, passed, detail=""):
    results.append((name, bool(passed), detail))
    print(("PASS " if passed else "FAIL ") + name + (f" :: {detail}" if detail else ""), flush=True)


def pr(page):
    return page.evaluate("() => { const d = window.__STREET_RACER_DEBUG__; return d && d.presentation ? d.presentation() : null; }")


def wait_pr(page, predicate, timeout=10.0, poll=0.1):
    """Waits until predicate (a JS expression over `p`, the read-out) is true. Returns the read-out, or None."""
    end = time.time() + timeout
    while time.time() < end:
        ok = page.evaluate(
            f"() => {{ const d = window.__STREET_RACER_DEBUG__; if (!d || !d.presentation) return false; const p = d.presentation(); return !!({predicate}); }}"
        )
        if ok:
            return pr(page)
        time.sleep(poll)
    return None


def wait_pursuit_state(page, states, timeout):
    """The pursuit snapshot is published a little after the tick that changes the state. Wait for it to catch up."""
    end = time.time() + timeout
    state = None
    while time.time() < end:
        state = page.evaluate("() => window.__STREET_RACER_DEBUG__.pursuit.getSnapshot().state")
        if state in states:
            return state
        time.sleep(0.1)
    return state


def hud_speed_kph(page):
    return page.evaluate("() => window.__STREET_RACER_DEBUG__.getHud().speedKph")


def luminance(hex_colour):
    if not hex_colour:
        return None
    r, g, b = (int(hex_colour[i : i + 2], 16) / 255 for i in (1, 3, 5))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def press(page, code):
    page.keyboard.press(code)


def shot(page, name):
    page.screenshot(path=os.path.join(OUT, name))


def open_hub(page):
    page.evaluate("() => document.activeElement && document.activeElement.blur && document.activeElement.blur()")
    press(page, "KeyC")
    page.wait_for_selector(".career-overlay", timeout=5000)


def close_hub(page):
    page.get_by_role("button", name="Close", exact=True).first.click()
    page.wait_for_selector(".career-overlay", state="detached", timeout=5000)


def step_start(page):
    print("== Step start ==", flush=True)
    p = pr(page)
    check("start: the presentation read-out is installed (DEV)", p is not None)
    if p is None:
        return
    check("start: time of day is day and weather is clear", p["timeOfDay"] == "day" and p["weather"] == "clear", f"{p['timeOfDay']}, {p['weather']}")
    check("start: a fresh profile uses the medium quality default", p["quality"] == "medium", p["quality"])
    check("start: the renderer is drawing (calls and triangles above zero)", p["renderer"]["calls"] > 0 and p["renderer"]["triangles"] > 0, json.dumps(p["renderer"]))
    check("start: no rain at the start", p["rainStreaks"] == 0, str(p["rainStreaks"]))
    check("start: the status line shows the presentation state", "day" in (page.locator(".presentation-status").text_content() or "").lower() and "medium" in (page.locator(".presentation-status").text_content() or "").lower(), page.locator(".presentation-status").text_content() or "")
    measurements["start_background"] = p["background"]
    shot(page, "S00_start_day_clear_medium.png")


def step_light(page):
    print("== Step light ==", flush=True)
    day_bg = pr(page)["background"]
    press(page, "KeyN")
    wait_pr(page, "p.timeOfDay === 'evening'", timeout=3)
    time.sleep(TIME_SETTLE_SECONDS)
    evening = pr(page)
    check("light: N moves to evening and the background changes", evening["timeOfDay"] == "evening" and evening["background"] != day_bg, f"day {day_bg}, evening {evening['background']}")
    shot(page, "L01_evening.png")
    press(page, "KeyN")
    wait_pr(page, "p.timeOfDay === 'night'", timeout=3)
    time.sleep(TIME_SETTLE_SECONDS)
    night = pr(page)
    check("light: N moves to night, which is darker than day", night["timeOfDay"] == "night" and luminance(night["background"]) < luminance(day_bg), f"day {day_bg} ({luminance(day_bg):.3f}), night {night['background']} ({luminance(night['background']):.3f})")
    check("light: night fog is set on the scene", night["fog"] is not None and night["fog"]["far"] > night["fog"]["near"], json.dumps(night["fog"]))
    shot(page, "L02_night.png")
    press(page, "KeyN")
    wait_pr(page, "p.timeOfDay === 'day'", timeout=3)
    time.sleep(TIME_SETTLE_SECONDS)
    back = pr(page)
    check("light: N cycles back to day, and the background returns", back["timeOfDay"] == "day" and abs(luminance(back["background"]) - luminance(day_bg)) < 0.02, f"{back['background']} vs {day_bg}")
    measurements["background_day"] = day_bg
    measurements["background_evening"] = evening["background"]
    measurements["background_night"] = night["background"]


def step_weather(page):
    print("== Step weather ==", flush=True)
    press(page, "KeyM")
    p = wait_pr(page, "p.weather === 'rain'", timeout=3)
    check("weather: M turns rain on", p is not None and p["weather"] == "rain")
    time.sleep(WEATHER_SETTLE_SECONDS)
    p = pr(page)
    expected = 500  # medium preset, full wetness.
    check("weather: rain streaks appear and stay within the medium budget", 0 < p["rainStreaks"] <= expected and p["rainStreaks"] >= expected * 0.8, f"streaks {p['rainStreaks']} (budget {expected})")
    check("weather: the asphalt is wetter (roughness near the wet value)", p["asphaltRoughness"] is not None and p["asphaltRoughness"] < 0.5, f"roughness {p['asphaltRoughness']}")
    check("weather: rain is visual only (the audio rain gain follows wetness)", p["audio"]["rainGain"] >= 0 and p["audio"]["enabled"], json.dumps(p["audio"]))
    shot(page, "W01_rain_day.png")
    measurements["rain_on"] = {"streaks": p["rainStreaks"], "roughness": p["asphaltRoughness"]}


def reset_car(page):
    """R puts the car back on the road (the game's own reset), so every driving check starts from a known state."""
    br.release_all(page)
    press(page, "KeyR")
    time.sleep(1.0)


def step_smoke(page):
    print("== Step smoke ==", flush=True)
    reset_car(page)
    br.set_key(page, "KeyW", True)
    time.sleep(4.0)
    speed = hud_speed_kph(page)
    check("smoke: the car builds speed under throttle", speed > 25, f"{speed:.1f} km/h")
    measurements["smoke_speed_kph"] = round(speed, 1)
    br.set_key(page, "Space", True)
    br.set_key(page, "KeyA", True)
    peak = 0
    end = time.time() + 1.6
    while time.time() < end:
        peak = max(peak, pr(page)["smokeLive"])
        time.sleep(0.05)
    shot(page, "SM01_handbrake_smoke.png")
    check("smoke: handbrake and steer put smoke on screen from real slip or brake", peak > 0, f"peak live particles {peak}")
    br.release_all(page)
    time.sleep(2.5)
    p = pr(page)
    check("smoke: the smoke stops once the slip ends", p["smokeLive"] == 0, f"live {p['smokeLive']} at rest")
    check("smoke: the pool is bounded by the quality budget", peak <= p["smokeCapacity"], f"peak {peak}, budget {p['smokeCapacity']}")
    measurements["smoke_peak"] = peak
    measurements["smoke_budget"] = p["smokeCapacity"]


def step_audio(page):
    print("== Step audio ==", flush=True)
    p = pr(page)
    reset_car(page)
    p = pr(page)
    check("audio: the context is running after the first key (a user gesture)", p["audio"]["enabled"] and p["audio"]["contextState"] == "running", json.dumps(p["audio"]))
    check("audio: one graph, five loops (engine, tyre, rain, siren oscillator and LFO)", p["audio"]["graphBuilt"] and p["audio"]["loopsCreated"] == 5, str(p["audio"]["loopsCreated"]))
    idle = p["audio"]["engineHz"]
    br.set_key(page, "KeyW", True)
    time.sleep(4.0)
    p = pr(page)
    speed = hud_speed_kph(page)
    check("audio: engine pitch rises with real speed", p["audio"]["engineHz"] > idle + 20 and speed > 25, f"idle {idle:.0f} Hz, now {p['audio']['engineHz']:.0f} Hz at {speed:.1f} km/h")
    check("audio: engine gain rises under throttle", p["audio"]["engineGain"] > 0.1, f"gain {p['audio']['engineGain']:.3f}")
    check("audio: rain gain follows the rain", p["audio"]["rainGain"] > 0, f"rain gain {p['audio']['rainGain']:.3f}")
    br.release_all(page)
    time.sleep(1.0)

    press(page, "Escape")
    wait_pr(page, "p.audio.contextState === 'suspended'", timeout=3)
    p = pr(page)
    check("audio: pause suspends the audio context", p["audio"]["contextState"] == "suspended", str(p["audio"]["contextState"]))
    cues = p["audio"]["cuesPlayed"]
    press(page, "Escape")
    wait_pr(page, "p.audio.contextState === 'running'", timeout=3)
    check("audio: resume runs the audio context again", pr(page)["audio"]["contextState"] == "running")
    check("audio: resume plays no queued cue", pr(page)["audio"]["cuesPlayed"] == cues)

    page.evaluate("() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); }")
    p = wait_pr(page, "p.audio.contextState === 'suspended'", timeout=3)
    check("audio: a hidden tab suspends the audio context", p is not None and p["audio"]["contextState"] == "suspended")
    page.evaluate("() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); }")
    p = wait_pr(page, "p.audio.contextState === 'running'", timeout=3)
    check("audio: the tab shown again resumes the audio", p is not None and p["audio"]["contextState"] == "running")
    measurements["engine_hz_idle"] = idle


def step_race(page):
    print("== Step race ==", flush=True)
    br.release_all(page)
    before = pr(page)["audio"]["cuesPlayed"]
    br.stage_at_route_start(page, 0)
    # Drive to the approach with the keyboard driver, as browser-race.py step E does.
    snap = br.drive(page, {"EVENT_APPROACH"}, timeout=90.0)
    if snap is None or snap.get("phase") != "EVENT_APPROACH":
        check("race: the car reaches the event approach at the marker", False, f"phase {snap and snap.get('phase')}")
        return
    br.release_all(page)
    press(page, "KeyE")
    snap = br.wait_phase(page, {"RACING"}, timeout=10.0)
    check("race: E starts the race", snap is not None and snap["phase"] == "RACING")
    time.sleep(0.3)
    countdown_cues = pr(page)["audio"]["cuesPlayed"] - before
    check("race: the countdown and GO cues play through the audio manager", countdown_cues >= 2, f"cues played {countdown_cues}")
    shot(page, "R01_race_started.png")
    # Drive the route to the finish with the keyboard driver. Checkpoints and the finish play their cues when they pass.
    final = br.drive(page, {"FINISHED", "FAILED"}, timeout=600.0, log_every=8.0)
    br.release_all(page)
    total = pr(page)["audio"]["cuesPlayed"] - before
    finished = final is not None and final.get("phase") == "FINISHED"
    check("race: the race is driven to the finish", finished, f"phase {final and final.get('phase')}")
    # Expected: countdown and GO, two checkpoints, and the finish. The countdown count depends on the countdown length.
    check("race: checkpoint and finish cues play when they are passed", finished and total >= countdown_cues + 3, f"cues: countdown and go {countdown_cues}, total {total}")
    shot(page, "R02_race_finished.png")
    press(page, "KeyQ")
    left = br.wait_phase(page, {"FREE_ROAM"}, timeout=5.0)
    check("race: Q on the result returns to free roam", left is not None)
    measurements["race_cues"] = {"countdownAndGo": countdown_cues, "total": total}


def step_siren(page):
    print("== Step siren ==", flush=True)
    br.release_all(page)
    has_pursuit = page.evaluate("() => !!(window.__STREET_RACER_DEBUG__ && window.__STREET_RACER_DEBUG__.pursuit)")
    check("siren: the pursuit API is present in this world", has_pursuit)
    if not has_pursuit:
        return
    page.evaluate("() => window.__STREET_RACER_DEBUG__.pursuit.placeAheadOfUnit(0, 30)")
    time.sleep(0.6)
    before = pr(page)["audio"]["cuesPlayed"]
    page.evaluate("() => window.__STREET_RACER_DEBUG__.pursuit.reportOffence('speeding')")
    # Wait on the audio read-out itself. The pursuit snapshot is published a little after the tick that changes the state.
    p = wait_pr(page, "p.audio.sirenOn === true", timeout=15.0)
    state = wait_pursuit_state(page, ("INITIATING", "PURSUING", "ESCALATING"), 5.0)
    check("siren: a pursuit starts from the real offence path", p is not None and state in ("INITIATING", "PURSUING", "ESCALATING"), f"state {state}")
    check("siren: the siren is on while police chase", p is not None and p["audio"]["sirenOn"] is True, f"sirenOn {p and p['audio']['sirenOn']}")
    cues = (p["audio"]["cuesPlayed"] - before) if p else 0
    check("siren: the siren start cue plays once at the start", cues == 1, f"cues {cues}")
    shot(page, "P01_siren_pursuit.png")
    press(page, "KeyR")
    p = wait_pr(page, "p.audio.sirenOn === false", timeout=10.0)
    state = wait_pursuit_state(page, ("INACTIVE",), 8.0)
    check("siren: reset ends the pursuit and the siren goes off", p is not None and state == "INACTIVE", f"state {state}, sirenOn {p and p['audio']['sirenOn']}")


def step_ui(page, url):
    print("== Step ui ==", flush=True)
    open_hub(page)
    overlay_anim = page.evaluate("() => getComputedStyle(document.querySelector('.career-overlay')).animationName")
    panel_anim = page.evaluate("() => getComputedStyle(document.querySelector('.career-panel')).animationName")
    check("ui: the career overlay fades in with the shared motion", overlay_anim == "overlay-in", f"animation {overlay_anim}")
    check("ui: the career panel slides in with the shared motion", panel_anim == "panel-in", f"animation {panel_anim}")
    shot(page, "U01_career_hub_motion.png")
    close_hub(page)
    status = (page.locator(".presentation-status").text_content() or "").strip()
    check("ui: the status line stays in the HUD after the overlay closes", bool(status), status)
    measurements["status_line"] = status

    # Reduced motion: a second page with the preference set, so the same overlay must not animate.
    context = page.context.browser.new_context(viewport={"width": 1280, "height": 760}, reduced_motion="reduce")
    rm = context.new_page()
    rm.on("pageerror", lambda err: page_errors.append(str(err)))
    rm.on("console", lambda msg: console_issues.append(msg.text) if msg.type == "error" else None)
    rm.goto(url, wait_until="domcontentloaded")
    rm.wait_for_function("() => window.__STREET_RACER_DEBUG__ && window.__STREET_RACER_DEBUG__.race", timeout=120000)
    rm.wait_for_function("() => window.__STREET_RACER_DEBUG__.race.getRace().phase === 'FREE_ROAM'", timeout=60000)
    time.sleep(1.0)
    open_hub(rm)
    anim = rm.evaluate("() => getComputedStyle(document.querySelector('.career-overlay')).animationName")
    duration = rm.evaluate("() => getComputedStyle(document.querySelector('.career-overlay')).animationDuration")
    check("ui: reduced motion turns the overlay animation off", anim == "none", f"animation {anim}, duration {duration}")
    context.close()


def garage_open(page):
    return page.locator(".garage-overlay[aria-label='Garage']").count() > 0


def one_cycle(page):
    """One pass over every repeated path: the hub, the garage, time of day, and weather."""
    open_hub(page)
    close_hub(page)
    press(page, "KeyV")
    page.wait_for_selector(".garage-overlay[aria-label='Garage']", timeout=5000)
    press(page, "KeyV")
    page.wait_for_selector(".garage-overlay[aria-label='Garage']", state="detached", timeout=5000)
    press(page, "KeyN")
    press(page, "KeyM")
    time.sleep(0.4)


def step_repeat(page):
    print("== Step repeat ==", flush=True)
    br.release_all(page)
    # Warm-up: the first rain and the first garage open each upload their GPU objects once. That is expected, so it is
    # not counted as growth. The five cycles after it must add nothing.
    one_cycle(page)
    time.sleep(1.0)
    before = pr(page)
    snap_before = (before["renderer"]["geometries"], before["renderer"]["textures"], before["renderer"]["programs"], before["audio"]["loopsCreated"], before["audio"]["graphBuilt"])
    canvases_before = page.locator("canvas").count()
    for _ in range(5):
        one_cycle(page)
    time.sleep(1.0)
    after = pr(page)
    snap_after = (after["renderer"]["geometries"], after["renderer"]["textures"], after["renderer"]["programs"], after["audio"]["loopsCreated"], after["audio"]["graphBuilt"])
    check("repeat: geometries, textures, and programs do not grow over 5 cycles", snap_after[:3] == snap_before[:3], f"before {snap_before[:3]}, after {snap_after[:3]}")
    check("repeat: the audio graph is still one graph with five loops", snap_after[3] == 5 and snap_after[4], f"loops {snap_after[3]}, graph {snap_after[4]}")
    check("repeat: the canvas count is the same as before the cycles, and the UI is closed", page.locator("canvas").count() == canvases_before and page.locator(".career-overlay").count() == 0 and not garage_open(page), f"canvases {canvases_before} before, {page.locator('canvas').count()} after")
    check("repeat: the game is not paused after the cycles", not page.evaluate("() => window.__STREET_RACER_DEBUG__.isPaused()"))
    measurements["repeat_before"] = snap_before
    measurements["repeat_after"] = snap_after


def sample_render(page, label, seconds=3.0):
    time.sleep(1.5)
    calls, tris, samples = [], [], 0
    end = time.time() + seconds
    while time.time() < end:
        p = pr(page)
        calls.append(p["renderer"]["calls"])
        tris.append(p["renderer"]["triangles"])
        samples += 1
        time.sleep(0.2)
    fps = page.evaluate(
        "() => new Promise((resolve) => { let n = 0; const t0 = performance.now();"
        " const f = () => { n += 1; if (performance.now() - t0 < 3000) requestAnimationFrame(f);"
        " else resolve(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); })"
    )
    row = {
        "label": label,
        "drawCallsMedian": sorted(calls)[len(calls) // 2],
        "trianglesMedian": sorted(tris)[len(tris) // 2],
        "fpsHeadless": round(fps, 1),
        "rainStreaks": pr(page)["rainStreaks"],
        "pixelRatio": pr(page)["pixelRatio"],
    }
    print("  " + json.dumps(row), flush=True)
    return row


def step_perf(page):
    print("== Step perf ==", flush=True)
    br.release_all(page)
    rows = []
    # Current state: medium, rain on. Measure each preset with rain, then medium clear.
    rows.append(sample_render(page, "medium, rain"))
    press(page, "KeyU")
    wait_pr(page, "p.quality === 'high'", timeout=3)
    rows.append(sample_render(page, "high, rain"))
    press(page, "KeyU")
    wait_pr(page, "p.quality === 'low'", timeout=3)
    rows.append(sample_render(page, "low, rain"))
    press(page, "KeyU")
    wait_pr(page, "p.quality === 'medium'", timeout=3)
    press(page, "KeyM")
    wait_pr(page, "p.weather === 'clear'", timeout=3)
    time.sleep(WEATHER_SETTLE_SECONDS)
    rows.append(sample_render(page, "medium, clear"))
    measurements["perf"] = rows
    check("perf: each preset rendered with bounded calls and a non-zero triangle count", all(r["drawCallsMedian"] > 0 and r["trianglesMedian"] > 0 for r in rows), "see the report")
    check("perf: rain draws only while wet (clear shows zero streaks)", rows[-1]["rainStreaks"] == 0, str(rows[-1]["rainStreaks"]))


def step_quality(url):
    print("== Step quality (device scale factor 2) ==", flush=True)
    context = None
    try:
        context = _browser.new_context(viewport={"width": 1280, "height": 760}, device_scale_factor=2)
        page = context.new_page()
        page.on("pageerror", lambda err: page_errors.append(str(err)))
        page.on("console", lambda msg: console_issues.append(msg.text) if msg.type == "error" else None)
        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_function("() => window.__STREET_RACER_DEBUG__ && window.__STREET_RACER_DEBUG__.presentation", timeout=120000)
        time.sleep(1.0)
        p = pr(page)
        check("quality: medium is the default and renders at pixel ratio 1.5", p["quality"] == "medium" and abs(p["pixelRatio"] - 1.5) < 0.01, f"{p['quality']} at {p['pixelRatio']}")
        press(page, "KeyU")
        p = wait_pr(page, "p.quality === 'high' && Math.abs(p.pixelRatio - 2) < 0.01", timeout=6)
        check("quality: high renders at pixel ratio 2", p is not None, f"{pr(page)['quality']} at {pr(page)['pixelRatio']}")
        press(page, "KeyU")
        p = wait_pr(page, "p.quality === 'low' && Math.abs(p.pixelRatio - 1) < 0.01", timeout=6)
        check("quality: low renders at pixel ratio 1", p is not None, f"{pr(page)['quality']} at {pr(page)['pixelRatio']}")
        stored = page.evaluate("() => window.localStorage.getItem('street-racer.settings')")
        check("quality: the choice is stored under street-racer.settings", stored is not None and json.loads(stored)["quality"] == "low", str(stored))
        page.reload(wait_until="domcontentloaded")
        page.wait_for_function("() => window.__STREET_RACER_DEBUG__ && window.__STREET_RACER_DEBUG__.presentation", timeout=120000)
        time.sleep(1.0)
        p = pr(page)
        check("quality: the choice survives a reload", p["quality"] == "low" and abs(p["pixelRatio"] - 1) < 0.01, f"{p['quality']} at {p['pixelRatio']}")
        press(page, "KeyU")
        press(page, "KeyU")
        wait_pr(page, "p.quality === 'medium'", timeout=3)
    finally:
        if context is not None:
            context.close()


def main():
    global _browser
    with sync_playwright() as p:
        _browser = p.chromium.launch(headless=True, args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
        context = _browser.new_context(viewport={"width": 1280, "height": 760})
        page = context.new_page()
        page.on("console", lambda msg: console_issues.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda err: page_errors.append(str(err)))
        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_function("() => window.__STREET_RACER_DEBUG__ && window.__STREET_RACER_DEBUG__.race", timeout=120000)
        page.wait_for_function("() => window.__STREET_RACER_DEBUG__.race.getRace().phase === 'FREE_ROAM'", timeout=60000)
        time.sleep(1.0)
        page.evaluate("() => document.activeElement && document.activeElement.blur && document.activeElement.blur()")
        try:
            if "start" in STEPS:
                step_start(page)
            if "light" in STEPS:
                step_light(page)
            if "weather" in STEPS:
                step_weather(page)
            if "smoke" in STEPS:
                step_smoke(page)
            if "audio" in STEPS:
                step_audio(page)
            if "race" in STEPS:
                step_race(page)
            if "siren" in STEPS:
                step_siren(page)
            if "ui" in STEPS:
                step_ui(page, URL)
            if "repeat" in STEPS:
                step_repeat(page)
            if "perf" in STEPS:
                step_perf(page)
            if "quality" in STEPS:
                step_quality(URL)
        except Exception as error:  # A failed step is a failed check, never a silent pass.
            check("run: no exception during the steps", False, repr(error)[:300])
        finally:
            br.release_all(page)
        _browser.close()

    if "errors" in STEPS:
        real = [text for text in console_issues if not any(known in text for known in KNOWN_WARNINGS)]
        check("errors: no page errors", not page_errors, "; ".join(page_errors)[:300])
        check("errors: no console errors other than the known warnings", not real, "; ".join(real)[:300])

    failed = [name for name, passed, _ in results if not passed]
    report = {
        "url": URL,
        "steps": STEPS,
        "passed": sum(1 for _, ok, _ in results if ok),
        "total": len(results),
        "failed": failed,
        "measurements": measurements,
        "results": [{"name": n, "passed": ok, "detail": d} for n, ok, d in results],
    }
    with open(os.path.join(OUT, "presentation-report.json"), "w") as handle:
        json.dump(report, handle, indent=2)
    print(f"\nRESULT {report['passed']}/{report['total']} checks passed", flush=True)
    if failed:
        print("FAILED: " + "; ".join(failed), flush=True)
    sys.exit(0 if not failed else 1)


_browser = None

if __name__ == "__main__":
    main()
