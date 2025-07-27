from __future__ import annotations

import datetime
import hashlib
from dataclasses import dataclass


@dataclass(slots=True)
class Item:
    """Represent a Mercari listing scraped by the bot."""

    title: str
    url: str
    img_url: str
    price_display: str
    numeric_price: int
    timestamp: str

    @property
    def signature(self) -> str:
        """Return a stable signature to detect duplicates (lower-case title + image hash)."""
        return hashlib.md5((self.title.lower() + self.img_url).encode()).hexdigest()

    @classmethod
    def create(
        cls,
        title: str,
        url: str,
        img_url: str,
        price_display: str,
        numeric_price: int,
        timestamp: str | None = None,
    ) -> "Item":
        return cls(
            title=title,
            url=url,
            img_url=img_url,
            price_display=price_display,
            numeric_price=numeric_price,
            timestamp=timestamp or datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        ) 