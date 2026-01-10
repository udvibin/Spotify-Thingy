"""
WhatsApp → Spotify Playlist Sync

Fetches a WhatsApp chat export (ZIP) from Google Drive, extracts Spotify and
Apple Music links, and syncs a Spotify playlist to match the chat exactly in
chronological order.

Features:
- Chronological playlist sync (handles manual deletions, out-of-order songs)
- Spotify link extraction and conversion
- Apple Music link extraction via HTML scraping + Spotify search
- GitHub Actions ready with detailed logging

This script is designed to run on GitHub Actions but can also run locally.
"""

from __future__ import annotations
import os
import re
import spotipy
from spotipy.oauth2 import SpotifyOAuth
from dotenv import load_dotenv
import datetime
import zipfile
import io
import json
import pytz
import requests
from bs4 import BeautifulSoup

# --- Google API Libraries ---
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

# =============================================================================
# CONFIGURATION
# =============================================================================

# Name of the WhatsApp chat ZIP file in Google Drive (without .zip extension)
TARGET_DRIVE_ARCHIVE_FILENAME = "WhatsApp Chat with Mandatory vibe compliance"

# Regex pattern to match the chat .txt file inside the ZIP
# Matches: "WhatsApp Chat with Mandatory vibe compliance.txt"
CHAT_TXT_FILENAME_IN_ARCHIVE_PATTERN = r"WhatsApp Chat with Mandatory vibe compliance\.txt"

# Name of the log file written after each run
LOG_FILENAME = "spotify_bot_log.txt"

# Global list to track which song URIs were successfully added this run
SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN = []

# Apple Music HTML scraping settings
APPLE_MUSIC_REQUEST_TIMEOUT = 10  # seconds

# Destructive sync mode: if True, playlist will be reordered to match chat exactly
# If False (default), only new songs are appended
ENABLE_DESTRUCTIVE_SYNC = os.getenv("ENABLE_DESTRUCTIVE_SYNC", "false").lower() == "true"

# =============================================================================
# LOGGING
# =============================================================================

def log_message(message: str) -> None:
    """
    Logs a message to both:
    - GitHub Actions console (via print)
    - Local file (spotify_bot_log.txt)

    Timestamps are in IST (Asia/Kolkata).
    """
    try:
        # Get current time in IST
        utc_now = datetime.datetime.now(datetime.timezone.utc)
        ist_tz = pytz.timezone("Asia/Kolkata")
        ist_now = utc_now.astimezone(ist_tz)
        timestamp = ist_now.strftime("%Y-%m-%d %H:%M:%S %Z")
        full_message = f"[{timestamp}] {message}"
    except Exception:
        # Fallback if timezone conversion fails
        timestamp = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")
        full_message = f"[{timestamp}] {message} (Timezone conversion error)"

    # Print to GitHub Actions console
    print(full_message, flush=True)

    # Append to log file
    with open(LOG_FILENAME, "a", encoding="utf-8") as f:
        f.write(full_message + "\n")


# =============================================================================
# SPOTIFY FUNCTIONS
# =============================================================================

def load_spotify_client() -> spotipy.Spotify | None:
    """
    Authenticates with Spotify using OAuth and returns a Spotipy client.

    Reads credentials from environment variables:
    - SPOTIPY_CLIENT_ID
    - SPOTIPY_CLIENT_SECRET
    - SPOTIPY_REDIRECT_URI
    - SPOTIPY_CACHE_CONTENT (optional, written to .spotifycache)

    Returns:
        Spotipy client if auth successful, None otherwise.
    """
    load_dotenv()

    client_id = os.getenv("SPOTIPY_CLIENT_ID")
    client_secret = os.getenv("SPOTIPY_CLIENT_SECRET")
    redirect_uri = os.getenv("SPOTIPY_REDIRECT_URI")
    spotify_cache_content = os.getenv("SPOTIPY_CACHE_CONTENT")

    # Write cache content to temp file if provided
    cache_path = ".spotifycache"
    if spotify_cache_content:
        with open(cache_path, "w", encoding="utf-8") as f_cache:
            f_cache.write(spotify_cache_content)

    # Check all required credentials are present
    if not all([client_id, client_secret, redirect_uri]):
        log_message(
            "Spotify auth config missing: "
            "SPOTIPY_CLIENT_ID / SPOTIPY_CLIENT_SECRET / SPOTIPY_REDIRECT_URI"
        )
        return None

    # Define required OAuth scopes
    scope = "playlist-modify-public playlist-modify-private playlist-read-private"

    try:
        # Create OAuth manager and Spotipy client
        auth_manager = SpotifyOAuth(
            client_id=client_id,
            client_secret=client_secret,
            redirect_uri=redirect_uri,
            scope=scope,
            cache_path=cache_path,
        )
        sp = spotipy.Spotify(auth_manager=auth_manager)

        # Test authentication by fetching current user
        sp.current_user()
        return sp

    except Exception as e:
        log_message(f"Spotify authentication failure: {repr(e)}")
        return None


