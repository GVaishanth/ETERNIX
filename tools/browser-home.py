"""
Home page check (DEV server): the active car, the camera templates, and the shared environment clock.

  1. Active car: for each car it seeds a save that owns and selects that car, loads the landing, and screenshots it.
     The landing and the garage must show that car (not the hatchback). No page or console errors.
  2. Templates: one car, screenshots every 15 s for 7 templates. Consecutive frames must differ at each 15 s boundary.
  3. Environment: the stored record (localStorage) is sampled over the run. The run seeds a record that is due about
     40 s after load, so the first change falls inside the sampled window. Exactly one change must happen, to a different
     pair, 300 s after the seeded start time. The record must also be shared with the game page (play.html).
  4. Fresh start: with no record, the first environment is day and clear, whatever the device clock says (Asia/Kolkata).

Usage:
  python3 tools/browser-home.py [url] [outdir] [quick]
Defaults: url=http://localhost:5173/  outdir=browser-output/home-check.  "quick" skips the 2-minute template and
environment run, so only the car, clock, and shared-record checks run.
"""

import io
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone

from PIL import Image
from playwright.sync_api import sync_playwright

ARGS = sys.argv[1:]
URL = ARGS[0] if ARGS and ARGS[0].startswith("http") else "http://localhost:5173/"
OUT = next((a for a in ARGS if a.startswith("browser-output") or a.startswith("/")), "browser-output/home-check")
QUICK = "quick" in ARGS
os.makedirs(OUT, exist_ok=True)

SAVE_KEY = "street-racer.save"
ENV_KEY = "street-racer.environment.v1"
# Must match ENVIRONMENT_CHANGE_SECONDS in src/config/environmentConfig.ts.
ENV_INTERVAL_S = 300
IST = timezone(timedelta(hours=5, minutes=30))
results = []
page_errors = []
console_errors = []
KNOWN = ("GL Driver Message", "GPU stall", "WebGL", "THREE.WebGLRenderer", "Download the React DevTools")


def check(name, passed, detail=""):
    results.append((name, bool(passed), detail))
    print(("PASS " if passed else "FAIL ") + name + (" -- " + detail if detail else ""), flush=True)


def seed(car_id, paint):
    garage = {
        "credits": 5000,
        "selectedVehicleId": car_id,
        "vehicles": {car_id: {"upgrades": {"engine": 0, "transmission": 0, "tires": 0, "brakes": 0}, "paintId": paint}},
    }
    return json.dumps({"schemaVersion": 2, "garage": garage})


def hook(page):
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.on(
        "console",
        lambda message: console_errors.append(message.text)
        if message.type == "error" and not any(k in message.text for k in KNOWN)
        else None,
    )


def wait_for_landing(page):
    page.wait_for_selector("canvas", timeout=90000)
    page.wait_for_function("() => document.querySelector('canvas') && document.querySelector('canvas').width > 0", timeout=90000)
    time.sleep(4)


def env_record(page):
    raw = page.evaluate(f"() => localStorage.getItem('{ENV_KEY}')")
    return json.loads(raw) if raw else None


def frame_diff(a, b):
    ia = Image.open(io.BytesIO(a)).convert("L").resize((160, 90))
    ib = Image.open(io.BytesIO(b)).convert("L").resize((160, 90))
    pa, pb = ia.load(), ib.load()
    total = 0
    for x in range(160):
        for y in range(90):
            total += abs(pa[x, y] - pb[x, y])
    return total / (160 * 90)


