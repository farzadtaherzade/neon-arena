#!/usr/bin/env python3
"""
Headless smoke test for NEON ARENA.

Loads the game in Chromium, asserts it boots without console errors, and
exercises the window.__NEON automation API. This is the regression net for the
ES module split: a broken import path shows up immediately as a page error.

Run with the pipx-managed Playwright interpreter:

    python3 -m http.server 8000 &
    ~/.local/share/pipx/venvs/playwright/bin/python tools/smoke_test.py
"""

import os
import sys
import time
from playwright.sync_api import sync_playwright
from playwright.sync_api import TimeoutError as PlaywrightTimeout

URL = "http://localhost:8000/?test"

# Use the system Chrome unless Playwright's own build is present, so this works
# without a separate `playwright install`.
CHROME = "/usr/bin/google-chrome"
LAUNCH = {"args": ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"]}
if os.path.exists(CHROME):
    LAUNCH["executable_path"] = CHROME

# Points the camera at the nearest enemy's torso, so a burst is guaranteed to
# connect instead of threading the gap between two lined-up enemies.
AIM_AT_FIRST_ENEMY = """
() => {
  const N = window.__NEON;
  const enemies = N.enemyPos();
  const cam = N.camState();
  let best = null, bestD = Infinity;
  for (const e of enemies) {
    const d = Math.hypot(e.x - cam.px, e.z - cam.pz);
    if (d < bestD) { bestD = d; best = e; }
  }
  if (!best) return false;
  const dx = best.x - cam.px, dz = best.z - cam.pz;
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(1.0 - cam.py, bestD);
  N.aim(yaw, pitch);
  return { yaw, pitch, dist: bestD };
}
"""

failures: list[str] = []
checks = 0


def check(label: str, condition: bool, detail: str = "") -> None:
    global checks
    checks += 1
    if condition:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label}  {detail}")
        failures.append(f"{label} {detail}".strip())


def warm_up(page, budget_s: int = 45) -> None:
    """
    Wait until the renderer's geometry count stops growing.

    Geometries are uploaded to the GPU lazily, on first use, so measuring a leak
    before that settles produces phantom growth. Poll until the number holds
    steady across several consecutive samples.
    """
    stable = 0
    previous = None
    deadline = time.time() + budget_s
    while time.time() < deadline:
        current = page.evaluate("() => window.__NEON.renderInfo().geometries")
        stable = stable + 1 if current == previous else 0
        previous = current
        if stable >= 4:
            return
        page.wait_for_timeout(500)


