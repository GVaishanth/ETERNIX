"""
Release checks (Part 11). Runs against a running build over HTTP with real keyboard and mouse input.

Works on the DEV server and on the production build. Steps use only what a player can see and what the browser stores,
so the same steps run in production (no debug API).

Usage:
  python3 tools/browser-release.py [url] [outdir] [step ...]
  default url: http://localhost:5173/play.html        default outdir: browser-output/part11/release
  default steps: boot drive focus pause corrupt newer quota nostorage resize cycles errors
  The step `nowebgl` launches its own browser without WebGL. Run it on its own.

Each step runs in a fresh browser context, so localStorage starts empty unless the step writes to it.
"""
import json
import os
import re
import sys
import time

from playwright.sync_api import sync_playwright

ARGS = sys.argv[1:]
URL = ARGS[0] if len(ARGS) > 0 and ARGS[0].startswith("http") else "http://localhost:5173/play.html?world=city"
REST = [a for a in ARGS if not a.startswith("http")]
OUT = REST[0] if len(REST) > 0 and REST[0].startswith("/") else "browser-output/part11/release"
STEPS = [a for a in REST if not a.startswith("/")] or [
    "boot", "drive", "focus", "pause", "corrupt", "newer", "quota", "nostorage", "resize", "cycles", "errors",
]
os.makedirs(OUT, exist_ok=True)

SAVE_KEY = "street-racer.save"
BACKUP_KEY = "street-racer.save.backup"
# Console messages from the GPU driver and three.js that are known and not game errors (see PROJECT_CONTEXT 15).
KNOWN_CONSOLE = re.compile(r"GL Driver Message|GPU stall|THREE\.Clock|WebGL|GL_CLOSE_PATH|ReadPixels")

results = []


def check(name, ok, detail=""):
    results.append({"name": name, "passed": bool(ok), "detail": str(detail)})
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail != "" else ""), flush=True)


def new_page(browser, init_script=None, viewport=(1280, 760)):
    context = browser.new_context(viewport={"width": viewport[0], "height": viewport[1]})
    if init_script:
        context.add_init_script(init_script)
    page = context.new_page()
    log = {"errors": [], "console": [], "failed": []}
    page.on("pageerror", lambda e: log["errors"].append(str(e)))
    page.on("console", lambda m: log["console"].append(f"{m.type}: {m.text[:200]}") if m.type == "error" else None)
    page.on("requestfailed", lambda r: log["failed"].append(r.url))
    page.on("response", lambda r: log["failed"].append(f"{r.status} {r.url}") if r.status >= 400 else None)
    return context, page, log


def speed_kph(page):
    text = page.locator(".hud-speed").first.inner_text(timeout=5000)
    match = re.search(r"-?\d+(\.\d+)?", text)
    return float(match.group(0)) if match else 0.0


def balance(page):
    return page.locator(".garage-balance-value").first.inner_text(timeout=5000)


def hold_until_speed(page, key, kph, cap_seconds=60.0):
    """Holds a key until the HUD speed reaches kph, or the wall-clock cap passes. Headless time runs slower than real
    time, so a fixed hold is not a speed test. Returns the speed reached. The key stays down; the caller releases it."""
    page.keyboard.down(key)
    end = time.time() + cap_seconds
    speed = speed_kph(page)
    while speed < kph and time.time() < end:
        page.wait_for_timeout(200)
        speed = speed_kph(page)
    return speed


def hold(page, key, seconds):
    page.keyboard.down(key)
    page.wait_for_timeout(int(seconds * 1000))
    page.keyboard.up(key)


def wait_for_hud(page):
    page.wait_for_selector(".hud-speed", timeout=120000)
    page.wait_for_function("() => document.querySelector('.garage-balance-value')?.textContent?.length > 0", timeout=60000)
    page.wait_for_timeout(800)


def step_boot(browser):
    context, page, log = new_page(browser)
    page.goto(URL, wait_until="load")
    wait_for_hud(page)
    page.wait_for_timeout(2000)
    check("boot: the title is the game name", page.title() == "ETERNIX", page.title())
    check("boot: a WebGL canvas is mounted", page.locator("canvas").count() >= 1, page.locator("canvas").count())
    check("boot: the HUD shows RUNNING", page.locator(".hud-status").first.inner_text() == "RUNNING")
    check("boot: the starting car is still (0 km/h)", speed_kph(page) == 0.0, speed_kph(page))
    check("boot: the credits balance starts at 1,500", balance(page) == "1,500", balance(page))
    check("boot: no page errors", not log["errors"], log["errors"][:2])
    check("boot: no failed or 4xx/5xx requests", not log["failed"], log["failed"][:3])
    page.screenshot(path=f"{OUT}/boot.png")
    context.close()


