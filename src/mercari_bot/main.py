from __future__ import annotations

import logging
import sys
import time
from collections import defaultdict

import requests
import schedule

from .config import load_settings, Settings
from .scraper import fetch_items, initialize_webdriver
from .store import load_seen_items, save_seen_items
from .telegram import send_message, send_photo
from .scheduler import send_daily_summary

CYCLES_BEFORE_RESTART = 10


def get_usd_to_jpy_rate() -> float:
    """Return current USD→JPY exchange rate (fallback to 145.0)."""

    try:
        response = requests.get("https://open.er-api.com/v6/latest/USD", timeout=5)
        response.raise_for_status()
        data = response.json()
        rate = float(data["rates"]["JPY"])
        logging.info("Fetched USD to JPY exchange rate: %s", rate)
        return rate
    except requests.exceptions.RequestException as exc:
        logging.warning("⚠️ Failed to fetch exchange rate, using fallback (145.0). Error: %s", exc)
    except (KeyError, TypeError) as exc:
        logging.warning("⚠️ Failed to parse exchange rate data, using fallback (145.0). Error: %s", exc)
    return 145.0


def _run(cfg: Settings):
    daily_counts: dict[str, int] = defaultdict(int)
    seen_items = load_seen_items(cfg)

    if not cfg.keywords:
        logging.critical("No keywords loaded. Please add keywords to the [KEYWORDS] section in config.ini.")
        sys.exit(1)

    rate = get_usd_to_jpy_rate()

    driver = initialize_webdriver()
    if not driver:
        sys.exit(1)

    # Register daily summary job
    schedule.every().day.at(cfg.daily_summary_time).do(send_daily_summary, cfg, daily_counts, cfg.keywords)

    cycle_count = 0
    try:
        while True:
            for kw_original, kw_translated in cfg.keywords.items():
                logging.info("Starting search for keyword: %s (Translated: %s)", kw_original, kw_translated)
                items = fetch_items(kw_original, seen_items, rate, driver)

                if items:
                    send_message(cfg, f"🔍 Found new listings for: <b>{kw_translated}</b>...")
                    daily_counts[kw_original] += len(items)
                    logging.info("🚀 Sending %d items for keyword: %s", len(items), kw_original)
                    for item in sorted(items, key=lambda x: x.timestamp):
                        send_photo(cfg, item.title, item.url, item.img_url, item.price_display, item.timestamp)
                    send_message(
                        cfg,
                        f"✅ Done! Found <b>{len(items)}</b> new item{'s' if len(items) != 1 else ''} for <b>{kw_translated}</b>.",
                    )
                else:
                    logging.info("No new items found for keyword: %s", kw_original)

                time.sleep(cfg.keyword_batch_delay)

            save_seen_items(cfg, seen_items)
            schedule.run_pending()
            logging.info("Finished a full cycle of keyword searches. Waiting for next cycle...")
            time.sleep(cfg.full_cycle_delay)

            cycle_count += 1
            if cycle_count % CYCLES_BEFORE_RESTART == 0:
                driver.quit()
                driver = initialize_webdriver()
                if not driver:
                    logging.critical("WebDriver failed to re-initialize. Exiting.")
                    break  # Exit the main loop if driver fails

    except KeyboardInterrupt:
        logging.info("Bot stopped by user (KeyboardInterrupt).")
    except Exception as exc:  # pragma: no cover – broad except for critical runtime errors
        logging.critical("An unhandled critical error occurred: %s", exc, exc_info=True)
        send_message(cfg, f"❗️ An error occurred: {exc}")
        logging.error("Shutting down due to critical error.")
    finally:
        if driver:
            driver.quit()
            logging.info("WebDriver closed.")
        send_message(cfg, "🔴 Mercari bot has stopped.")
        logging.info("Mercari bot is shutting down.")


# Entry-point ---------------------------------------------------------------


def main() -> None:  # pragma: no cover – CLI entry
    logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
    cfg = load_settings()
    _run(cfg)


if __name__ == "__main__":
    main() 