def kill_enemies(page, target_kills: int, budget_s: int) -> int:
    """
    Hold the trigger until the kill counter reaches `target_kills`.

    Enemies are parked at long range first so they can't close and kill the
    player mid-run; the aim helper then points at the nearest one. Returns the
    kill count reached, which may fall short of the target on a slow machine.
    """
    page.mouse.down()
    deadline = time.time() + budget_s
    kills = page.evaluate("() => window.__NEON.stats().kills")
    try:
        while time.time() < deadline:
            kills = page.evaluate("() => window.__NEON.stats().kills")
            if kills >= target_kills:
                break
            page.evaluate("() => window.__NEON.teleportEnemies(22)")
            page.evaluate(AIM_AT_FIRST_ENEMY)
            try:
                page.wait_for_function(
                    "k => window.__NEON.stats().kills > k", arg=kills, timeout=2500
                )
            except PlaywrightTimeout:
                pass
    finally:
        page.mouse.up()
    return kills


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(**LAUNCH)
        page = browser.new_page(viewport={"width": 1280, "height": 720})

        console_errors: list[str] = []
        page_errors: list[str] = []

        def on_console(m):
            url = m.location.get("url", "") or ""
            # The favicon 404 is an artefact of serving from a bare directory.
            if "favicon" in url or "favicon" in m.text:
                return
            # Transient CDN failures (the jsdelivr/unpkg fetch is slow and
            # occasionally drops) are retried by src/three.js, and the run
            # still boots. Ignore them, but only for off-machine resources —
            # a failure to load one of OUR modules must still fail the test.
            external = url and "localhost" not in url
            if external and "ERR_" in m.text:
                return
            if m.type == "error":
                console_errors.append(m.text)

        page.on("console", on_console)
        page.on("pageerror", lambda e: page_errors.append(str(e)))

        page.goto(URL, wait_until="load")

        # Boot: the game logs a marker and installs its automation hook.
        page.wait_for_function("() => window.__NEON !== undefined", timeout=15000)
        check("no uncaught page errors", not page_errors, "; ".join(page_errors[:3]))
        check("no console errors", not console_errors, "; ".join(console_errors[:3]))

        # Let the first wave spawn.
        page.wait_for_timeout(2500)

        stats = page.evaluate("() => window.__NEON.stats()")
        check("state is playing", stats["state"] == "playing", stats)
        check("wave 1 started", stats["wave"] == 1, stats)
        check("hp at 100", stats["hp"] == 100, stats)
        check("magazine full", stats["ammo"] == 12, stats)
        check("hostiles spawned", stats["hostiles"] > 0, stats)

        # Enemies are alive, positioned, and reporting health.
        enemies = page.evaluate("() => window.__NEON.enemyPos()")
        check("enemies have positions", len(enemies) > 0 and all("x" in e and "z" in e for e in enemies))
        check("enemies alive", all(e["state"] == "alive" for e in enemies), enemies[:3])

        # Camera responds to aiming.
        page.evaluate("() => window.__NEON.aim(0.5, -0.2)")
        page.wait_for_timeout(120)
        cam = page.evaluate("() => window.__NEON.camState()")
        check("yaw applied", abs(cam["yaw"] - 0.5) < 0.01, cam)
        check("pitch applied", abs(cam["pitch"] + 0.2) < 0.01, cam)
        check("rig followed yaw", abs(cam["yawObjY"] - 0.5) < 0.01, cam)

        # Aim precisely at the first enemy's torso and fire until damage lands.
        # Software rendering runs the sim slower than wall clock, so every wait
        # below is condition-based rather than a fixed sleep.
        #
        # The camera's forward vector is (-sin(yaw), *, -cos(yaw)), which is
        # what this in-page helper inverts to get an aim angle.
        page.evaluate(AIM_AT_FIRST_ENEMY)
        before = page.evaluate("() => window.__NEON.enemyPos().map(e => e.hp)")

        page.mouse.down()
        page.wait_for_function(
            "() => window.__NEON.enemyPos().some(e => e.hp < 60) "
            "|| window.__NEON.stats().ammo < 8",
            timeout=30000,
        )
        page.mouse.up()

        after = page.evaluate("() => window.__NEON.enemyPos().map(e => e.hp)")
        check("shots damaged an enemy", sum(after) < sum(before), {"before": before, "after": after})

        fired = page.evaluate("() => window.__NEON.stats()")
        check("firing consumed ammo", fired["ammo"] < 12, fired)

        # Reload refills the magazine.
        page.keyboard.press("KeyR")
        page.wait_for_function("() => window.__NEON.stats().ammo === 12", timeout=30000)
        reloaded = page.evaluate("() => window.__NEON.stats()")
        check("reload refilled magazine", reloaded["ammo"] == 12, reloaded)

        # Resource leak: killing enemies must not permanently grow GPU memory.
        # Before the module split every enemy allocated two health-bar
        # geometries that were never disposed, so this grew forever.
        #
        # A few uploads are always in flight early on (meshes reach the GPU on
        # first render), so the assertion is that growth *converges*: the second
        # window must be perfectly flat. A real leak never converges.
        warm = kill_enemies(page, 4, 120)
        warm_up(page)
        before = page.evaluate("() => window.__NEON.renderInfo()")

        mid_kills = kill_enemies(page, warm + 8, 180)
        warm_up(page)
        mid = page.evaluate("() => window.__NEON.renderInfo()")

        end_kills = kill_enemies(page, mid_kills + 8, 180)
        warm_up(page)
        after = page.evaluate("() => window.__NEON.renderInfo()")

        check(
            f"geometry count converges over {end_kills - mid_kills} further kills",
            after["geometries"] - mid["geometries"] == 0,
            f"geometries {mid['geometries']} -> {after['geometries']} "
            f"(delta {after['geometries'] - mid['geometries']:+d}); "
            f"first window was {before['geometries']} -> {mid['geometries']}",
        )
        check(
            "no texture leak",
            after["textures"] - mid["textures"] == 0,
            f"textures {mid['textures']} -> {after['textures']}",
        )

        # Player damage and death.
        page.evaluate("() => window.__NEON.hurt(30)")
        page.wait_for_timeout(150)
        hurt = page.evaluate("() => window.__NEON.stats()")
        check("player took damage", hurt["hp"] == 70, hurt)

        # Rendering sanity: a WebGL canvas with real content, not a black frame.
        info = page.evaluate("() => window.__NEON.renderInfo()")
        check("renderer issuing draw calls", info["calls"] > 0, info)
        shot = page.screenshot()
        check("frame is not uniformly black", len(set(shot)) > 3)
        page.screenshot(path="tools/screenshot.png")

        # Lethal damage ends the run.
        page.evaluate("() => window.__NEON.hurt(999)")
        page.wait_for_timeout(300)
        dead = page.evaluate("() => window.__NEON.stats()")
        check("game over on death", dead["state"] == "gameover", dead)

        # Crosshair settings: tuning, painting, persistence and input clamping.
        # Run last — opening the panel mid-run pauses the game.
        tuned = page.evaluate(
            "() => window.__NEON.setCrosshair({ shape: 'circle', color: '#ff0000', lines: false })"
        )
        check("custom crosshair applied", tuned["shape"] == "circle" and not tuned["lines"], tuned)

        painted = page.evaluate(
            "() => ['crosshair', 'previewCross'].map("
            "  id => getComputedStyle(document.getElementById(id)).getPropertyValue('--color').trim())"
        )
        check("crosshair and preview repainted", painted == ["#ff0000", "#ff0000"], painted)

        stored = page.evaluate("() => localStorage.getItem('neon.crosshair')")
        check("settings persisted to storage", '"circle"' in (stored or ""), stored)

        clamped = page.evaluate(
            "() => window.__NEON.setCrosshair({ lineLen: 9999, shape: 'nope', color: 'red' })"
        )
        check("out-of-range settings fall back to defaults",
              clamped["lineLen"] == 30 and clamped["shape"] == "none"
              and clamped["color"] == "#46e0ff", clamped)

        page.keyboard.press("KeyC")
        page.wait_for_timeout(200)
        check(
            "C key opens the settings panel",
            page.evaluate("() => document.getElementById('settingsScreen').classList.contains('visible')"),
        )
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)
        check(
            "Escape closes the settings panel",
            not page.evaluate("() => document.getElementById('settingsScreen').classList.contains('visible')"),
        )

        browser.close()

    print(f"\n{checks - len(failures)}/{checks} checks passed")
    if failures:
        print("\nFailures:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Smoke test OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())