# Regenerate site/genre-mock.json for the nebulae mock page (mocks.html).
#
# Thin wrapper around dashboard/genres.derive_genres so the mock and the live
# site (data.json["genres"], emitted by dashboard/generate.py) can't drift.
# No network, no auth — joins committed resolution_cache.json + data.json.
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "dashboard"))

from genres import derive_genres, FAMILY_ORDER  # noqa: E402


def main() -> None:
    cache = json.load(open(os.path.join(ROOT, "dashboard", "resolution_cache.json"), encoding="utf-8"))
    data = json.load(open(os.path.join(ROOT, "site", "data.json"), encoding="utf-8"))

    out = derive_genres(data["tracks"], cache)

    path = os.path.join(ROOT, "site", "genre-mock.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)

    print(f"wrote {path} ({os.path.getsize(path) // 1024} KB) | {len(out['artists'])} artists kept")
    for fam in FAMILY_ORDER:
        fs = out["families"].get(fam)
        if fs:
            print(f"  {fam:18} {fs['shares']:4} shares  {fs['artists']:3} artists  "
                  f"e.g. {', '.join(fs['top_genres'][:3])}")


if __name__ == "__main__":
    main()
