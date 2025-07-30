from __future__ import annotations

import logging
from typing import Final

import requests
import time
import threading

from .config import Settings

_SEND_MESSAGE_ENDPOINT: Final[str] = "https://api.telegram.org/bot{token}/sendMessage"
_SEND_PHOTO_ENDPOINT: Final[str] = "https://api.telegram.org/bot{token}/sendPhoto"

# --- Rate limiting globals ---
_LAST_REQUEST_TS: float = 0.0
_LOCK = threading.Lock()


def _raw_post(endpoint: str, payload: dict, timeout: int = 10) -> None:
    try:
        response = requests.post(endpoint, data=payload, timeout=timeout)
        response.raise_for_status()
    except requests.exceptions.RequestException as exc:  # pragma: no cover – network
        logging.error("Failed to send Telegram request: %s", exc)
        raise


def send_message(cfg: Settings, text: str) -> None:
    """Send a plain text (HTML-formatted) message to Telegram."""

    endpoint = _SEND_MESSAGE_ENDPOINT.format(token=cfg.bot_token)
    payload = {
        "chat_id": cfg.chat_id,
        "text": text,
        "parse_mode": "HTML",
    }
    _rate_limited_post(cfg, endpoint, payload, timeout=5)
    logging.info("📝 Sent message: %s", text[:50])


def send_photo(cfg: Settings, title: str, url: str, img_url: str, price: str, timestamp: str) -> None:
    """Send a photo with caption describing the Mercari item."""

    endpoint = _SEND_PHOTO_ENDPOINT.format(token=cfg.bot_token)
    caption = f"<b>{title}</b>\nPrice: {price}\nTime: {timestamp}\n{url}"
    payload = {
        "chat_id": cfg.chat_id,
        "photo": img_url,
        "caption": caption,
        "parse_mode": "HTML",
    }
    _rate_limited_post(cfg, endpoint, payload, timeout=10)
    logging.info("📷 Sent photo for: %s", title)


def _rate_limited_post(cfg: Settings, endpoint: str, payload: dict, timeout: int = 10) -> None:
    """
    Send a Telegram request while respecting a global minimum delay and configurable
    retry/back-off strategy to avoid 429 Too Many Requests.
    """
    global _LAST_REQUEST_TS

    for attempt in range(cfg.telegram_max_retries + 1):
        # Enforce global delay
        with _LOCK:
            elapsed = time.time() - _LAST_REQUEST_TS
            if elapsed < cfg.telegram_min_delay:
                time.sleep(cfg.telegram_min_delay - elapsed)

        try:
            _raw_post(endpoint, payload, timeout=timeout)
            with _LOCK:
                _LAST_REQUEST_TS = time.time()
            return  # Success
        except requests.exceptions.HTTPError as exc:  # pragma: no cover – network
            status = getattr(exc.response, "status_code", None)
            if status == 429 and attempt < cfg.telegram_max_retries:
                retry_after = int(exc.response.headers.get("Retry-After", 0))
                backoff = cfg.telegram_backoff_factor ** attempt
                wait_time = max(retry_after, cfg.telegram_min_delay) * backoff
                logging.warning(
                    "Telegram 429 received – backing off for %.1f s (attempt %d/%d).",
                    wait_time,
                    attempt + 1,
                    cfg.telegram_max_retries,
                )
                time.sleep(wait_time)
                continue
            # Other errors or retries exhausted – re-raise
            raise 