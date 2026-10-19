"""
Garage studio follows the shared environment (DEV app). For each setting it seeds the active car and the shared
environment record, opens the home page, opens the garage, and screenshots it. The environment the page actually shows
is read from the stage's data attribute at the moment of the screenshot, and the screenshot is saved under that name.

Usage: python3 tools/browser-garage-env.py [base-url] [outdir]
Defaults: base=http://localhost:5173  outdir=browser-output/garage-env
"""
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173"
OUT = sys.argv[2] if len(sys.argv) > 2 else "browser-output/garage-env"
os.makedirs(OUT, exist_ok=True)
SAVE_KEY = "street-racer.save"
ENV_KEY = "street-racer.environment.v1"
SETTINGS = [("day", "clear"), ("evening", "clear"), ("night", "rain")]
results = []


def seed():
    garage = {
        "credits": 5000,
        "selectedVehicleId": "vandal-r",
        "vehicles": {"vandal-r": {"upgrades": {"engine": 0, "transmission": 0, "tires": 0, "brakes": 0}, "paintId": "cherry"}},
    }
    return json.dumps({"schemaVersion": 2, "garage": garage})


with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    for time_of_day, weather in SETTINGS:
        # The record is written at page load, so the clock keeps it for its interval (the page reads it at once).
        record = json.dumps({"timeOfDay": time_of_day, "weather": weather, "changedAt": int(time.time() * 1000)})
        context = browser.new_context(viewport={"width": 1024, "height": 640}, timezone_id="Asia/Kolkata")
        context.add_init_script(f"localStorage.setItem('{SAVE_KEY}', {json.dumps(seed())}); localStorage.setItem('{ENV_KEY}', {json.dumps(record)});")
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(BASE + "/index.html", wait_until="domcontentloaded")
        page.wait_for_selector(".ex-stage[data-environment]", state="attached", timeout=120000)
        time.sleep(3)
        page.get_by_role("button", name="GARAGE").click()
        time.sleep(6)
        shown = page.locator(".ex-stage").first.get_attribute("data-environment")
        path = os.path.join(OUT, f"garage-{time_of_day}-{weather}.png")
        page.screenshot(path=path, timeout=180000)
        ok = shown == f"{time_of_day} {weather}" and not errors
        results.append({"setting": f"{time_of_day} {weather}", "shown": shown, "errors": errors, "screenshot": path, "passed": ok})
        print(("PASS " if ok else "FAIL ") + f"garage at {time_of_day} {weather}: shown {shown!r}" + (f", errors {errors[:2]}" if errors else ""), flush=True)
        context.close()
    browser.close()

with open(os.path.join(OUT, "garage_env_report.json"), "w") as handle:
    json.dump(results, handle, indent=2)
print(f"{sum(r['passed'] for r in results)}/{len(results)} PASS", flush=True)
sys.exit(0 if all(r["passed"] for r in results) else 1)
