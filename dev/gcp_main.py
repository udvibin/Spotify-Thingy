import os
import re
import spotipy
from spotipy.oauth2 import SpotifyOAuth
import datetime
import zipfile
import io
import json
import pytz

# --- Google Cloud & API Libraries ---
# Note: These are needed for the cloud environment
from google.cloud import secretmanager
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

# --- Global Variables ---
SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN = []

# --- Cloud-Specific Function: Accessing Secrets ---
def access_secret_version(secret_id, version_id="latest"):
    """
    Fetches a secret's value from Google Cloud Secret Manager.
    """
    # Get the project ID from the environment, which is automatically
    # set by the Cloud Functions runtime.
    project_id = os.environ.get("GCP_PROJECT")
    if not project_id:
        raise ValueError("GCP_PROJECT environment variable not set. Are you running in Google Cloud?")
        
    client = secretmanager.SecretManagerServiceClient()
    name = f"projects/{project_id}/secrets/{secret_id}/versions/{version_id}"
    response = client.access_secret_version(name=name)
    return response.payload.data.decode("UTF-8")

# --- Cloud-Specific Function: Loading the Environment ---
def load_environment_from_secrets():
    """
    Loads all necessary credentials from Secret Manager into this script's
    environment variables so the other functions can use them seamlessly.
    """
    print("Loading credentials from Google Cloud Secret Manager...")
    secrets_to_load = [
        "SPOTIPY_CLIENT_ID", "SPOTIPY_CLIENT_SECRET", "SPOTIPY_REDIRECT_URI",
        "SPOTIPY_CACHE_CONTENT", "TARGET_PLAYLIST_ID", "GOOGLE_DRIVE_INPUT_FOLDER_ID",
        "GOOGLE_APPLICATION_CREDENTIALS_CONTENT"
    ]
    for secret_id in secrets_to_load:
        # This makes the secret available via os.getenv()
        os.environ[secret_id] = access_secret_version(secret_id)
    print("Successfully loaded all credentials.")


# --- MODIFIED: Spotify Client Loader ---
def load_spotify_client():
    """
    Loads the Spotipy client using credentials from environment variables.
    In the cloud, it writes the cache content to a temporary file.
    """
    # The secrets have already been loaded into the environment
    client_id = os.getenv("SPOTIPY_CLIENT_ID")
    client_secret = os.getenv("SPOTIPY_CLIENT_SECRET")
    redirect_uri = os.getenv("SPOTIPY_REDIRECT_URI")
    
    # In a stateless environment like Cloud Functions, we can't rely on a persistent
    # file. We write the cache from our secret to a temporary location.
    cache_path = "/tmp/.spotifycache"
    spotify_cache_content = os.getenv("SPOTIPY_CACHE_CONTENT")
    if spotify_cache_content:
        with open(cache_path, "w", encoding="utf-8") as f_cache:
            f_cache.write(spotify_cache_content)
            
    if not all([client_id, client_secret, redirect_uri]):
        log_message("Error: Missing one or more Spotify credentials.")
        return None

    scope = "playlist-modify-public playlist-modify-private playlist-read-private"
    try:
        auth_manager = SpotifyOAuth(
            client_id=client_id,
            client_secret=client_secret,
            redirect_uri=redirect_uri,
            scope=scope,
            cache_path=cache_path # Use the temp file
        )
        sp = spotipy.Spotify(auth_manager=auth_manager)
        sp.current_user()
        return sp
    except Exception as e:
        log_message(f"Error during Spotify authentication: {e}")
        return None

# --- MODIFIED: Logging Function ---
def log_message(message):
    """
    Prints a message that will be automatically captured by Google Cloud Logging.
    """
    try:
        ist_tz = pytz.timezone("Asia/Kolkata")
        ist_now = datetime.datetime.now(ist_tz)
        timestamp = ist_now.strftime("%Y-%m-%d %H:%M:%S %Z")
        full_message = f"[{timestamp}] {message}"
    except Exception:
        timestamp = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")
        full_message = f"[{timestamp}] {message} (Timezone conversion error)"
    
    # In Google Cloud, 'print' is the correct way to log.
    print(full_message)

# ==============================================================================
# UNCHANGED LOGIC: ALL YOUR ORIGINAL FUNCTIONS
# The functions below are copied directly from your original 'spotify.py'
# They work without changes because the environment is set up for them.
# ==============================================================================

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
        except Exception as e:
            log_message(f"Error fetching playlist items: {e}")
            return existing_uris 
        if not results or not results['items']: break
        for item in results['items']:
            if item.get('track') and item['track'].get('uri') and "spotify:track:" in item['track']['uri'] and len(item['track']['uri'].split(':')[-1]) == 22:
                existing_uris.add(item['track']['uri'])
        if results['next']: offset += limit
        else: break
    return existing_uris

def add_tracks_to_playlist(sp, playlist_id, track_uris_to_add):
    global SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN
    if not track_uris_to_add: return 0
    valid_uris_to_add = [uri for uri in track_uris_to_add if uri and isinstance(uri, str) and uri.startswith("spotify:track:") and len(uri.split(':')[-1]) == 22]
    if not valid_uris_to_add: return 0
    for i in range(0, len(valid_uris_to_add), 100):
        chunk = valid_uris_to_add[i:i + 100]
        try:
            sp.playlist_add_items(playlist_id, chunk)
            SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN.extend(chunk) 
        except Exception as e:
            log_message(f"Error adding chunk to Spotify: {e}")
    return len(SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN)

