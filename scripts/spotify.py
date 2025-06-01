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

# --- Configuration ---
TARGET_DRIVE_ARCHIVE_FILENAME = "WhatsApp Chat with Mandatory vibe compliance" 
CHAT_TXT_FILENAME_IN_ARCHIVE_PATTERN = r"WhatsApp Chat with Mandatory vibe compliance\.txt"
LOG_FILENAME = "spotify_bot_log.txt"
SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN = []

# --- Logging Function (Only for final summary) ---
def log_message(message): # Kept name log_message as it's used in one place now effectively
    """Appends THE FINAL SUMMARY message to the log file with a timestamp in IST."""
    try:
        utc_now = datetime.datetime.now(datetime.timezone.utc)
        ist_tz = pytz.timezone("Asia/Kolkata")
        ist_now = utc_now.astimezone(ist_tz)
        timestamp = ist_now.strftime("%Y-%m-%d %H:%M:%S %Z")
        full_message = f"[{timestamp}] {message}"
    except Exception: 
        timestamp = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")
        full_message = f"[{timestamp}] {message} (Timezone conversion error)"
    
    # print(full_message) # Optional: if you want the final summary in GitHub Actions console too
    with open(LOG_FILENAME, "a", encoding="utf-8") as f:
        f.write(full_message + "\n")

# --- Spotify Functions ---
def load_spotify_client():
    load_dotenv() 
    client_id = os.getenv("SPOTIPY_CLIENT_ID")
    client_secret = os.getenv("SPOTIPY_CLIENT_SECRET")
    redirect_uri = os.getenv("SPOTIPY_REDIRECT_URI")
    spotify_cache_content = os.getenv("SPOTIPY_CACHE_CONTENT")
    cache_path = ".spotifycache"
    if spotify_cache_content:
        with open(cache_path, "w", encoding="utf-8") as f_cache:
            f_cache.write(spotify_cache_content)
    if not all([client_id, client_secret, redirect_uri]): return None
    scope = "playlist-modify-public playlist-modify-private playlist-read-private"
    try:
        auth_manager = SpotifyOAuth(client_id=client_id, client_secret=client_secret, redirect_uri=redirect_uri, scope=scope, cache_path=cache_path)
        sp = spotipy.Spotify(auth_manager=auth_manager)
        sp.current_user() 
        return sp
    except Exception: return None

def extract_spotify_links_from_text_content(text_content):
    ordered_unique_urls = []
    seen_urls = set()
    url_pattern = r"(https?:\/\/open\.spotify\.com\/track\/[a-zA-Z0-9]+)"
    for line_content in text_content.splitlines():
        found_urls = re.findall(url_pattern, line_content)
        for url in found_urls:
            if url not in seen_urls:
                ordered_unique_urls.append(url)
                seen_urls.add(url)
    return ordered_unique_urls

def get_track_uri_from_url(spotify_url):
    if not isinstance(spotify_url, str): return None
    # Spotify track IDs are 22 characters, Base62
    match = re.search(r"open\.spotify\.com\/track\/([a-zA-Z0-9]{22})", spotify_url)
    if match: return f"spotify:track:{match.group(1)}"
    return None

def get_existing_playlist_track_uris(sp, playlist_id):
    existing_uris = set()
    offset = 0
    limit = 100 
    while True:
        try:
            results = sp.playlist_items(playlist_id, offset=offset, limit=limit, fields='items(track(uri)),next', additional_types=['track'])
        except Exception: return existing_uris 
        if not results or not results['items']: break
        for item in results['items']:
            if item['track'] and item['track']['uri'] and "spotify:track:" in item['track']['uri'] and len(item['track']['uri'].split(':')[-1]) == 22 :
                existing_uris.add(item['track']['uri'])
        if results['next']: offset += limit
        else: break
    return existing_uris

def add_tracks_to_playlist(sp, playlist_id, track_uris_to_add):
    global SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN
    if not track_uris_to_add: return 0
    valid_uris_to_add = [uri for uri in track_uris_to_add if uri and isinstance(uri, str) and uri.startswith("spotify:track:") and len(uri.split(':')[-1]) == 22]
    if not valid_uris_to_add: return 0
    successfully_added_this_call_count = 0
    for i in range(0, len(valid_uris_to_add), 100):
        chunk = valid_uris_to_add[i:i + 100]
        try:
            sp.playlist_add_items(playlist_id, chunk)
            SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN.extend(chunk) 
        except Exception: 
            # print(f"[Error adding chunk to Spotify]: {e}") # For GHA console debug if needed
            pass 
    return len(SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN) # Return total actually added this session

def get_track_details_for_logging(sp, track_uris):
    if not track_uris: return []
    track_details_list = []
    for i in range(0, len(track_uris), 50): # Spotify API get_tracks allows up to 50 IDs
        chunk_uris = track_uris[i:i + 50]
        try:
            tracks_info = sp.tracks(tracks=chunk_uris)
            for track_data in tracks_info['tracks']:
                if track_data: 
                    name = track_data['name']
                    artists = ", ".join([artist['name'] for artist in track_data['artists']])
                    track_details_list.append(f"{name} by {artists}")
                else:
                    failed_uri_index = -1
                    try: failed_uri_index = tracks_info['tracks'].index(track_data)
                    except ValueError: pass 
                    failed_uri = chunk_uris[failed_uri_index] if 0 <= failed_uri_index < len(chunk_uris) else "UnknownURI"
                    track_details_list.append(f"Unknown Track (URI: {failed_uri})")
        except Exception:
            track_details_list.extend([f"ErrorFetchingTrackDetailsForURI({uri})" for uri in chunk_uris])
    return track_details_list

