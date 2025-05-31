import os
import re
import spotipy
from spotipy.oauth2 import SpotifyOAuth
from dotenv import load_dotenv
import datetime
import zipfile # Crucial for handling the compressed archive
import io
import json

# --- Google API Libraries ---
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

# --- Configuration ---
# This should be the name of the COMPRESSED ARCHIVE file as it appears in your Google Drive list
TARGET_DRIVE_ARCHIVE_FILENAME = "WhatsApp Chat with Mandatory vibe compliance" 
# This is a regex pattern to find the actual .txt chat file INSIDE the archive
# Based on your screenshot, the txt file inside is named "WhatsApp Chat with Mandatory vibe compliance.txt"
CHAT_TXT_FILENAME_IN_ARCHIVE_PATTERN = r"WhatsApp Chat with Mandatory vibe compliance\.txt"
# If the name inside varies, a more general pattern like r".*\.txt" or r"_chat\.txt" might be needed.

LOG_FILENAME = "spotify_bot_log.txt"

# --- Logging Function ---
def log_message(message):
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    full_message = f"[{timestamp}] {message}"
    print(full_message)
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
        log_message("Found SPOTIPY_CACHE_CONTENT, writing to .spotifycache")
        with open(cache_path, "w", encoding="utf-8") as f_cache:
            f_cache.write(spotify_cache_content)
    else:
        log_message("SPOTIPY_CACHE_CONTENT not found. Relying on existing .spotifycache or fresh auth if cache is invalid/missing.")

    if not all([client_id, client_secret, redirect_uri]):
        log_message("Error: Spotify API credentials not fully set in environment variables.")
        return None
    scope = "playlist-modify-public playlist-modify-private playlist-read-private"
    try:
        auth_manager = SpotifyOAuth(client_id=client_id, client_secret=client_secret, redirect_uri=redirect_uri, scope=scope, cache_path=cache_path)
        sp = spotipy.Spotify(auth_manager=auth_manager)
        sp.current_user() 
        log_message("Successfully authenticated with Spotify.")
        return sp
    except Exception as e:
        log_message(f"Error during Spotify authentication: {e}")
        return None

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
    log_message(f"Found {len(ordered_unique_urls)} unique Spotify track URLs in the provided text content.")
    return ordered_unique_urls

def get_track_uri_from_url(spotify_url):
    """Converts a Spotify track URL to a Spotify track URI. Returns None if invalid."""
    if not isinstance(spotify_url, str): return None
    # Spotify track IDs are 22 characters, Base62
    match = re.search(r"open\.spotify\.com\/track\/([a-zA-Z0-9]{22})", spotify_url)
    if match:
        track_id = match.group(1)
        return f"spotify:track:{track_id}"
    else:
        # log_message(f"Warning: Could not parse a valid Base62 track ID from URL: {spotify_url}") # Can be verbose
        return None

def get_existing_playlist_track_uris(sp, playlist_id):
    existing_uris = set()
    offset = 0
    limit = 100 
    log_message(f"Fetching existing tracks from Spotify playlist ID: {playlist_id}...")
    while True:
        try:
            results = sp.playlist_items(playlist_id, offset=offset, limit=limit, fields='items(track(uri)),next', additional_types=['track'])
        except spotipy.SpotifyException as e:
            log_message(f"Spotify API Error fetching playlist items: HTTP Status {e.http_status} - {e.msg}")
            if e.http_status == 400 and "Invalid base62 id" in str(e.msg).lower(): # Check error message content
                 log_message("Error suggests an issue with the Playlist ID ('{playlist_id}') provided for fetching items.")
            return existing_uris 
        except Exception as e:
            log_message(f"General Error fetching playlist items: {e}")
            return existing_uris
        if not results or not results['items']: break
        for item in results['items']:
            if item['track'] and item['track']['uri'] and "spotify:track:" in item['track']['uri'] and len(item['track']['uri'].split(':')[-1]) == 22 :
                existing_uris.add(item['track']['uri'])
        if results['next']: offset += limit
        else: break
    log_message(f"Spotify playlist currently has {len(existing_uris)} tracks.")
    return existing_uris

