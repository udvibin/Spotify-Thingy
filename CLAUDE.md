# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Two things built on the same WhatsApp group-chat export ("Mandatory Vibe Compliance"):

1. **Sync bot** (`scripts/spotify.py`) — pulls the chat export ZIP from Google Drive, extracts Spotify/Apple Music track links, and syncs a Spotify playlist.
2. **Stats site** (`site/`) — a fully static "Spotify Wrapped but with the bois" page deployed to GitHub Pages, fed by `site/data.json` which `dashboard/generate.py` produces from the same chat data.

Both run in one GitHub Actions job (`.github/workflows/spotify-automation.yaml`) every 2 days; the job commits logs/caches/data.json back to main and deploys `site/` to Pages. There is no backend — Actions is the backend.

`dev/PLAN.md` is the living plan/status doc with hard-won gotchas — read it before touching the pipeline or site, and keep it updated.

## Rules

- **Never `git commit` or `git push` unless Uday explicitly asks.** He pushes manually. (CI also commits to main, so local commits can conflict.)
- Privacy invariant: **no raw chat text ever enters git or the site** — only timestamps, sender names, and track URIs. `history.json`, `resolution_cache.json`, and `data.json` are committed; the chat export itself never is.
- Don't blow away `dashboard/resolution_cache.json` — entries are hand-pinned so re-shares/version variants resolve to the playlist's exact URI (chat data = playlist, 1:1).

## Commands

Local venv at `./venv` (Windows). `.env` in the repo root holds the Spotify/Drive credentials both Python entry points need.

```bash
./venv/Scripts/python.exe dashboard/generate.py   # regenerate site/data.json (Drive + Spotify auth required)
./venv/Scripts/python.exe scripts/spotify.py      # run the playlist sync bot (careful: touches the real playlist)

# Site dev — no build step, but fetch() needs a server:
cd site && python -m http.server 8901
# http://localhost:8901/               story page (index.html)
# http://localhost:8901/dashboard.html nerd view (Chart.js, year filters)
# http://localhost:8901/bg-lab.html    background shader tuning lab
# http://localhost:8901/visuals-test.html  isolated visuals (?real=1 / ?mobile=1)

# Verification (the only "tests" — Playwright; server must already be on :8901):
python dev/verify_site.py   # full scroll-through, console errors, failed requests, screenshots → dev/screens/
python dev/verify_bg.py     # background-specific checks
```

There is no linter or unit test suite. Use `PYTHONIOENCODING=utf-8` if console output mangles non-ASCII track names.

## Architecture

### Data pipeline (Python)

`scripts/spotify.py` is both the bot **and** a library: `dashboard/generate.py` does `import spotify as bot` (via `sys.path` insert) to reuse Drive auth, ZIP extraction, Apple Music HTML scraping, and Spotify search. Changes to those functions affect both consumers.

Pipeline in `generate.py`:
1. Load committed `dashboard/history.json` (one-time backfill from an old archive; the backfill script was deleted 2026-06-12 and lives in git history).
2. Download the current export ZIP from Drive, parse with `dashboard/common.py`.
3. Splice: history covers everything before the new export's first message — no fuzzy dedup.
4. Resolve every link to a track URI through `resolution_cache.json` (re-runs make ~zero API calls).
5. Fetch track/artist metadata for anything new, crunch stats, write `site/data.json` (~350 KB).

`dashboard/common.py` holds the chat parsers (two WhatsApp export formats), `NAME_MAP` (reconciles different contact names for the same people across the two source phones), and `DISPLAY_NAMES` (public-facing names; edit + regenerate to change the site).

Sync bot behavior is gated by `ENABLE_DESTRUCTIVE_SYNC`: `false` (default, CI) = append-only; `true` = full chronological reorder.

### Site (static, no build)

ES modules + import maps, all pinned to jsdelivr CDN (three, gsap, chart.js). `site/js/app.js` is the orchestrator: loads `data.json`, inits each section in isolation (one section's error never kills the page), and lazily mounts WebGL visuals via `lazyVisual()` — every visual has a CSS fallback and respects reduced-motion. Sections live in `site/js/sections/`, their heavy visuals in `site/js/visuals/`. The background shader's tuned params are locked as `BG_DEFAULTS` in `visuals/fractal-bg.js`.

### Gotchas (don't relearn — full list in dev/PLAN.md)

- The old archive was exported on a UK phone: timestamps are Europe/London and were converted to IST during backfill. Current exports are already IST.
- Track dedup normalizes version suffixes ("- 2014 Remaster") but keeps deliberate remixes distinct — `normalize_track_detail()` in `scripts/spotify.py`, validated against all known historical pairs.
- Spotify audio features (energy/valence) are deprecated for new apps; mood stats were skipped by design.
- Headless Chromium delivers popups erratically — verify scripts assert the `window.open` invocation rather than waiting for a popup page.
- Permanently dead Apple links are cached in `apple_link_failures.json`; delete an entry to retry it.