# --- Google Drive Functions ---
def load_google_drive_service():
    load_dotenv()
    creds_json_str = os.getenv("GOOGLE_APPLICATION_CREDENTIALS_CONTENT")
    if not creds_json_str: return None
    try:
        creds_info = json.loads(creds_json_str)
        creds = service_account.Credentials.from_service_account_info(creds_info, scopes=['https://www.googleapis.com/auth/drive'])
        service = build('drive', 'v3', credentials=creds)
        return service
    except Exception: return None

def get_target_archive_file(service, input_folder_id, target_archive_filename):
    if not input_folder_id or not target_archive_filename: return None
    try:
        query = f"'{input_folder_id}' in parents and name = '{target_archive_filename}' and trashed=false"
        results = service.files().list(q=query, pageSize=1, fields="files(id, name, modifiedTime, mimeType)", orderBy="modifiedTime desc").execute()
        items = results.get('files', [])
        if not items: return None
        return items[0] 
    except Exception: return None

def download_and_extract_chat_from_archive(service, file_id, file_name):
    try:
        request = service.files().get_media(fileId=file_id)
        fh = io.BytesIO() 
        downloader = MediaIoBaseDownload(fh, request)
        done = False
        while not done: status, done = downloader.next_chunk()
        fh.seek(0)
        with zipfile.ZipFile(fh, 'r') as zip_ref: 
            for member_name in zip_ref.namelist():
                if re.match(CHAT_TXT_FILENAME_IN_ARCHIVE_PATTERN, member_name, re.IGNORECASE):
                    return zip_ref.read(member_name).decode('utf-8')
        return None
    except Exception: return None

# --- Main Orchestration Logic ---
def process_spotify_from_drive():
    global SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN
    SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN.clear()

    final_log_message = "No new songs added (An issue occurred before processing could start)." # Default
    # print("[DEBUG] Starting Spotify processing from Google Drive...") # For GHA console if needed

    load_dotenv() 
    drive_service = load_google_drive_service()
    if not drive_service:
        final_log_message = "No new songs added (Google Drive authentication failure)."
        log_message(final_log_message)
        return

    input_drive_folder_id = os.getenv("GOOGLE_DRIVE_INPUT_FOLDER_ID")
    target_archive_name_on_drive = os.getenv("TARGET_DRIVE_ARCHIVE_FILENAME", TARGET_DRIVE_ARCHIVE_FILENAME)

    if not input_drive_folder_id:
        final_log_message = "No new songs added (Configuration error: missing Drive input folder ID)."
        log_message(final_log_message)
        return
    
    target_drive_file = get_target_archive_file(drive_service, input_drive_folder_id, target_archive_name_on_drive) 
    
    sp = None 
    chat_text_content = None
    ordered_spotify_urls = None
    final_uris_to_add_to_spotify_candidates = None

    if not target_drive_file:
        final_log_message = f"No new songs added (Target chat archive '{target_archive_name_on_drive}' not found)."
    else:
        file_id = target_drive_file['id']
        file_name = target_drive_file['name']
        chat_text_content = download_and_extract_chat_from_archive(drive_service, file_id, file_name) 

        if chat_text_content:
            sp = load_spotify_client()
            if not sp:
                final_log_message = "No new songs added (Spotify authentication failure)."
            else:
                target_playlist_id = os.getenv('TARGET_PLAYLIST_ID')
                if not target_playlist_id:
                    final_log_message = "No new songs added (Configuration error: missing Spotify playlist ID)."
                else:
                    existing_uris_in_spotify_playlist = get_existing_playlist_track_uris(sp, target_playlist_id)
                    ordered_spotify_urls = extract_spotify_links_from_text_content(chat_text_content)
                    
                    if not ordered_spotify_urls:
                        final_log_message = "No new songs added (no Spotify links in chat file)."
                    else:
                        ordered_track_uris_from_chat = []
                        for url in ordered_spotify_urls:
                            uri = get_track_uri_from_url(url)
                            if uri: ordered_track_uris_from_chat.append(uri)
                        
                        if not ordered_track_uris_from_chat:
                            final_log_message = "No new songs added (no valid track URIs derived from chat links)."
                        else:
                            final_uris_to_add_to_spotify_candidates = []
                            for uri in ordered_track_uris_from_chat:
                                if uri not in existing_uris_in_spotify_playlist:
                                    final_uris_to_add_to_spotify_candidates.append(uri)
                            
                            if final_uris_to_add_to_spotify_candidates:
                                add_tracks_to_playlist(sp, target_playlist_id, final_uris_to_add_to_spotify_candidates)
                                # The final log message will be determined below based on SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN
                            else: # No new unique songs to add (all already in playlist or invalid)
                                final_log_message = "No new songs added (all found songs already in playlist or were invalid)."
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
    # If SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN is empty, final_log_message will retain the reason set in the blocks above.
    
    log_message(final_log_message) # This is THE ONE log message per run for the file.

if __name__ == "__main__":
    load_dotenv() 
    process_spotify_from_drive()