def add_tracks_to_playlist(sp, playlist_id, track_uris_to_add):
    if not track_uris_to_add:
        log_message("No new tracks to add to Spotify (list was empty).")
        return 0
    
    valid_uris_to_add = [uri for uri in track_uris_to_add if uri and isinstance(uri, str) and uri.startswith("spotify:track:") and len(uri.split(':')[-1]) == 22]
    
    if not valid_uris_to_add:
        log_message("No valid track URIs to add after filtering. Original list might have contained invalid entries.")
        if track_uris_to_add: log_message(f"Problematic URIs originally attempted: {track_uris_to_add}")
        return 0
        
    if len(valid_uris_to_add) < len(track_uris_to_add):
        log_message(f"Filtered out {len(track_uris_to_add) - len(valid_uris_to_add)} invalid or None URIs before adding.")

    added_to_spotify_count = 0
    for i in range(0, len(valid_uris_to_add), 100):
        chunk = valid_uris_to_add[i:i + 100]
        try:
            sp.playlist_add_items(playlist_id, chunk)
            log_message(f"Successfully added {len(chunk)} tracks to the Spotify playlist: {', '.join(chunk)}")
            added_to_spotify_count += len(chunk)
        except spotipy.SpotifyException as e:
             log_message(f"Spotify API Error adding tracks: HTTP Status {e.http_status} - {e.msg}. Failed chunk: {chunk}")
             if e.http_status == 400 and "Invalid base62 id" in str(e.msg).lower():
                 log_message("Error suggests an issue with the Playlist ID ('{playlist_id}') or one of the track URIs in the chunk.")
        except Exception as e:
            log_message(f"General Error adding tracks to Spotify playlist: {e}. Failed chunk: {chunk}")
    return added_to_spotify_count

# --- Google Drive Functions ---
def load_google_drive_service():
    load_dotenv()
    creds_json_str = os.getenv("GOOGLE_APPLICATION_CREDENTIALS_CONTENT")
    if not creds_json_str:
        log_message("Error: GOOGLE_APPLICATION_CREDENTIALS_CONTENT environment variable not found.")
        return None
    try:
        creds_info = json.loads(creds_json_str)
        creds = service_account.Credentials.from_service_account_info(creds_info, scopes=['https://www.googleapis.com/auth/drive'])
        service = build('drive', 'v3', credentials=creds)
        # log_message("Successfully authenticated with Google Drive API.") # Already logged by the calling function or less verbose
        return service
    except Exception as e:
        log_message(f"Error authenticating with Google Drive: {e}")
        return None

def get_target_archive_file(service, input_folder_id, target_archive_filename):
    """Finds the specified ARCHIVE file by name in the Google Drive folder."""
    try:
        # Query for the specific filename. MimeType for "Compressed archive" can be unreliable/varied.
        # Best to find by name and then try to treat as zip.
        query = f"'{input_folder_id}' in parents and name = '{target_archive_filename}' and trashed=false"
        
        results = service.files().list(
            q=query,
            pageSize=5, # Should ideally be only one, or very few if versions exist.
            fields="files(id, name, modifiedTime, mimeType)", # mimeType for debugging
            orderBy="modifiedTime desc" # Get the most recently modified if multiple exact names
        ).execute()
        items = results.get('files', [])
        
        if not items:
            log_message(f"Target archive file '{target_archive_filename}' not found in Google Drive folder ID: {input_folder_id}")
            return None
        
        latest_file = items[0] 
        log_message(f"Found target archive file: {latest_file['name']} (ID: {latest_file['id']}, Type: {latest_file.get('mimeType', 'N/A')}, Modified: {latest_file['modifiedTime']})")
        if len(items) > 1:
            log_message(f"Warning: Found {len(items)} files named '{target_archive_filename}'. Processing the latest one based on modification time.")
        return latest_file 
    except Exception as e:
        log_message(f"Error searching for '{target_archive_filename}' in Google Drive folder {input_folder_id}: {e}")
        return None

