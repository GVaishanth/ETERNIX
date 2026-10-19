"""
Browser verification for Part 4 (traffic, collisions, opponent AI). Runs in the running DEV app and reads only the
public debug snapshot (window.__STREET_RACER_DEBUG__). It drives the player with real keyboard events.

Checks:
  boot        circuit loads with traffic enabled, pool capacity, one opponent, no page errors
  spawn       the fixed scenario spawns traffic (postponed spawns are allowed), with rejection reasons visible
  traffic     spawned traffic moves (not stuck) and never reports boundary contact
  opponent    the AI opponent drives across several road segments without entering the lost state
  drive       the player still accelerates with W (Part 1 regression, at the new traffic config)
  debug       the backtick panel lists the traffic and AI section, and G shows the road overlay (screenshots)
  reset       T resets traffic and the opponent without errors
  legacy      ?world=legacy loads with traffic off and no opponents
  errors      no page errors or console errors (known GL/three.js warnings are listed, not counted)

Usage:
  python3 tools/browser-traffic.py [url] [outdir]
Defaults: url=http://localhost:5173/play.html?world=circuit  outdir=browser-output/part4
Writes screenshots and report.json to outdir.
"""

import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173/play.html?world=circuit"
OUT = sys.argv[2] if len(sys.argv) > 2 else "browser-output/part4"
os.makedirs(OUT, exist_ok=True)

KNOWN_WARNINGS = ("THREE.Clock", "GL Driver Message", "GPU stall")

results = []
console_issues = []
page_errors = []


