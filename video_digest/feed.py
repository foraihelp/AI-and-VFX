"""Machine-readable feed (state/feed.json) that the desktop app can sync from GitHub."""
from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Sequence

from .config import Software
from .models import Video

DESCRIPTION_CHARS = 400


def build_feed(videos: Sequence[Video], software: Sequence[Software], *, now: datetime, days: int) -> dict:
    return {
        "version": 1,
        "generated_at": now.isoformat(timespec="seconds"),
        "window_days": days,
        "software": [{"id": s.id, "name": s.name} for s in software],
        "videos": [{
            "id": v.video_id, "platform": v.platform, "title": v.title, "channel": v.channel,
            "url": v.url, "published": v.published.isoformat(timespec="seconds"),
            "description": v.description[:DESCRIPTION_CHARS], "official": v.official,
            "kind": v.kind, "software": v.software, "score": v.score,
        } for v in videos],
    }


def write_feed(path: Path, feed: dict) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")      # atomic write
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(feed, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    os.replace(tmp, path)
