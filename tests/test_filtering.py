from datetime import timedelta

from video_digest.filtering import classify, dedupe, is_short, select
from tests.helpers import NOW, SOURCES, make

SINCE = NOW - timedelta(days=30)


def pick(*videos, seen=frozenset(), **kw):
    return select(videos, SOURCES, since=SINCE, seen=set(seen), **kw)


def test_relevant_nuke_video_matches():
    out = pick(make("Nuke compositing tutorial: keying"))
    assert out[0].software == ["nuke"] and out[0].kind == "tutorial"


def test_ambiguous_words_rejected():
    assert pick(make("Tactical nuke compilation", desc="Warzone fun")) == []
    assert pick(make("Best mocha latte recipe")) == []
    assert pick(make("Mocha.js unit testing", desc="javascript test runner")) == []


def test_weak_term_needs_context():
    assert pick(make("Nuke is great")) == []
    assert pick(make("Nuke is great for VFX comp work"))


def test_mocha_pro_and_comfy_spelling_variants():
    assert pick(make("Boris FX Mocha Pro 2026 tour", vid="a"))[0].software == ["mocha"]
    assert pick(make("My Comfy UI setup", vid="b"))[0].software == ["comfyui"]
    assert pick(make("ComfyUI workflow for video", vid="c"))


def test_trust_hint_for_single_product_channel():
    v = make("Community call", official=True, hint=["comfyui"], trust_hint=True)
    assert pick(v)[0].software == ["comfyui"]
    v2 = make("Community call", official=True, hint=["comfyui"], trust_hint=False)
    assert pick(v2) == []


def test_shorts_excluded_by_default():
    assert is_short(make("x #Shorts")) and is_short(make("x", duration_seconds=45))
    assert pick(make("Nuke vfx tip #shorts")) == []
    assert pick(make("Nuke vfx tip #shorts"), include_shorts=True)


def test_live_old_and_seen_excluded():
    assert pick(make("Nuke vfx stream", is_live=True)) == []
    assert pick(make("Nuke vfx news", hours_ago=24 * 40)) == []
    assert pick(make("Nuke vfx news", vid="seen1"), seen={"yt:seen1"}) == []


def test_ranking_official_release_first_then_newest():
    a = make("Nuke vfx tutorial old", vid="a", hours_ago=30)
    b = make("Nuke vfx tutorial new", vid="b", hours_ago=2)
    c = make("Nuke 17 release notes", vid="c", hours_ago=40, official=True)
    assert [v.video_id for v in pick(a, b, c)] == ["yt:c", "yt:b", "yt:a"]


def test_dedupe_same_id_and_reupload():
    a = make("ComfyUI workflow", vid="a", channel="X", desc="short")
    a2 = make("ComfyUI workflow", vid="a", channel="X", desc="a longer description here", official=True)
    merged = dedupe([a, a2])
    assert len(merged) == 1 and merged[0].official
    r1 = make("ComfyUI Workflow!", vid="1", channel="X", hours_ago=10)
    r2 = make("comfyui workflow", vid="2", channel="x", hours_ago=2)
    kept = dedupe([r1, r2])
    assert len(kept) == 1 and kept[0].video_id == "yt:1"
    assert len(dedupe([r1, make("comfyui workflow", vid="3", channel="Other")])) == 2


def test_classify_labels():
    rules = SOURCES.type_rules
    assert classify(make("Mocha Pro 2026 release notes"), rules) == "release"
    assert classify(make("Foundry webinar on deep comp"), rules) == "webinar"
    assert classify(make("How to roto in Silhouette"), rules) == "tutorial"
    assert classify(make("My ComfyUI workflow"), rules) == "workflow"
    assert classify(make("Random chat"), rules) == "other"


def test_global_noise_terms():
    assert pick(make("Nuke vfx reaction video")) == []
