from datetime import datetime, timedelta, timezone

from video_digest.config import BASE_DIR, load_sources
from video_digest.models import Video

NOW = datetime(2026, 10, 2, 7, 0, tzinfo=timezone.utc)
SOURCES = load_sources(BASE_DIR / "config" / "sources.yaml")


def make(title, *, vid="abc", channel="Chan", hours_ago=5, desc="", official=False, **kw):
    return Video(video_id=f"yt:{vid}", platform="YouTube", title=title, channel=channel,
                 url=f"https://www.youtube.com/watch?v={vid}", published=NOW - timedelta(hours=hours_ago),
                 description=desc, official=official, **kw)
