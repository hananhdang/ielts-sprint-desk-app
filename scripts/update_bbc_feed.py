#!/usr/bin/env python3
"""Build a small, browser-friendly cache of the latest BBC podcast episodes."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from html.parser import HTMLParser
from pathlib import Path


FEEDS = {
    "six": {
        "label": "6 Minute English",
        "url": "https://podcasts.files.bbci.co.uk/p02pc9tn.rss",
    },
    "news": {
        "label": "Global News Podcast",
        "url": "https://podcasts.files.bbci.co.uk/p02nq0gn.rss",
    },
    "drama": {
        "label": "Learning English Drama",
        "url": "https://podcasts.files.bbci.co.uk/p02pc9s1.rss",
    },
}

DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "bbc-feed.json"
ITEMS_PER_FEED = 8
DESCRIPTION_LIMIT = 500
LEARNING_EPISODE_RE = re.compile(
    r"https://www\.bbc\.co\.uk/learningenglish/english/features/6-minute-english[^\"'<>\s]+"
)
DIRECT_AUDIO_RE = re.compile(
    r"https://downloads\.bbc\.co\.uk/learningenglish/[^\"'<>\s]+\.mp3"
)


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def clean_description(value: str) -> str:
    parser = _TextExtractor()
    try:
        parser.feed(value or "")
        parser.close()
        text = " ".join(parser.parts)
    except Exception:
        text = re.sub(r"<[^>]+>", " ", value or "")
    text = re.sub(r"\s+", " ", unescape(text)).strip()
    if len(text) <= DESCRIPTION_LIMIT:
        return text
    return text[: DESCRIPTION_LIMIT - 1].rstrip() + "…"


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def child_text(item: ET.Element, name: str) -> str:
    for child in item:
        if local_name(child.tag) == name:
            return (child.text or "").strip()
    return ""


def audio_url(item: ET.Element) -> str:
    fallback = ""
    for child in item:
        name = local_name(child.tag)
        url = (child.attrib.get("url") or "").strip()
        if name == "enclosureSecure" and url.startswith("https://"):
            return url
        if name == "enclosure" and url:
            fallback = url
    if fallback.startswith("http://"):
        fallback = "https://" + fallback.removeprefix("http://")
    return fallback


def date_key(value: str) -> datetime:
    try:
        parsed = parsedate_to_datetime(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except (TypeError, ValueError, OverflowError):
        return datetime.min.replace(tzinfo=timezone.utc)


def direct_learning_audio(page_url: str) -> str:
    if not page_url:
        return ""
    try:
        html = fetch(
            page_url,
            retries=2,
            timeout=30,
            accept="text/html,application/xhtml+xml;q=0.9",
        ).decode("utf-8", errors="ignore")
    except RuntimeError as error:
        print(f"Direct BBC audio lookup failed for {page_url}: {error}", file=sys.stderr)
        return ""
    match = DIRECT_AUDIO_RE.search(unescape(html).replace(r"\/", "/"))
    return match.group(0) if match else ""


def parse_feed(xml_data: bytes, feed_key: str) -> list[dict[str, str]]:
    root = ET.fromstring(xml_data)
    episodes: list[dict[str, str]] = []
    for item in (element for element in root.iter() if local_name(element.tag) == "item"):
        audio = audio_url(item)
        if not audio:
            continue
        raw_description = child_text(item, "description")
        link = child_text(item, "link")
        if link.startswith("http://"):
            link = "https://" + link.removeprefix("http://")
        learning_match = LEARNING_EPISODE_RE.search(unescape(raw_description)) if feed_key == "six" else None
        episodes.append(
            {
                "title": child_text(item, "title") or "BBC episode",
                "date": child_text(item, "pubDate"),
                "description": clean_description(raw_description),
                "audio": audio,
                "link": link,
                "guid": child_text(item, "guid"),
                "_learningUrl": learning_match.group(0) if learning_match else "",
            }
        )
    episodes.sort(key=lambda episode: date_key(episode["date"]), reverse=True)
    selected = episodes[:ITEMS_PER_FEED]
    if feed_key == "six":
        for episode in selected:
            learning_url = episode.get("_learningUrl", "")
            direct_audio = direct_learning_audio(learning_url)
            if direct_audio:
                episode["audio"] = direct_audio
                episode["link"] = learning_url
    for episode in selected:
        episode.pop("_learningUrl", None)
    return selected


def fetch(
    url: str,
    retries: int = 3,
    timeout: int = 45,
    accept: str = "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": accept,
            "User-Agent": "IELTS-Sprint-Desk/1.0 (+https://github.com/hananhdang/ielts-sprint-desk-app)",
        },
    )
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            last_error = error
            if attempt < retries:
                time.sleep(attempt * 2)
    raise RuntimeError(f"failed to download {url} after {retries} attempts: {last_error}")


def current_timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def build_payload() -> dict[str, object]:
    feeds: dict[str, object] = {}
    for key, metadata in FEEDS.items():
        episodes = parse_feed(fetch(metadata["url"]), key)
        if len(episodes) < ITEMS_PER_FEED:
            raise RuntimeError(
                f"{metadata['label']} returned only {len(episodes)} playable episodes; "
                f"expected {ITEMS_PER_FEED}"
            )
        feeds[key] = {
            "label": metadata["label"],
            "sourceUrl": metadata["url"],
            "episodes": episodes,
        }
        print(f"Fetched {len(episodes)} episodes: {metadata['label']}")
    return {"version": 2, "updatedAt": current_timestamp(), "feeds": feeds}


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
    content = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    descriptor, temp_name = tempfile.mkstemp(prefix=f".{output.name}.", dir=output.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as temp_file:
            temp_file.write(content)
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
    except (ET.ParseError, RuntimeError) as error:
        print(f"BBC feed update failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
