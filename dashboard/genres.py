# Genre-family derivation for the "genre nebulae" section.
#
# Joins the resolution cache (artist_id -> Spotify genres, uri -> artist_ids)
# with the per-track share counts to bucket every artist into one of ~9 readable
# macro-families. Pure data crunch — no network, no auth — so it runs both inside
# dashboard/generate.py (emitting data["genres"]) and from dev/derive_genre_mock.py.
from __future__ import annotations
from collections import Counter, defaultdict

# ── macro-family mapping: ordered keyword rules, first match wins ────────────
# Spotify genres are micro-genres ("stutter house", "hindi indie", ...);
# the nebulae need ~9 readable families. Order matters: "punjabi hip hop"
# must hit desi-hip-hop before either "desi" or "hip hop".
FAMILIES = [
    ("desi hip hop",  ["desi hip hop", "hindi hip hop", "punjabi hip hop",
                       "malayalam hip hop", "indian hip hop", "desi drill", "desi trap"]),
    ("desi",          ["indian", "hindi", "desi", "bollywood", "punjabi", "sufi",
                       "qawwali", "ghazal", "bhangra", "garba", "marathi", "tamil",
                       "telugu", "kannada", "malayalam", "bengali", "urdu",
                       "pakistani", "filmi", "carnatic", "hindustani"]),
    ("hip hop",       ["rap", "hip hop", "drill", "grime", "boom bap", "g-funk",
                       "gangster", "hyphy", "crunk", "phonk"]),
    ("house & edm",   ["house", "edm", "techno", "garage", "rave", "dubstep",
                       "bassline", "bass music", "breakbeat", "trance", "hardstyle",
                       "big room", "electro", "dance pop", "jungle", "drum and bass",
                       "dnb", "amapiano", "hypertechno"]),
    ("electronica",   ["idm", "breakcore", "trip hop", "downtempo", "ambient",
                       "glitch", "electronic", "electronica", "chillwave",
                       "synthwave", "vaporwave", "hyperpop"]),
    ("rock & metal",  ["rock", "metal", "punk", "grunge", "shoegaze", "gothic",
                       "new wave", "cold wave", "emo", "screamo", "hardcore"]),
    ("r&b, soul & jazz", ["r&b", "soul", "jazz", "funk", "motown", "blues",
                          "gospel", "doo-wop"]),
    ("indie & dream", ["indie", "bedroom", "dream pop", "art pop", "psychedelic",
                       "lo-fi", "baroque pop", "folk", "singer-songwriter",
                       "slowcore", "sadcore", "jangle", "twee", "synthpop"]),
    ("global pop",    ["afro", "latin", "reggae", "k-pop", "j-pop", "dancehall",
                       "pop"]),
]
FAMILY_ORDER = [f for f, _ in FAMILIES] + ["uncharted"]

# Spotify's 2024 genre purge left many mainstream artists with zero genres.
# Two-stage rescue: (1) collab inference — inherit the majority family of
# co-credited artists across shared tracks; (2) hand pins for big solo names
# that never collab (same spirit as the hand-pinned resolution_cache entries).
GENRE_PINS = {
    "The Weeknd": "r&b, soul & jazz", "Frank Ocean": "r&b, soul & jazz",
    "RAYE": "r&b, soul & jazz", "Kali Uchis": "r&b, soul & jazz",
    "Daniel Caesar": "r&b, soul & jazz", "Joji": "r&b, soul & jazz",
    "Metro Boomin": "hip hop", "Mac Miller": "hip hop", "070 Shake": "hip hop",
    "Don Toliver": "hip hop", "¥$": "hip hop", "Swae Lee": "hip hop",
    "Kid Cudi": "hip hop", "Lil Yachty": "hip hop", "21 Savage": "hip hop",
    "EsDeeKid": "hip hop", "Offset": "hip hop", "Pharrell Williams": "hip hop",
    "Lana Del Rey": "indie & dream", "Glass Animals": "indie & dream",
    "keshi": "indie & dream", "Empire Of The Sun": "indie & dream",
    "Twenty One Pilots": "rock & metal",
    "James Blake": "electronica", "Bob Moses": "house & edm",
    "Post Malone": "hip hop", "Doja Cat": "hip hop", "Baby Keem": "hip hop",
    "M83": "electronica", "STRFKR": "indie & dream", "Labrinth": "r&b, soul & jazz",
}

