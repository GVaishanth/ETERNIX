"""
Home-to-game handoff check (DEV app), against the spec:

  ENTER GAME: the camera swings to the back view over 3 s (a full turn if it is already there). The game mounts behind
  the front page. Then a translucent loading page holds for at least 3 s, with one bar per real loading step and a tick
  when each completes, and the game is revealed once the steps, the game canvas, and the hold have all finished.
  Leave (the HUD's Leave, then Leave in the confirm): the loading page shows over the game for at least 3 s, the camera
  swings back to where the page was left, and the game is taken down 3 s after the return starts.

Every change in the handoff state is logged in the page with performance.now stamps (a MutationObserver on the DOM), so
the timings do not depend on screenshot speed. The clicks are stamped by capture listeners, so Playwright's
actionability wait is excluded.

Checks:
  1. Loading page first shows at least 2900 ms after ENTER GAME (the camera swing comes first).
  2. Loading page is still up at least 2900 ms before it starts to fade (the reveal).
  3. At the reveal: 6 of 6 ticks done, and the game canvas is drawn behind the page.
  4. Before the loading page shows, the front page stage is visible (the camera is moving, the game is not).
  5. Leave: the return veil ("Back to the front page") holds at least 2900 ms before it starts to fade.
  6. Leave: the game layer is gone at least 2900 ms after the return starts.
  7. Final state: the front page is back (ENTER GAME present, no veil, no game layer, stage visible).
  8. No page errors or console errors (except the known GPU messages).

Known limits: software GL (swiftshader) runs at about 1 fps, so the page's timers are real, but frame-based motion looks
coarse. Keyboard input is not blocked under the veil.

Usage:
  python3 tools/browser-handoff.py [url] [outdir]
Defaults: url=http://localhost:5173/  outdir=browser-output/handoff
Exit code 0 when every check passes.
"""

import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

ARGS = sys.argv[1:]
URL = ARGS[0] if ARGS and ARGS[0].startswith("http") else "http://localhost:5173/"
OUT = ARGS[1] if len(ARGS) > 1 else "browser-output/handoff"
MIN_HOLD_MS = 2900
WAIT_LIMIT_S = 600
KNOWN = ("GL Driver Message", "GPU stall", "WebGL", "THREE.WebGLRenderer", "Download the React DevTools")
SAVE_KEY = "street-racer.save"
SAVE = {
    "schemaVersion": 2,
    "garage": {
        "credits": 5000,
        "selectedVehicleId": "vandal-r",
        "vehicles": {"vandal-r": {"upgrades": {"engine": 0, "transmission": 0, "tires": 0, "brakes": 0}, "paintId": "midnight"}},
    },
}

os.makedirs(OUT, exist_ok=True)
results = []
page_errors = []
console_errors = []


def check(name, passed, detail=""):
    results.append({"name": name, "passed": bool(passed), "detail": detail})
    print(("PASS " if passed else "FAIL ") + name + (" -- " + detail if detail else ""), flush=True)


# Logs each change of the handoff state. A change is a new signature; the stamp is performance.now() in the page.
OBSERVER = """
() => {
  window.__log = [];
  window.__t = { enter: null, leave: null };
  let last = '';
  const state = () => {
    const veil = document.querySelector('.ex-veil');
    const stage = document.querySelector('.ex-stage');
    const slot = document.querySelector('.ex-game-slot');
    const layer = document.querySelector('.ex-game-layer');
    const kicker = veil ? veil.querySelector('.ex-kicker') : null;
    return {
      veil: !!veil,
      veilKicker: kicker ? kicker.textContent : null,
      veilOut: !!(veil && veil.classList.contains('ex-veil-out')),
      bars: document.querySelectorAll('.ex-bar-row').length,
      ticksDone: document.querySelectorAll('.ex-bar-row.ex-row-done').length,
      stage: !!stage,
      stageHidden: !!(stage && stage.classList.contains('ex-hidden')),
      slot: !!slot,
      slotHidden: !!(slot && slot.classList.contains('ex-hidden')),
      layer: !!layer,
      gameCanvas: document.querySelectorAll('.ex-game-layer canvas').length,
      pointer: layer ? getComputedStyle(layer).pointerEvents : 'absent',
      enterButton: !!document.querySelector('.ex-entry .ex-btn-primary'),
      root: document.querySelector('.ex-root') ? document.querySelector('.ex-root').className : '',
    };
  };
  const record = () => {
    const now = performance.now();
    const s = state();
    const key = JSON.stringify(s);
    if (key === last) return;
    last = key;
    window.__log.push(Object.assign({ t: Math.round(now) }, s));
  };
  document.addEventListener('click', (event) => {
    const button = event.target && event.target.closest ? event.target.closest('button') : null;
    if (!button) return;
    if (button.textContent.includes('ENTER GAME') && window.__t.enter === null) window.__t.enter = performance.now();
    if (button.textContent.trim() === 'Leave' && window.__t.leave === null) window.__t.leave = performance.now();
  }, true);
  new MutationObserver(record).observe(document.body, {
    subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'],
  });
  record();
  return true;
}
"""