def get_track_uri_from_url(spotify_url: str) -> str | None:
    """
    Converts a Spotify track URL to a Spotify track URI.

    Args:
        spotify_url: Full Spotify track URL (e.g., https://open.spotify.com/track/...)

    Returns:
        Spotify URI (e.g., spotify:track:...) or None if invalid
    """
    if not isinstance(spotify_url, str):
        return None

    # Spotify track IDs are 22 characters
    match = re.search(r"open\.spotify\.com\/track\/([a-zA-Z0-9]{22})", spotify_url)
    if match:
        return f"spotify:track:{match.group(1)}"
    return None


def get_existing_playlist_track_uris_in_order(sp: spotipy.Spotify, playlist_id: str) -> list[str]:
    """
    Fetches all track URIs currently in the playlist, preserving their order.

    Spotify's playlist_items API paginates results; this fetches all pages.

    Args:
        sp: Authenticated Spotipy client
        playlist_id: Spotify playlist ID

    Returns:
        List of track URIs in playlist order
    """
    existing_uris: list[str] = []
    offset = 0
    limit = 100

    while True:
        try:
            results = sp.playlist_items(
                playlist_id,
                offset=offset,
                limit=limit,
                fields='items(track(uri)),next',
                additional_types=['track']
            )
        except Exception as e:
            log_message(f"Error fetching playlist items: {repr(e)}")
            return existing_uris

        if not results or not results['items']:
            break

        for item in results['items']:
            if item['track'] and item['track']['uri'] and "spotify:track:" in item['track']['uri']:
                existing_uris.append(item['track']['uri'])

        if results['next']:
            offset += limit
        else:
            break

    return existing_uris


def add_tracks_to_playlist(sp: spotipy.Spotify, playlist_id: str, track_uris_to_add: list[str]) -> int:
    """
    Adds tracks to a Spotify playlist in chunks of 100 (API limit).

    Args:
        sp: Authenticated Spotipy client
        playlist_id: Spotify playlist ID
        track_uris_to_add: List of track URIs to add

    Returns:
        Total number of tracks added this session
    """
    global SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN

    if not track_uris_to_add:
        return 0

    # Validate URIs before sending to API
    valid_uris_to_add = [
        uri for uri in track_uris_to_add
        if uri and isinstance(uri, str)
        and uri.startswith("spotify:track:")
        and len(uri.split(':')[-1]) == 22
    ]

    if not valid_uris_to_add:
        return 0

    for i in range(0, len(valid_uris_to_add), 100):
        chunk = valid_uris_to_add[i:i + 100]
        try:
            sp.playlist_add_items(playlist_id, chunk)
            SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN.extend(chunk)
            print(f"Added {len(chunk)} tracks to playlist.")
        except Exception as e:
            log_message(f"Error adding chunk to Spotify (chunk start {i}): {repr(e)}")

    return len(SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN)


def remove_tracks_from_playlist_in_batches(
    sp: spotipy.Spotify,
    playlist_id: str,
    track_uris_to_remove: list[str],
    batch_size: int = 100,
) -> None:
    """
    Spotify API removal endpoint has a per-request item limit.
    Remove tracks in batches to avoid 'Too many ids requested'.
    """
    if not track_uris_to_remove:
        return

    # Spotify remove endpoint supports up to 100 tracks per request.
    batch_size = max(1, min(batch_size, 100))

    for i in range(0, len(track_uris_to_remove), batch_size):
        chunk = track_uris_to_remove[i:i + batch_size]
        sp.playlist_remove_all_occurrences_of_items(playlist_id, chunk)
        print(f"Removed {len(chunk)} tracks from playlist (batch {i // batch_size + 1}).")


