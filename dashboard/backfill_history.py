"""
ONE-TIME local script: parses the Shridhar archive (full chat Aug 2021 ->
Jan 2026, UK-time) into dashboard/history.json — message metadata and music
links only. No chat text is written, so the output is safe to commit.

generate.py splices this with the current Drive export at the point where
the new export's coverage begins.
"""
import os
import sys
import json

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, os.path.dirname(__file__))
from common import parse_chat, uk_to_ist, message_meta, extract_links

ARCHIVE = r"C:\Users\gupta\Downloads\WhatsApp Chat with Mandatory vibe compliance shridhar\WhatsApp Chat with Mandatory vibe compliance.txt"
OUTPUT = os.path.join(os.path.dirname(__file__), "history.json")


def main():
    with open(ARCHIVE, "r", encoding="utf-8") as f:
        messages = parse_chat(f.read())
    print(f"Parsed {len(messages)} messages "
          f"({messages[0]['ts']:%d %b %Y} -> {messages[-1]['ts']:%d %b %Y}, UK time)")

    uk_to_ist(messages)
    print(f"Converted to IST ({messages[0]['ts']:%d %b %Y %H:%M} -> {messages[-1]['ts']:%d %b %Y %H:%M})")

    links = [link for msg in messages for link in extract_links(msg)]
    history = {
        "source": "shridhar-archive-jan2026",
        "messages": [message_meta(m) for m in messages],
        "links": links,
    }
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False)

    senders = sorted({m["sender"] for m in messages})
    print(f"Wrote {OUTPUT}: {len(history['messages'])} messages, {len(links)} links")
    print(f"Senders: {', '.join(senders)}")


if __name__ == "__main__":
    main()
