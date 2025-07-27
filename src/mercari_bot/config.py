from __future__ import annotations

import configparser
import logging
import os
import pathlib
import sys
from dataclasses import dataclass

from dotenv import load_dotenv


@dataclass(slots=True)
class Settings:
    """Runtime configuration loaded from .env and config.ini."""

    # Telegram
    bot_token: str
    chat_id: str

    # Bot behaviour
    max_seen_items: int = 6000
    seen_file: str = "seen_items.json"
    daily_summary_time: str = "12:30"
    keyword_batch_delay: int = 10
    full_cycle_delay: int = 60

    # Keywords mapping (original -> translated)
    keywords: dict[str, str] | None = None

    @property
    def has_keywords(self) -> bool:  # Convenience helper
        return bool(self.keywords)


_DEF_BASE_DIR = pathlib.Path(__file__).resolve().parents[2]  # project root


def _load_env(base_dir: pathlib.Path) -> None:
    """Load environment variables from *key.env* located at project root."""

    env_path = base_dir / "key.env"
    load_dotenv(env_path)


def _load_ini(base_dir: pathlib.Path) -> configparser.ConfigParser:
    """Return a ConfigParser loaded from *config.ini* at project root."""

    cfg_path = base_dir / "config.ini"
    if not cfg_path.exists():
        logging.critical("Configuration file '%s' not found. Please create it.", cfg_path)
        sys.exit(1)

    parser = configparser.ConfigParser()
    parser.read(cfg_path, encoding="utf-8")
    return parser


def load_settings() -> Settings:
    """Return consolidated *Settings* object for the application."""

    base_dir = _DEF_BASE_DIR

    # 1. Environment variables ------------------------------------------------
    _load_env(base_dir)

    bot_token = os.getenv("BOT_TOKEN")
    chat_id = os.getenv("CHAT_ID")

    if not bot_token or not chat_id:
        logging.critical("Missing Telegram credentials in key.env file! BOT_TOKEN and CHAT_ID are required.")
        sys.exit(1)

    # 2. Parse INI ------------------------------------------------------------
    parser = _load_ini(base_dir)

    max_seen_items = parser.getint("BOT_SETTINGS", "MAX_SEEN_ITEMS", fallback=6000)
    seen_file = parser.get("BOT_SETTINGS", "SEEN_FILE", fallback="seen_items.json")

    daily_summary_time = parser.get("SCHEDULE", "DAILY_SUMMARY_TIME", fallback="12:30")

    keyword_batch_delay = parser.getint("DELAYS", "KEYWORD_BATCH_DELAY", fallback=10)
    full_cycle_delay = parser.getint("DELAYS", "FULL_CYCLE_DELAY", fallback=60)

    try:
        keywords: dict[str, str] = dict(parser.items("KEYWORDS"))
    except configparser.NoSectionError:
        keywords = {}
        logging.warning("No [KEYWORDS] section found in config.ini – the bot will run without active searches.")

    settings = Settings(
        bot_token=bot_token,
        chat_id=chat_id,
        max_seen_items=max_seen_items,
        seen_file=str((base_dir / seen_file).resolve()),
        daily_summary_time=daily_summary_time,
        keyword_batch_delay=keyword_batch_delay,
        full_cycle_delay=full_cycle_delay,
        keywords=keywords,
    )

    return settings 