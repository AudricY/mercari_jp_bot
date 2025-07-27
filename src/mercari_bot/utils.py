from __future__ import annotations

import logging
import re
from typing import Tuple

__all__ = [
    "parse_price",
]


def parse_price(text: str) -> Tuple[str | None, int | None]:
    """Parse a raw Mercari price without performing any currency conversion.

    Returns a tuple `(display, numeric)` where *display* is the string you can
    show directly to the end-user (e.g. "US$50" or "¥12.000") and *numeric* is
    the integer amount extracted. If the price cannot be parsed, both values are
    *None*.
    """

    # Capture optional decimal part, e.g. "US$12,345.67".
    match = re.search(r"(¥|US\$|\$)\s*([\d,]+(?:\.\d+)?)", text)
    if not match:
        logging.debug("No price found in text: %s", text)
        return None, None

    symbol, amount_str = match.groups()
    try:
        amount_float = float(amount_str.replace(",", ""))
    except ValueError:
        logging.warning("Could not parse amount '%s' from text: %s", amount_str, text)
        return None, None

    # Preserve the original price format for display (symbol + amount as captured).
    display = f"{symbol}{amount_str}"

    return display, amount_float 