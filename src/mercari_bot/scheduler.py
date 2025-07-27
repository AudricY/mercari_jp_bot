from __future__ import annotations

import datetime
import logging
from typing import Dict

from .config import Settings
from .telegram import send_message


def send_daily_summary(cfg: Settings, daily_counts: Dict[str, int]) -> None:
    """Send a daily usage summary via Telegram and reset *daily_counts*."""

    date = datetime.date.today().isoformat()
    lines: list[str] = [f"📊 Mercari Summary — {date}\n"]

    if not daily_counts:
        lines.append("No activity recorded today.")
    else:
        for display_name, count in daily_counts.items():
            plural = "s" if count != 1 else ""
            lines.append(f"• {display_name}: {count} new item{plural}")

    send_message(cfg, "\n".join(lines))
    daily_counts.clear()
    logging.info("Daily summary sent and daily counts cleared.") 