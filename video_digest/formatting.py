"""Build the digest subject, plain-text and HTML bodies."""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from html import escape
from typing import Sequence
from zoneinfo import ZoneInfo

from .config import Software
from .models import Video

KIND_LABEL = {"release": "Release / News", "tutorial": "Tutorial", "workflow": "Workflow",
              "webinar": "Webinar", "other": "Other"}
SNIPPET_CHARS = 200


@dataclass
class Digest:
    subject: str
    text: str
    html: str
    count: int


def fmt_date(dt: datetime, tz: str) -> str:
    return dt.astimezone(ZoneInfo(tz)).strftime("%d %b %Y, %H:%M %Z")


def snippet(v: Video) -> str:
    """First part of the creator's own description (never generated text)."""
    text = re.sub(r"https?://\S+", "", v.description)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > SNIPPET_CHARS:
        text = text[:SNIPPET_CHARS].rsplit(" ", 1)[0] + "…"
    return text


def group(videos: Sequence[Video], software: Sequence[Software], max_per: int):
    """-> [(Software, shown_videos, hidden_count)] in config order; a video appears once."""
    groups = []
    for sw in software:
        items = [v for v in videos if v.software and v.software[0] == sw.id]
        if items:
            groups.append((sw, items[:max_per], max(0, len(items) - max_per)))
    return groups


def build_digest(videos: Sequence[Video], software: Sequence[Software], *, tz: str = "UTC",
                 summaries: str = "description", max_per: int = 15, now: datetime) -> Digest:
    names = {s.id: s.name for s in software}
    day = now.astimezone(ZoneInfo(tz)).strftime("%d %b %Y")
    n = len(videos)
    if n == 0:
        subject = f"AI & VFX video digest - {day}: no new videos"
        body = "No new videos today for Nuke, Silhouette, Mocha or ComfyUI."
        return Digest(subject, body, f"<p>{escape(body)}</p>", 0)
    subject = f"AI & VFX video digest - {day}: {n} new video{'s' if n != 1 else ''}"
    lines = [f"AI & VFX video digest - {day}", f"{n} new video{'s' if n != 1 else ''}", ""]
    h = [f'<div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;color:#222">',
         f'<h2 style="margin-bottom:0">AI &amp; VFX video digest</h2>',
         f'<p style="color:#666;margin-top:4px">{escape(day)} &middot; {n} new video{"s" if n != 1 else ""}</p>']
    for sw, items, hidden in group(videos, software, max_per):
        lines += [f"== {sw.name} ({len(items) + hidden}) ==", ""]
        h.append(f'<h3 style="border-bottom:2px solid #ddd;padding-bottom:4px">{escape(sw.name)} '
                 f'<span style="color:#888;font-weight:normal">({len(items) + hidden})</span></h3>')
        for v in items:
            label = KIND_LABEL.get(v.kind, "Other") + (" - Official" if v.official else "")
            also = [names[s] for s in v.software[1:] if s in names]
            meta = f"{v.channel} | {fmt_date(v.published, tz)} | {v.platform} | {label}"
            lines += [v.title, f"  {meta}"]
            h.append('<div style="margin:0 0 14px 0">'
                     f'<a href="{escape(v.url, quote=True)}" style="font-size:15px;font-weight:bold;'
                     f'color:#1a56c4;text-decoration:none">{escape(v.title)}</a><br>'
                     f'<span style="color:#555;font-size:13px">{escape(meta)}</span>')
            if also:
                lines.append(f"  Also covers: {', '.join(also)}")
                h.append(f'<br><span style="color:#555;font-size:13px">Also covers: {escape(", ".join(also))}</span>')
            if summaries == "description" and snippet(v):
                lines.append(f"  Description: {snippet(v)}")
                h.append(f'<br><span style="font-size:13px;color:#333">{escape(snippet(v))}</span>')
            lines += [f"  {v.url}", ""]
            h.append("</div>")
        if hidden:
            lines += [f"  ...and {hidden} more (raise MAX_ITEMS_PER_SOFTWARE to see them)", ""]
            h.append(f'<p style="color:#888">...and {hidden} more.</p>')
    h.append('<p style="color:#999;font-size:12px">Titles, channels and descriptions are shown as '
             'published by the creators.</p></div>')
    return Digest(subject, "\n".join(lines), "\n".join(h), n)
