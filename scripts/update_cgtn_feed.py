#!/usr/bin/env python3
"""Build a small cache of short, current CGTN Radio episodes."""

from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html import unescape
from pathlib import Path


SOURCE_URL = "https://radio.cgtn.com/downapiRES/radio/v1/classification/detail/groupType1_id25.json"
SOURCE_PAGE = "https://radio.cgtn.com"
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "cgtn-feed.json"
ITEMS_PER_FEED = 8


def clean_text(value: str) -> str:
    text = re.sub(r"<[^>]+>", " ", value or "")
    return re.sub(r"\s+", " ", unescape(text)).strip()[:500]


def duration_seconds(value: str) -> int:
    try:
        minutes, seconds = value.split(":", 1)
        return int(minutes) * 60 + int(seconds)
    except (AttributeError, TypeError, ValueError):
        return 0


def walk(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)


def fetch_json() -> dict:
    request = urllib.request.Request(
        SOURCE_URL,
        headers={
            "Accept": "application/json",
            "User-Agent": "IELTS-Sprint-Desk/1.0 (+https://github.com/hananhdang/ielts-sprint-desk-app)",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            return json.load(response)
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"failed to download CGTN feed: {error}") from error


def build_payload() -> dict[str, object]:
    candidates: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in walk(fetch_json()):
        audio = str(item.get("mediaUrl") or "").strip().replace(
            "https://radio-res.cgtn.com//", "https://radio-res.cgtn.com/"
        )
        duration = str(item.get("duration") or "").strip()
        seconds = duration_seconds(duration)
        if not re.match(r"^https://radio-res\.cgtn\.com/.+\.mp3(?:\?.*)?$", audio):
            continue
        if not 120 <= seconds <= 600:
            continue
        identity = str(item.get("id") or audio)
        if identity in seen:
            continue
        seen.add(identity)
        item_type = str(item.get("type") or "otherHistory").strip()
        title = str(item.get("title") or "CGTN Radio report").strip()
        item_id = str(item.get("id") or "").strip()
        official_page = (
            f"{SOURCE_PAGE}/news/{urllib.parse.quote(item_type, safe='')}/"
            f"{urllib.parse.quote(title, safe='')}/{urllib.parse.quote(item_id, safe='')}"
            if item_id
            else SOURCE_PAGE
        )
        candidates.append(
            {
                "title": title,
                "date": str(item.get("date") or "").strip(),
                "description": clean_text(str(item.get("info") or item.get("detail") or "")),
                "audio": audio,
                "link": str(item.get("linkUrl") or official_page).strip(),
                "guid": f"cgtn:{identity}",
                "duration": duration,
                "programme": str(item.get("columnName") or "CGTN Radio").strip(),
            }
        )
    candidates.sort(key=lambda item: (item["date"], item["guid"]), reverse=True)
    episodes = candidates[:ITEMS_PER_FEED]
    if len(episodes) < ITEMS_PER_FEED:
        raise RuntimeError(f"CGTN feed returned only {len(episodes)} suitable short episodes")
    return {
        "version": 1,
        "updatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "sourceUrl": SOURCE_URL,
        "episodes": episodes,
    }


def comparable(payload: dict[str, object]) -> dict[str, object]:
    return {key: value for key, value in payload.items() if key != "updatedAt"}


def write_if_changed(output: Path, payload: dict[str, object]) -> bool:
    if output.exists():
        try:
            existing = json.loads(output.read_text(encoding="utf-8"))
            if comparable(existing) == comparable(payload):
                print(f"No feed changes; kept {output}")
                return False
        except (json.JSONDecodeError, OSError):
            pass
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp_name = tempfile.mkstemp(prefix=f".{output.name}.", dir=output.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as temp_file:
            json.dump(payload, temp_file, ensure_ascii=False, indent=2)
            temp_file.write("\n")
        os.replace(temp_name, output)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)
    print(f"Updated {output}")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    try:
        write_if_changed(args.output.resolve(), build_payload())
    except RuntimeError as error:
        print(f"CGTN feed update failed: {error}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
