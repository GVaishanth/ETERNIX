"""
Shared environment check across two open pages (DEV app).

Opens the home page and the game in one browser context (same origin, so they share localStorage). Writes a new
environment record from the home page and checks that the game page shows it within a few seconds, without waiting for
its interval tick. Then does the same the other way round. Each page's status line is read from the DOM.

Usage: python3 tools/browser-environment-sync.py [base-url] [outdir]
Defaults: base=http://localhost:5173  outdir=browser-output/environment-sync
Exit code 0 when every check passes.
"""

import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173"
OUT = sys.argv[2] if len(sys.argv) > 2 else "browser-output/environment-sync"
os.makedirs(OUT, exist_ok=True)
KEY = "street-racer.environment.v1"
SYNC_WAIT_S = 20.0
LABELS = {"day": "Day", "evening": "Evening", "night": "Night", "clear": "Clear", "rain": "Rain"}
results = []


def check(name, passed, detail=""):
    results.append({"name": name, "passed": bool(passed), "detail": detail})
    print(("PASS " if passed else "FAIL ") + name + (" -- " + detail if detail else ""), flush=True)
    return bool(passed)


def status_text(page):
    """The game's status line, e.g. 'Night · Rain · High quality'."""
    return page.locator(".presentation-status").first.text_content(timeout=30000) or ""


def home_environment(page):
    """The home page's shared environment as 'timeOfDay weather' ids, from the stage's data attribute."""
    return page.locator(".ex-stage").first.get_attribute("data-environment", timeout=5000) or ""


def write_record(page, time_of_day, weather):
    page.evaluate(
        "([key, value]) => localStorage.setItem(key, value)",
        [KEY, json.dumps({"timeOfDay": time_of_day, "weather": weather, "changedAt": int(time.time() * 1000)})],
    )


def wait_for_environment(page, reader, expected_parts, timeout_s):
    """Returns (passed, text, seconds). Software WebGL in this sandbox runs the pages at about 1 fps, so the wait is long."""
    start = time.time()
    deadline = start + timeout_s
    text = ""
    while time.time() < deadline:
        text = reader(page)
        if all(part in text for part in expected_parts):
            return True, text, time.time() - start
        time.sleep(0.25)
    return False, text, time.time() - start


with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
    context = browser.new_context(viewport={"width": 1280, "height": 760})
    home = context.new_page()
    game = context.new_page()
    errors = []
    for page, name in ((home, "home"), (game, "game")):
        page.on("pageerror", lambda err, n=name: errors.append(f"{n}: {err}"))
    home.goto(f"{BASE}/index.html", wait_until="domcontentloaded")
    game.goto(f"{BASE}/play.html", wait_until="domcontentloaded")
    home.wait_for_selector(".ex-stage[data-environment]", timeout=120000, state="attached")
    game.wait_for_selector(".presentation-status", timeout=120000)
    time.sleep(1.0)

    # A page never gets its own storage event, so each direction is written by the other page (in the app, the interval
    # clock writes and applies in the same page).
    # Game writes, home follows.
    write_record(game, "night", "rain")
    ok, text, secs = wait_for_environment(home, home_environment, ["night", "rain"], SYNC_WAIT_S)
    check(f"home page shows the game's new environment within {SYNC_WAIT_S:.0f} s", ok, f"home environment: {text!r} after {secs:.1f} s")

    # Home writes, game follows. The value written must differ from what the game shows now, or the check proves nothing.
    before = status_text(game)
    check("precondition: the game shows a different environment before the home write", "Evening" not in before or "Rain" not in before, f"game before: {before!r}")
    write_record(home, "evening", "rain")
    ok, text, secs = wait_for_environment(game, status_text, [LABELS["evening"], LABELS["rain"]], SYNC_WAIT_S)
    check(f"game shows the home page's new environment within {SYNC_WAIT_S:.0f} s", ok, f"game status: {text!r} after {secs:.1f} s")

    # Stored record is the last one written.
    stored = json.loads(home.evaluate("(key) => localStorage.getItem(key)", KEY) or "{}")
    check("stored record is the last one written", stored.get("timeOfDay") == "evening" and stored.get("weather") == "rain", json.dumps(stored))

    home.screenshot(path=os.path.join(OUT, "home-after-sync.png"), timeout=120000)
    game.screenshot(path=os.path.join(OUT, "game-after-sync.png"), timeout=120000)
    check("no page errors", not errors, "; ".join(errors)[:300])
    browser.close()

passed = all(r["passed"] for r in results)
with open(os.path.join(OUT, "environment_sync_report.json"), "w") as handle:
    json.dump({"base": BASE, "results": results}, handle, indent=2)
print(f"{sum(r['passed'] for r in results)}/{len(results)} PASS", flush=True)
sys.exit(0 if passed else 1)
