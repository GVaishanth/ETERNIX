"""
Car overhaul visual check: captures the garage preview of all 20 catalogue cars in the RUNNING app.

For each car (roster order) it selects the row in the garage, then captures the preview in four fixed views
(3/4, Front, Side, Rear). Writes one PNG per car and view, plus contact sheets so every car can be compared in one image.

Usage:
  python3 tools/car-gallery.py [url] [outdir]
Defaults: url=http://localhost:5173/play.html  outdir=browser-output/car-overhaul
Pre-condition: a fresh browser profile (Playwright starts one each run), so the save starts empty.
"""

import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173/play.html?world=city"
OUT = sys.argv[2] if len(sys.argv) > 2 else "browser-output/car-overhaul"
SHOTS = os.path.join(OUT, "gallery")
os.makedirs(SHOTS, exist_ok=True)

CARS = [
    "Finch S1", "Vesper C2", "Rook RS", "Ember GT", "Strata S",
    "Vandal R", "Nightfall GT", "Kestrel MR", "Talon V8", "Meridian XR",
    "Phantom LX", "Apex T", "Voltaris E", "Sovereign S", "Zephyr R",
    "Obsidian X", "Tempest R", "Havoc AWD", "Solstice LM", "Zenith One",
]
VIEWS = ["3/4", "Front", "Side", "Rear"]
KNOWN_WARNINGS = ("THREE.Clock", "GL Driver Message", "GPU stall", "WebGL")

page_errors = []
console_errors = []
results = []


def check(name, passed, detail=""):
    results.append({"name": name, "passed": bool(passed), "detail": detail})
    print(("PASS " if passed else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        page.on("pageerror", lambda err: page_errors.append(str(err)))

        def on_console(msg):
            if msg.type == "error" and not any(known in msg.text for known in KNOWN_WARNINGS):
                console_errors.append(msg.text)

        page.on("console", on_console)
        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_selector(".garage-launch .hud-button", timeout=120000)
        page.wait_for_function(
            "() => document.querySelector('.garage-launch .hud-button') && !document.querySelector('.garage-launch .hud-button').disabled",
            timeout=60000,
        )
        page.keyboard.press("v")
        page.wait_for_selector(".garage-overlay", timeout=10000)
        check("garage opens with V", page.locator(".garage-overlay").count() == 1)

        rows = page.locator(".garage-row").count()
        check("garage lists 20 cars", rows == 20, f"rows={rows}")

        captured = {}
        for name in CARS:
            page.locator(".garage-row", has_text=name).first.click()
            page.wait_for_timeout(250)
            title = page.locator(".garage-car-name").first.inner_text()
            check(f"focus shows {name}", name in title, title)
            for view in VIEWS:
                page.locator(".garage-view", has_text=view).first.click()
                page.wait_for_timeout(450)
                fname = f"{CARS.index(name) + 1:02d}_{name.replace(' ', '_').replace('/', '')}_{view.replace('/', '')}.png"
                path = os.path.join(SHOTS, fname)
                page.locator(".garage-preview").first.screenshot(path=path)
                captured[(name, view)] = path
            fallback = page.locator(".garage-preview-fallback").count()
            check(f"{name} preview renders (no fallback)", fallback == 0, f"fallback={fallback}")

        # Contact sheets: all four views for each car, then one side-only comparison of all 20 cars.
        def font(size):
            try:
                return ImageFont.truetype("DejaVuSans.ttf", size)
            except OSError:
                return ImageFont.load_default()

        cell_w, cell_h = 320, 200
        label_h = 22

        def sheet(names, views, path):
            cols = len(views)
            rows_n = len(names)
            img = Image.new("RGB", (cols * cell_w + 150, rows_n * (cell_h + label_h) + 30), (14, 18, 24))
            draw = ImageDraw.Draw(img)
            f = font(14)
            for c, view in enumerate(views):
                draw.text((150 + c * cell_w + 8, 6), view, fill=(230, 230, 230), font=f)
            for r, name in enumerate(names):
                y = 30 + r * (cell_h + label_h)
                draw.text((8, y + 6), f"{CARS.index(name) + 1:02d} {name}", fill=(255, 210, 120), font=f)
                for c, view in enumerate(views):
                    tile = Image.open(captured[(name, view)]).convert("RGB")
                    tile.thumbnail((cell_w - 6, cell_h - 6))
                    img.paste(tile, (150 + c * cell_w + 3, y + label_h))
            img.save(path)
            return path

        half_a, half_b = CARS[:10], CARS[10:]
        sheet_paths = [
            sheet(half_a, VIEWS, os.path.join(OUT, "contact-sheet-01-10.png")),
            sheet(half_b, VIEWS, os.path.join(OUT, "contact-sheet-11-20.png")),
        ]
        side_img = Image.new("RGB", (5 * 300, 4 * 230 + 10), (14, 18, 24))
        draw = ImageDraw.Draw(side_img)
        f = font(14)
        for i, name in enumerate(CARS):
            col, row_i = i % 5, i // 5
            x, y = col * 300, row_i * 230
            draw.text((x + 6, y + 4), f"{i + 1:02d} {name}", fill=(255, 210, 120), font=f)
            tile = Image.open(captured[(name, "Side")]).convert("RGB")
            tile.thumbnail((292, 200))
            side_img.paste(tile, (x + 4, y + 26))
        side_path = os.path.join(OUT, "side-compare-20.png")
        side_img.save(side_path)
        sheet_paths.append(side_path)

        check("no page errors during the gallery", not page_errors, "; ".join(page_errors[:3]))
        check("no console errors during the gallery", not console_errors, "; ".join(console_errors[:3]))
        browser.close()

    summary = {
        "passed": sum(1 for r in results if r["passed"]),
        "total": len(results),
        "results": results,
        "pageErrors": page_errors,
        "consoleErrors": console_errors,
        "sheets": sheet_paths,
        "shots": len(captured),
    }
    with open(os.path.join(OUT, "gallery-results.json"), "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2)
    print(f"SUMMARY {summary['passed']}/{summary['total']} shots={summary['shots']}", flush=True)


if __name__ == "__main__":
    main()
