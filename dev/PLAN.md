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
| CI deploy (GitHub Pages) | ✅ LIVE — https://udvibin.github.io/mandatory-vibe-compliance/ (deployed 11 Jun, end-to-end verified by Uday in Brave) |
| Privacy | ✅ decided 11 Jun: publish with real first names |

## Tasks to take up

1. ~~First deploy~~ DONE 11 Jun — live at
   https://udvibin.github.io/mandatory-vibe-compliance/ ; still open:
   custom domain decision (is-a.dev subdomain or ~₹400/yr .in)
2. ~~Galaxy wheel-zoom mechanic~~ DECIDED 12 Jun — current behaviour stays
   (ctrl+wheel / pinch zooms, plain wheel scrolls). No further work.
3. **Constellation v2 redesign** — THE remaining blocker before the big
   push. Rejected as-is: overlapping labels, disconnected low-similarity
   nodes, weights unreadable. Rethink layout (label collision avoidance,
   maybe 2D, dark backdrop like the galaxy). Uday wants frontier-grade
   data-viz here.
4. ~~Nerd-view CTA~~ DONE 12 Jun — bordered `.nerd-cta` block in the outro
   ("want every chart, every table? open the nerd view →"); footer is now
   just "built with ❤️".
5. ~~Galaxy mobile loading~~ DONE 12 Jun — pipeline now stores `art_sm`
   (Spotify's 64px art) per track; mobile galaxy + fallback grid load it
   instead of the 300px art (~5x fewer bytes), texture flushes are also
   time-based (700 ms) so covers appear steadily on slow networks.
6. ~~Glass defaults~~ LOCKED 12 Jun by Uday via ?glass tuner:
   `--glass-fill:0; --glass-blur:7px; --glass-sat:160%` (pure refraction).

## Scope creep (explicitly parked — do not pick up)

- **Two more background variants** — bg-lab iteration; original task
  retired 12 Jun as scope creep.
- **Playable vinyl** — hero record that actually plays the playlist's
  songs. Glorious. Parked.
6. ~~Hero text rewrite~~ DONE 12 Jun — wordmark is now the H1:
   "Mandatory *Vibe* Compliance" (coral italic "Vibe", matching the
   section-title accent); computed stats line moved to a serif-italic
   subline; overline is just "EST. AUG 2021". Fonts kept.
7. ~~Favicon~~ DONE 12 Jun — `site/favicon.svg`, vinyl disc in the
   Currents palette (linked from index + dashboard).
8. ~~Text legibility over the background~~ DONE 12 Jun — liquid-glass
   panels (`.sec.glass` in style.css): every text section sits in a
   rounded frosted card (backdrop blur + saturate boost + bright inset
   rim, low fill so the bg stays visible); galaxy/constellation overlay
   text gets a smaller `.glass-scrim`. Falls back to near-solid panels
   under `prefers-reduced-transparency`.

## Architecture (reference)

**No live backend.** Data changes only when the bot runs (every 2 days);
GitHub Actions is the "backend", the site is fully static.

```
One-time (already run; backfill_history.py deleted 12 Jun — in git history):
  Shridhar archive ─> backfill_history.py ─> dashboard/history.json
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
- `index.html?glass` — frosted-glass tuner (fill/blur/saturate sliders,
  copy values → paste into the `--glass-*` vars in `:root` in style.css)
- `site/visuals-test.html` — isolated visuals page (?real=1 / ?mobile=1)
- `dev/verify_site.py` — full-page Playwright check (console errors, failed
  requests, screenshots per section into `dev/screens/`, gitignored)
- `dev/verify_bg.py` — background-specific screenshots/check
