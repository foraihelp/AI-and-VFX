import pytest

from video_digest.config import ConfigError, Settings, parse_sources


def test_defaults():
    s = Settings.from_env({})
    assert s.lookback_hours == 48 and s.send_empty is True and s.email_provider == "resend"


def test_overrides_and_bool_parsing():
    s = Settings.from_env({"LOOKBACK_HOURS": "24", "SEND_EMPTY": "false", "DIGEST_TIMEZONE": "Europe/London"})
    assert s.lookback_hours == 24 and s.send_empty is False and s.timezone == "Europe/London"


@pytest.mark.parametrize("env", [{"LOOKBACK_HOURS": "abc"}, {"LOOKBACK_HOURS": "0"},
                                 {"EMAIL_PROVIDER": "pigeon"}, {"DIGEST_TIMEZONE": "Mars/Base"},
                                 {"SUMMARIES": "ai"}])
def test_invalid_values(env):
    with pytest.raises(ConfigError):
        Settings.from_env(env)


def test_missing_email_settings_names_only_keys():
    s = Settings.from_env({"EMAIL_TO": "a@b.c", "EMAIL_PROVIDER": "smtp", "SMTP_PASSWORD": "hunter2"})
    with pytest.raises(ConfigError) as e:
        s.validate_for_sending()
    assert "EMAIL_FROM" in str(e.value) and "SMTP_HOST" in str(e.value)
    assert "hunter2" not in str(e.value)


def test_secrets_not_in_repr():
    s = Settings.from_env({"RESEND_API_KEY": "re_secret", "SMTP_PASSWORD": "pw_secret"})
    assert "re_secret" not in repr(s) and "pw_secret" not in repr(s)


def test_sources_skip_disabled_and_validate_ids():
    data = {"software": [{"id": "a", "name": "A"}],
            "channels": [{"name": "x", "software": ["a"]}, {"name": "y", "enabled": False}]}
    assert len(parse_sources(data).channels) == 1
    with pytest.raises(ConfigError):
        parse_sources({"software": [{"id": "a", "name": "A"}], "channels": [{"name": "x", "software": ["zzz"]}]})
