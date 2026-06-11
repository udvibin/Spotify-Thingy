# Vibe Compliance Dashboard — Plan

"Spotify Wrapped but with the bois." A stats site for the Mandatory Vibe
Compliance group chat, generated from the same chat exports the sync bot
already uses. Everything free: Spotify Web API, Drive API, Actions, Pages.

## Current status (2026-06-11)

| Piece | State |
|---|---|
| Data pipeline (`dashboard/`) | ✅ done — 987 shares, 951 unique tracks, 13 sharers, Aug 2021 → Jun 2026 |
| Playlist reconciliation | ✅ zero-delta: 951 chat tracks = 951 playlist tracks, every historical mismatch explained & pinned in `resolution_cache.json` |
| Story page (`site/index.html`) | ✅ built + 3 review rounds of polish |
| Nerd view (`site/dashboard.html`) | ✅ done (Chart.js, year filters, instant tooltips) |
| Background (vortex-shedding shader) | ✅ finalized with Uday; his params locked as `BG_DEFAULTS` in `fractal-bg.js` |
| CI deploy (GitHub Pages) | ✅ wired in `spotify-automation.yaml` — first run pending |
| Privacy | ✅ decided 11 Jun: publish with real first names |

## Tasks to take up

1. **First deploy** — Uday commits + pushes, then:
   - repo → public; Settings → Pages → Source = "GitHub Actions"
   - run the workflow (workflow_dispatch) → site at `https://udvibin.github.io/<repo>/`
   - custom domain later (is-a.dev subdomain or ~₹400/yr .in)
2. **Galaxy wheel-zoom mechanic** — decide WITH Uday, then implement.
   Candidates: zoom while a toggle/modifier is active; "click to enter" zoom
   mode over the canvas; scroll-jacked pinned zoom segment. (Currently:
   ctrl+wheel / pinch zooms, plain wheel scrolls the page.)
3. **Two more background variants** — AFTER publish. Iterate in
   `site/bg-lab.html` (sliders for all shader params, "copy params" button);
   `initFractalBg` API stays, swap/extend the shader behind it.
4. **Constellation v2 redesign** — rejected as-is: overlapping labels,
   disconnected low-similarity nodes, weights unreadable. Rethink layout
   (label collision avoidance, maybe 2D, dark backdrop like the galaxy).
5. **Nerd-view CTA** — outro link to dashboard.html is too easy to miss;
   make it a proper bordered call-to-action block.
6. **Hero text rewrite** — current line kept for now; brainstorm openers
   with Uday someday. Font (Fraunces + Space Grotesk) also kept.

## Architecture (reference)

**No live backend.** Data changes only when the bot runs (every 2 days);
GitHub Actions is the "backend", the site is fully static.

```
One-time (already run locally):
  Shridhar archive ─> dashboard/backfill_history.py ─> dashboard/history.json
  (only ts / sender / track-URI committed; raw chat text never enters git)

Every 2 days (GitHub Actions, same job as the playlist sync):
  scripts/spotify.py            # sync playlist (existing bot)
  dashboard/generate.py         # merge history + live Drive export,
    │                           # resolve links (resolution_cache.json ≈ 0 API
    │                           # calls/run), crunch stats
    └─> site/data.json  ─> upload-pages-artifact ─> deploy-pages
  (log + cache + data.json committed back to the repo each run)
```

**Frontend:** no build step — ES modules + import maps, all pinned jsdelivr
CDN: three@0.165.0, gsap@3.12.5, chart.js@4.4.3. Two pages: `index.html`
(scrollytelling story) and `dashboard.html` (nerd view). Every visual has a
CSS fallback; reduced-motion respected; mobile caps DPR/texture counts.

**data.json schema:** normalized around `tracks` (URI → metadata +
`shared_by`), plus precomputed `people` / `years` / `timeline` /
`similarity` / `trendsetters` / `facts`. Crossovers and re-shares are
derived client-side from `tracks.shared_by`. ~350 KB raw.

## Gotchas & decisions (hard-won, don't relearn)

- **Shridhar archive is in UK time** (exported on his phone) — timestamps
  converted Europe/London → IST in backfill (validated on overlap).
- The two phones use different contact names for the same people:
  `NAME_MAP` in `dashboard/common.py` reconciles; `DISPLAY_NAMES` controls
  public names (currently first names) — edit + regenerate to change.
- Both WhatsApp export formats handled (old `DD/MM/YYYY, HH:MM` and new
  `DD/MM/YY, h:mm am/pm`).
- `resolution_cache.json` is **pinned** in places: re-shares/version variants
  resolve to the playlist's URI so chat data and playlist agree 1:1. Don't
  blow the cache away.
- Spotify audio features (energy/valence) are deprecated for new apps —
  mood features were skipped by design.
- Bot dedup normalizes version suffixes ("- 2014 Remaster" etc.) but keeps
  deliberate different recordings ("- southstar remix") distinct —
  `normalize_track_detail()` in `scripts/spotify.py`, tested against all
  known historical pairs.
- **Headless Chromium delivers popups erratically** (even from real button
  clicks) — verify scripts assert the `window.open` invocation instead of
  waiting for a popup page. Real-browser link behavior was verified headed.
- Galaxy links bug (v3): the section never passed `uri` into the visual's
  items — if links die again, check the data plumbing before blaming popups.

## Dev tooling

- `cd site && python -m http.server 8901` → http://localhost:8901/
- `site/bg-lab.html` — background tuning lab (all params live, copy-params)
- `site/visuals-test.html` — isolated visuals page (?real=1 / ?mobile=1)
- `dev/verify_site.py` — full-page Playwright check (console errors, failed
  requests, screenshots per section into `dev/screens/`, gitignored)
- `dev/verify_bg.py` — background-specific screenshots/check
