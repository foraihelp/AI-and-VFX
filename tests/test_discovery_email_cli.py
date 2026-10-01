import json
import smtplib
import urllib.error
from datetime import timedelta

import pytest

from tests.helpers import NOW, SOURCES
from video_digest import cli, discovery
from video_digest.config import Settings, Sources
from video_digest.emailer import EmailError, send_email
from video_digest.http_client import HttpError, redact, request

ATOM = b"""<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
<title>Chan</title><entry><title>Nuke vfx tutorial</title><link rel="alternate" href="https://www.youtube.com/watch?v=ABCDEFGHIJK"/>
<author><name>Creator</name></author><published>2026-10-01T10:00:00+00:00</published>
<media:group><media:description>desc</media:description></media:group></entry></feed>"""


def only_channels(channels):
    return Sources(software=SOURCES.software, channels=channels, searches=[], feeds=[],
                   exclude_title_terms=[], type_rules={})


def test_youtube_id_and_duration_helpers():
    assert discovery.canonical_id("https://youtu.be/ABCDEFGHIJK?t=3") == "yt:ABCDEFGHIJK"
    assert discovery.canonical_id("https://www.youtube.com/shorts/ABCDEFGHIJK") == "yt:ABCDEFGHIJK"
    assert discovery.canonical_id("https://vimeo.com/123/") == "url:vimeo.com/123"
    assert discovery.parse_duration("PT1H2M3S") == 3723 and discovery.parse_duration("PT45S") == 45


def test_parse_atom_feed():
    [v] = discovery.parse_feed(ATOM, platform="YouTube", official=False, source="s")
    assert v.video_id == "yt:ABCDEFGHIJK" and v.channel == "Creator" and v.description == "desc"


def test_discover_one_failing_source_does_not_stop_others():
    src = only_channels([{"name": "bad", "channel_id": "UCbad"},
                         {"name": "good", "channel_id": "UCgood", "software": ["nuke"]}])

    def fetch(url):
        if "UCbad" in url:
            raise HttpError("HTTP 500")
        return ATOM
    vids, warns = discovery.discover(src, since=NOW - timedelta(days=5), fetch=fetch)
    assert len(vids) == 1 and len(warns) == 1 and "bad" in warns[0]


def test_channel_without_id_is_skipped_with_warning():
    vids, warns = discovery.discover(only_channels([{"name": "noid", "handle": "@x"}]),
                                     since=NOW - timedelta(days=5), fetch=lambda u: ATOM)
    assert vids == [] and "noid" in warns[0]


def test_discover_via_api_flags_live_and_hides_key():
    calls = []

    def fetch(url):
        calls.append(url)
        if "/playlistItems" in url:
            return json.dumps({"items": [{"contentDetails": {"videoId": "ABCDEFGHIJK"}}]}).encode()
        return json.dumps({"items": [{"id": "ABCDEFGHIJK", "snippet": {
            "title": "Nuke vfx", "channelTitle": "C", "publishedAt": "2026-10-01T10:00:00Z",
            "description": "", "liveBroadcastContent": "live"}, "contentDetails": {"duration": "PT10M"}}]}).encode()
    src = only_channels([{"name": "c", "channel_id": "UC" + "x" * 22}])
    vids, _ = discovery.discover(src, since=NOW - timedelta(days=5), api_key="SECRETKEY", fetch=fetch)
    assert vids[0].is_live and vids[0].duration_seconds == 600
    assert any("SECRETKEY" in c for c in calls)            # sent to Google...
    assert "SECRETKEY" not in redact(calls[0])             # ...but never logged


def test_request_retries_transient_then_succeeds():
    attempts = []

    class Resp:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return b"ok"

    def opener(req, timeout):
        attempts.append(1)
        if len(attempts) < 3:
            raise urllib.error.HTTPError(req.full_url, 503, "x", {}, None)
        return Resp()
    sleeps = []
    assert request("https://x.test", opener=opener, sleep=sleeps.append) == b"ok"
    assert len(attempts) == 3 and len(sleeps) == 2