def step_drive(browser):
    context, page, log = new_page(browser)
    page.goto(URL, wait_until="load")
    wait_for_hud(page)
    top = hold_until_speed(page, "KeyW", 30.0)
    page.keyboard.up("KeyW")
    check("drive: holding W accelerates the car (reaches 30 km/h)", top >= 30, f"{top:.1f} km/h")
    hold(page, "KeyS", 2.0)
    slower = speed_kph(page)
    check("drive: holding S brakes the car", slower < top - 10, f"{top:.1f} -> {slower:.1f} km/h")
    page.keyboard.press("KeyR")
    page.wait_for_timeout(600)
    check("drive: R resets the car to rest", speed_kph(page) < 1.0, f"{speed_kph(page):.1f} km/h")
    check("drive: no page errors while driving", not log["errors"], log["errors"][:2])
    page.screenshot(path=f"{OUT}/drive.png")
    context.close()


def step_focus(browser):
    context, page, log = new_page(browser)
    page.goto(URL, wait_until="load")
    wait_for_hud(page)
    page.keyboard.press("KeyV")
    page.wait_for_selector(".garage-overlay", timeout=10000)
    page.keyboard.press("KeyV")
    page.wait_for_timeout(500)
    check("focus: V opens and closes the garage", page.locator(".garage-overlay").count() == 0)
    hold(page, "KeyW", 2.0)
    check("focus: keys drive the car after the garage closes", speed_kph(page) > 10, f"{speed_kph(page):.1f} km/h")
    # Focus loss: a blur clears held keys, so the throttle pedal releases (5/s, about 0.2 s from full) while the key is
    # still physically down. Then the car coasts down. A sustained push after the blur would show as speed still
    # rising later. Measured in the probe: pedal 1.0 -> 0.33 -> 0.00 within about 0.3 s, then speed falls steadily.
    # Read times are HUD reads (100 ms publish interval), so the check compares speed at +0.5 s and +1.5 s.
    page.keyboard.press("KeyR")
    page.wait_for_timeout(600)
    before_blur = hold_until_speed(page, "KeyW", 20.0)
    page.evaluate("() => window.dispatchEvent(new Event('blur'))")
    page.wait_for_timeout(500)
    settle = speed_kph(page)
    page.wait_for_timeout(1000)
    late = speed_kph(page)
    page.keyboard.up("KeyW")
    check("focus: window blur releases held keys (the car coasts down after the pedal releases)", late < settle and before_blur >= 20,
          f"before blur {before_blur:.1f}, +0.5 s {settle:.1f}, +1.5 s {late:.1f} km/h")
    check("focus: no page errors", not log["errors"], log["errors"][:2])
    context.close()


def step_pause(browser):
    context, page, log = new_page(browser)
    page.goto(URL, wait_until="load")
    wait_for_hud(page)
    hold(page, "KeyW", 1.5)
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    paused_status = page.locator(".hud-status").first.inner_text()
    frozen_a = speed_kph(page)
    page.keyboard.down("KeyW")
    page.wait_for_timeout(1200)
    page.keyboard.up("KeyW")
    frozen_b = speed_kph(page)
    check("pause: Esc shows PAUSED", paused_status == "PAUSED", paused_status)
    check("pause: the car does not move while paused", abs(frozen_b - frozen_a) < 0.5, f"{frozen_a:.2f} -> {frozen_b:.2f} km/h")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    check("pause: Esc resumes (RUNNING)", page.locator(".hud-status").first.inner_text() == "RUNNING")
    hold(page, "KeyW", 1.5)
    check("pause: the car accelerates after resume", speed_kph(page) > frozen_b + 5, f"{speed_kph(page):.1f} km/h")
    context.close()


def seed_save(browser, raw_text, init_extra=None):
    """Loads the page once to create the context, writes raw_text to the save key, then reloads and returns the page."""
    context, page, log = new_page(browser)
    page.goto(URL, wait_until="load")
    wait_for_hud(page)
    page.evaluate("([key, value]) => localStorage.setItem(key, value)", [SAVE_KEY, raw_text])
    page.reload(wait_until="load")
    wait_for_hud(page)
    page.wait_for_timeout(600)
    return context, page, log