# artists with fewer shares than this are dropped (sprites are cheap, but a star
# for a one-off share is noise). The galaxy already draws every cover.
MIN_SHARES = 2


def family_of(genre: str):
    g = genre.lower()
    for fam, kws in FAMILIES:
        if any(kw in g for kw in kws):
            return fam
    return None


def _vote_family(genres: Counter):
    votes = Counter()
    for g, c in genres.items():
        fam = family_of(g)
        if fam:
            votes[fam] += c
    if not votes:
        return None
    best = max(votes.values())
    return min((f for f, v in votes.items() if v == best), key=FAMILY_ORDER.index)


def derive_genres(tracks: dict, cache: dict) -> dict:
    """Bucket artists into macro-families.

    tracks: data.json-style {uri: {shared_by: {person: count}, ...}}
    cache:  resolution_cache.json {artists: {id: [genres]}, tracks: {uri: {artists, artist_ids}}}
    Returns {"families": {...}, "artists": {...}} — the nebulae's input shape.
    """
    artist_genres = cache.get("artists", {})
    cache_tracks = cache.get("tracks", {})

    def cached_track(uri: str):
        return cache_tracks.get(uri) or cache_tracks.get(uri.split(":")[-1])

    # artist name -> {shares, by, genres Counter, collabs Counter}
    A = defaultdict(lambda: {"shares": 0, "by": Counter(), "genres": Counter(),
                             "collabs": Counter()})
    for uri, t in tracks.items():
        ct = cached_track(uri)
        if not ct:
            continue
        names = ct.get("artists") or []
        ids = ct.get("artist_ids") or []
        n_shares = sum((t.get("shared_by") or {}).values())
        for name, aid in zip(names, ids):
            a = A[name]
            a["shares"] += n_shares
            for person, c in (t.get("shared_by") or {}).items():
                a["by"][person] += c
            for g in artist_genres.get(aid, []):
                a["genres"][g] += 1
            for other in names:
                if other != name:
                    a["collabs"][other] += n_shares

    # pass 1: direct genre vote; pass 2: pins; pass 3: collab inference
    direct = {name: _vote_family(a["genres"]) for name, a in A.items()}
    artists_out = {}
    fam_stats = defaultdict(lambda: {"shares": 0, "artists": 0, "genres": Counter()})
    for name, a in A.items():
        fam = direct[name] or GENRE_PINS.get(name)
        if not fam and a["collabs"]:
            cvotes = Counter()
            for other, w in a["collabs"].items():
                of = direct.get(other) or GENRE_PINS.get(other)
                if of:
                    cvotes[of] += w
            if cvotes:
                best = max(cvotes.values())
                fam = min((f for f, v in cvotes.items() if v == best),
                          key=FAMILY_ORDER.index)
        fam = fam or "uncharted"
        artists_out[name] = {
            "family": fam,
            "genres": [g for g, _ in a["genres"].most_common(3)],
            "shares": a["shares"],
            "by": dict(a["by"]),
        }
        fs = fam_stats[fam]
        fs["shares"] += a["shares"]
        fs["artists"] += 1
        for g in a["genres"]:
            fs["genres"][g] += 1

    artists_out = {n: v for n, v in artists_out.items() if v["shares"] >= MIN_SHARES}

    # families ordered specific -> general; only those still populated after the
    # share filter would be ideal, but fam_stats counts pre-filter artists, so
    # recompute family rollups from the kept artists for an exact match.
    kept_fam = defaultdict(lambda: {"shares": 0, "artists": 0, "genres": Counter()})
    for name, v in artists_out.items():
        fs = kept_fam[v["family"]]
        fs["shares"] += v["shares"]
        fs["artists"] += 1
        for g in v["genres"]:
            fs["genres"][g] += 1

    families = {
        fam: {
            "shares": kept_fam[fam]["shares"],
            "artists": kept_fam[fam]["artists"],
            "top_genres": [g for g, _ in kept_fam[fam]["genres"].most_common(6)],
        }
        for fam in FAMILY_ORDER if fam in kept_fam
    }
    return {"families": families, "artists": artists_out}
