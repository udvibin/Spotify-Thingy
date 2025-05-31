import os
import re
import spotipy
from spotipy.oauth2 import SpotifyOAuth
from dotenv import load_dotenv

# --- Configuration ---
CHAT_FILENAME = "WhatsApp Chat with Mandatory vibe compliance.txt"
# PROCESSED_URIS_FILENAME = ".processed_spotify_uris.txt" # Local log of processed URIs (optional now)

def load_spotify_client():
    """Authenticates with Spotify API and returns a Spotipy client instance."""
    load_dotenv()
    client_id = os.getenv("SPOTIPY_CLIENT_ID")
    client_secret = os.getenv("SPOTIPY_CLIENT_SECRET")
    redirect_uri = os.getenv("SPOTIPY_REDIRECT_URI")

    if not all([client_id, client_secret, redirect_uri]):
        print("Error: SPOTIPY_CLIENT_ID, SPOTIPY_CLIENT_SECRET, or SPOTIPY_REDIRECT_URI not found in .env file.")
        return None

    scope = "playlist-modify-public playlist-modify-private playlist-read-private"
    
    try:
        auth_manager = SpotifyOAuth(
            client_id=client_id,
            client_secret=client_secret,
            redirect_uri=redirect_uri,
            scope=scope,
            cache_path=".spotifycache"
        )
        sp = spotipy.Spotify(auth_manager=auth_manager)
        sp.current_user() 
        print("Successfully authenticated with Spotify.")
        return sp
    except Exception as e:
        print(f"Error during Spotify authentication: {e}")
        return None

# Optional: Functions for local processed URIs log (if you want to use it later)
# def load_processed_uris():
#     """Loads already processed track URIs from the local file."""
#     processed_uris = set()
#     if os.path.exists(PROCESSED_URIS_FILENAME):
#         with open(PROCESSED_URIS_FILENAME, 'r', encoding='utf-8') as f:
#             for line in f:
#                 processed_uris.add(line.strip())
#     return processed_uris

# def save_processed_uri(uri):
#     """Appends a newly processed URI to the local file."""
#     with open(PROCESSED_URIS_FILENAME, 'a', encoding='utf-8') as f:
#         f.write(uri + "\n")

def extract_spotify_links_from_file_chronological(filepath):
    """
    Extracts unique Spotify track URLs from a given text file,
    preserving the order of their first appearance.
    """
    ordered_unique_urls = []
    seen_urls = set()
    
    url_pattern = r"(https?:\/\/open\.spotify\.com\/track\/[a-zA-Z0-9]+)"
    
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            for line_content in f:
                found_urls = re.findall(url_pattern, line_content)
                for url in found_urls:
                    if url not in seen_urls:
                        ordered_unique_urls.append(url)
                        seen_urls.add(url)
                        
    except FileNotFoundError:
        print(f"Error: Chat file not found at {filepath}")
        return []
    except Exception as e:
        print(f"Error reading or parsing file {filepath}: {e}")
        return []
        
    print(f"Found {len(ordered_unique_urls)} unique Spotify track URLs in chronological order in the chat file.")
    return ordered_unique_urls


def get_track_uri_from_url(spotify_url):
    """Converts a Spotify track URL to a Spotify track URI."""
    if "/track/" in spotify_url:
        try:
            track_id_part = spotify_url.split('/track/')[1].split('?')[0]
            if track_id_part:
                return f"spotify:track:{track_id_part}"
        except IndexError:
            print(f"Warning: Could not parse track ID from URL: {spotify_url}")
            return None
    return None

def get_existing_playlist_track_uris(sp, playlist_id):
    """Fetches all track URIs currently in the specified playlist."""
    existing_uris = set()
    offset = 0
    limit = 100
    print(f"Fetching existing tracks from Spotify playlist ID: {playlist_id}...")
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
            print(f"Error fetching playlist items: {e}")
            return existing_uris

        if not results or not results['items']:
            break
        
        for item in results['items']:
            if item['track'] and item['track']['uri']: #Ensure track and URI exist
                existing_uris.add(item['track']['uri'])
        
        if results['next']:
            offset += limit
        else:
            break
    print(f"Spotify playlist currently has {len(existing_uris)} tracks.")
    return existing_uris

def add_tracks_to_playlist(sp, playlist_id, track_uris_to_add):
    """Adds a list of track URIs to the specified playlist."""
    if not track_uris_to_add:
        print("No new tracks to add to Spotify.")
        return 0

    added_to_spotify_count = 0
        
    # Add to Spotify in chunks of 100
    # The order of track_uris_to_add is preserved here.
    for i in range(0, len(track_uris_to_add), 100):
        chunk = track_uris_to_add[i:i + 100]
        try:
            sp.playlist_add_items(playlist_id, chunk)
            print(f"Successfully added {len(chunk)} tracks to the Spotify playlist.")
            added_to_spotify_count += len(chunk)
            # Optional: If you re-enable local processed URI logging:
            # for uri_added in chunk:
            #     save_processed_uri(uri_added)
        except Exception as e:
            print(f"Error adding tracks to Spotify playlist: {e}")
            print(f"Failed chunk: {chunk}")
    return added_to_spotify_count

def main():
    """Main function to drive the script."""
    sp = load_spotify_client()
    if not sp:
        return

    target_playlist_id = os.getenv('TARGET_PLAYLIST_ID')
    if not target_playlist_id:
        print("Error: TARGET_PLAYLIST_ID not set in .env file. Exiting.")
        return

    script_dir = os.path.dirname(os.path.abspath(__file__))
    chat_file_path = os.path.join(script_dir, CHAT_FILENAME)

    if not os.path.exists(chat_file_path):
        print(f"Error: Chat file '{CHAT_FILENAME}' not found in the script's directory: {script_dir}")
        return
        
    print(f"Processing chat file: {chat_file_path}")
    
    # Extract unique Spotify track URLs in chronological order from the chat file
    ordered_spotify_urls_from_file = extract_spotify_links_from_file_chronological(chat_file_path)
    if not ordered_spotify_urls_from_file:
        return

    # Convert URLs to URIs, maintaining order
    ordered_track_uris_from_chat = []
    for url in ordered_spotify_urls_from_file:
        uri = get_track_uri_from_url(url)
        if uri:
            ordered_track_uris_from_chat.append(uri)
    
    if not ordered_track_uris_from_chat:
        print("No valid Spotify track URIs could be derived from the chat file links.")
        return
    
    print(f"\nDerived {len(ordered_track_uris_from_chat)} unique track URIs in chronological order from chat file.")

    # Load URIs already in the Spotify playlist
    existing_uris_in_spotify_playlist = get_existing_playlist_track_uris(sp, target_playlist_id)
    
    # Determine tracks to add: must not be in the Spotify playlist. Order is preserved.
    final_uris_to_add_to_spotify = []
    for uri in ordered_track_uris_from_chat:
        if uri not in existing_uris_in_spotify_playlist:
            final_uris_to_add_to_spotify.append(uri)
        else:
            print(f"Track {uri} is already in the Spotify playlist. Skipping.")
    
    if final_uris_to_add_to_spotify:
        print(f"\nFound {len(final_uris_to_add_to_spotify)} tracks from chat file that are not currently in the Spotify playlist.")
        tracks_added = add_tracks_to_playlist(sp, target_playlist_id, final_uris_to_add_to_spotify)
        print(f"\nFinished. Added {tracks_added} new tracks to Spotify in this session (newest songs from chat are at the bottom of the playlist).")
    else:
        print("\nNo new tracks to add to the Spotify playlist. All found tracks from chat were already present.")

if __name__ == "__main__":
    main()