def get_track_details_for_logging(sp, track_uris):
    if not track_uris: return []
    track_details_list = []
    for i in range(0, len(track_uris), 50):
        chunk_uris = track_uris[i:i + 50]
        try:
            tracks_info = sp.tracks(tracks=chunk_uris)
            for track_data in tracks_info['tracks']:
                if track_data: 
                    name = track_data.get('name', 'Unknown Name')
                    artists = ", ".join([artist.get('name', 'Unknown Artist') for artist in track_data.get('artists', [])])
                    track_details_list.append(f"{name} by {artists}")
        except Exception as e:
            log_message(f"Error fetching track details: {e}")
            track_details_list.extend([f"ErrorFetchingTrackDetailsForURI({uri})" for uri in chunk_uris])
    return track_details_list

def load_google_drive_service():
    creds_json_str = os.getenv("GOOGLE_APPLICATION_CREDENTIALS_CONTENT")
    if not creds_json_str:
        log_message("Error: GOOGLE_APPLICATION_CREDENTIALS_CONTENT not found in environment.")
        return None
    try:
        creds_info = json.loads(creds_json_str)
        creds = service_account.Credentials.from_service_account_info(creds_info, scopes=['https://www.googleapis.com/auth/drive.readonly'])
        service = build('drive', 'v3', credentials=creds)
        return service
    except Exception as e:
        log_message(f"Error loading Google Drive service: {e}")
        return None

def get_target_archive_file(service, input_folder_id):
    target_archive_filename = "WhatsApp Chat with Mandatory vibe compliance"
    if not input_folder_id or not target_archive_filename: return None
    try:
        query = f"'{input_folder_id}' in parents and name = '{target_archive_filename}' and trashed=false"
        results = service.files().list(q=query, pageSize=1, fields="files(id, name, modifiedTime)", orderBy="modifiedTime desc").execute()
        return results.get('files', [None])[0]
    except Exception as e:
        log_message(f"Error finding target archive in Google Drive: {e}")
        return None

def download_and_extract_chat_from_archive(service, file_id):
    try:
        request = service.files().get_media(fileId=file_id)
        fh = io.BytesIO()
        downloader = MediaIoBaseDownload(fh, request)
        done = False
        while not done: status, done = downloader.next_chunk()
        fh.seek(0)
        with zipfile.ZipFile(fh, 'r') as zip_ref:
            for member_name in zip_ref.namelist():
                if re.match(r".*WhatsApp Chat with Mandatory vibe compliance\.txt", member_name, re.IGNORECASE):
                    return zip_ref.read(member_name).decode('utf-8')
        return None
    except Exception as e:
        log_message(f"Error downloading or extracting chat archive: {e}")
        return None

# --- MAIN ORCHESTRATION LOGIC ---
def process_spotify_from_drive():
    global SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN
    SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN.clear()
    final_log_message = "No new songs added (An issue occurred before processing could start)."

    drive_service = load_google_drive_service()
    if not drive_service:
        final_log_message = "No new songs added (Google Drive authentication failure)."
        log_message(final_log_message)
        return

    input_drive_folder_id = os.getenv("GOOGLE_DRIVE_INPUT_FOLDER_ID")
    if not input_drive_folder_id:
        final_log_message = "No new songs added (Configuration error: missing Drive input folder ID)."
        log_message(final_log_message)
        return
    
    target_drive_file = get_target_archive_file(drive_service, input_drive_folder_id)
    if not target_drive_file:
        final_log_message = "No new songs added (Target chat archive not found in Drive)."
    else:
        chat_text_content = download_and_extract_chat_from_archive(drive_service, target_drive_file['id'])
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
                    if ordered_spotify_urls:
                        ordered_track_uris_from_chat = [uri for url in ordered_spotify_urls if (uri := get_track_uri_from_url(url))]
                        if ordered_track_uris_from_chat:
                            uris_to_add = [uri for uri in ordered_track_uris_from_chat if uri not in existing_uris_in_spotify_playlist]
                            if uris_to_add:
                                add_tracks_to_playlist(sp, target_playlist_id, uris_to_add)
                            else:
                                final_log_message = "No new songs to add (all found songs already in playlist)."
                        else:
                            final_log_message = "No new songs added (no valid track URIs could be derived from chat links)."
                    else:
                        final_log_message = "No new songs added (no Spotify links found in chat file)."
        else: 
            final_log_message = f"No new songs added (failed to extract chat content from archive)."

    if SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN:
        song_details_for_log = get_track_details_for_logging(sp, SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN)
        songs_log_str = ", ".join(song_details_for_log)
        final_log_message = f"{len(SUCCESSFULLY_ADDED_SONG_URIS_THIS_RUN)} new songs added - {songs_log_str}"
    
    log_message(final_log_message)

# --- GOOGLE CLOUD FUNCTION ENTRY POINT ---
def spotify_automation_entrypoint(event, context):
    """
    This is the main function that Google Cloud will call.
    It's triggered by Cloud Scheduler.
    """
    try:
        # 1. Load all secrets from Secret Manager into the environment
        load_environment_from_secrets()

        # 2. Run your main script logic
        process_spotify_from_drive()

        print("Cloud Function execution finished successfully.")
        return "OK", 200 # Return a success response

    except Exception as e:
        # Log any fatal error
        print(f"A fatal error occurred during execution: {e}")
        # Re-raise the exception to mark the function's execution as a failure
        raise