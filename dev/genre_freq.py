# One-off: dump share-weighted genre frequencies to design macro-families.
# Joins committed resolution_cache.json (artist genres) with site/data.json (shares).
import json, os, sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

cache = json.load(open(os.path.join(ROOT, "dashboard", "resolution_cache.json"), encoding="utf-8"))
data = json.load(open(os.path.join(ROOT, "site", "data.json"), encoding="utf-8"))

genre_w = Counter()          # genre -> total shares touching it
genre_artists = Counter()    # genre -> distinct artists
no_genre_shares = 0

for uri, t in data["tracks"].items():
    ct = cache["tracks"].get(uri.split(":")[-1]) or cache["tracks"].get(uri)
    if not ct:
        continue
    shares = sum(t["shared_by"].values())
    gs = set()
    for aid in ct.get("artist_ids", []):
        gs.update(cache["artists"].get(aid, []))
    if not gs:
        no_genre_shares += shares
    for g in gs:
        genre_w[g] += shares
for aid, gl in cache["artists"].items():
    for g in gl:
        genre_artists[g] += 1

print(f"distinct genres: {len(genre_w)} | shares with no genre at all: {no_genre_shares}")
for g, w in genre_w.most_common(120):
    print(f"{w:5}  {genre_artists[g]:3} artists  {g}")