def wait_for(page, script, name, timeout_s=WAIT_LIMIT_S):
    try:
        page.wait_for_function(script, timeout=timeout_s * 1000, polling=250)
    except Exception as error:  # noqa: BLE001 - reported as a failed check, not a crash
        check(f"reached: {name}", False, str(error).splitlines()[0][:200])
        return False
    return True


def first(log, predicate, after=0):
    for entry in log:
        if entry["t"] >= after and predicate(entry):
            return entry
    return None


def snap(page, name):
    page.screenshot(path=os.path.join(OUT, name), timeout=180000)
    print(f"screenshot {name}", flush=True)


with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
    context = browser.new_context(viewport={"width": 1280, "height": 760}, timezone_id="Asia/Kolkata")
    context.add_init_script(f"if (!localStorage.getItem('{SAVE_KEY}')) localStorage.setItem('{SAVE_KEY}', {json.dumps(json.dumps(SAVE))});")
    page = context.new_page()
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.on(
        "console",
        lambda message: console_errors.append(message.text)
        if message.type == "error" and not any(k in message.text for k in KNOWN)
        else None,
    )
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_selector("canvas", timeout=90000)
    page.wait_for_function("() => document.querySelector('canvas') && document.querySelector('canvas').width > 0", timeout=90000)
    time.sleep(4)
    page.evaluate(OBSERVER)

    # ---- Forward: ENTER GAME ----
    page.get_by_role("button", name="ENTER GAME").click()
    wait_for(page, "() => window.__log.some((e) => e.veil)", "loading page appears")
    time.sleep(0.5)
    snap(page, "handoff-loading.png")
    wait_for(page, "() => window.__log.some((e) => e.veilOut && e.veil)", "loading page starts to fade")
    time.sleep(0.5)
    wait_for(page, "() => document.querySelectorAll('.ex-game-layer canvas').length > 0 && document.querySelector('.ex-entry .ex-btn-primary') === null", "game on screen, landing hidden")

    # ---- Game: take a look, then Leave ----
    wait_for(page, "() => !!document.querySelector('button[aria-label=\"Leave to the front page\"]')", "game HUD leave button")
    time.sleep(2)
    page.get_by_role("button", name="Leave to the front page").click()
    page.get_by_role("button", name="Leave", exact=True).click()
    wait_for(page, "() => window.__log.some((e) => e.veilKicker === 'Back to the front page')", "return loading page appears")
    time.sleep(0.5)
    snap(page, "handoff-leave.png")
    wait_for(page, "() => window.__log.some((e) => e.veilKicker === 'Back to the front page' && e.veilOut)", "return veil starts to fade")
    time.sleep(1.0)
    snap(page, "handoff-return.png")
    wait_for(page, "() => !document.querySelector('.ex-game-layer') && !document.querySelector('.ex-veil') && !!document.querySelector('.ex-entry .ex-btn-primary')", "front page back, game gone")
    time.sleep(1.0)
    snap(page, "handoff-final.png")
    time.sleep(0.5)

    log = page.evaluate("() => window.__log")
    timing = page.evaluate("() => window.__t")
    final = page.evaluate(
        """() => ({
          veil: !!document.querySelector('.ex-veil'),
          stage: !!document.querySelector('.ex-stage'),
          stageHidden: !!(document.querySelector('.ex-stage') && document.querySelector('.ex-stage').classList.contains('ex-hidden')),
          game: document.querySelectorAll('.ex-game-layer').length,
          enterButton: !!document.querySelector('.ex-entry .ex-btn-primary'),
        })"""
    )
    browser.close()

