"""HTTP helper with retries, rate-limit handling and secret redaction."""
from __future__ import annotations

import logging
import re
import time
import urllib.error
import urllib.request
from typing import Mapping, Optional

log = logging.getLogger(__name__)

TRANSIENT = {408, 425, 429, 500, 502, 503, 504}
_SECRET_QS = re.compile(r"([?&](?:key|api_key|token)=)[^&\s]+", re.I)


class HttpError(Exception):
    def __init__(self, message: str, status: Optional[int] = None, body: str = ""):
        super().__init__(message)
        self.status = status
        self.body = body


def redact(text: str) -> str:
    """Remove API keys from URLs before they reach logs or error messages."""
    return _SECRET_QS.sub(r"\1REDACTED", str(text))


def request(url: str, *, data: Optional[bytes] = None, headers: Optional[Mapping[str, str]] = None,
            method: Optional[str] = None, timeout: int = 30, retries: int = 3,
            sleep=time.sleep, opener=urllib.request.urlopen) -> bytes:
    """Fetch a URL. Retries transient failures with backoff; honours Retry-After."""
    hdrs = {"User-Agent": "video-digest/1.0 (+personal digest)"}
    hdrs.update(headers or {})
    last: Optional[HttpError] = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
        try:
            with opener(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", "replace")[:500] if hasattr(exc, "read") else ""
            last = HttpError(f"HTTP {exc.code} for {redact(url)}", exc.code, body)
            if exc.code not in TRANSIENT:
                raise last from None
            retry_after = exc.headers.get("Retry-After") if exc.headers else None
            delay = min(float(retry_after), 60) if retry_after and retry_after.isdigit() else 2 ** attempt * 2
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            last = HttpError(f"Network error for {redact(url)}: {redact(exc)}")
            delay = 2 ** attempt * 2
        if attempt < retries:
            log.warning("%s - retrying in %.0fs (%d/%d)", last, delay, attempt + 1, retries)
            sleep(delay)
    assert last is not None
    raise last
