from datetime import timedelta

import pytest

from tests.helpers import NOW, SOURCES, make
from video_digest.filtering import select
from video_digest.formatting import build_digest
from video_digest.state import State, lookback_start


def digest(videos, **kw):
    chosen = select(videos, SOURCES, since=NOW - timedelta(days=60), seen=set())
    return build_digest(chosen, SOURCES.software, now=NOW, **kw)


def test_digest_groups_counts_and_links():
    d = digest([make("Nuke vfx tutorial", vid="n1", channel="A"),
                make("ComfyUI workflow tour", vid="c1", channel="B", official=True)])
    assert d.count == 2 and "2 new videos" in d.subject
    assert d.text.index("Foundry Nuke") < d.text.index("ComfyUI")
    assert "https://www.youtube.com/watch?v=n1" in d.text
    assert 'href="https://www.youtube.com/watch?v=c1"' in d.html


def test_html_escapes_untrusted_text():
    d = digest([make('Nuke vfx <script>alert(1)</script> "tutorial"', vid="x")])
    assert "<script>" not in d.html and "&lt;script&gt;" in d.html


def test_no_description_means_no_invented_summary():
    d = digest([make("Nuke vfx tutorial", vid="n1")])
    assert "Description:" not in d.text
    d2 = digest([make("Nuke vfx tutorial", vid="n1", desc="Real words. https://x.io")], summaries="description")
    assert "Description: Real words." in d2.text and "x.io" not in d2.text
    d3 = digest([make("Nuke vfx tutorial", vid="n1", desc="Real words.")], summaries="off")
    assert "Description:" not in d3.text


def test_timezone_display():
    d = digest([make("Nuke vfx tutorial", vid="n1", hours_ago=0)], tz="Asia/Tokyo")
    assert "16:00 JST" in d.text


def test_empty_digest_and_max_items():
    assert digest([]).count == 0 and "no new videos" in digest([]).subject
    many = [make(f"Nuke vfx tutorial {i}", vid=f"v{i}", channel=f"c{i}") for i in range(5)]
    assert "and 3 more" in digest(many, max_per=2).text


def test_state_roundtrip_first_run_and_lookback(tmp_path):
    p = tmp_path / "s.json"
    st = State.load(p)
    assert st.is_first_run
    assert lookback_start(st, NOW, 48, 72) == NOW - timedelta(hours=72)
    st.mark_sent([make("t", vid="a")], NOW)
    st.save(p)
    again = State.load(p)
    assert "yt:a" in again.seen_ids and not again.is_first_run
    assert lookback_start(again, NOW, 48, 72) == NOW - timedelta(hours=48)


def test_corrupt_state_raises(tmp_path):
    p = tmp_path / "s.json"
    p.write_text("{not json")
    with pytest.raises(RuntimeError):
        State.load(p)