def test_request_does_not_retry_client_errors_and_redacts_key():
    n = []

    def opener(req, timeout):
        n.append(1)
        raise urllib.error.HTTPError(req.full_url, 403, "x", {}, None)
    with pytest.raises(HttpError) as e:
        request("https://x.test?key=SECRET", opener=opener, sleep=lambda s: None)
    assert len(n) == 1 and "SECRET" not in str(e.value)


def settings(**kw):
    base = {"EMAIL_TO": "me@example.com", "EMAIL_FROM": "d@example.com", "RESEND_API_KEY": "re_x"}
    base.update(kw)
    return Settings.from_env(base)


def test_resend_payload_and_error_has_no_secret():
    sent = {}

    def post(url, data, **kw):
        sent.update(json.loads(data))
    send_email(settings(), "S", "text", "<p>h</p>", post=post)
    assert sent["to"] == ["me@example.com"] and sent["text"] == "text" and sent["html"] == "<p>h</p>"

    def bad(url, data, **kw):
        raise HttpError("HTTP 422", 422, "invalid from")
    with pytest.raises(EmailError) as e:
        send_email(settings(), "S", "t", "h", post=bad)
    assert "re_x" not in str(e.value)


def test_smtp_sends_multipart_and_retries():
    class FakeSMTP:
        fails = 1
        messages = []

        def __enter__(self): return self
        def __exit__(self, *a): return False
        def login(self, u, p): pass

        def send_message(self, msg, **kw):
            if FakeSMTP.fails:
                FakeSMTP.fails -= 1
                raise smtplib.SMTPServerDisconnected("x")
            FakeSMTP.messages.append(msg)
    s = settings(EMAIL_PROVIDER="smtp", SMTP_HOST="h", SMTP_USER="u", SMTP_PASSWORD="p")
    send_email(s, "Sub", "plain", "<b>html</b>", smtp_factory=FakeSMTP, sleep=lambda x: None)
    msg = FakeSMTP.messages[0]
    assert msg.is_multipart() and {p.get_content_type() for p in msg.iter_parts()} == {"text/plain", "text/html"}


def sample_discover(*a, **k):
    return cli._sample_videos(None)[0], []


def test_cli_dry_run_sends_nothing_and_writes_no_state(tmp_path, capsys, monkeypatch):
    called = []
    monkeypatch.setattr(cli, "send_email", lambda *a, **k: called.append(1))
    s = settings(STATE_PATH=str(tmp_path / "seen.json"))
    assert cli.run_digest(s, send=False, sample=True, now=NOW) == 0
    assert not called and not (tmp_path / "seen.json").exists()
    assert "Foundry Nuke" in capsys.readouterr().out


def test_cli_send_records_state_and_does_not_resend(tmp_path, monkeypatch):
    sent = []
    monkeypatch.setattr(cli, "send_email", lambda st, subj, *a, **k: sent.append(subj))
    monkeypatch.setattr(cli.discovery, "discover", sample_discover)
    s = settings(STATE_PATH=str(tmp_path / "seen.json"), INITIAL_LOOKBACK_HOURS="100000")
    cli.run_digest(s, send=True, now=NOW)
    assert "6 new videos" in sent[0] and (tmp_path / "seen.json").exists()
    cli.run_digest(s, send=True, now=NOW)
    assert "no new videos" in sent[1]


def test_cli_skip_empty_and_failed_send_keeps_state(tmp_path, monkeypatch):
    monkeypatch.setattr(cli.discovery, "discover", lambda *a, **k: ([], []))
    sent = []
    monkeypatch.setattr(cli, "send_email", lambda *a, **k: sent.append(1))
    state = tmp_path / "seen.json"
    cli.run_digest(settings(STATE_PATH=str(state), SEND_EMPTY="false"), send=True, now=NOW)
    assert not sent

    def boom(*a, **k):
        raise EmailError("boom")
    monkeypatch.setattr(cli.discovery, "discover", sample_discover)
    monkeypatch.setattr(cli, "send_email", boom)
    state.unlink()
    with pytest.raises(EmailError):
        cli.run_digest(settings(STATE_PATH=str(state), INITIAL_LOOKBACK_HOURS="100000"), send=True, now=NOW)
    assert not state.exists()