def step_corrupt(browser):
    bad = '{"schemaVersion": 2, "garage": {"credits": 1500, '  # truncated JSON
    context, page, log = seed_save(browser, bad)
    notice = page.locator(".garage-save-notice")
    check("corrupt: the game still loads with a corrupt save", page.locator(".hud-speed").count() == 1)
    check("corrupt: the HUD tells the player the save was not read", notice.count() == 1 and "could not be read" in notice.first.inner_text(),
          notice.first.inner_text() if notice.count() else "no notice")
    backup = page.evaluate("(key) => localStorage.getItem(key)", BACKUP_KEY)
    check("corrupt: the unreadable save is copied to the backup key first", backup == bad, "backup present" if backup else "no backup")
    check("corrupt: the balance falls back to the starting 1,500", balance(page) == "1,500", balance(page))
    check("corrupt: no page errors", not log["errors"], log["errors"][:2])
    context.close()


def step_newer(browser):
    newer = json.dumps({"schemaVersion": 99, "garage": {"credits": 9999, "selectedVehicleId": "kestrel-hatch", "vehicles": {}}})
    context, page, log = seed_save(browser, newer)
    kept = page.evaluate("(key) => localStorage.getItem(key)", SAVE_KEY)
    check("newer: the save from a newer version is left untouched", kept == newer)
    check("newer: the HUD says the session will not save", page.locator(".garage-credits-note").count() == 1)
    check("newer: the HUD explains the newer save", page.locator(".garage-save-notice").count() == 1)
    check("newer: no page errors", not log["errors"], log["errors"][:2])
    context.close()


def step_quota(browser):
    # Storage that refuses writes to the save key, like a full quota. Reading still works.
    init = """
      (() => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key === 'street-racer.save' && window.__failSaves) {
            throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
          }
          return original.call(this, key, value);
        };
      })();
    """
    context, page, log = new_page(browser, init_script=init)
    page.goto(URL, wait_until="load")
    wait_for_hud(page)
    page.evaluate("() => { window.__failSaves = true; }")
    page.keyboard.press("KeyV")
    page.wait_for_selector(".garage-overlay", timeout=10000)
    page.locator(".garage-row", has_text="Rook RS").first.click()
    page.locator("button.garage-primary", has_text="Buy for 950").first.click()
    page.locator("button.garage-primary", has_text="Confirm: buy for 950").first.click()
    page.wait_for_timeout(800)
    message = page.locator(".garage-message").first.inner_text()
    check("quota: a purchase that cannot be saved is refused", "Nothing was charged" in message or "could not" in message.lower(), message[:120])
    page.locator("button.garage-primary", has_text="Return to free roam").first.click()
    page.wait_for_timeout(300)
    check("quota: the balance is unchanged after the refused purchase", balance(page) == "1,500", balance(page))
    page.evaluate("() => { window.__failSaves = false; }")
    check("quota: no page errors", not log["errors"], log["errors"][:2])
    context.close()


def step_nostorage(browser):
    # localStorage access throws (blocked storage, for example in some private modes).
    init = """
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() { throw new DOMException('Access is denied for this document.', 'SecurityError'); },
      });
    """
    context, page, log = new_page(browser, init_script=init)
    page.goto(URL, wait_until="load")
    wait_for_hud(page)
    page.wait_for_timeout(800)
    check("nostorage: the game loads when storage is blocked", page.locator(".hud-speed").count() == 1)
    check("nostorage: the HUD says progress is not saved", page.locator(".garage-credits-note").count() == 1)
    check("nostorage: the car still drives", (hold(page, "KeyW", 2.0) or True) and speed_kph(page) > 10, f"{speed_kph(page):.1f} km/h")
    check("nostorage: no page errors", not log["errors"], log["errors"][:2])
    context.close()


def step_resize(browser):
    sizes = [(390, 844, "phone-portrait"), (768, 1024, "tablet-portrait"), (1280, 720, "laptop"), (1920, 1080, "desktop")]
    for width, height, label in sizes:
        context, page, log = new_page(browser, viewport=(width, height))
        page.goto(URL, wait_until="load")
        wait_for_hud(page)
        page.wait_for_timeout(800)
        overflow = page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(f"resize {label} {width}x{height}: no horizontal page overflow", overflow <= 1, f"overflow {overflow}px")
        boxes = page.evaluate("""() => {
          const pick = (sel) => { const el = document.querySelector(sel); if (!el) return null;
            const r = el.getBoundingClientRect(); return {x: r.x, y: r.y, r: r.right, b: r.bottom}; };
          return { speed: pick('.hud-speed'), pause: pick('.hud-status'), hint: pick('.hud-info-button'), minimap: pick('.minimap'), career: pick('.career-launch') };
        }""")
        inside = all(
            b is None or (b["x"] >= -1 and b["y"] >= -1 and b["r"] <= width + 1 and b["b"] <= height + 1)
            for b in boxes.values()
        )
        check(f"resize {label}: HUD panels stay inside the viewport", inside, json.dumps({k: (None if v is None else [round(v['x']), round(v['y']), round(v['r']), round(v['b'])]) for k, v in boxes.items()}))
        check(f"resize {label}: the speed readout is visible", boxes["speed"] is not None)
        page.screenshot(path=f"{OUT}/resize_{label}.png")
        check(f"resize {label}: no page errors", not log["errors"], log["errors"][:2])
        context.close()