enter = timing.get("enter")
leave = timing.get("leave")
veil_in = first(log, lambda e: e["veil"] and not e["veilOut"] and e.get("veilKicker") != "Back to the front page", enter or 0)
veil_out = first(log, lambda e: e["veilOut"] and e.get("veilKicker") != "Back to the front page", enter or 0)
reveal_stage_hidden = veil_in and veil_in["stageHidden"]
before_veil = [e for e in log if enter is not None and e["t"] >= enter and veil_in is not None and e["t"] < veil_in["t"]]
stage_visible_before = bool(before_veil) and any(not e["stageHidden"] and e["stage"] for e in before_veil)
return_in = first(log, lambda e: e.get("veilKicker") == "Back to the front page" and not e["veilOut"], leave or 0)
return_out = first(log, lambda e: e.get("veilKicker") == "Back to the front page" and e["veilOut"], leave or 0)
game_gone = first(log, lambda e: not e["layer"], return_out["t"] if return_out else 0)

shown_ms = (veil_in["t"] - enter) if (veil_in and enter is not None) else None
hold_ms = (veil_out["t"] - veil_in["t"]) if (veil_in and veil_out) else None
ticks_at_reveal = veil_out["ticksDone"] if veil_out else None
bars_at_reveal = veil_out["bars"] if veil_out else None
canvas_at_reveal = veil_out["gameCanvas"] if veil_out else None
return_hold_ms = (return_out["t"] - return_in["t"]) if (return_in and return_out) else None
gone_ms = (game_gone["t"] - return_out["t"]) if (game_gone and return_out) else None

check(
    "loading page first shows at least 2900 ms after ENTER GAME",
    shown_ms is not None and shown_ms >= MIN_HOLD_MS,
    f"shown_after_ms={shown_ms and round(shown_ms)}",
)
check(
    "loading page held at least 2900 ms before it starts to fade",
    hold_ms is not None and hold_ms >= MIN_HOLD_MS,
    f"held_ms={hold_ms and round(hold_ms)}",
)
check(
    "at the reveal: all bars and ticks complete, and the game canvas is drawn behind the page",
    ticks_at_reveal is not None and bars_at_reveal and ticks_at_reveal == bars_at_reveal == 6 and (canvas_at_reveal or 0) > 0,
    f"ticks={ticks_at_reveal}/{bars_at_reveal} canvas={canvas_at_reveal}",
)
check(
    "front page stage visible during the camera swing (before the loading page)",
    stage_visible_before,
    f"entries_before_veil={len(before_veil)}",
)
check(
    "leave: return loading page holds at least 2900 ms before it starts to fade",
    return_hold_ms is not None and return_hold_ms >= MIN_HOLD_MS,
    f"return_held_ms={return_hold_ms and round(return_hold_ms)}",
)
check(
    "leave: game layer gone at least 2900 ms after the return starts",
    gone_ms is not None and gone_ms >= MIN_HOLD_MS,
    f"gone_after_return_ms={gone_ms and round(gone_ms)}",
)
check(
    "final state: front page back (ENTER GAME present, no veil, no game layer, stage visible)",
    final.get("enterButton") is True and final.get("veil") is False and final.get("game") == 0 and final.get("stage") is True and final.get("stageHidden") is False,
    json.dumps(final),
)
check("no page errors", not page_errors, "; ".join(page_errors)[:300])
check("no console errors", not console_errors, "; ".join(console_errors)[:300])

passed = all(r["passed"] for r in results)
report = {
    "url": URL,
    "click_to_veil_ms": shown_ms,
    "veil_hold_ms": hold_ms,
    "return_hold_ms": return_hold_ms,
    "return_to_game_gone_ms": gone_ms,
    "ticks_at_reveal": ticks_at_reveal,
    "canvas_at_reveal": canvas_at_reveal,
    "final": final,
    "stamps": timing,
    "log": log,
    "results": results,
}
with open(os.path.join(OUT, "handoff_report.json"), "w") as handle:
    json.dump(report, handle, indent=2)
print(f"{sum(r['passed'] for r in results)}/{len(results)} PASS", flush=True)
sys.exit(0 if passed else 1)