def download_and_extract_chat_from_archive(service, file_id, file_name):
    """Downloads the archive, extracts the chat .txt file, and returns its content."""
    log_message(f"Attempting to download and extract from archive: {file_name} (ID: {file_id})")
    try:
        request = service.files().get_media(fileId=file_id)
        fh = io.BytesIO() 
        downloader = MediaIoBaseDownload(fh, request)
        done = False
        while done is False:
            status, done = downloader.next_chunk()
        log_message(f"Download of archive {file_name} complete.")
        fh.seek(0)
        
        with zipfile.ZipFile(fh, 'r') as zip_ref: 
            chat_file_content = None
            found_txt_files = []
            for member_name in zip_ref.namelist():
                if re.match(CHAT_TXT_FILENAME_IN_ARCHIVE_PATTERN, member_name, re.IGNORECASE):
                    found_txt_files.append(member_name)
            
            if not found_txt_files:
                log_message(f"Error: No chat text file matching pattern '{CHAT_TXT_FILENAME_IN_ARCHIVE_PATTERN}' found inside archive {file_name}.")
                log_message(f"Files found in archive: {zip_ref.namelist()}")
                return None

            # If multiple .txt files match (unlikely for WhatsApp export), take the first one.
            # Or add logic to choose (e.g. largest, specific name like _chat.txt)
            target_txt_in_zip = found_txt_files[0]
            if len(found_txt_files) > 1:
                log_message(f"Warning: Multiple .txt files matched pattern in archive. Using first one: '{target_txt_in_zip}'. Matches: {found_txt_files}")

            log_message(f"Extracting '{target_txt_in_zip}' from archive.")
            chat_file_content = zip_ref.read(target_txt_in_zip).decode('utf-8')
            log_message(f"Successfully extracted chat content from {file_name} (internal file: {target_txt_in_zip}).")
            return chat_file_content

    except zipfile.BadZipFile:
        log_message(f"Error: File {file_name} (ID: {file_id}) is not a valid zip file or is corrupted.")
        return None
    except Exception as e:
        log_message(f"Error downloading or extracting archive file {file_name} (ID: {file_id}): {e}")
        return None

def move_file_to_archive_folder(service, file_id, file_name, archive_folder_id, original_parent_folder_id): # Renamed for clarity
    log_message(f"Archiving {file_name} (ID: {file_id}) from {original_parent_folder_id} to folder ID: {archive_folder_id}")
    try:
        service.files().update(
            fileId=file_id,
            addParents=archive_folder_id,
            removeParents=original_parent_folder_id, 
            fields='id, parents'
        ).execute()
        log_message(f"Successfully moved {file_name} to archive folder.")
        return True
    except Exception as e:
        log_message(f"Error moving file {file_name} to archive folder: {e}")
        return False

