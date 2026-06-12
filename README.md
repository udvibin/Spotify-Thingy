# Mandatory Vibe Compliance

One group chat, four-plus years of songs. This repo keeps it all alive, for free:

1. **Playlist sync bot** — a GitHub Actions workflow that syncs a Spotify
   playlist with every music link shared in a WhatsApp chat (export ZIP in
   Google Drive).
2. **The site** — a "Spotify Wrapped but with the bois" stats experience
   generated from the same chat data and deployed to GitHub Pages.

## The Site

Fully static, no build step (ES modules + CDN import maps: Three.js, GSAP,
Chart.js). Two pages:

- **`site/index.html`** — the story: WebGL vortex-shedding background,
  spinning vinyl hero, a 3D galaxy of all 951 album covers (click any cover
  to open it on Spotify), leaderboards, per-boi wrapped cards, crossover
  bangers, timeline, trendsetters.
- **`site/dashboard.html`** — the nerd view: every chart and table, year
  filters, no theatrics.

Data pipeline (`dashboard/`): `generate.py` merges the committed chat history
(`history.json`) with the live Drive export, resolves every Spotify/Apple
link to a track URI (cached in `resolution_cache.json` → re-runs make ~zero
API calls), pulls track/artist metadata, and writes `site/data.json`. Runs in
the same Actions job as the playlist sync, then deploys `site/` via
`actions/deploy-pages`. No message text ever enters the repo or the site —
only timestamps, sender names, and track URIs.

Local dev:

```bash
cd site && python -m http.server 8901   # fetch() needs a server, file:// won't work
# http://localhost:8901/            the story
# http://localhost:8901/dashboard.html  the nerd view
# http://localhost:8901/bg-lab.html     background shader tuning lab
```

## The Sync Bot

1. **Fetches** the latest WhatsApp chat export (ZIP) from a Google Drive folder
2. **Extracts** Spotify and Apple Music track links from the chat text file
3. **Converts** Apple Music links to Spotify tracks via HTML scraping + search
4. **Syncs** the Spotify playlist based on the selected mode

### Sync Modes

- **Append-only (default,** `ENABLE_DESTRUCTIVE_SYNC=false`**)** — only adds
  new songs to the end; never reorders or re-adds; safe for manual curation.
- **Destructive (**`ENABLE_DESTRUCTIVE_SYNC=true`**)** — reorders the playlist
  to match the chat exactly in chronological order, re-adds manual deletions.

### Supported Links

| Platform | Link Type | Support |
|----------|-----------|---------|
| Spotify | Track URLs | ✅ Full support |
| Apple Music | Song URLs | ✅ Via HTML scraping |
| Apple Music | Album URLs with `?i=` track param | ✅ Via HTML scraping |
| Apple Music | Playlist URLs | ❌ Not supported |

### Features

- **Chronological order** — preserves the order songs were shared in chat
- **Duplicate prevention** — each track appears once, even when shared as both
  Spotify and Apple links or as different album versions of the same recording
  (version suffixes like "- 2014 Remaster" are normalized; deliberate remixes
  stay distinct)
- **Confidence matching** — Apple → Spotify conversion validates track/artist
  to avoid wrong songs
- **Apple failure cache** — permanently dead Apple links are cached in
  `apple_link_failures.json` and skipped; delete an entry to retry it
- **Rolling log** — one summary line per run, pruned after 90 days
- **Stale export warning** — warns when the Drive export is older than 10 days
- **Safe aborts** — if the playlist can't be fetched, the run aborts instead of
  re-adding everything as duplicates

## Setup

### 1. Google Cloud (Drive access)

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/)
2. Enable the **Google Drive API**
3. Create a **Service Account** and download the JSON key
4. Share the Drive folder with the service account email

### 2. Spotify Developer

1. Create an app at the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Set a Redirect URI (e.g. `http://localhost:8888/callback`)
3. Note the Client ID and Secret

### 3. Spotify token cache

Run locally once to authenticate, then copy `.spotifycache` contents into the
`SPOTIPY_CACHE_CONTENT` secret:

```bash
pip install -r requirements.txt
python scripts/spotify.py
```

### 4. GitHub Secrets & Variables

**Secrets:**
| Name | Description |
|------|-------------|
| `GOOGLE_APPLICATION_CREDENTIALS_CONTENT` | Full JSON of the service account key |
| `SPOTIPY_CLIENT_ID` / `SPOTIPY_CLIENT_SECRET` / `SPOTIPY_REDIRECT_URI` | Spotify app credentials |
| `SPOTIPY_CACHE_CONTENT` | Contents of `.spotifycache` |
| `TARGET_PLAYLIST_ID` | Spotify playlist ID |

**Variables:**
| Name | Description |
|------|-------------|
| `GOOGLE_DRIVE_INPUT_FOLDER_ID` | Drive folder ID containing the ZIP |
| `TARGET_DRIVE_ARCHIVE_FILENAME` | ZIP filename (optional, has default) |
| `ENABLE_DESTRUCTIVE_SYNC` | `true` for full sync, `false` for append-only |

### 5. GitHub Pages

Repo → Settings → Pages → Source = **GitHub Actions**. The sync workflow
regenerates `site/data.json` and deploys `site/` on every run (every 2 days,
or trigger it manually via *Run workflow*).

## Directory Structure

```
.github/workflows/
  spotify-automation.yaml   # sync + generate + Pages deploy (every 2 days)
scripts/
  spotify.py                # the sync bot
dashboard/
  common.py                 # chat parser, NAME_MAP / DISPLAY_NAMES
  generate.py               # history + live export -> site/data.json
  history.json              # committed derived history (ts, sender, uri)
  resolution_cache.json     # link->URI + metadata cache (committed)
site/                       # the static site (deployed to Pages)
dev/                        # plan + Playwright verify scripts
spotify_bot_log.txt         # run history (rolling 90 days)
apple_link_failures.json    # permanently failed Apple links
```

## Log Format

One summary line per run (doubles as a heartbeat so GitHub never auto-disables
the schedule):

```
[2026-06-10 13:00:00 IST] 5 songs added: Song1 by Artist1, Song2 by Artist2 (+3 more) | Issues: 4 Apple links failed
[2026-06-10 13:00:00 IST] No new songs added (all found songs already in playlist).
```

## Troubleshooting

| Error | Solution |
|-------|----------|
| Google Drive authentication failure | Check `GOOGLE_APPLICATION_CREDENTIALS_CONTENT` is valid JSON |
| Spotify authentication failure | Verify credentials; regenerate `.spotifycache` if expired |
| `403: Active premium subscription required` | The app owner's Premium lapsed; runs resume after renewal |
| Target chat archive not found | Check folder ID and filename |
| Apple Music links failing | Normal for removed/region-locked songs and playlists |
| Apple link wrongly cached as failed | Delete its entry from `apple_link_failures.json` to retry |
| "Chat export is N days old" warning | Re-export the chat and upload the ZIP to Drive |
