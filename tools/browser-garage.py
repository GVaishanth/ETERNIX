"""
Browser verification for Part 8 (garage, vehicle economy, upgrades, paint, persistence).

Runs in the running DEV app. Keyboard (V, W) and mouse (garage buttons) are real input events.

Steps (select with arguments; default runs all steps in order):
  load     the city loads, the garage launcher and credits show, the starter car is active, the entrance is ready
  garage   V opens the garage. Buy the Rook RS (950), make it active, double-click one upgrade (one charge only),
           paint it midnight. Paint is counted on the live car in the frame before and after.
  persist  reload the page: the credits, the owned car, the active car, the upgrade, and the paint are the same
  drive    leaving the entrance disables the garage button with its reason, and V does not open the garage
  errors   no page errors or console errors (known GL/three.js warnings are listed, not counted)

Usage:
  python3 tools/browser-garage.py [url] [outdir] [steps...]
Defaults: url=http://localhost:5173/play.html  outdir=browser-output/part8  steps=load garage persist drive errors
Pre-condition: a fresh browser profile (Playwright starts one each run), so the save starts empty.
"""

import json
import os
import sys
import time

from PIL import Image
from playwright.sync_api import sync_playwright

ARGS = sys.argv[1:]
URL = ARGS[0] if len(ARGS) > 0 and ARGS[0].startswith("http") else "http://localhost:5173/play.html?world=city"
REST = [a for a in ARGS if not a.startswith("http")]
OUT = REST[0] if len(REST) > 0 and REST[0].startswith("/") else "browser-output/part8"
STEPS = [a for a in REST if not a.startswith("/")] or ["load", "garage", "persist", "drive", "errors"]
os.makedirs(OUT, exist_ok=True)

KNOWN_WARNINGS = ("THREE.Clock", "GL Driver Message", "GPU stall", "WebGL")
SAVE_KEY = "street-racer.save"

results = []
console_issues = []
page_errors = []