# --- Main Orchestration Logic ---
def process_spotify_from_drive():
    log_message("Starting Spotify processing from Google Drive...")
    load_dotenv() 

    drive_service = load_google_drive_service()
    if not drive_service:
        log_message("Exiting due to Google Drive authentication failure.")
        return

    input_drive_folder_id = os.getenv("GOOGLE_DRIVE_INPUT_FOLDER_ID")
    archive_drive_folder_id = os.getenv("GOOGLE_DRIVE_ARCHIVE_FOLDER_ID")
    target_archive_name_on_drive = os.getenv("TARGET_DRIVE_ARCHIVE_FILENAME", TARGET_DRIVE_ARCHIVE_FILENAME)

    if not input_drive_folder_id or not archive_drive_folder_id:
        log_message("Error: GOOGLE_DRIVE_INPUT_FOLDER_ID or GOOGLE_DRIVE_ARCHIVE_FOLDER_ID not set as environment variables.")
        return
    
    log_message(f"Looking for target archive file '{target_archive_name_on_drive}' in input folder '{input_drive_folder_id}'.")
    target_drive_file = get_target_archive_file(drive_service, input_drive_folder_id, target_archive_name_on_drive) 
    
    if not target_drive_file:
        log_message(f"Target archive file '{target_archive_name_on_drive}' not found. Nothing to process.")
        log_message("--- Run Summary --- \nNo new tracks were added to Spotify in this run.")
        log_message("Spotify processing from Google Drive finished.")
        return

    file_id = target_drive_file['id']
    file_name = target_drive_file['name']
    
    log_message(f"\nProcessing specified Drive archive: {file_name} (ID: {file_id})")
    chat_text_content = download_and_extract_chat_from_archive(drive_service, file_id, file_name) 

    overall_tracks_added_this_run = 0 # Initialize here

    if chat_text_content:
        sp = load_spotify_client()
        if not sp:
            log_message("Exiting due to Spotify authentication failure (triggered after finding chat content).")
            # Not moving the file if Spotify auth fails, so it can be re-attempted.
            return
        
        target_playlist_id = os.getenv('TARGET_PLAYLIST_ID')
        if not target_playlist_id:
            log_message("Error: TARGET_PLAYLIST_ID not set as environment variable. Exiting.")
            return

        existing_uris_in_spotify_playlist = get_existing_playlist_track_uris(sp, target_playlist_id)
        
        ordered_spotify_urls = extract_spotify_links_from_text_content(chat_text_content)
        if not ordered_spotify_urls:
            log_message(f"No Spotify URLs found in extracted chat from {file_name}.")
        else:
            ordered_track_uris_from_chat = []
            for url in ordered_spotify_urls:
                uri = get_track_uri_from_url(url)
                if uri: ordered_track_uris_from_chat.append(uri)
            
            if not ordered_track_uris_from_chat:
                log_message(f"No valid track URIs derived from {file_name}.")
            else:
                log_message(f"Derived {len(ordered_track_uris_from_chat)} unique and valid URIs from {file_name}.")
                final_uris_to_add_to_spotify = []
                for uri in ordered_track_uris_from_chat:
                    if uri not in existing_uris_in_spotify_playlist:
                        final_uris_to_add_to_spotify.append(uri)
                    else:
                        log_message(f"Track {uri} from {file_name} is already in the Spotify playlist. Skipping.")
                
                if final_uris_to_add_to_spotify:
                    log_message(f"Attempting to add {len(final_uris_to_add_to_spotify)} new tracks from {file_name} to Spotify.")
                    tracks_added = add_tracks_to_playlist(sp, target_playlist_id, final_uris_to_add_to_spotify)
                    overall_tracks_added_this_run += tracks_added
                else:
                    log_message(f"No new tracks from {file_name} to add to Spotify (all were already present or invalid).")
        
        # Move processed file to archive, regardless of whether songs were added (as long as chat content was processed)
        move_file_to_archive_folder(drive_service, file_id, file_name, archive_drive_folder_id, input_drive_folder_id)
    else:
        log_message(f"Failed to get chat content from {file_name}. Moving unprocessed archive to archive folder.")
        move_file_to_archive_folder(drive_service, file_id, file_name, archive_drive_folder_id, input_drive_folder_id)

    log_message(f"\n--- Run Summary ---")
    if overall_tracks_added_this_run > 0:
        log_message(f"Total new tracks added to Spotify in this run: {overall_tracks_added_this_run}")
    else:
        log_message("No new tracks were added to Spotify in this run.")
    log_message("Spotify processing from Google Drive finished.")

if __name__ == "__main__":
    load_dotenv() 
    process_spotify_from_drive()