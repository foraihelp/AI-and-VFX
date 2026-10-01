"""Seen-video state kept in a small JSON file (committed by the workflow)."""
from __future__ import annotations

import json
import logging
import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable, Optional

from .models import Video

log = logging.getLogger(__name__)
KEEP_DAYS = 400      # forget IDs older than this; far beyond any lookback window


class State:
    def __init__(self, seen: Optional[dict] = None, last_run: Optional[datetime] = None):
        self.seen: dict[str, dict] = seen or {}
        self.last_run = last_run

    @property
    def is_first_run(self) -> bool:
        return self.last_run is None and not self.seen

    @property
    def seen_ids(self) -> set[str]:
        return set(self.seen)

    @classmethod
    def load(cls, path: Path) -> "State":
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
            last = data.get("last_run")
            return cls(dict(data.get("seen") or {}),
                       datetime.fromisoformat(last) if last else None)
        except FileNotFoundError:
            return cls()
        except (ValueError, OSError, AttributeError) as exc:
            # A corrupt state file must not silently flood the inbox with a backlog.
            raise RuntimeError(f"State file {path} is unreadable ({exc}). "
                               "Fix or delete it (deleting = first-run behaviour).") from None

    def mark_sent(self, videos: Iterable[Video], now: datetime) -> None:
        for v in videos:
            self.seen[v.video_id] = {"first_seen": now.isoformat(timespec="seconds"),
                                     "published": v.published.isoformat(timespec="seconds")}
        cutoff = (now - timedelta(days=KEEP_DAYS)).isoformat()
        self.seen = {k: v for k, v in self.seen.items() if v.get("first_seen", "") >= cutoff}
        self.last_run = now

    def save(self, path: Path) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"version": 1,
                   "last_run": self.last_run.isoformat(timespec="seconds") if self.last_run else None,
                   "seen": dict(sorted(self.seen.items()))}
        fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")   # atomic write
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2)
            fh.write("\n")
        os.replace(tmp, path)


def lookback_start(state: State, now: datetime, lookback_hours: int, initial_hours: int) -> datetime:
    hours = initial_hours if state.is_first_run else lookback_hours
    return now - timedelta(hours=hours)
