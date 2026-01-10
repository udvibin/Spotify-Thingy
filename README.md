# WhatsApp → Spotify Playlist Sync

A GitHub Actions workflow that automatically syncs a Spotify playlist with Spotify links found in a WhatsApp chat export (ZIP file from Google Drive).

## How It Works

1. **Fetches** the latest WhatsApp chat export (ZIP) from a Google Drive folder
2. **Extracts** Spotify track links from the chat text file inside the ZIP
3. **Syncs** your Spotify playlist to match the chat exactly in chronological order:
   - If you manually delete a song from the playlist, the script brings it back
   - If you add older chat exports (e.g., 2022 songs), they get inserted at the correct chronological position
4. **Logs** the result with a timestamp in IST

## Features

- **Chronological Order**: Playlist mirrors the exact order of songs in the chat file
- **Divergence Detection**: Automatically fixes manual deletions or out-of-order songs
- **Duplicate Prevention**: Each track appears only once in the playlist
- **GitHub Actions Automation**: Runs on a schedule or manually

## Setup

### 1. Google Cloud (for Google Drive access)

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/)
2. Enable the **Google Drive API**
3. Create a **Service Account**
4. Download the JSON key file
5. Share the WhatsApp chat ZIP file (or its parent folder) with the Service Account email (`...@project.iam.gserviceaccount.com`)

### 2. GitHub Secrets & Variables

Add these to your GitHub repo:

**Secrets:**
- `GOOGLE_APPLICATION_CREDENTIALS_CONTENT` → Full JSON content of your service account key
- `SPOTIPY_CLIENT_ID` → Spotify Developer Client ID
- `SPOTIPY_CLIENT_SECRET` → Spotify Developer Client Secret
- `SPOTIPY_REDIRECT_URI` → Spotify Redirect URI (e.g., `http://localhost:8888/callback`)
- `SPOTIPY_CACHE_CONTENT` → Spotify token cache (get this by running locally once)
- `TARGET_PLAYLIST_ID` → Your Spotify Playlist ID (from the playlist URL)

**Variables:**
- `GOOGLE_DRIVE_INPUT_FOLDER_ID` → The folder ID in Google Drive containing the WhatsApp ZIP
- `TARGET_DRIVE_ARCHIVE_FILENAME` → (Optional) Exact name of the ZIP file in Drive

### 3. Spotify Developer Setup

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create an app
3. Set the **Redirect URI** to match `SPOTIPY_REDIRECT_URI`
4. Get your Client ID and Secret

### 4. Get Spotify Cache Token

Run this locally once to generate the cache:

```bash
python scripts/spotify.py
```

It will open a browser for authentication. After successful auth, copy the contents of `.spotifycache` and add it as a GitHub secret (`SPOTIPY_CACHE_CONTENT`).

## Workflow

The workflow runs automatically every 3 days at 18:30 UTC. You can also trigger it manually from the Actions tab.

## Directory Structure

├── .github/workflows/

│   └── spotify-update.yml      # GitHub Actions workflow

├── scripts/

│   └── spotify.py              # Main script

├── requirements.txt            # Python dependencies

├── .gitignore

├── .spotifycache               # Generated locally (gitignored)

├── spotify_bot_log.txt         # Generated log file

└── README.md

## Troubleshooting

### "Google Drive authentication failure"
- Check that `GOOGLE_APPLICATION_CREDENTIALS_CONTENT` is valid JSON
- Ensure the Service Account has access to the Drive folder/file

### "Spotify authentication failure"
- Verify `SPOTIPY_CLIENT_ID` and `SPOTIPY_CLIENT_SECRET`
- Ensure `SPOTIPY_CACHE_CONTENT` is valid and not expired

### "Target chat archive not found"
- Check `GOOGLE_DRIVE_INPUT_FOLDER_ID`
- Verify the ZIP file name matches `TARGET_DRIVE_ARCHIVE_FILENAME`

## License

MIT