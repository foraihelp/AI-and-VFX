"""Settings (from environment) and source definitions (from YAML)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping, Optional

import yaml

BASE_DIR = Path(__file__).resolve().parent.parent


class ConfigError(Exception):
    pass


def load_dotenv(path: Path) -> None:
    """Tiny .env reader for local runs. Real environment variables win."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.split(" #")[0].strip().strip("'\"")   # drop inline comment
        os.environ.setdefault(key.strip(), value)


def _bool(value: Optional[str], default: bool) -> bool:
    if value is None or value.strip() == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _int(value: Optional[str], default: int, name: str, minimum: int = 0) -> int:
    if value is None or value.strip() == "":
        return default
    try:
        number = int(value)
    except ValueError:
        raise ConfigError(f"{name} must be a whole number, got {value!r}") from None
    if number < minimum:
        raise ConfigError(f"{name} must be >= {minimum}")
    return number


@dataclass
class Settings:
    youtube_api_key: str = ""
    lookback_hours: int = 48
    initial_lookback_hours: int = 72
    send_empty: bool = True
    timezone: str = "UTC"
    summaries: str = "description"        # "description" or "off"
    max_items_per_software: int = 15
    include_shorts: bool = False
    state_path: Path = BASE_DIR / "state" / "seen.json"
    sources_path: Path = BASE_DIR / "config" / "sources.yaml"
    # email
    email_provider: str = "resend"
    email_to: str = ""
    email_from: str = ""
    resend_api_key: str = field(default="", repr=False)
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = field(default="", repr=False)
    smtp_security: str = "starttls"

    @classmethod
    def from_env(cls, env: Optional[Mapping[str, str]] = None) -> "Settings":
        e = os.environ if env is None else env
        g = lambda k: (e.get(k) or "").strip()  # noqa: E731
        summaries = (g("SUMMARIES") or "description").lower()
        if summaries not in {"description", "off"}:
            raise ConfigError("SUMMARIES must be 'description' or 'off'")
        provider = (g("EMAIL_PROVIDER") or "resend").lower()
        if provider not in {"resend", "smtp"}:
            raise ConfigError("EMAIL_PROVIDER must be 'resend' or 'smtp'")
        security = (g("SMTP_SECURITY") or "starttls").lower()
        if security not in {"starttls", "ssl", "none"}:
            raise ConfigError("SMTP_SECURITY must be starttls, ssl or none")
        tz = g("DIGEST_TIMEZONE") or "UTC"
        try:
            from zoneinfo import ZoneInfo
            ZoneInfo(tz)
        except Exception:
            raise ConfigError(f"DIGEST_TIMEZONE {tz!r} is not a valid timezone name") from None
        s = cls(
            youtube_api_key=g("YOUTUBE_API_KEY"),
            lookback_hours=_int(g("LOOKBACK_HOURS"), 48, "LOOKBACK_HOURS", 1),
            initial_lookback_hours=_int(g("INITIAL_LOOKBACK_HOURS"), 72, "INITIAL_LOOKBACK_HOURS", 1),
            send_empty=_bool(g("SEND_EMPTY"), True),
            timezone=tz,
            summaries=summaries,
            max_items_per_software=_int(g("MAX_ITEMS_PER_SOFTWARE"), 15, "MAX_ITEMS_PER_SOFTWARE", 1),
            include_shorts=_bool(g("INCLUDE_SHORTS"), False),
            email_provider=provider,
            email_to=g("EMAIL_TO"),
            email_from=g("EMAIL_FROM"),
            resend_api_key=g("RESEND_API_KEY"),
            smtp_host=g("SMTP_HOST"),
            smtp_port=_int(g("SMTP_PORT"), 587, "SMTP_PORT", 1),
            smtp_user=g("SMTP_USER"),
            smtp_password=e.get("SMTP_PASSWORD") or "",
            smtp_security=security,
        )
        if g("STATE_PATH"):
            s.state_path = Path(g("STATE_PATH"))
        if g("SOURCES_PATH"):
            s.sources_path = Path(g("SOURCES_PATH"))
        return s

    def validate_for_sending(self) -> None:
        """Raise ConfigError naming the missing settings (never their values)."""
        missing = [n for n, v in (("EMAIL_TO", self.email_to), ("EMAIL_FROM", self.email_from)) if not v]
        if self.email_provider == "resend" and not self.resend_api_key:
            missing.append("RESEND_API_KEY")
        if self.email_provider == "smtp":
            missing += [n for n, v in (("SMTP_HOST", self.smtp_host), ("SMTP_USER", self.smtp_user),
                                       ("SMTP_PASSWORD", self.smtp_password)) if not v]
        if missing:
            raise ConfigError("Missing email settings: " + ", ".join(missing))


@dataclass
class Software:
    id: str
    name: str
    strong: list[str] = field(default_factory=list)    # match on their own
    weak: list[str] = field(default_factory=list)      # match only with a context term
    context: list[str] = field(default_factory=list)
    exclude: list[str] = field(default_factory=list)
    enabled: bool = True


@dataclass
class Sources:
    software: list[Software]
    channels: list[dict[str, Any]]
    searches: list[dict[str, Any]]
    feeds: list[dict[str, Any]]
    exclude_title_terms: list[str]
    type_rules: dict[str, list[str]]


def load_sources(path: Path) -> Sources:
    try:
        data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError) as exc:
        raise ConfigError(f"Cannot read sources file {path}: {exc}") from None
    return parse_sources(data)


def parse_sources(data: Mapping[str, Any]) -> Sources:
    software = []
    for item in data.get("software") or []:
        if "id" not in item or "name" not in item:
            raise ConfigError("Every software entry needs 'id' and 'name'")
        software.append(Software(
            id=item["id"], name=item["name"],
            strong=list(item.get("strong") or []), weak=list(item.get("weak") or []),
            context=list(item.get("context") or []), exclude=list(item.get("exclude") or []),
            enabled=item.get("enabled", True),
        ))
    ids = {s.id for s in software}
    channels = [c for c in (data.get("channels") or []) if c.get("enabled", True)]
    searches = [q for q in (data.get("searches") or []) if q.get("enabled", True)]
    feeds = [f for f in (data.get("feeds") or []) if f.get("enabled", True)]
    for entry in channels + searches + feeds:
        for sid in entry.get("software") or []:
            if sid not in ids:
                raise ConfigError(f"Source {entry.get('name') or entry.get('query')!r} "
                                  f"refers to unknown software id {sid!r}")
    return Sources(
        software=[s for s in software if s.enabled],
        channels=channels, searches=searches, feeds=feeds,
        exclude_title_terms=list(data.get("exclude_title_terms") or []),
        type_rules={k: list(v) for k, v in (data.get("type_rules") or {}).items()},
    )