def sync_playlist_chronologically(
    sp: spotipy.Spotify,
    playlist_id: str,
    ordered_track_uris_from_chat: list[str]
) -> bool:
    """
    Syncs the playlist to match the chat file exactly in chronological order.

    If the playlist diverges from the chat at any point:
    1. Removes all songs from the divergence point onward
    2. Adds all songs from the chat file from that point onward

    This handles:
    - Manual deletions (script brings back deleted songs)
    - Old chat exports (2022 songs get inserted at correct position)
    - Out-of-order songs (playlist is restored to exact chat order)

    Args:
        sp: Authenticated Spotipy client
        playlist_id: Spotify playlist ID
        ordered_track_uris_from_chat: Track URIs in chronological order from chat

    Returns:
        True if sync completed, False on error
    """
    global SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN
    SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN.clear()

    # Fetch existing playlist tracks (preserving order)
    existing_uris = get_existing_playlist_track_uris_in_order(sp, playlist_id)
    print(f"Playlist has {len(existing_uris)} tracks. Chat file has {len(ordered_track_uris_from_chat)} tracks.")

    # Find the first position where playlist and chat diverge
    divergence_index = None
    for i, (chat_uri, existing_uri) in enumerate(zip(ordered_track_uris_from_chat, existing_uris)):
        if chat_uri != existing_uri:
            divergence_index = i
            break

    if divergence_index is None:
        # No divergence found in the overlapping portion
        if len(ordered_track_uris_from_chat) == len(existing_uris):
            log_message("Playlist is already in sync with chat file. No changes needed.")
            return True
        else:
            # Chat has more songs than playlist → add the remainder
            divergence_index = len(existing_uris)

    # Prepare songs to remove and songs to add
    songs_to_remove = existing_uris[divergence_index:]
    songs_to_add = ordered_track_uris_from_chat[divergence_index:]

    print(f"Resyncing from position {divergence_index}: removing {len(songs_to_remove)} songs, adding {len(songs_to_add)} songs.")

    # Remove songs from divergence point onward
    if songs_to_remove:
        try:
            remove_tracks_from_playlist_in_batches(sp, playlist_id, songs_to_remove, batch_size=100)
            print(f"Removed {len(songs_to_remove)} songs from playlist (total).")
        except Exception as e:
            log_message(f"Error removing songs from playlist: {repr(e)}")
            return False

    # Add songs from chat file (in order)
    if songs_to_add:
        add_tracks_to_playlist(sp, playlist_id, songs_to_add)

    return True


def get_track_details_for_logging(sp: spotipy.Spotify, track_uris: list[str]) -> list[str]:
    """
    Fetches track names and artists for a list of track URIs.

    Used for logging the final summary of songs added.

    Args:
        sp: Authenticated Spotipy client
        track_uris: List of track URIs

    Returns:
        List of formatted strings: "Song Name by Artist1, Artist2"
    """
    if not track_uris:
        return []

    track_details_list: list[str] = []

    # Spotify's get_tracks API accepts up to 50 IDs per request
    for i in range(0, len(track_uris), 50):
        chunk_uris = track_uris[i:i + 50]
        try:
            tracks_info = sp.tracks(tracks=chunk_uris)
            for track_data in tracks_info['tracks']:
                if track_data:
                    name = track_data['name']
                    artists = ", ".join([artist['name'] for artist in track_data['artists']])
                    track_details_list.append(f"{name} by {artists}")
                else:
                    # Handle case where API returns null for a track ID
                    failed_uri_index = -1
                    try:
                        failed_uri_index = tracks_info['tracks'].index(track_data)
                    except ValueError:
                        pass
                    failed_uri = chunk_uris[failed_uri_index] if 0 <= failed_uri_index < len(chunk_uris) else "UnknownURI"
                    track_details_list.append(f"Unknown Track (URI: {failed_uri})")
        except Exception as e:
            track_details_list.extend([f"ErrorFetchingTrackDetailsForURI({uri})" for uri in chunk_uris])

    return track_details_list


# =============================================================================
# APPLE MUSIC PARSING & SEARCH
# =============================================================================

# Pattern to match Apple Music URLs (song, album, or playlist pages)
# Examples:
# - https://music.apple.com/in/song/winny/1840941762
# - https://music.apple.com/in/album/i-want-you-shes-so-heavy/1441164426?i=1441164587&ls
# - https://music.apple.com/in/playlist/apple-music-live-fred-again/pl.61a35ff1b29d4f19a7be67ed281669d6?ls
APPLE_MUSIC_URL_PATTERN = r"https?:\/\/music\.apple\.com\/[a-z]{2}\/(?:album|song|playlist)\/[^\/\?]+(?:\/[a-z0-9]+)?(?:\?[^\s]*)?"

