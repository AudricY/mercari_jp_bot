from __future__ import annotations

import logging
from typing import Final

import requests

from .config import Settings

_SEND_MESSAGE_ENDPOINT: Final[str] = "https://api.telegram.org/bot{token}/sendMessage"
_SEND_PHOTO_ENDPOINT: Final[str] = "https://api.telegram.org/bot{token}/sendPhoto"


def _post(endpoint: str, payload: dict, timeout: int = 10) -> None:
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
    _post(endpoint, payload, timeout=5)
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
    _post(endpoint, payload, timeout=10)
    logging.info("📷 Sent photo for: %s", title) 