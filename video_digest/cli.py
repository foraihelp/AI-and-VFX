"""Command line entry point.

  python -m video_digest                 dry run: prints the digest, sends nothing, saves nothing
  python -m video_digest --send          sends the email and records the videos as seen
  python -m video_digest --sample        use offline sample data (no network)
  python -m video_digest test-email      send a short test email
  python -m video_digest resolve-channels  look up channel IDs from @handles (needs YOUTUBE_API_KEY)
"""
from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from . import discovery
from .config import BASE_DIR, ConfigError, Settings, load_dotenv, load_sources
from .discovery import YouTubeAPI
from .emailer import EmailError, send_email
from .filtering import select
from .formatting import build_digest
from .http_client import HttpError, redact
from .state import State, lookback_start

log = logging.getLogger("video_digest")
SAMPLE_DIR = BASE_DIR / "sample_data"


def run_digest(settings: Settings, *, send: bool, sample: bool = False,
               now: Optional[datetime] = None, html_out: Optional[Path] = None,
               fetch=None) -> int:
    now = now or datetime.now(timezone.utc)
    sources = load_sources(settings.sources_path)
    state = State() if sample else State.load(settings.state_path)
    since = lookback_start(state, now, settings.lookback_hours, settings.initial_lookback_hours)
    if state.is_first_run:
        log.info("First run: looking back %dh only.", settings.initial_lookback_hours)

    if sample:
        videos, warnings = _sample_videos(sources)
        since = datetime(2000, 1, 1, tzinfo=timezone.utc)
    else:
        videos, warnings = discovery.discover(sources, since=since, api_key=settings.youtube_api_key, fetch=fetch)

    chosen = select(videos, sources, since=since, seen=state.seen_ids, include_shorts=settings.include_shorts)
    digest = build_digest(chosen, sources.software, tz=settings.timezone, summaries=settings.summaries,
                          max_per=settings.max_items_per_software, now=now)
    for w in warnings:
        digest.text += f"\n[warning] {w}"
    if html_out:
        html_out.write_text(digest.html, encoding="utf-8")

    if not send:
        print(f"Subject: {digest.subject}\n\n{digest.text}\n")
        print("(dry run: nothing sent, state not changed)")
        return 0
    if digest.count == 0 and not settings.send_empty:
        log.info("No new videos and SEND_EMPTY=false: skipping email.")
    else:
        send_email(settings, digest.subject, digest.text, digest.html)
        log.info("Email sent (%d videos).", digest.count)
    state.mark_sent(chosen, now)          # only reached if sending succeeded
    state.save(settings.state_path)
    return 0


def _sample_videos(sources):
    fetch_map = {"atom": (SAMPLE_DIR / "sample_feed.xml").read_bytes()}
    vids = discovery.parse_feed(fetch_map["atom"], platform="YouTube", official=False, source="sample")
    official = discovery.parse_feed((SAMPLE_DIR / "sample_official_feed.xml").read_bytes(),
                                    platform="YouTube", official=True, source="sample official")
    for v in official:
        v.hint, v.trust_hint = ["comfyui"], True
    return vids + official, []


def resolve_channels(settings: Settings) -> int:
    if not settings.youtube_api_key:
        print("Set YOUTUBE_API_KEY first.")
        return 2
    api = YouTubeAPI(settings.youtube_api_key)
    sources = load_sources(settings.sources_path)
    for ch in sources.channels:
        handle = ch.get("handle")
        if not handle:
            continue
        try:
            res = api.resolve_handle(handle)
        except (HttpError, KeyError) as exc:
            print(f"{ch['name']}: lookup failed ({redact(exc)})")
            continue
        print(f"{ch['name']} ({handle}): " + (f"channel_id: {res[0]}   # YouTube says it is '{res[1]}'" if res else "not found"))
    print("\nCheck each channel name looks right, then paste channel_id into config/sources.yaml.")
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    p = argparse.ArgumentParser(prog="video_digest", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("command", nargs="?", default="run", choices=["run", "test-email", "resolve-channels"])
    p.add_argument("--send", action="store_true", help="actually send the email and save state")
    p.add_argument("--sample", action="store_true", help="use bundled sample data instead of the network")
    p.add_argument("--html-out", type=Path, help="also write the HTML email to this file")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s", stream=sys.stderr)
    load_dotenv(BASE_DIR / ".env")
    try:
        settings = Settings.from_env()
        if args.command == "resolve-channels":
            return resolve_channels(settings)
        if args.command == "test-email":
            send_email(settings, "Video digest: test email",
                       "If you can read this, email delivery works.",
                       "<p>If you can read this, email delivery works.</p>")
            print("Test email sent.")
            return 0
        return run_digest(settings, send=args.send, sample=args.sample, html_out=args.html_out)
    except (ConfigError, EmailError, RuntimeError) as exc:
        log.error("%s", redact(exc))
        return 1