# Spotify track URL pattern
SPOTIFY_URL_PATTERN = r"(https?:\/\/open\.spotify\.com\/track\/[a-zA-Z0-9]+)"


def resolve_apple_music_metadata_via_html(url: str) -> dict:
    """
    Fetches an Apple Music web page and extracts track metadata via OG tags.

    This is a free alternative to using the Apple Music API (which requires
    a paid developer account). It works by scraping the HTML OpenGraph metadata
    that Apple Music pages include.

    Args:
        url: Apple Music URL (can be song, album with ?i=, or playlist)

    Returns:
        Dict with extracted metadata:
        {
            "url": str,
            "track_name": str | None,
            "artist_name": str | None,
            "is_valid": bool,
            "reason": str  # for logging why something failed
        }
    """
    result = {
        "url": url,
        "track_name": None,
        "artist_name": None,
        "is_valid": False,
        "reason": "unknown",
    }

    # Determine the type of Apple Music link
    is_playlist = "/playlist/" in url

    if is_playlist:
        result["reason"] = "playlist links not supported (requires Apple Music API)"
        return result

    # Set User-Agent to avoid being blocked by Apple
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
    }

    try:
        response = requests.get(url, headers=headers, timeout=APPLE_MUSIC_REQUEST_TIMEOUT)
        response.raise_for_status()
        html_content = response.text
    except requests.RequestException as e:
        result["reason"] = f"failed to fetch page: {repr(e)}"
        return result

    # Parse HTML with BeautifulSoup
    soup = BeautifulSoup(html_content, "html.parser")

    # Try to extract metadata from OG tags
    # Format: "Track Name by Artist Name" or just "Track Name"
    og_title = soup.find("meta", property="og:title")
    if og_title and og_title.get("content"):
        title_content = og_title["content"].strip()

        # Parse "Track Name by Artist Name" format
        if " by " in title_content:
            parts = title_content.rsplit(" by ", 1)
            result["track_name"] = parts[0].strip()
            result["artist_name"] = parts[1].strip()
        else:
            result["track_name"] = title_content

    # Fallback: try to find artist from other meta tags
    if not result["artist_name"]:
        og_description = soup.find("meta", property="og:description")
        if og_description and og_description.get("content"):
            desc = og_description["content"]
            # Often format: "Artist Name • Album Name" or similar
            if "•" in desc:
                artist_part = desc.split("•")[0].strip()
                if len(artist_part) > 0 and len(artist_part) < 100:
                    result["artist_name"] = artist_part

    # Final validation
    if result["track_name"]:
        result["is_valid"] = True
        result["reason"] = "success"
    else:
        result["reason"] = "could not extract track name from page"

    return result


