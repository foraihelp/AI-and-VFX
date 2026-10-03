"""Plain data objects shared by all modules."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class Video:
    video_id: str            # canonical ID, e.g. "yt:abc123" or "url:https://..."
    platform: str            # "YouTube", "Vimeo", ...
    title: str               # original title, never rewritten
    channel: str             # channel / creator name
    url: str                 # direct link to the video
    published: datetime      # timezone-aware (UTC)
    description: str = ""
    channel_id: str = ""     # YouTube channel ID when known (UC...)
    official: bool = False   # came from an official vendor channel/feed
    source: str = ""         # name of the source entry that found it
    duration_seconds: Optional[int] = None
    is_live: bool = False    # currently live or upcoming
    software: list[str] = field(default_factory=list)   # software ids, config order
    kind: str = "other"      # release | webinar | workflow | tutorial | other
    score: int = 0
    hint: list[str] = field(default_factory=list)       # software ids the source says it covers
    trust_hint: bool = False  # True = source is single-product, so the hint needs no keyword match
