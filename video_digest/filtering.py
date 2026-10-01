"""Relevance matching, classification, ranking and de-duplication."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Iterable

from .config import Software, Sources
from .models import Video

DESCRIPTION_WINDOW = 300     # characters of description considered for matching
SHORT_MAX_SECONDS = 60
TYPE_SCORE = {"release": 50, "webinar": 25, "workflow": 15, "tutorial": 10, "other": 0}
OFFICIAL_SCORE = 100


def _term_regex(term: str) -> str:
    # "mocha pro" also matches "mocha-pro" / "mochapro"; whole words only.
    parts = [re.escape(p) for p in re.split(r"[\s_-]+", term.strip()) if p]
    return r"(?<!\w)" + r"[\s_-]*".join(parts) + r"(?!\w)"


def _any(terms: Iterable[str], text: str) -> bool:
    return any(re.search(_term_regex(t), text, re.I) for t in terms if t.strip())


def is_short(v: Video) -> bool:
    return (v.duration_seconds is not None and v.duration_seconds <= SHORT_MAX_SECONDS) \
        or "/shorts/" in v.url or bool(re.search(r"#shorts?\b", v.title, re.I))


def match_software(v: Video, software: Software) -> bool:
    desc = v.description[:DESCRIPTION_WINDOW]
    text = f"{v.title}\n{desc}"
    if _any(software.exclude, text):
        return False
    if v.trust_hint and software.id in v.hint:
        return True
    if _any(software.strong, text):
        return True
    return _any(software.weak, text) and _any(software.context, text)


def classify(v: Video, type_rules: dict[str, list[str]]) -> str:
    for kind in ("release", "webinar", "workflow", "tutorial"):
        if _any(type_rules.get(kind, []), v.title):
            return kind
    return "other"


def score(v: Video) -> int:
    return (OFFICIAL_SCORE if v.official else 0) + TYPE_SCORE.get(v.kind, 0)


def _norm_title(title: str) -> str:
    return re.sub(r"\W+", " ", title.lower()).strip()


def dedupe(videos: Iterable[Video]) -> list[Video]:
    """Merge duplicates: same canonical ID, or same title re-uploaded by the same channel."""
    by_id: dict[str, Video] = {}
    for v in videos:
        old = by_id.get(v.video_id)
        by_id[v.video_id] = v if old is None else _merge(old, v)
    by_title: dict[tuple[str, str], Video] = {}
    for v in by_id.values():
        key = (_norm_title(v.title), v.channel.lower())
        old = by_title.get(key)
        if old is None:
            by_title[key] = v
            continue
        # Re-upload: keep the official one, otherwise the original (earliest) upload.
        first, second = sorted((old, v), key=lambda x: (not x.official, x.published))
        first.official = first.official or second.official
        by_title[key] = first
    return list(by_title.values())


def _merge(a: Video, b: Video) -> Video:
    """Keep the richer record; combine the 'official' flag."""
    best, other = (a, b) if len(a.description) >= len(b.description) else (b, a)
    best.official = a.official or b.official
    if best.duration_seconds is None:
        best.duration_seconds = other.duration_seconds
    best.is_live = a.is_live or b.is_live
    best.trust_hint = best.trust_hint or other.trust_hint
    best.hint = list(dict.fromkeys(best.hint + other.hint))
    return best


def select(videos: Iterable[Video], sources: Sources, *, since: datetime, seen: set[str],
           include_shorts: bool = False) -> list[Video]:
    """Full pipeline. Returns relevant, new, labelled videos, ranked."""
    out: list[Video] = []
    for v in dedupe(videos):
        if v.video_id in seen or v.published < since or v.is_live:
            continue
        if not include_shorts and is_short(v):
            continue
        if _any(sources.exclude_title_terms, v.title):
            continue
        v.software = [s.id for s in sources.software if match_software(v, s)]
        if not v.software:
            continue
        v.kind = classify(v, sources.type_rules)
        v.score = score(v)
        out.append(v)
    # Highest tier first (official / release news), then newest first.
    out.sort(key=lambda v: (-v.score, -v.published.timestamp()))
    return out