def search_spotify_for_apple_music_track(
    sp: spotipy.Spotify,
    track_name: str | None,
    artist_name: str | None,
    apple_url: str
) -> str | None:
    """
    Searches Spotify for a track matching the Apple Music metadata.

    Uses confidence-based matching:
    1. Search with track + artist (exact-ish)
    2. Validate match quality (normalized title match, artist contains)
    3. If confidence too low, skip rather than add wrong song

    Args:
        sp: Spotipy client
        track_name: Track name extracted from Apple Music page
        artist_name: Artist name extracted from Apple Music page (may be None)
        apple_url: Original Apple Music URL (for logging)

    Returns:
        Spotify track URI or None if not found / confidence too low
    """
    if not track_name:
        log_message(f"Apple Music: No track name for '{apple_url}'")
        return None

    # Build search query
    # Prefer exact track + artist search
    if artist_name:
        query = f'track:"{track_name}" artist:"{artist_name}"'
    else:
        query = f'track:"{track_name}"'

    try:
        results = sp.search(q=query, limit=10, type='track')
        tracks = results.get('tracks', {}).get('items', [])

        if not tracks:
            # Fallback: looser search without quotes
            fallback_query = f"{track_name} {artist_name or ''}".strip()
            results = sp.search(q=fallback_query, limit=10, type='track')
            tracks = results.get('tracks', {}).get('items', [])

            if not tracks:
                log_message(f"Apple Music: No Spotify match for '{track_name}' ({artist_name or 'unknown artist'})")
                return None

        # Evaluate confidence of best match
        best_match = tracks[0]
        matched_track_name = best_match.get('name', '').lower()
        matched_artist_names = [a.get('name', '').lower() for a in best_match.get('artists', [])]
        input_track_name = track_name.lower()
        input_artist_name = artist_name.lower() if artist_name else None

        # Normalize for comparison (remove special chars, extra spaces)
        def normalize(s: str) -> str:
            return re.sub(r"[^\w\s]", "", s).replace("/", " ").replace("-", " ").replace("_", " ").lower()

        norm_input_track = normalize(input_track_name)
        norm_matched_track = normalize(matched_track_name)

        # Check if track names are reasonably similar
        track_name_match = (
            norm_input_track == norm_matched_track or
            norm_input_track in norm_matched_track or
            norm_matched_track in norm_input_track
        )

        # Check artist match if we have artist name
        artist_match = True
        if input_artist_name:
            norm_input_artist = normalize(input_artist_name)
            artist_match = any(
                norm_input_artist in normalize(a) or normalize(a) in norm_input_artist
                for a in matched_artist_names
            )

        # Confidence threshold
        if track_name_match and artist_match:
            # High confidence - accept the match
            return best_match['uri']
        elif track_name_match and not artist_name:
            # Medium confidence (no artist to verify) - accept if track name is exact-ish
            if norm_input_track == norm_matched_track:
                return best_match['uri']
            else:
                log_message(f"Apple Music: Low confidence match for '{track_name}', skipping to avoid wrong add")
                return None
        else:
            log_message(f"Apple Music: Track/artist mismatch for '{track_name}', skipping to avoid wrong add")
            return None

    except Exception as e:
        log_message(f"Apple Music search error for '{track_name}': {repr(e)}")
        return None


# =============================================================================
# UNIFIED LINK EXTRACTION (PRESERVES CHRONOLOGICAL ORDER)
# =============================================================================

def extract_all_music_links_from_chat(text_content: str) -> list[dict]:
    """
    Extracts both Spotify and Apple Music links from chat text content,
    preserving their original chronological order.

    Each line is processed in order, and all links found in that line
    are added to the result list in the order they appear.

    Args:
        text_content: Raw text from WhatsApp chat export

    Returns:
        List of dicts, each with:
        {
            "type": "spotify" | "apple",
            "url": str,
            "line_number": int
        }
    """
    links: list[dict] = []
    seen_urls: set[str] = set()

    for line_number, line_content in enumerate(text_content.splitlines(), start=1):
        # Find Spotify URLs
        spotify_matches = re.findall(SPOTIFY_URL_PATTERN, line_content)
        for url in spotify_matches:
            url = url.strip()
            if url and url not in seen_urls:
                links.append({
                    "type": "spotify",
                    "url": url,
                    "line_number": line_number,
                })
                seen_urls.add(url)

        # Find Apple Music URLs
        apple_matches = re.findall(APPLE_MUSIC_URL_PATTERN, line_content)
        for url in apple_matches:
            url = url.strip()
            if url and url not in seen_urls:
                links.append({
                    "type": "apple",
                    "url": url,
                    "line_number": line_number,
                })
                seen_urls.add(url)

    return links


# =============================================================================
# GOOGLE DRIVE FUNCTIONS
# =============================================================================

def load_google_drive_service():
    """
    Authenticates with Google Drive using a service account.

    Reads credentials from GOOGLE_APPLICATION_CREDENTIALS_CONTENT env var.
    This should be the full JSON content of a service account key file.

    Returns:
        Google Drive service instance or None on failure
    """
    load_dotenv()
    creds_json_str = os.getenv("GOOGLE_APPLICATION_CREDENTIALS_CONTENT")

    if not creds_json_str:
        log_message("Google Drive auth missing: GOOGLE_APPLICATION_CREDENTIALS_CONTENT")
        return None

    try:
        creds_info = json.loads(creds_json_str)
        creds = service_account.Credentials.from_service_account_info(
            creds_info,
            scopes=['https://www.googleapis.com/auth/drive']
        )
        service = build('drive', 'v3', credentials=creds)
        return service

    except Exception as e:
        log_message(f"Google Drive authentication failure: {repr(e)}")
        return None