def heap_after_gc(client):
    client.send("HeapProfiler.collectGarbage")
    usage = client.send("Runtime.getHeapUsage")
    return usage["usedSize"]


def step_cycles(browser):
    # Repeated menu cycles: heap after forced GC should not keep growing. Warm up one cycle first (first open uploads
    # GPU objects and fills caches), then measure five cycles. Numbers are measured in this headless run only.
    context, page, log = new_page(browser)
    page.goto(URL, wait_until="load")
    wait_for_hud(page)
    client = context.new_cdp_session(page)
    client.send("HeapProfiler.enable")
    cycle_with_garage = lambda: (page.keyboard.press("KeyV"), page.wait_for_selector(".garage-overlay", timeout=10000),
                                 page.keyboard.press("KeyV"), page.wait_for_timeout(250))
    cycle_with_career = lambda: (page.keyboard.press("KeyC"), page.wait_for_selector(".career-overlay", timeout=10000),
                                 page.keyboard.press("KeyC"), page.wait_for_timeout(250))
    cycle_with_garage()
    cycle_with_career()
    warm = heap_after_gc(client)
    samples = []
    for _ in range(5):
        cycle_with_garage()
        cycle_with_career()
        samples.append(heap_after_gc(client))
    growth_kb = (samples[-1] - warm) / 1024.0
    check("cycles: heap does not keep growing across five garage and career cycles",
          growth_kb < 1024, f"warm {warm / 1048576:.2f} MB, after 5 cycles {samples[-1] / 1048576:.2f} MB, change {growth_kb:+.0f} kB")
    with open(f"{OUT}/cycles_heap.json", "w") as handle:
        json.dump({"warmBytes": warm, "samplesBytes": samples}, handle, indent=1)
    check("cycles: no page errors", not log["errors"], log["errors"][:2])
    context.close()


def step_errors(browser):
    context, page, log = new_page(browser)
    page.goto(URL, wait_until="load")
    wait_for_hud(page)
    hold(page, "KeyW", 4.0)
    page.keyboard.press("KeyN")
    page.keyboard.press("KeyM")
    page.keyboard.press("KeyU")
    page.wait_for_timeout(1500)
    real = [m for m in log["console"] if not KNOWN_CONSOLE.search(m)]
    check("errors: no page errors while driving and changing settings", not log["errors"], log["errors"][:2])
    check("errors: no unexpected console errors", not real, real[:3])
    context.close()


def step_nowebgl(playwright):
    # A browser with WebGL disabled. The game must show the start-up message instead of a blank page.
    browser = playwright.chromium.launch(args=["--disable-webgl", "--disable-webgl2", "--disable-3d-apis"])
    context, page, log = new_page(browser)
    page.goto(URL, wait_until="load")
    page.wait_for_timeout(5000)
    shown = page.locator(".startup-error").count() == 1
    check("nowebgl: a start-up message is shown instead of a blank page", shown)
    if shown:
        check("nowebgl: the message names WebGL", "WebGL" in page.locator(".startup-error").first.inner_text())
    page.screenshot(path=f"{OUT}/nowebgl.png")
    browser.close()


def main():
    with sync_playwright() as p:
        if "nowebgl" in STEPS:
            step_nowebgl(p)
        browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
        table = {
            "boot": step_boot, "drive": step_drive, "focus": step_focus, "pause": step_pause,
            "corrupt": step_corrupt, "newer": step_newer, "quota": step_quota, "nostorage": step_nostorage,
            "resize": step_resize, "cycles": step_cycles, "errors": step_errors,
        }
        for name in STEPS:
            if name == "nowebgl":
                continue
            if name not in table:
                print(f"unknown step {name}")
                continue
            print(f"--- {name}", flush=True)
            try:
                table[name](browser)
            except Exception as exc:  # A step that cannot run is a failed check, with its reason recorded.
                check(f"{name}: step ran to completion", False, f"{type(exc).__name__}: {str(exc)[:200]}")
        browser.close()
    passed = sum(1 for r in results if r["passed"])
    summary = {"url": URL, "steps": STEPS, "passed": passed, "total": len(results), "results": results}
    with open(f"{OUT}/report.json", "w") as handle:
        json.dump(summary, handle, indent=1)
    print(f"{passed}/{len(results)} checks passed. Report: {OUT}/report.json", flush=True)
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
