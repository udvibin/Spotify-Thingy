"""
Shared parsing for the vibe dashboard.

Handles both WhatsApp export formats seen in the wild:
  OLD (Shridhar archive, UK-time): "05/08/2021, 19:33 - Sender: text"
  NEW (current exports, IST):      "23/07/24, 2:12 am - Sender: text"

Senders are canonicalized: the two exports come from different phones with
different contact names for the same people.
"""
from __future__ import annotations
import re
import datetime

# Old-phone name -> canonical, new-phone name -> canonical.
# Canonical keys are what data.json uses internally; the public-facing
# display name lives in DISPLAY_NAMES (edit freely without breaking data).
NAME_MAP = {
    # old archive (Shridhar's contacts)
    "Uday Extra": "Uday",
    "Amrit": "Ammar",
    "Aditya Shridhar": "Shridhar",
    "Pratyush Bobs": "Pratyush",
    "Kunal RubbingGenitals": "Kunal",
    "Sameer ChixHunter": "Sameer",
    "Dhruvajib Machina": "Dhruvajit",
    "Karan Uhunnn": "Karan",
    "Ankit Triggered": "Ankit",
    "Dhawal": "Dhawal",
    "Tushar Verma": "Tushar",
    "Praneet Kasula": "Praneet",
    "Sahil Ektho": "Sahil",
    "Shaury": "Shaury",
    "Vishal Trying": "Vishal",
    "Sandeep EEE": "Sandeep",
    # current export (Uday's contacts)
    "uday": "Uday",
    "Ammar Khurshid": "Ammar",
    "Pratyush Mishra": "Pratyush",
    "Kunal Khanwalkar": "Kunal",
    "Sameer Agarwal": "Sameer",
    "Dhruvajit Ghosh": "Dhruvajit",
    "Karan Kapoor": "Karan",
    "Ankit Varshnay": "Ankit",
    "Dhawal Samel": "Dhawal",
}

# Shown on the public site. Change here, regenerate, done.
DISPLAY_NAMES = {}  # canonical -> display; empty = use canonical as-is

OLD_MSG_RE = re.compile(r"^(\d{2})/(\d{2})/(\d{4}), (\d{2}):(\d{2}) - ([^:]+?): (.*)$")
NEW_MSG_RE = re.compile(r"^(\d{2})/(\d{2})/(\d{2}), (\d{1,2}):(\d{2})[\s ]*([ap]m) - ([^:]+?): (.*)$")

SPOTIFY_URL_RE = re.compile(r"(https?://open\.spotify\.com/track/[a-zA-Z0-9]+)")
APPLE_URL_RE = re.compile(
    r"https?://music\.apple\.com/[a-z]{2}/(?:album|song|playlist)/[^/\?\s]+(?:/[a-z0-9.]+)?(?:\?[^\s]*)?"
)
BANGER_RE = re.compile(r"banger", re.I)
DELETED_RE = re.compile(r"^(This message was deleted|You deleted this message)$")


def canonical(sender: str) -> str:
    return NAME_MAP.get(sender.strip(), sender.strip())


def parse_chat(text: str) -> list[dict]:
    """
    Returns [{ts: datetime (naive), sender: canonical str, text: str}].
    Auto-detects line format; continuation lines merge into the previous
    message. System lines (no "Sender: " part) are skipped.
    """
    messages: list[dict] = []
    for line in text.splitlines():
        m = OLD_MSG_RE.match(line)
        if m:
            day, month, year, hh, mm, sender, body = m.groups()
            try:
                ts = datetime.datetime(int(year), int(month), int(day), int(hh), int(mm))
            except ValueError:
                continue
            messages.append({"ts": ts, "sender": canonical(sender), "text": body})
            continue
        m = NEW_MSG_RE.match(line)
        if m:
            day, month, yy, h, mm, ampm, sender, body = m.groups()
            hour = int(h) % 12 + (12 if ampm == "pm" else 0)
            try:
                ts = datetime.datetime(2000 + int(yy), int(month), int(day), hour, int(mm))
            except ValueError:
                continue
            messages.append({"ts": ts, "sender": canonical(sender), "text": body})
            continue
        if messages and " - " not in line[:22]:
            messages[-1]["text"] += "\n" + line
    return messages


def uk_to_ist(messages: list[dict]) -> None:
    """
    Converts message timestamps in-place from Europe/London local time to
    Asia/Kolkata. The Shridhar archive was exported on a UK phone, so the
    entire history is rendered in UK local time (incl. DST).
    """
    from zoneinfo import ZoneInfo
    uk, ist = ZoneInfo("Europe/London"), ZoneInfo("Asia/Kolkata")
    for msg in messages:
        aware = msg["ts"].replace(tzinfo=uk)
        msg["ts"] = aware.astimezone(ist).replace(tzinfo=None)


def message_meta(msg: dict) -> dict:
    """Per-message stats fodder. No chat text leaves this function."""
    text = msg["text"]
    return {
        "ts": msg["ts"].strftime("%Y-%m-%dT%H:%M"),
        "s": msg["sender"],
        "media": text.count("<Media omitted>"),
        "bangers": len(BANGER_RE.findall(text)),
        "deleted": 1 if DELETED_RE.match(text.strip()) else 0,
    }


def extract_links(msg: dict) -> list[dict]:
    """All music links in a message, with sender + timestamp attribution."""
    out = []
    for url in SPOTIFY_URL_RE.findall(msg["text"]):
        out.append({"ts": msg["ts"].strftime("%Y-%m-%dT%H:%M"), "s": msg["sender"],
                    "kind": "spotify", "url": url})
    for url in APPLE_URL_RE.findall(msg["text"]):
        out.append({"ts": msg["ts"].strftime("%Y-%m-%dT%H:%M"), "s": msg["sender"],
                    "kind": "apple", "url": url})
    return out