def get_target_archive_file(service, input_folder_id, target_archive_filename):
    """
    Finds the most recently modified Drive file in the folder whose name matches
    either:
      - target_archive_filename
      - target_archive_filename + ".zip" (if not already ending with .zip)

    Returns the latest match (by modifiedTime).
    """
    if not input_folder_id or not target_archive_filename:
        return None

    name_a = target_archive_filename
    name_b = (
        target_archive_filename
        if target_archive_filename.lower().endswith(".zip")
        else f"{target_archive_filename}.zip"
    )

    try:
        # Note: orderBy ensures we get the latest match first.
        query = (
            f"'{input_folder_id}' in parents and trashed=false and "
            f"(name = '{name_a}' or name = '{name_b}')"
        )
        results = service.files().list(
            q=query,
            pageSize=1,
            fields="files(id, name, modifiedTime, mimeType)",
            orderBy="modifiedTime desc",
        ).execute()
        items = results.get("files", [])
        if not items:
            return None
        return items[0]
    except Exception as e:
        log_message(f"Error finding target archive in Drive: {repr(e)}")
        return None


def download_and_extract_chat_from_archive(service, file_id: str, file_name: str):
    """
    Downloads a ZIP file from Google Drive and extracts the chat .txt file.

    Args:
        service: Google Drive service instance
        file_id: Google Drive file ID of the ZIP
        file_name: Name of the ZIP file (for error messages)

    Returns:
        Decoded UTF-8 text content of the chat file, or None on failure
    """
    try:
        request = service.files().get_media(fileId=file_id)
        fh = io.BytesIO()
        downloader = MediaIoBaseDownload(fh, request)
        done = False

        while not done:
            status, done = downloader.next_chunk()

        fh.seek(0)

        with zipfile.ZipFile(fh, 'r') as zip_ref:
            for member_name in zip_ref.namelist():
                if re.match(CHAT_TXT_FILENAME_IN_ARCHIVE_PATTERN, member_name, re.IGNORECASE):
                    return zip_ref.read(member_name).decode('utf-8')

        return None

    except Exception as e:
        log_message(f"Error downloading/extracting archive '{file_name}': {repr(e)}")
        return None


# =============================================================================
# MAIN ORCHESTRATION
# =============================================================================

