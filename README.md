# WhatsApp → Spotify Playlist Sync

A GitHub Actions workflow that automatically syncs a Spotify playlist with music links found in a WhatsApp chat export (ZIP file from Google Drive).

## How It Works

1. **Fetches** the latest WhatsApp chat export (ZIP) from a Google Drive folder
2. **Extracts** Spotify and Apple Music track links from the chat text file
3. **Converts** Apple Music links to Spotify tracks via HTML scraping + search
4. **Syncs** your Spotify playlist based on the selected mode

## Sync Modes

### Append-Only Mode (default)
- Only adds **new** songs to the **end** of the playlist
- Does NOT reorder existing songs
- Safe for manual playlist curation
- Set `ENABLE_DESTRUCTIVE_SYNC=false` (or omit)

### Destructive Sync Mode
- Reorders playlist to match chat **exactly** in chronological order
- Re-adds manually deleted songs
- Inserts older songs at correct chronological positions
- Set `ENABLE_DESTRUCTIVE_SYNC=true`

## Supported Links

| Platform | Link Type | Support |
|----------|-----------|---------|
| Spotify | Track URLs | ✅ Full support |
| Apple Music | Song URLs | ✅ Via HTML scraping |
| Apple Music | Album URLs with `?i=` track param | ✅ Via HTML scraping |
| Apple Music | Playlist URLs | ❌ Not supported |

## Features

- **Chronological Order**: Preserves the order songs were shared in chat
- **Duplicate Prevention**: Each track appears only once (even if shared as both Spotify and Apple Music links)
- **Confidence Matching**: Apple Music → Spotify conversion validates track/artist match to avoid wrong songs
- **Clean Logging**: Single-line log entries with song count and issue summary
- **GitHub Actions Ready**: Runs on schedule or manually

## Setup

### 1. Google Cloud (for Google Drive access)

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/)
2. Enable the **Google Drive API**
3. Create a **Service Account**
4. Download the JSON key file
5. Share the Drive folder with the Service Account email

### 2. Spotify Developer Setup

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create an app
3. Set the **Redirect URI** (e.g., `http://localhost:8888/callback`)
4. Get your Client ID and Secret

### 3. Get Spotify Token Cache

Run locally once to authenticate:

```bash
pip install -r requirements.txt
python scripts/spotify.py
```

After browser auth, copy `.spotifycache` contents to `SPOTIPY_CACHE_CONTENT` secret.

### 4. GitHub Secrets & Variables

**Secrets:**
| Name | Description |
|------|-------------|
| `GOOGLE_APPLICATION_CREDENTIALS_CONTENT` | Full JSON of service account key |
| `SPOTIPY_CLIENT_ID` | Spotify app Client ID |
| `SPOTIPY_CLIENT_SECRET` | Spotify app Client Secret |
| `SPOTIPY_REDIRECT_URI` | Spotify redirect URI |
| `SPOTIPY_CACHE_CONTENT` | Contents of `.spotifycache` file |
| `TARGET_PLAYLIST_ID` | Spotify playlist ID (from URL) |

**Variables:**
| Name | Description |
|------|-------------|
| `GOOGLE_DRIVE_INPUT_FOLDER_ID` | Drive folder ID containing the ZIP |
| `TARGET_DRIVE_ARCHIVE_FILENAME` | ZIP filename (optional, has default) |
| `ENABLE_DESTRUCTIVE_SYNC` | `true` for full sync, `false` for append-only |

## Log Format

[2026-01-31 13:00:00 IST] 5 songs added: Song1 by Artist1, Song2 by Artist2 (+3 more) | Issues: 4 Apple links failed

When no new songs but issues exist:

[2026-01-31 13:00:00 IST] No new songs added | 4 Apple links failed

Silent (no log entry) when nothing to add and no issues.

## Directory Structure

├── .github/workflows/

│   └── spotify-automation.yaml   # GitHub Actions workflow

├── scripts/

│   └── spotify.py                # Main script

├── requirements.txt              # Python dependencies

├── .gitignore

├── .spotifycache                 # Generated locally (gitignored)

├── spotify_bot_log.txt           # Run history log

└── README.md


## Troubleshooting

| Error | Solution |
|-------|----------|
| Google Drive authentication failure | Check `GOOGLE_APPLICATION_CREDENTIALS_CONTENT` is valid JSON |
| Spotify authentication failure | Verify credentials; regenerate `.spotifycache` if expired |
| Target chat archive not found | Check folder ID and filename match |
| Apple Music links failing | Normal for removed songs, playlists, or region-locked content |

## License

MIT