def check(name, passed, detail=""):
    results.append({"name": name, "passed": bool(passed), "detail": detail})
    print(("PASS " if passed else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def credits(page):
    # The HUD pill shows the balance when the garage is closed; the garage header shows it when open. One is on screen.
    text = page.locator(".garage-balance-value").first.inner_text(timeout=5000)
    return int(text.replace(",", ""))


def garage_open(page):
    return page.locator(".garage-overlay").count() > 0


def row(page, name):
    return page.locator(".garage-row", has_text=name).first


def wait_garage(page):
    page.wait_for_selector(".garage-overlay", timeout=10000)


def body_panel_rgb(path):
    """Mean colour of a fixed strip of body panel on the parked car (between cabin and tail lights), in the chase view."""
    img = Image.open(path).convert("RGB")
    box = (590, 496, 690, 508)
    pixels = [img.getpixel((x, y)) for x in range(box[0], box[2]) for y in range(box[1], box[3])]
    n = len(pixels)
    return tuple(sum(p[i] for p in pixels) // n for i in range(3))


def run(page, steps):
    if "load" in steps:
        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_selector(".garage-launch .hud-button", timeout=120000)
        page.wait_for_function("() => document.querySelector('.garage-balance-value')?.textContent === '1,500'", timeout=60000)
        check("launcher shows the starting balance of 1,500", credits(page) == 1500, f"credits={credits(page)}")
        button = page.locator(".garage-launch .hud-button").first
        check("garage button enabled at the entrance", button.is_enabled(), "")
        page.wait_for_timeout(1500)
        page.screenshot(path=os.path.join(OUT, "g1_load.png"))

    if "garage" in steps:
        page.wait_for_function("() => document.querySelector('.garage-launch .hud-button') && !document.querySelector('.garage-launch .hud-button').disabled", timeout=30000)
        page.wait_for_timeout(800)
        pre = os.path.join(OUT, "g2_before_paint.png")
        page.screenshot(path=pre)
        before = body_panel_rgb(pre)

        page.keyboard.press("v")
        wait_garage(page)
        check("V opens the garage", garage_open(page), "")
        page.screenshot(path=os.path.join(OUT, "g3_garage_open.png"))

        row(page, "Rook RS").click()
        buy = page.locator(".garage-primary", has_text="Buy for 950").first
        check("Rook RS shows its price", buy.count() == 1, "")
        buy.click()
        page.wait_for_timeout(200)
        check("the first click asks for confirmation and charges nothing", credits(page) == 1500, f"credits={credits(page)}")
        page.locator(".garage-primary", has_text="Confirm: buy for 950").first.click()
        page.wait_for_timeout(200)
        check("buying the Rook RS charges 950 once", credits(page) == 550, f"credits={credits(page)}")
        check("garage message reports the purchase", "Bought the Rook RS" in page.locator(".garage-message").inner_text(), "")

        page.locator("button.garage-primary", has_text="Make active").first.click()
        page.wait_for_timeout(200)
        check("Make active switches the active car", "Active" in row(page, "Rook RS").inner_text(), "")
        check("the starter is no longer active", "Owned" in row(page, "Finch S1").inner_text(), "")

        engine = page.locator(".garage-upgrade", has_text="Engine").locator("button").first
        engine.dblclick()
        page.wait_for_timeout(300)
        check("a double click on an upgrade charges one tier only", credits(page) == 400, f"credits={credits(page)}")
        check("the upgrade shows tier 1 after the double click", page.locator(".garage-upgrade", has_text="Engine").locator(".garage-pip-on").count() == 1, "")

        page.locator(".garage-swatch[aria-label^='Midnight']").first.click()
        page.wait_for_timeout(300)
        check("painting midnight charges the 150 change fee", credits(page) == 250, f"credits={credits(page)}")

        page.screenshot(path=os.path.join(OUT, "g4_garage_painted.png"))
        page.locator("button.garage-primary", has_text="Return to free roam").first.click()
        page.wait_for_timeout(1500)
        check("Return to free roam closes the garage", not garage_open(page), "")
        post = os.path.join(OUT, "g5_after_paint.png")
        page.screenshot(path=post)
        after = body_panel_rgb(post)
        check(
            "the live car changes paint: body panel goes from red-dominant to blue-dominant",
            before[0] - before[2] > 20 and after[2] > after[0],
            f"before rgb={before}; after rgb={after}",
        )

    if "persist" in steps:
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector(".garage-launch .hud-button", timeout=120000)
        page.wait_for_function("() => document.querySelector('.garage-balance-value')?.textContent === '250'", timeout=60000)
        check("credits persist across a reload (250)", credits(page) == 250, f"credits={credits(page)}")
        saved = page.evaluate(f"() => localStorage.getItem('{SAVE_KEY}')")
        data = json.loads(saved) if saved else {}
        garage = data.get("garage", {})
        check("save has the current schemaVersion (2 since Part 9)", data.get("schemaVersion") == 2, f"schemaVersion {data.get('schemaVersion')}")
        check("save selects the Rook RS", garage.get("selectedVehicleId") == "rook-rs", garage.get("selectedVehicleId", ""))
        check("save records the engine tier and midnight paint", garage.get("vehicles", {}).get("rook-rs", {}).get("upgrades", {}).get("engine") == 1
              and garage.get("vehicles", {}).get("rook-rs", {}).get("paintId") == "midnight", "")
        check("save holds no catalogue prices", "priceCredits" not in saved and "handling" not in saved, "")
        page.keyboard.press("v")
        page.wait_for_timeout(300)
        page.keyboard.press("v")
        page.wait_for_timeout(300)
        page.keyboard.press("v")
        wait_garage(page)
        check("after reload the Rook RS is the active car", "Active" in row(page, "Rook RS").inner_text(), "")
        page.screenshot(path=os.path.join(OUT, "g6_after_reload.png"))
        page.locator("button.garage-primary", has_text="Return to free roam").first.click()
        page.wait_for_timeout(300)

    if "drive" in steps:
        # Hold W until the car is clearly outside the 12 m entrance zone. A fixed hold is too short on a slow headless clock.
        start_pose = page.evaluate("() => window.__STREET_RACER_DEBUG__.race.getPose()")
        page.wait_for_timeout(500)
        page.keyboard.down("w")
        t_drive = time.time()
        while time.time() - t_drive < 60:
            pose = page.evaluate("() => window.__STREET_RACER_DEBUG__.race.getPose()")
            if ((pose["x"] - start_pose["x"]) ** 2 + (pose["z"] - start_pose["z"]) ** 2) ** 0.5 > 20:
                break
            page.wait_for_timeout(200)
        page.keyboard.up("w")
        page.wait_for_timeout(300)
        button = page.locator(".garage-launch .hud-button").first
        check("driving away disables the garage button", button.is_disabled(), "")
        reason = page.locator(".garage-launch-reason").first.inner_text()
        check("the disabled button says why", "garage entrance" in reason or "Stop" in reason, reason)
        page.keyboard.press("v")
        page.wait_for_timeout(400)
        check("V does not open the garage away from the entrance", not garage_open(page), "")
        page.screenshot(path=os.path.join(OUT, "g7_drive_refused.png"))


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
        page = browser.new_page(viewport={"width": 1280, "height": 760})

        def on_console(msg):
            if msg.type not in ("error", "warning"):
                return
            text = msg.text
            if any(known in text for known in KNOWN_WARNINGS):
                return
            if msg.type == "error":
                console_issues.append(text)

        page.on("console", on_console)
        page.on("pageerror", lambda err: page_errors.append(str(err)))
        try:
            run(page, STEPS)
            if "errors" in STEPS:
                check("no page errors", len(page_errors) == 0, "; ".join(page_errors[:3]))
                check("no console errors", len(console_issues) == 0, "; ".join(console_issues[:3]))
        finally:
            browser.close()

    passed = sum(1 for r in results if r["passed"])
    summary = {"passed": passed, "total": len(results), "steps": STEPS, "results": results, "page_errors": page_errors, "console_errors": console_issues}
    with open(os.path.join(OUT, "report_garage.json"), "w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=2)
    print(f"\n{passed}/{len(results)} checks passed. Report: {os.path.join(OUT, 'report_garage.json')}", flush=True)
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    started = time.time()
    code = main()
    print(f"elapsed {time.time() - started:.1f}s", flush=True)
    sys.exit(code)
