"""
Part 5 production smoke: loads the built app (vite preview, default http://localhost:4173/play.html), records page errors,
console errors, and failed or missing asset requests (favicon ignored), confirms the city canvas renders, drives the
car for a few seconds with the keyboard, and checks the car moved. Production has no diagnostics, so it reads only
the rendered canvas and the on-screen speed text. Writes report.json and a screenshot to the output folder.

Usage: python3 tools/browser-prod.py [url] [out_dir]
"""
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173/play.html?world=city"
OUT = sys.argv[2] if len(sys.argv) > 2 else "browser-output/part5_prod"
os.makedirs(OUT, exist_ok=True)

KNOWN_WARNINGS = ("GPU stall", "WebGL: CONTEXT_LOST", "swiftshader", "GL Driver Message")

results = []


def check(name, ok, detail=""):
    results.append({"name": name, "passed": bool(ok), "detail": detail})
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def main():
    page_errors, console_errors, asset_failures = [], [], []
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"])
        page = browser.new_page(viewport={"width": 1280, "height": 760})
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("requestfailed", lambda r: asset_failures.append(f"{r.url} ({r.failure})") if "favicon" not in r.url else None)
        page.on("response", lambda r: asset_failures.append(f"{r.url} ({r.status})") if r.status >= 400 and "favicon" not in r.url else None)

        page.goto(URL, wait_until="load", timeout=60000)
        page.wait_for_timeout(4000)
        canvas = page.locator("canvas").first
        check("boot: the 3D canvas is present", canvas.count() > 0)
        check("boot: the minimap canvas is present", page.locator(".minimap canvas").count() == 1)
        page.screenshot(path=os.path.join(OUT, "01_prod_boot.png"))

        # Drive: hold W for 4 seconds and confirm the speed readout rises above zero.
        page.keyboard.down("KeyW")
        page.wait_for_timeout(4000)
        page.keyboard.up("KeyW")
        page.wait_for_timeout(500)
        import re
        body = page.locator("body").inner_text()
        match = re.search(r"(\d+(?:\.\d+)?)\s*km/h", body)
        kmh = float(match.group(1)) if match else -1.0
        check("drive: holding W moves the car (HUD speed above zero)", kmh > 5.0, f"HUD speed={kmh} km/h")
        page.screenshot(path=os.path.join(OUT, "02_prod_drive.png"))

        page.keyboard.press("KeyR")
        page.wait_for_timeout(400)
        check("reset: R completes without an error", not page_errors)

        browser.close()

    real_console = [m for m in console_errors if not any(k in m for k in KNOWN_WARNINGS)]
    check("errors: no page errors", not page_errors, "; ".join(page_errors)[:300])
    check("errors: no console errors", not real_console, "; ".join(real_console)[:300])
    check("assets: no failed or missing asset requests", not asset_failures, "; ".join(asset_failures)[:300])

    passed = sum(1 for r in results if r["passed"])
    report = {"url": URL, "passed": passed, "total": len(results), "results": results,
              "page_errors": page_errors, "console_errors": console_errors, "asset_failures": asset_failures}
    with open(os.path.join(OUT, "report.json"), "w") as f:
        json.dump(report, f, indent=2)
    print(f"\n{passed}/{len(results)} checks passed. Report: {os.path.join(OUT, 'report.json')}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
