from __future__ import annotations

import logging
import os
import pathlib
import sys
from dataclasses import dataclass

import yaml
from dotenv import load_dotenv


@dataclass(slots=True)
class KeywordConfig:
    """Configuration for a single search keyword, including optional price range."""
    term: str
    price_min: int | None = None
    price_max: int | None = None
    title_must_contain: str | list[str] | None = None
    exclude_keyword: str | None = None


@dataclass(slots=True)
class Settings:
    """Runtime configuration loaded from .env and config.yaml."""

    # Telegram
    bot_token: str
    chat_id: str

    # Bot behaviour
    telegram_min_delay: float = 1.2
    telegram_max_retries: int = 3
    telegram_backoff_factor: float = 2.0
    max_seen_items: int = 6000
    seen_file: str = "seen_items.json"
    daily_summary_time: str = "12:30"
    keyword_batch_delay: int = 10
    full_cycle_delay: int = 60
    max_telegram_messages_per_item: int | None = None

    # Keywords mapping (display name -> search term)
    keywords: dict[str, 'KeywordConfig'] | None = None

    @property
    def has_keywords(self) -> bool:  # Convenience helper
        return bool(self.keywords)


_DEF_BASE_DIR = pathlib.Path(__file__).resolve().parents[2]  # project root


def _load_env(base_dir: pathlib.Path) -> None:
    """Load environment variables from *key.env* located at project root."""

    env_path = base_dir / "key.env"
    load_dotenv(env_path)


def _load_yaml(base_dir: pathlib.Path) -> dict:
    """Return a dictionary loaded from *config.yaml* at project root."""

    cfg_path = base_dir / "config.yaml"
    if not cfg_path.exists():
        logging.critical("Configuration file '%s' not found. Please create it.", cfg_path)
        sys.exit(1)

    try:
        with open(cfg_path, 'r', encoding='utf-8') as file:
            config = yaml.safe_load(file)
            return config or {}
    except yaml.YAMLError as e:
        logging.critical("Error parsing YAML configuration file '%s': %s", cfg_path, e)
        sys.exit(1)
    except Exception as e:
        logging.critical("Error reading configuration file '%s': %s", cfg_path, e)
        sys.exit(1)


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

    # 2. Parse YAML ------------------------------------------------------------
    config = _load_yaml(base_dir)

    # Extract bot settings with fallbacks
    bot_settings = config.get("bot_settings", {})
    max_seen_items = bot_settings.get("max_seen_items", 6000)
    seen_file = bot_settings.get("seen_file", "seen_items.json")

    # Extract schedule settings with fallbacks
    schedule = config.get("schedule", {})
    daily_summary_time = schedule.get("daily_summary_time", "12:30")
    max_telegram_messages_per_item = bot_settings.get("max_telegram_messages_per_item")
    telegram_max_retries = bot_settings.get("telegram_max_retries", 3)
    telegram_backoff_factor = bot_settings.get("telegram_backoff_factor", 2.0)

    # Extract delay settings with fallbacks
    delays = config.get("delays", {})
    keyword_batch_delay = delays.get("keyword_batch_delay", 10)
    full_cycle_delay = delays.get("full_cycle_delay", 60)
    telegram_min_delay = delays.get("telegram_min_delay", 1.2)

    # Extract keywords with fallbacks
    raw_keywords = config.get("keywords", {})
    # Convert raw keywords mapping into KeywordConfig objects (supports old and new style)
    parsed_keywords: dict[str, KeywordConfig] = {}
    for display_name, spec in raw_keywords.items():
        if isinstance(spec, str):
            parsed_keywords[display_name] = KeywordConfig(term=spec)
        elif isinstance(spec, dict):
            term = spec.get("term") or spec.get("search") or ""
            if not term:
                logging.warning("Keyword '%s' entry missing 'term'; skipping.", display_name)
                continue
            price_min = spec.get("price_min")
            price_max = spec.get("price_max")
            title_must_contain = spec.get("title_must_contain")
            exclude_keyword = spec.get("exclude_keyword")
            parsed_keywords[display_name] = KeywordConfig(term=term, price_min=price_min, price_max=price_max, title_must_contain=title_must_contain, exclude_keyword=exclude_keyword)
        else:
            logging.warning("Keyword '%s' has unsupported type; skipping.", display_name)
    if not raw_keywords:
        logging.warning("No 'keywords' section found in config.yaml – the bot will run without active searches.")

    settings = Settings(
        bot_token=bot_token,
        chat_id=chat_id,
        telegram_min_delay=telegram_min_delay,
        telegram_max_retries=telegram_max_retries,
        telegram_backoff_factor=telegram_backoff_factor,
        max_seen_items=max_seen_items,
        seen_file=str((base_dir / seen_file).resolve()),
        daily_summary_time=daily_summary_time,
        keyword_batch_delay=keyword_batch_delay,
        full_cycle_delay=full_cycle_delay,
        max_telegram_messages_per_item=max_telegram_messages_per_item,
        keywords=parsed_keywords,
    )

    return settings 