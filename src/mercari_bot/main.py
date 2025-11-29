from __future__ import annotations

import logging
import sys
import time
from collections import defaultdict

from requests.exceptions import RequestException

import schedule

from .config import load_settings, Settings
from .scraper import fetch_items, initialize_webdriver
from .store import load_seen_items, save_seen_items
from .telegram import send_message, send_photo
from .scheduler import send_daily_summary

CYCLES_BEFORE_RESTART = 10

# Removed currency-conversion helper – bot now uses raw prices as displayed.


def _run(cfg: Settings):
    daily_counts: dict[str, int] = defaultdict(int)
    seen_items = load_seen_items(cfg)

    if not cfg.keywords:
        logging.critical("No keywords loaded. Please add keywords to the [KEYWORDS] section in config.ini.")
        sys.exit(1)

    driver = initialize_webdriver()
    if not driver:
        sys.exit(1)

    # Register daily summary job (keywords mapping no longer required)
    schedule.every().day.at(cfg.daily_summary_time).do(send_daily_summary, cfg, daily_counts)

    cycle_count = 0
    max_msgs_cfg = cfg.max_telegram_messages_per_item
    try:
        while True:
            for display_name, kw_cfg in cfg.keywords.items():
                terms = kw_cfg.terms  # list of search terms (1 or more)
                logging.info("Starting search for keyword: %s (%d term(s))", display_name, len(terms))

                # Aggregate items from all search terms
                items = []
                for term in terms:
                    logging.info("  Searching term: %s", term)
                    term_items = fetch_items(term, seen_items, driver, kw_cfg.price_min, kw_cfg.price_max, kw_cfg.title_must_contain, kw_cfg.exclude_keyword)
                    items.extend(term_items)
                    if len(terms) > 1:
                        time.sleep(cfg.keyword_batch_delay)  # delay between term searches

                if items:
                    send_message(cfg, f"🔍 Found new listings for: <b>{display_name}</b>...")
                    allowed_items = items if max_msgs_cfg is None else items[:max_msgs_cfg]
                    daily_counts[display_name] += len(allowed_items)

                    if allowed_items:
                        logging.info("🚀 Sending %d items for keyword: %s", len(allowed_items), display_name)
                        for item in sorted(allowed_items, key=lambda x: x.timestamp):
                            try:
                                send_photo(cfg, item.title, item.url, item.img_url, item.price_display, item.timestamp)
                            except RequestException as exc:
                                logging.error("Failed to send photo for '%s': %s", item.title, exc)
                                try:
                                    send_message(cfg, f"⚠️ Failed to send photo for <b>{item.title}</b>: {exc}")
                                except RequestException as msg_exc:
                                    logging.error("Also failed to send error notification: %s", msg_exc)
                            except Exception as exc:  # pragma: no cover – unexpected runtime errors
                                logging.error("Unexpected error sending photo for '%s': %s", item.title, exc, exc_info=True)
                    else:
                        logging.info("No items to send after applying message limit for %s", display_name)

                    send_message(
                        cfg,
                        f"✅ Done! Sent <b>{len(allowed_items)}</b> new item{'s' if len(allowed_items) != 1 else ''} for <b>{display_name}</b>.",
                    )
                else:
                    logging.info("No new items found for keyword: %s", display_name)

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
        save_seen_items(cfg, seen_items)
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
