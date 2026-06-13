"""
Browser verification for the two constellation-v2 candidate mocks
(genre nebulae + time machine) on mocks.html.
Shoots overview, person-focus and hover states. Server must run on :8901.
Usage: python dev/verify_mocks.py
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


def attach(page, errors, failures):
    page.on("console", lambda m: errors.append(f"[console.{m.type}] {m.text}")
            if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))
    page.on("requestfailed", lambda r: failures.append(f"[reqfail] {r.url} :: {r.failure}"))


def main():
    bad = 0
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--use-gl=angle"])
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        errors, failures = [], []
        attach(page, errors, failures)

        page.goto(f"{BASE}/mocks.html", wait_until="domcontentloaded")
        time.sleep(5)
        status = page.locator("#status").inner_text()
        print(f"status: {status!r}")

        # ── nebulae: overview ───────────────────────────────────────────────
        page.screenshot(path=os.path.join(SHOTS, "mock-nebulae-all.png"))

        # focus a person via chip (first chip in the nebulae section)
        neb_chips = page.locator("#nebulae button")
        n_chips = neb_chips.count()
        print(f"nebulae chips: {n_chips}")
        if n_chips:
            neb_chips.nth(0).click()
            time.sleep(1.5)
            page.screenshot(path=os.path.join(SHOTS, "mock-nebulae-focus.png"))
            neb_chips.nth(0).click()
            time.sleep(0.5)

        # hover middle of the canvas to try for a star tooltip
        page.mouse.move(720, 430)
        time.sleep(0.4)
        page.mouse.move(700, 400, steps=8)
        time.sleep(0.6)
        page.screenshot(path=os.path.join(SHOTS, "mock-nebulae-hover.png"))

        # ── time machine ───────────────────────────────────────────────────
        page.evaluate("document.getElementById('timemachine-sec').scrollIntoView()")
        time.sleep(1.5)
        page.screenshot(path=os.path.join(SHOTS, "mock-timemachine-all.png"))

        tm_chips = page.locator("#timemachine button")
        n_tm = tm_chips.count()
        print(f"timemachine chips: {n_tm}")
        if n_tm:
            tm_chips.nth(0).click()
            time.sleep(0.8)
            page.screenshot(path=os.path.join(SHOTS, "mock-timemachine-focus.png"))
            tm_chips.nth(0).click()

        # hover for tooltip
        page.mouse.move(900, 300, steps=6)
        time.sleep(0.5)
        page.screenshot(path=os.path.join(SHOTS, "mock-timemachine-hover.png"))

        print(f"errors={len(errors)} reqfail={len(failures)}")
        for e in errors + failures:
            bad += 1
            print("  !!", e)

        # ── mobile pass ────────────────────────────────────────────────────
        mctx = browser.new_context(viewport={"width": 390, "height": 844},
                                   is_mobile=True, has_touch=True)
        mpage = mctx.new_page()
        merr, mfail = [], []
        attach(mpage, merr, mfail)
        mpage.goto(f"{BASE}/mocks.html?mobile=1", wait_until="domcontentloaded")
        time.sleep(5)
        mpage.screenshot(path=os.path.join(SHOTS, "mock-nebulae-mobile.png"))
        mpage.evaluate("document.getElementById('timemachine-sec').scrollIntoView()")
        time.sleep(1.5)
        mpage.screenshot(path=os.path.join(SHOTS, "mock-timemachine-mobile.png"))
        print(f"mobile: errors={len(merr)} reqfail={len(mfail)}")
        for e in merr + mfail:
            bad += 1
            print("  !!", e)
        mctx.close()
        ctx.close()
        browser.close()

    print("FAIL" if bad else "PASS")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
