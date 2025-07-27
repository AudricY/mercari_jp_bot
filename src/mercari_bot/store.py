from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Dict, Any

from .config import Settings


def load_seen_items(cfg: Settings) -> Dict[str, Any]:
    """Load previously seen items from JSON; return empty dict if not found/invalid."""

    path = Path(cfg.seen_file)
    if path.exists():
        try:
            with path.open("r", encoding="utf-8") as fp:
                data = json.load(fp)
            logging.info("Loaded %d seen items from '%s'.", len(data), path)
            return data
        except json.JSONDecodeError as exc:
            logging.error("Error decoding JSON from '%s': %s – starting with empty seen items.", path, exc)
        except Exception as exc:  # pragma: no cover – generic I/O errors
            logging.error("Error loading seen items from '%s': %s – starting with empty seen items.", path, exc)
    else:
        logging.info("No seen items file found at '%s'. Starting fresh.", path)

    return {}


def save_seen_items(cfg: Settings, seen_items: Dict[str, Any]) -> None:
    """Persist *seen_items* dict to disk, keeping only last *max_seen_items* entries."""

    trimmed_items = dict(list(seen_items.items())[-cfg.max_seen_items :])
    path = Path(cfg.seen_file)
    try:
        with path.open("w", encoding="utf-8") as fp:
            json.dump(trimmed_items, fp, ensure_ascii=False, indent=2)
        logging.info("Saved %d seen items to '%s'.", len(trimmed_items), path)
    except Exception as exc:  # pragma: no cover – generic I/O errors
        logging.error("Failed to save seen items: %s", exc) 