"""Find candidate videos: YouTube Data API v3, YouTube channel RSS, generic feeds.

Only official APIs and feeds are used - no page scraping.
"""
from __future__ import annotations

import json
import logging
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Callable, Iterable, Optional
from urllib.parse import parse_qs, quote, urlencode, urlparse

from .config import Sources
from .http_client import HttpError, redact, request
from .models import Video

log = logging.getLogger(__name__)

API = "https://www.googleapis.com/youtube/v3"
YT_FEED = "https://www.youtube.com/feeds/videos.xml?channel_id={}"
Fetch = Callable[[str], bytes]
_DURATION = re.compile(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?")


def parse_iso_datetime(text: str) -> datetime:
    dt = datetime.fromisoformat(text.strip().replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def parse_duration(text: str) -> Optional[int]:
    m = _DURATION.fullmatch(text or "")
    if not m:
        return None
    h, mi, s = (int(x or 0) for x in m.groups())
    return h * 3600 + mi * 60 + s


def youtube_id_from_url(url: str) -> Optional[str]:
    u = urlparse(url)
    host = u.netloc.lower().removeprefix("www.").removeprefix("m.")
    if host == "youtu.be":
        return u.path.strip("/").split("/")[0] or None
    if host in {"youtube.com", "music.youtube.com"}:
        if u.path == "/watch":
            return (parse_qs(u.query).get("v") or [None])[0]
        m = re.match(r"/(?:shorts|embed|live)/([\w-]{11})", u.path)
        if m:
            return m.group(1)
    return None


def canonical_id(url: str) -> str:
    yt = youtube_id_from_url(url)
    if yt:
        return f"yt:{yt}"
    u = urlparse(url)
    return "url:" + f"{u.netloc.lower()}{u.path.rstrip('/')}"


# --------------------------------------------------------------------- YouTube API
class YouTubeAPI:
    def __init__(self, api_key: str, fetch: Optional[Fetch] = None):
        self.key = api_key
        self.fetch = fetch or (lambda url: request(url))

    def _get(self, endpoint: str, **params) -> dict:
        url = f"{API}/{endpoint}?" + urlencode({**params, "key": self.key})
        return json.loads(self.fetch(url))

    def resolve_handle(self, handle: str) -> Optional[tuple[str, str]]:
        data = self._get("channels", part="snippet", forHandle=handle.lstrip("@"))
        items = data.get("items") or []
        return (items[0]["id"], items[0]["snippet"]["title"]) if items else None

    def channel_uploads(self, channel_id: str, limit: int = 15) -> list[str]:
        playlist = "UU" + channel_id[2:]          # uploads playlist of a channel
        data = self._get("playlistItems", part="contentDetails", playlistId=playlist, maxResults=limit)
        return [i["contentDetails"]["videoId"] for i in data.get("items", [])]

    def search(self, query: str, published_after: datetime, limit: int = 25) -> list[str]:
        data = self._get("search", part="id", q=query, type="video", order="date", maxResults=limit,
                         publishedAfter=published_after.strftime("%Y-%m-%dT%H:%M:%SZ"),
                         relevanceLanguage="en", safeSearch="none")
        return [i["id"]["videoId"] for i in data.get("items", []) if i.get("id", {}).get("videoId")]

    def details(self, ids: Iterable[str]) -> list[dict]:
        ids = list(dict.fromkeys(ids))
        out: list[dict] = []
        for i in range(0, len(ids), 50):
            data = self._get("videos", part="snippet,contentDetails", id=",".join(ids[i:i + 50]))
            out += data.get("items", [])
        return out


def video_from_api_item(item: dict, *, official: bool, source: str) -> Video:
    sn = item["snippet"]
    vid = item["id"]
    live = sn.get("liveBroadcastContent", "none") in {"live", "upcoming"}
    return Video(
        video_id=f"yt:{vid}", platform="YouTube", title=sn.get("title", ""),
        channel=sn.get("channelTitle", ""), url=f"https://www.youtube.com/watch?v={vid}",
        published=parse_iso_datetime(sn["publishedAt"]), description=sn.get("description", ""),
        official=official, source=source,
        duration_seconds=parse_duration(item.get("contentDetails", {}).get("duration", "")),
        is_live=live,
    )


# --------------------------------------------------------------------------- feeds
def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _child_text(el: ET.Element, name: str) -> str:
    for c in el:
        if _local(c.tag) == name and c.text:
            return c.text.strip()
    return ""


def parse_feed(xml_bytes: bytes, *, platform: str, official: bool, source: str,
               default_channel: str = "") -> list[Video]:
    """Parse Atom (YouTube, Vimeo, PeerTube...) or RSS 2.0 into Video objects."""
    root = ET.fromstring(xml_bytes)
    feed_title = default_channel or _child_text(root, "title")
    videos: list[Video] = []
    entries = [e for e in root.iter() if _local(e.tag) in {"entry", "item"}]
    for e in entries:
        title = _child_text(e, "title")
        link = ""
        for c in e:
            if _local(c.tag) == "link":
                href = c.get("href") or (c.text or "").strip()
                if href and (c.get("rel") in (None, "alternate") or not c.get("href")):
                    link = href
                    break
        date_text = _child_text(e, "published") or _child_text(e, "updated") or _child_text(e, "pubDate")
        if not (title and link and date_text):
            continue
        try:
            published = parse_iso_datetime(date_text) if "T" in date_text else parsedate_to_datetime(date_text)
        except (ValueError, TypeError):
            continue
        if published.tzinfo is None:
            published = published.replace(tzinfo=timezone.utc)
        author = ""
        for c in e:
            if _local(c.tag) == "author":
                author = _child_text(c, "name") or (c.text or "").strip()
        desc = ""
        for c in e.iter():
            if _local(c.tag) in {"description", "summary", "content"} and c.text and c.text.strip():
                desc = c.text.strip()
                break
        videos.append(Video(video_id=canonical_id(link), platform=platform, title=title,
                            channel=author or feed_title, url=link, published=published,
                            description=desc, official=official, source=source))
    return videos


# ------------------------------------------------------------------ orchestration
def discover(sources: Sources, *, since: datetime, api_key: str = "",
             fetch: Optional[Fetch] = None) -> tuple[list[Video], list[str]]:
    """Return (videos, warnings). One failing source never stops the others."""
    fetch = fetch or (lambda url: request(url))
    api = YouTubeAPI(api_key, fetch) if api_key else None
    videos: list[Video] = []
    warnings: list[str] = []

    def add(found: list[Video], entry: dict) -> None:
        for v in found:
            if v.published >= since:
                v.hint = list(entry.get("software") or [])
                v.trust_hint = bool(entry.get("trust_all", False))
                videos.append(v)

    for ch in sources.channels:
        name = ch.get("name", "channel")
        try:
            cid = ch.get("channel_id") or ""
            if not cid and api and ch.get("handle"):
                res = api.resolve_handle(ch["handle"])
                cid = res[0] if res else ""
            if not cid:
                warnings.append(f"Channel '{name}' skipped: no channel_id "
                                f"(run `python -m video_digest resolve-channels`).")
                continue
            official = bool(ch.get("official", False))
            if api:
                items = api.details(api.channel_uploads(cid))
                found = [video_from_api_item(i, official=official, source=name) for i in items]
            else:
                found = parse_feed(fetch(YT_FEED.format(cid)), platform="YouTube",
                                   official=official, source=name)
            add(found, ch)
        except (HttpError, ET.ParseError, KeyError, ValueError, json.JSONDecodeError) as exc:
            warnings.append(f"Channel '{name}' failed: {redact(exc)}")
            log.warning(warnings[-1])

    if api:
        for q in sources.searches:
            try:
                ids = api.search(q["query"], since)
                items = api.details(ids)
                add([video_from_api_item(i, official=False, source=f"search: {q['query']}") for i in items], q)
            except (HttpError, KeyError, ValueError, json.JSONDecodeError) as exc:
                warnings.append(f"Search '{q.get('query')}' failed: {redact(exc)}")
                log.warning(warnings[-1])
    elif sources.searches:
        log.info("No YOUTUBE_API_KEY: %d search queries skipped (channel RSS only).", len(sources.searches))

    for fd in sources.feeds:
        name = fd.get("name", fd.get("url", "feed"))
        try:
            found = parse_feed(fetch(fd["url"]), platform=fd.get("platform", "Web"),
                               official=bool(fd.get("official", False)), source=name)
            add(found, fd)
        except (HttpError, ET.ParseError, KeyError) as exc:
            warnings.append(f"Feed '{name}' failed: {redact(exc)}")
            log.warning(warnings[-1])

    log.info("Discovered %d candidate videos (%d warnings).", len(videos), len(warnings))
    return videos, warnings
