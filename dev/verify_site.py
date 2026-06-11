"""
Browser verification for the story page. Loads index.html (desktop + mobile)
and visuals-test.html, scrolls through everything to trigger lazy inits,
collects console errors / page errors / failed requests, screenshots sections.
Usage: python dev/verify_site.py [url-path]   (server must run on :8901)
"""
import os
import sys
import time

from playwright.sync_api import sync_playwright

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

BASE = "http://localhost:8901"
HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, "screens")
os.makedirs(SHOTS, exist_ok=True)


def attach_collectors(page, errors, failures):
    page.on("console", lambda m: errors.append(f"[console.{m.type}] {m.text}")
            if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))
    page.on("requestfailed", lambda r: failures.append(
        f"[reqfail] {r.url} :: {r.failure}"))


def scroll_through(page, steps=16, pause=0.7):
    height = page.evaluate("document.body.scrollHeight")
    for i in range(steps + 1):
        page.evaluate(f"window.scrollTo(0, {int(height * i / steps)})")
        time.sleep(pause)
    page.evaluate("window.scrollTo(0, 0)")
    time.sleep(0.5)


def shoot_sections(page, tag, ids):
    page.screenshot(path=os.path.join(SHOTS, f"{tag}-top.png"))
    for sid in ids:
        el = page.locator(f"#{sid}")
        if el.count() == 0:
            print(f"  !! section #{sid} not found")
            continue
        el.first.scroll_into_view_if_needed()
        time.sleep(1.6)
        page.screenshot(path=os.path.join(SHOTS, f"{tag}-{sid}.png"))


def run(pw, tag, viewport, url, ids, mobile=False):
    print(f"\n=== {tag}: {url} @ {viewport['width']}x{viewport['height']} ===")
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport=viewport, device_scale_factor=2,
                              is_mobile=mobile, has_touch=mobile)
    page = ctx.new_page()
    errors, failures = [], []
    attach_collectors(page, errors, failures)
    page.goto(f"{BASE}/{url}", wait_until="domcontentloaded")
    time.sleep(4)  # loader + first visuals
    scroll_through(page)
    shoot_sections(page, tag, ids)
    print(f"  console/page errors: {len(errors)}")
    for e in errors[:30]:
        print(f"    {e[:300]}")
    print(f"  failed requests: {len(failures)}")
    for f in failures[:15]:
        print(f"    {f[:300]}")
    browser.close()


SECTION_IDS = ["hero", "numbers", "galaxy", "leaderboard", "bois",
               "bangers", "constellation", "timeline", "trendsetters",
               "outro"]

with sync_playwright() as pw:
    run(pw, "desktop", {"width": 1440, "height": 900}, "index.html", SECTION_IDS)
    run(pw, "mobile", {"width": 390, "height": 844}, "index.html", SECTION_IDS,
        mobile=True)
    run(pw, "vistest", {"width": 1440, "height": 900},
        "visuals-test.html?real=1", [])
print(f"\nScreenshots in {SHOTS}")