def process_spotify_from_drive():
    """
    Main function that orchestrates the entire sync process.

    Steps:
    1. Authenticate with Google Drive
    2. Download and extract chat text from ZIP
    3. Authenticate with Spotify
    4. Extract all music links (Spotify + Apple) in chronological order
    5. Convert each link to Spotify URI in order
    6. Sync playlist to match chat exactly
    7. Log the result
    """
    final_log_message = "No new songs added (An issue occurred before processing could start)."

    # Load environment variables from .env (for local dev)
    load_dotenv()

    # Step 1: Google Drive authentication
    drive_service = load_google_drive_service()
    if not drive_service:
        final_log_message = "No new songs added (Google Drive authentication failure)."
        log_message(final_log_message)
        return

    # Get configuration
    input_drive_folder_id = os.getenv("GOOGLE_DRIVE_INPUT_FOLDER_ID")
    target_archive_name_on_drive = os.getenv("TARGET_DRIVE_ARCHIVE_FILENAME", TARGET_DRIVE_ARCHIVE_FILENAME)

    if not input_drive_folder_id:
        final_log_message = "No new songs added (Configuration error: missing Drive input folder ID)."
        log_message(final_log_message)
        return

    # Step 2: Find the chat ZIP file in Drive
    target_drive_file = get_target_archive_file(drive_service, input_drive_folder_id, target_archive_name_on_drive)

    sp = None
    chat_text_content = None
    ordered_track_uris_from_chat: list[str] = []

    if not target_drive_file:
        final_log_message = f"No new songs added (Target chat archive '{target_archive_name_on_drive}' not found)."
    else:
        file_id = target_drive_file['id']
        file_name = target_drive_file['name']

        # Step 3: Download and extract chat text
        chat_text_content = download_and_extract_chat_from_archive(drive_service, file_id, file_name)

        if chat_text_content:
            # Step 4: Spotify authentication
            sp = load_spotify_client()
            if not sp:
                final_log_message = "No new songs added (Spotify authentication failure)."
            else:
                target_playlist_id = os.getenv('TARGET_PLAYLIST_ID')
                if not target_playlist_id:
                    final_log_message = "No new songs added (Configuration error: missing Spotify playlist ID)."
                else:
                    # --- STEP 5: Extract ALL music links in chronological order ---
                    all_links = extract_all_music_links_from_chat(chat_text_content)

                    if not all_links:
                        final_log_message = "No new songs added (no Spotify or Apple Music links in chat file)."
                    else:
                        # Statistics for logging
                        spotify_count = sum(1 for link in all_links if link["type"] == "spotify")
                        apple_count = sum(1 for link in all_links if link["type"] == "apple")
                        print(f"Found {len(all_links)} total links in chat: {spotify_count} Spotify, {apple_count} Apple Music")

                        # --- STEP 6: Convert each link to Spotify URI in order ---
                        apple_music_converted_count = 0
                        apple_music_skipped_count = 0
                        apple_music_failed_count = 0

                        for link in all_links:
                            if link["type"] == "spotify":
                                # Direct Spotify URL → URI conversion
                                uri = get_track_uri_from_url(link["url"])
                                if uri:
                                    ordered_track_uris_from_chat.append(uri)
                                else:
                                    log_message(f"Spotify: Invalid URL format: {link['url']}")

                            elif link["type"] == "apple":
                                # Apple Music URL → HTML scrape → Spotify search
                                metadata = resolve_apple_music_metadata_via_html(link["url"])

                                if not metadata["is_valid"]:
                                    if "playlist" in metadata["reason"]:
                                        log_message(f"Apple Music: Skipping playlist link (unsupported): {link['url']}")
                                        apple_music_skipped_count += 1
                                    else:
                                        log_message(f"Apple Music: Could not resolve '{link['url']}' - {metadata['reason']}")
                                        apple_music_failed_count += 1
                                    continue

                                # Search Spotify with confidence checks
                                spotify_uri = search_spotify_for_apple_music_track(
                                    sp,
                                    metadata.get("track_name"),
                                    metadata.get("artist_name"),
                                    link["url"]
                                )

                                if spotify_uri:
                                    ordered_track_uris_from_chat.append(spotify_uri)
                                    apple_music_converted_count += 1
                                else:
                                    apple_music_failed_count += 1

                        # Log conversion results
                        if apple_music_converted_count > 0:
                            print(f"Converted {apple_music_converted_count} Apple Music links to Spotify")
                        if apple_music_skipped_count > 0:
                            log_message(f"Skipped {apple_music_skipped_count} unsupported Apple Music links (playlists)")
                        if apple_music_failed_count > 0:
                            log_message(f"Failed to convert {apple_music_failed_count} Apple Music links")

                        if not ordered_track_uris_from_chat:
                            final_log_message = "No new songs added (no valid track URIs derived from chat links)."
                        else:
                            # --- STEP 7: Sync or Append based on mode ---
                            if ENABLE_DESTRUCTIVE_SYNC:
                                print("Running in DESTRUCTIVE SYNC mode - playlist will match chat exactly")
                                sync_playlist_chronologically(sp, target_playlist_id, ordered_track_uris_from_chat)
                            else:
                                print("Running in ADD-ONLY mode - only appending new songs")
                                existing = set(get_existing_playlist_track_uris_in_order(sp, target_playlist_id))
                                to_add = [uri for uri in ordered_track_uris_from_chat if uri not in existing]
                                if to_add:
                                    add_tracks_to_playlist(sp, target_playlist_id, to_add)
                                else:
                                    final_log_message = "No new songs added (all found songs already in playlist)."

        else:
            final_log_message = f"No new songs added (failed to extract chat content from '{target_drive_file['name'] if target_drive_file else 'unknown archive'}')."

    # --- Final Run Summary Logging ---
    if SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN:
        # There were new songs added — log everything
        if sp:
            song_details_for_log = get_track_details_for_logging(
                sp,
                SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN,
            )
            # Cap at 20 tracks for readability
            max_listed = 20
            shown = song_details_for_log[:max_listed]
            remaining = len(song_details_for_log) - len(shown)
            suffix = f" (+{remaining} more)" if remaining > 0 else ""
            songs_log_str = ", ".join(shown) + suffix
            final_log_message = (
                f"{len(song_details_for_log)} new songs added - {songs_log_str}"
            )
        else:
            final_log_message = (
                f"{len(SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN)} new song URIs were added "
                f"(Spotify client unavailable for lookup): "
                f"{', '.join(SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN)}"
            )

        # Write to file AND print to console
        log_message(final_log_message)

    else:
        # No new songs — print to console only, don't write to file
        print("No new songs added this run.", flush=True)

if __name__ == "__main__":
    load_dotenv()
    process_spotify_from_drive()