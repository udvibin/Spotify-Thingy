"""
WhatsApp → Spotify Playlist Sync

Fetches a WhatsApp chat export (ZIP) from Google Drive, extracts Spotify and
Apple Music links, and syncs a Spotify playlist to match the chat exactly in
chronological order.

Features:
- Chronological playlist sync (handles manual deletions, out-of-order songs)
- Spotify link extraction and conversion
- Apple Music link extraction + Spotify search and conversion
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


def extract_spotify_links_from_text_content(text_content: str) -> list[str]:
    """
    Extracts unique Spotify track URLs from chat text content.

    Preserves the order of first appearance (chronological order).

    Args:
        text_content: Raw text from WhatsApp chat export

    Returns:
        List of unique Spotify track URLs in order
    """
    ordered_unique_urls: list[str] = []
    seen_urls: set[str] = set()

    # Regex to match Spotify track URLs
    url_pattern = r"(https?:\/\/open\.spotify\.com\/track\/[a-zA-Z0-9]+)"

    for line_content in text_content.splitlines():
        found_urls = re.findall(url_pattern, line_content)
        for url in found_urls:
            if url not in seen_urls:
                ordered_unique_urls.append(url)
                seen_urls.add(url)

    return ordered_unique_urls


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
            sp.playlist_remove_all_occurrences_of_items(playlist_id, songs_to_remove)
            print(f"Removed {len(songs_to_remove)} songs from playlist.")
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

# Pattern to match Apple Music URLs (song or album pages)
# Matches: https://music.apple.com/us/song/song-name/1234567890
#          https://music.apple.com/in/album/album-name/1234567890?i=1234567891
APPLE_MUSIC_URL_PATTERN = r"https?:\/\/music\.apple\.com\/[a-z]{2}\/(?:album|song)\/[^\/]+\/[^\?]+(?:\?i=[0-9]+)?"


def extract_apple_music_links_from_text_content(text_content: str) -> list[str]:
    """
    Extracts unique Apple Music URLs from chat text, preserving order.

    Args:
        text_content: Raw text from WhatsApp chat export

    Returns:
        List of unique Apple Music URLs in order
    """
    ordered_unique_urls: list[str] = []
    seen_urls: set[str] = set()

    for line_content in text_content.splitlines():
        found_urls = re.findall(APPLE_MUSIC_URL_PATTERN, line_content)
        for url in found_urls:
            # Normalize URL (remove tracking params, etc.)
            normalized_url = url.split('?')[0]
            if normalized_url not in seen_urls:
                ordered_unique_urls.append(normalized_url)
                seen_urls.add(normalized_url)

    return ordered_unique_urls


def extract_metadata_from_apple_music_url(url: str) -> dict:
    """
    Extracts metadata from an Apple Music URL.

    Tries to extract:
    - song_id: The numeric ID from the URL
    - track_name: Track name if present in URL path

    Args:
        url: Apple Music URL (e.g., https://music.apple.com/us/song/starboy/1234567890)

    Returns:
        Dict with extracted metadata:
        {
            "url": str,
            "song_id": str | None,
            "track_name": str | None
        }
    """
    result = {
        "url": url,
        "song_id": None,
        "track_name": None,
    }

    # Extract song ID from patterns like:
    # /song/song-name/1234567890 or ?i=1234567891 or album/1234567890
    id_patterns = [
        r"\?i=([0-9]+)",           # ?i=1234567890
        r"/song/[^/]+/([0-9]+)",   # /song/song-name/1234567890
        r"/album/[^/]+/([0-9]+)",  # /album/album-name/1234567890
    ]

    for pattern in id_patterns:
        id_match = re.search(pattern, url)
        if id_match:
            result["song_id"] = id_match.group(1)
            break

    # Try to extract track name from URL path
    # URL format: /song/track-name/1234567890 or /album/album-name/1234567890
    path_match = re.search(r"music\.apple\.com\/[a-z]{2}\/(?:song)\/([^\/]+)\/?", url)
    if path_match:
        # Convert URL-encoded/hyphenated name to readable format
        potential_track = path_match.group(1).replace('-', ' ').replace('%20', ' ').strip()
        if len(potential_track) > 2:
            result["track_name"] = potential_track

    return result


def search_spotify_for_apple_music_track(
    sp: spotipy.Spotify,
    track_name: str | None,
    song_id: str | None
) -> str | None:
    """
    Searches Spotify for a track matching the Apple Music metadata.

    Uses the track name to search Spotify. Falls back to looser search
    if exact match fails.

    Args:
        sp: Spotipy client
        track_name: Track name extracted from Apple Music URL (may be None)
        song_id: Apple Music song ID (for logging only)

    Returns:
        Spotify track URI or None if not found
    """
    if not track_name:
        log_message(f"Apple Music: No track name to search for ID {song_id}")
        return None

    # Try exact search first with quotes around track name
    query = f'"{track_name}" type:track'

    try:
        results = sp.search(q=query, limit=5, type='track')
        tracks = results.get('tracks', {}).get('items', [])

        if tracks:
            # Return the first exact match
            return tracks[0]['uri']

        # Fallback: try looser search without exact quotes
        loose_query = f"{track_name} type:track"
        loose_results = sp.search(q=loose_query, limit=10, type='track')
        loose_tracks = loose_results.get('tracks', {}).get('items', [])

        if loose_tracks:
            return loose_tracks[0]['uri']

        log_message(f"Apple Music: Could not find Spotify match for '{track_name}'")
        return None

    except Exception as e:
        log_message(f"Apple Music search error: {repr(e)}")
        return None


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


def get_target_archive_file(service, input_folder_id: str, target_archive_filename: str):
    """
    Finds the WhatsApp chat ZIP file in Google Drive.

    Searches the specified folder for a file matching the target filename.
    Returns the most recently modified matching file.

    Args:
        service: Google Drive service instance
        input_folder_id: Google Drive folder ID to search in
        target_archive_filename: Name of the ZIP file (without .zip extension)

    Returns:
        File metadata dict or None if not found
    """
    if not input_folder_id or not target_archive_filename:
        return None

    try:
        # Query: file is in the folder, has exact name, not trashed
        query = f"'{input_folder_id}' in parents and name = '{target_archive_filename}' and trashed=false"
        results = service.files().list(
            q=query,
            pageSize=1,
            fields="files(id, name, modifiedTime, mimeType)",
            orderBy="modifiedTime desc"
        ).execute()

        items = results.get('files', [])
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
    4. Extract Spotify and Apple Music links from chat
    5. Convert Apple Music links to Spotify URIs via search
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
                    # --- STEP 5: Extract Spotify links from chat ---
                    ordered_spotify_urls = extract_spotify_links_from_text_content(chat_text_content)

                    # --- STEP 6: Extract Apple Music links from chat ---
                    ordered_apple_music_urls = extract_apple_music_links_from_text_content(chat_text_content)

                    if not ordered_spotify_urls and not ordered_apple_music_urls:
                        final_log_message = "No new songs added (no Spotify or Apple Music links in chat file)."
                    else:
                        # --- STEP 7: Convert Spotify URLs to URIs ---
                        for url in ordered_spotify_urls:
                            uri = get_track_uri_from_url(url)
                            if uri:
                                ordered_track_uris_from_chat.append(uri)

                        # --- STEP 8: Convert Apple Music URLs to Spotify URIs ---
                        apple_music_converted_count = 0
                        apple_music_failed_count = 0

                        for url in ordered_apple_music_urls:
                            metadata = extract_metadata_from_apple_music_url(url)
                            spotify_uri = search_spotify_for_apple_music_track(
                                sp,
                                metadata.get("track_name"),
                                metadata.get("song_id")
                            )
                            if spotify_uri:
                                ordered_track_uris_from_chat.append(spotify_uri)
                                apple_music_converted_count += 1
                            else:
                                apple_music_failed_count += 1
                                log_message(f"Apple Music: Could not convert '{url}' to Spotify")

                        if apple_music_converted_count > 0:
                            print(f"Converted {apple_music_converted_count} Apple Music links to Spotify")
                        if apple_music_failed_count > 0:
                            log_message(f"Failed to convert {apple_music_failed_count} Apple Music links")

                        if not ordered_track_uris_from_chat:
                            final_log_message = "No new songs added (no valid track URIs derived from chat links)."
                        else:
                            # --- STEP 9: Sync playlist to match chat exactly ---
                            sync_playlist_chronologically(sp, target_playlist_id, ordered_track_uris_from_chat)
        else:
            final_log_message = f"No new songs added (failed to extract chat content from '{target_drive_file['name'] if target_drive_file else 'unknown archive'}')."

    # --- Final Run Summary Logging ---
    if SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN:
        if sp:
            song_details_for_log = get_track_details_for_logging(sp, SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN)
            songs_log_str = ", ".join(song_details_for_log)
            final_log_message = f"{len(SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN)} new songs added - {songs_log_str}"
        else:
            final_log_message = f"{len(SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN)} new song URIs were added (Spotify client NA for name lookup): {', '.join(SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN)}"

    log_message(final_log_message)


if __name__ == "__main__":
    load_dotenv()
    process_spotify_from_drive()