def check(name, passed, detail=""):
    results.append({"name": name, "passed": bool(passed), "detail": detail})
    print(("PASS " if passed else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def snap(page):
    return page.evaluate("() => window.__STREET_RACER_DEBUG__ ? window.__STREET_RACER_DEBUG__.getSnapshot() : null")


def wait_snap(page, predicate_js, timeout_ms=60000):
    page.wait_for_function(
        f"() => {{ const s = window.__STREET_RACER_DEBUG__ && window.__STREET_RACER_DEBUG__.getSnapshot(); return !!s && ({predicate_js}); }}",
        timeout=timeout_ms,
        polling=100,
    )


def opponents_of(s):
    return [v for v in (s.get("traffic") or {}).get("vehicles", []) if v["kind"] == "opponent"]


def traffic_of(s):
    return [v for v in (s.get("traffic") or {}).get("vehicles", []) if v["kind"] == "traffic"]


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"])
        page = browser.new_page(viewport={"width": 1280, "height": 760})
        page.on("console", lambda m: console_issues.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        page.goto(URL, wait_until="networkidle")
        wait_snap(page, "s.physics.stepCount > 0")

        # boot
        s = snap(page)
        t = s.get("traffic")
        check("boot: traffic enabled on the circuit", bool(t and t["enabled"]), f"capacity={t and t['capacity']}")
        check("boot: one opponent AI car", bool(t) and t["opponentCount"] == 1, f"opponents={t and t['opponentCount']}")
        opp = opponents_of(s)
        check("boot: opponent reports an AI state", bool(opp) and opp[0]["aiState"] in ("follow", "brake", "recover"), f"{opp[0]['aiState'] if opp else None}")
        page.screenshot(path=os.path.join(OUT, "01_boot.png"))

        # spawn: wait for the scenario to produce traffic. Spawns are postponed until safe, so this can take a while.
        t0 = time.time()
        active = 0
        while time.time() - t0 < 60:
            s = snap(page)
            active = s["traffic"]["activeTraffic"]
            if active >= 1:
                break
            page.wait_for_timeout(500)
        s = snap(page)
        check("spawn: scenario spawns traffic", s["traffic"]["activeTraffic"] >= 1, f"active={s['traffic']['activeTraffic']} after {time.time() - t0:.1f}s; rejections={s['traffic']['rejections']}")
        check("spawn: spawned count is reported", s["traffic"]["stats"] is not None and s["traffic"]["stats"]["spawned"] >= 1, json.dumps(s["traffic"]["stats"]))

        # traffic and opponent: sample together for 70 s, from the start of the run. The player stays parked on the
        # loop start, so the opponent's first pass goes S3 -> T3 -> S4 -> T4, then it queues behind the parked player.
        # The stall rule must release that queue (the opponent is recycled to its spawn after the stall time).
        order = []
        lost_seen = False
        max_speed = 0.0
        min_speed_seen = 0.0
        traffic_speeds = []
        t1 = time.time()
        while time.time() - t1 < 70:
            page.wait_for_timeout(500)
            s = snap(page)
            traffic_speeds += [v["speedMps"] for v in traffic_of(s)]
            for o in opponents_of(s):
                if o["segmentId"] and (not order or order[-1] != o["segmentId"]):
                    order.append(o["segmentId"])
                if o["aiState"] == "lost":
                    lost_seen = True
                max_speed = max(max_speed, o["speedMps"])
                min_speed_seen = min(min_speed_seen, o["speedMps"])
        s = snap(page)
        check("traffic: vehicles are moving", bool(traffic_speeds) and max(traffic_speeds) > 2.0, f"max speed {max(traffic_speeds) if traffic_speeds else 0:.1f} m/s")
        contacts = s["traffic"]["contacts"] or {}
        check("traffic: no traffic-boundary contact", contacts.get("traffic-boundary", 0) == 0, json.dumps(contacts))
        loop = ["S3", "T3", "S4", "T4"]
        progressed = all(seg in order for seg in loop) and order.index("T3") < order.index("S4") < order.index("T4")
        check("opponent: drives the loop in order S3 -> T3 -> S4 -> T4", progressed, f"sequence={order}")
        check("opponent: never lost", not lost_seen)
        check("opponent: reaches road speed", max_speed > 8, f"max {max_speed:.1f} m/s")
        check("opponent: never reverses while stopped", min_speed_seen > -0.3, f"min speed {min_speed_seen:.2f} m/s")
        check("opponent: no opponent-boundary contact", (s["traffic"]["contacts"] or {}).get("opponent-boundary", 0) == 0, json.dumps(s["traffic"]["contacts"]))
        # Queue release: the parked player blocks the loop, so the opponent stops behind it, then the stall rule recycles it.
        t2 = time.time()
        while time.time() - t2 < 45 and snap(page)["traffic"]["opponentRecycles"] < 1:
            page.wait_for_timeout(500)
        s = snap(page)
        check("opponent: stalled queue is released by the stall recycle", s["traffic"]["opponentRecycles"] >= 1, f"recycles={s['traffic']['opponentRecycles']}")

        # drive: player regression, W accelerates from the spawn.
        s = snap(page)
        page.keyboard.down("KeyW")
        wait_snap(page, "s.vehicle.speedMps > 8", timeout_ms=60000)
        page.keyboard.up("KeyW")
        s = snap(page)
        check("drive: W accelerates the player", s["vehicle"]["speedMps"] > 8, f"v={s['vehicle']['speedMps']:.1f} m/s")
        page.screenshot(path=os.path.join(OUT, "02_driving.png"))

        # debug: the DEV panel is visible by default. Backtick hides it, and the traffic section is in the panel text.
        page.wait_for_timeout(300)
        body_text = page.inner_text("body")
        check("debug: panel shows the traffic and AI section", "Traffic and AI (DEV)" in body_text)
        page.screenshot(path=os.path.join(OUT, "03_debug_panel.png"))
        page.keyboard.press("Shift+Backquote")
        page.wait_for_timeout(300)
        check("debug: backtick hides the panel", "Traffic and AI (DEV)" not in page.inner_text("body"))
        page.keyboard.press("Shift+Backquote")
        page.keyboard.press("KeyG")
        page.wait_for_timeout(600)
        page.screenshot(path=os.path.join(OUT, "04_road_overlay.png"))
        page.keyboard.press("KeyG")
        page.wait_for_timeout(200)

        # reset: T clears traffic and resets the opponent to its spawn lane. No errors afterwards.
        page.keyboard.press("KeyT")
        page.wait_for_timeout(600)
        s = snap(page)
        opp = opponents_of(s)
        check("reset: T resets the opponent to its spawn segment", bool(opp) and opp[0]["segmentId"] == "S3", f"seg={opp[0]['segmentId'] if opp else None}")

        page.screenshot(path=os.path.join(OUT, "05_after_reset.png"))
        browser.close()

        # legacy: traffic off, no opponents, and the legacy road still loads.
        browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"])
        page = browser.new_page(viewport={"width": 1280, "height": 760})
        page.on("console", lambda m: console_issues.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        page.goto(URL.split("?")[0] + "?world=legacy", wait_until="networkidle")  # base URL without its query, so the legacy world is the only one requested
        wait_snap(page, "s.physics.stepCount > 0")
        s = snap(page)
        check("legacy: loads with no traffic and no opponents", s["road"]["worldId"] == "legacy" and not (s["traffic"] or {}).get("enabled", False), s["road"]["worldId"])
        browser.close()

        ignored = [m for m in console_issues if not any(w in m for w in KNOWN_WARNINGS)]
        check("errors: no page errors", len(page_errors) == 0, "; ".join(page_errors)[:300])
        check("errors: no console errors", len(ignored) == 0, "; ".join(ignored)[:300])

    passed = sum(1 for r in results if r["passed"])
    report = {
        "url": URL,
        "passed": passed,
        "total": len(results),
        "results": results,
        "console_errors": console_issues,
        "page_errors": page_errors,
    }
    with open(os.path.join(OUT, "report.json"), "w") as f:
        json.dump(report, f, indent=2)
    print(f"\n{passed}/{len(results)} checks passed. Report: {os.path.join(OUT, 'report.json')}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
