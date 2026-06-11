"""
Browser verification for the v3 vortex-shedding background.
Shoots bg-lab.html (desktop, two moments in time, +mobile) and index.html top,
collecting console/page errors. Server must run on :8901 (site/ root).
Usage: python dev/verify_bg.py
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

        # --- bg-lab desktop: two moments in time to confirm it animates -----
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        errors, failures = [], []
        attach(page, errors, failures)
        page.goto(f"{BASE}/bg-lab.html", wait_until="domcontentloaded")
        time.sleep(4)
        page.screenshot(path=os.path.join(SHOTS, "bg-v3-lab-t0.png"))
        # speed up time so the two shots differ visibly even at slow defaults
        page.locator("#sliders input").nth(0).evaluate(
            "el => { el.value = 6; el.dispatchEvent(new Event('input')); }")
        time.sleep(6)
        page.locator("#sliders input").nth(0).evaluate(
            "el => { el.value = 1; el.dispatchEvent(new Event('input')); }")
        time.sleep(0.5)
        page.screenshot(path=os.path.join(SHOTS, "bg-v3-lab-t1.png"))
        # text off, to see the raw field
        page.click("#textBtn")
        time.sleep(0.3)
        page.screenshot(path=os.path.join(SHOTS, "bg-v3-lab-raw.png"))
        status = page.locator("#status").inner_text()
        print(f"bg-lab desktop: status={status!r} errors={len(errors)} reqfail={len(failures)}")
        for e in errors + failures:
            bad += 1
            print("  !!", e)
        ctx.close()

        # --- bg-lab mobile ---------------------------------------------------
        ctx = browser.new_context(viewport={"width": 390, "height": 844},
                                  is_mobile=True, has_touch=True)
        page = ctx.new_page()
        errors, failures = [], []
        attach(page, errors, failures)
        page.goto(f"{BASE}/bg-lab.html", wait_until="domcontentloaded")
        time.sleep(4)
        page.screenshot(path=os.path.join(SHOTS, "bg-v3-lab-mobile.png"))
        print(f"bg-lab mobile: errors={len(errors)} reqfail={len(failures)}")
        for e in errors + failures:
            bad += 1
            print("  !!", e)
        ctx.close()

        # --- index.html top: new bg under the real hero ----------------------
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        errors, failures = [], []
        attach(page, errors, failures)
        page.goto(f"{BASE}/index.html", wait_until="domcontentloaded")
        time.sleep(5)
        page.screenshot(path=os.path.join(SHOTS, "bg-v3-index-hero.png"))
        page.evaluate("window.scrollTo(0, document.body.scrollHeight * 0.35)")
        time.sleep(2)
        page.screenshot(path=os.path.join(SHOTS, "bg-v3-index-mid.png"))
        print(f"index: errors={len(errors)} reqfail={len(failures)}")
        for e in errors + failures:
            bad += 1
            print("  !!", e)
        ctx.close()
        browser.close()

    print("\nRESULT:", "FAIL" if bad else "OK", f"({bad} problems)")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
