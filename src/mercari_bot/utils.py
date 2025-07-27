from __future__ import annotations

import logging
import re
from typing import Tuple

__all__ = [
    "convert_price_to_yen",
]


def convert_price_to_yen(text: str, rate: float) -> Tuple[str | None, int | None]:
    """Convert a raw price string (with currency symbol) to JPY.

    Returns a tuple `(display, numeric)` where *display* is formatted "¥12,345" and
    *numeric* is the integer value in yen. If the text cannot be parsed, both values
    are *None*.
    """

    match = re.search(r"(¥|US\$|\$)\s*([\d,]+)", text)
    if not match:
        logging.debug("No price found in text: %s", text)
        return None, None

    symbol, amount_str = match.groups()
    try:
        amount_int = int(amount_str.replace(",", ""))
    except ValueError:
        logging.warning("Could not parse amount '%s' from text: %s", amount_str, text)
        return None, None

    yen: int | None = None
    if symbol in {"US$", "$"}:
        yen = int(amount_int * rate)
    elif symbol == "¥":
        yen = amount_int
    else:
        logging.warning("Unknown currency symbol '%s' in text: %s", symbol, text)
        return None, None

    return f"¥{yen:,}".replace(",", "."), yen 