"""Email delivery: Resend HTTP API or plain SMTP. Secrets are never logged."""
from __future__ import annotations

import json
import logging
import smtplib
import ssl
import time
from email.message import EmailMessage
from email.utils import parseaddr

from .config import Settings
from .http_client import HttpError, request

log = logging.getLogger(__name__)
RESEND_URL = "https://api.resend.com/emails"


class EmailError(Exception):
    pass


def send_email(settings: Settings, subject: str, text: str, html: str, *,
               sleep=time.sleep, post=request, smtp_factory=None) -> None:
    settings.validate_for_sending()
    if settings.email_provider == "resend":
        _send_resend(settings, subject, text, html, sleep, post)
    else:
        _send_smtp(settings, subject, text, html, sleep, smtp_factory)


def _send_resend(s: Settings, subject, text, html, sleep, post) -> None:
    body = json.dumps({"from": s.email_from, "to": [a.strip() for a in s.email_to.split(",") if a.strip()],
                       "subject": subject, "text": text, "html": html}).encode()
    try:
        post(RESEND_URL, data=body, method="POST", sleep=sleep,
             headers={"Authorization": f"Bearer {s.resend_api_key}", "Content-Type": "application/json"})
    except HttpError as exc:
        # exc message has no secrets; the response body (Resend's reason) is safe to show.
        raise EmailError(f"Resend rejected the email: {exc} {exc.body[:200]}") from None


def _send_smtp(s: Settings, subject, text, html, sleep, factory) -> None:
    msg = EmailMessage()
    msg["Subject"], msg["From"], msg["To"] = subject, s.email_from, s.email_to
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")
    ctx = ssl.create_default_context()
    last = None
    for attempt in range(3):
        try:
            if factory:
                server = factory()
            elif s.smtp_security == "ssl":
                server = smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, timeout=30, context=ctx)
            else:
                server = smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=30)
            with server:
                if s.smtp_security == "starttls" and not factory:
                    server.starttls(context=ctx)
                server.login(s.smtp_user, s.smtp_password)
                recipients = [a.strip() for a in s.email_to.split(",") if a.strip()]
                server.send_message(msg, from_addr=parseaddr(s.email_from)[1], to_addrs=recipients)
            return
        except smtplib.SMTPAuthenticationError:
            raise EmailError("SMTP login failed - check SMTP_USER / SMTP_PASSWORD "
                             "(Gmail needs an App Password).") from None
        except (smtplib.SMTPException, OSError) as exc:
            last = type(exc).__name__
            log.warning("SMTP attempt %d failed (%s)", attempt + 1, last)
            if attempt < 2:
                sleep(2 ** attempt * 2)
    raise EmailError(f"SMTP delivery failed after 3 attempts ({last}).")