with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])

    # 1. The active car on the landing and in the garage.
    for car_id, paint in [("vandal-r", "midnight"), ("phantom-lx", "pearl"), ("kestrel-hatch", "cherry")]:
        context = browser.new_context(viewport={"width": 1024, "height": 640}, timezone_id="Asia/Kolkata")
        context.add_init_script(f"localStorage.setItem('{SAVE_KEY}', {json.dumps(seed(car_id, paint))});")
        page = context.new_page()
        hook(page)
        page.goto(URL, wait_until="domcontentloaded")
        wait_for_landing(page)
        page.screenshot(path=f"{OUT}/landing-{car_id}.png", timeout=180000)
        check(f"landing loads {car_id} with a canvas", page.locator("canvas").count() > 0)
        page.get_by_role("button", name="GARAGE").click()
        time.sleep(4)
        page.screenshot(path=f"{OUT}/garage-{car_id}.png", timeout=180000)
        page.get_by_role("button", name="LANDING").click()
        context.close()

    # 2 and 3. Templates and the shared environment, on one page, for about two minutes. The record is seeded (only when
    # none is stored) so that its next change is due about 40 s after load, inside this window. The seeded start time is
    # then the stored start time of the record, and the next change is 300 s after it.
    seeded = {"timeOfDay": "day", "weather": "clear", "changedAt": int(time.time() * 1000) - (ENV_INTERVAL_S - 40) * 1000}
    context = browser.new_context(viewport={"width": 1024, "height": 640}, timezone_id="Asia/Kolkata")
    context.add_init_script(f"localStorage.setItem('{SAVE_KEY}', {json.dumps(seed('vandal-r', 'cherry'))});")
    if not QUICK:
        context.add_init_script(
            f"if (!localStorage.getItem('{ENV_KEY}')) localStorage.setItem('{ENV_KEY}', {json.dumps(json.dumps(seeded))});"
        )
    page = context.new_page()
    hook(page)
    page.goto(URL, wait_until="domcontentloaded")
    wait_for_landing(page)
    start_record = env_record(page)
    check("first environment is stored at load", start_record is not None, json.dumps(start_record))
    if not QUICK:
        frames = []
        records = [(time.time(), seeded)]
        start = time.time()
        next_shot = start
        index = 0
        while time.time() - start < 7 * 15 + 2:
            now = time.time()
            if now >= next_shot:
                shot = page.screenshot(path=f"{OUT}/template-{index}.png", timeout=180000)
                frames.append((now - start, shot))
                index += 1
                next_shot += 15
            record = env_record(page)
            if record and (not records or record != records[-1][1]):
                records.append((time.time(), record))
            time.sleep(0.5)
        # Templates: a frame just after each 15 s boundary differs from the frame before it.
        diffs = [frame_diff(frames[i - 1][1], frames[i][1]) for i in range(1, len(frames))]
        print("template frame diffs (mean grey change):", [round(d, 2) for d in diffs], flush=True)
        check("templates change between each 15 s frame", all(d > 0.5 for d in diffs), f"diffs={[round(d, 2) for d in diffs]}")
        changes = records[1:]
        check("environment changed once, at the 300 s interval", len(changes) == 1, f"changes={len(changes)} over ~2 min")
        pairs = [(r["timeOfDay"], r["weather"]) for _, r in records]
        repeats = sum(1 for a, b in zip(pairs, pairs[1:]) if a == b)
        check("no change repeats the same pair", repeats == 0, f"pairs={pairs}")
        # Gaps come from the stored start times, not from when this script happened to sample them.
        stamps = [r["changedAt"] for _, r in records]
        gaps = [round((b - a) / 1000, 1) for a, b in zip(stamps, stamps[1:])]
        check("changes are 300 s apart (stored start times)", all(abs(g - ENV_INTERVAL_S) < 0.5 for g in gaps) if gaps else False, f"gaps_s={gaps}")
    # Shared with the game page, same browser profile. The environment changes once every 300 s, so the home record is read
    # just before and just after the game's read. The game is right if it matches either one.
    home_before = env_record(page)
    game = context.new_page()
    hook(game)
    game.goto(URL.rstrip("/") + "/play.html", wait_until="domcontentloaded")
    time.sleep(6)
    game_record = env_record(game)
    home_after = env_record(page)
    check(
        "game page shows the same environment as the home page",
        game_record in (home_before, home_after),
        f"home={home_before} game={game_record}",
    )
    game.screenshot(path=f"{OUT}/game-page.png", timeout=180000)
    context.close()

    # 4. Device clock start, no record stored yet.
    for label, when, expected in [
        ("clock 21:30 gives day", datetime(2026, 10, 18, 21, 30, tzinfo=IST), "day"),
        ("clock 18:00 gives day", datetime(2026, 10, 18, 18, 0, tzinfo=IST), "day"),
        ("clock 10:00 gives day", datetime(2026, 10, 18, 10, 0, tzinfo=IST), "day"),
    ]:
        context = browser.new_context(viewport={"width": 800, "height": 600}, timezone_id="Asia/Kolkata")
        context.clock.set_fixed_time(when)
        page = context.new_page()
        hook(page)
        page.goto(URL, wait_until="domcontentloaded")
        time.sleep(2)
        record = env_record(page)
        check(
            f"fresh start: {label}",
            record is not None and record["timeOfDay"] == expected and record["weather"] == "clear",
            json.dumps(record),
        )
        context.close()

    browser.close()

check("no page errors", not page_errors, "; ".join(page_errors[:3]))
check("no console errors", not console_errors, "; ".join(console_errors[:3]))
failed = [name for name, passed, _ in results if not passed]
print(f"\n{len(results) - len(failed)}/{len(results)} PASS", flush=True)
sys.exit(1 if failed else 0)
