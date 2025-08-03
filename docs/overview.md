# Mercari Telegram Bot – Architecture Overview

> A high-level guide to the structure, responsibilities, and runtime behaviour of the Mercari Telegram Bot codebase.

## Table of Contents
- [Mercari Telegram Bot – Architecture Overview](#mercari-telegram-bot--architecture-overview)
  - [Table of Contents](#table-of-contents)
  - [Project Goals](#project-goals)
  - [High-Level Architecture](#high-level-architecture)
  - [Directory Layout](#directory-layout)
  - [Configuration \& Runtime Parameters](#configuration--runtime-parameters)
  - [Core Modules](#core-modules)
  - [End-to-End Execution Flow](#end-to-end-execution-flow)
  - [Daily Summary Scheduler](#daily-summary-scheduler)
  - [Telegram Rate-Limiting Strategy](#telegram-rate-limiting-strategy)
  - [Extending / Customising](#extending--customising)
  - [Maintaining This Document](#maintaining-this-document)

---

## Project Goals
The bot continuously monitors *Mercari Japan* listings for user-specified keywords and instantly relays interesting items to a Telegram chat. Key features include:

* Near-real-time monitoring of new listings.
* Rich Telegram messages containing title, price, image and direct URL.
* De-duplication & price-drop detection via a persistent *seen items* store.
* Configurable price ranges and title filters per keyword.
* Daily summary of activity.
* Robust error handling, retry strategies, and Telegram rate limiting.

---

## High-Level Architecture
Below is a bird’s-eye view of how the pieces fit together.

```mermaid
graph TD
    subgraph Runtime
        A[main.py] -->|loads| C(config.py)
        A --> B(initialize_webdriver → scraper.py)
        B --> D(fetch_items)
        D --> E[(store.py – seen_items.json)]
        A --> F(telegram.py)
        A --> G[schedule (third-party lib)]
        G --> H(scheduler.py – send_daily_summary)
        H --> F
    end
```

* **`main.py`** orchestrates everything: loads configuration, spins up Selenium, loops through keywords, triggers scraping, and pushes messages.
* **`scraper.py`** uses a headless Chrome WebDriver to fetch & parse listings.
* **`telegram.py`** contains a thin wrapper around Telegram’s HTTP API with global rate-limiting.
* **`store.py`** persists the *seen items* dictionary to `seen_items.json`.
* **`scheduler.py`** leverages the `schedule` library for the once-a-day summary.

---

## Directory Layout
```
mercari_jp_bot/
├── docs/                     # Project documentation (this file lives here)
├── src/
│   └── mercari_bot/          # Application package
│       ├── __init__.py
│       ├── main.py           # Program entry-point
│       ├── config.py         # Settings loader (.env + YAML)
│       ├── scraper.py        # Selenium scraping logic
│       ├── telegram.py       # Telegram API wrapper & rate limiter
│       ├── models.py         # Plain dataclasses (e.g. Item)
│       ├── store.py          # Persistence for seen items
│       ├── scheduler.py      # Daily summary job
│       └── utils.py          # Misc helpers (price parsing, etc.)
├── key.env                   # **Required** – Telegram credentials (not committed)
├── config.yaml               # **Required** – Main configuration file
├── requirements.txt          # Python dependencies
└── README.md                 # Setup guide & troubleshooting
```

---

## Configuration & Runtime Parameters
1. **`key.env`** – *never commit this file!*
   ```env
   BOT_TOKEN=<telegram-bot-token>
   CHAT_ID=<telegram-chat-id>
   ```

2. **`config.yaml`** – centralised, human-friendly settings.
   * `bot_settings` – limits, retry/back-off values, path to `seen_items.json`.
   * `schedule` – daily summary time (`HH:MM`).
   * `delays` – inter-keyword and inter-cycle delays plus minimum delay between Telegram requests.
   * `keywords` – mapping of display name → search spec, e.g.
     ```yaml
     keywords:
       ps3:
         term: プレイステーション3 (PS3) 本体
         price_min: 4000
         price_max: 10000
         title_must_contain: [本体]
     ```

`config.py` merges the environment variables and YAML into a typed `Settings` dataclass which is passed around at runtime.

---

## Core Modules
| Module | Responsibility |
|--------|----------------|
| **`config.py`** | Read `.env` & YAML, validate, expose `Settings` dataclass. |
| **`main.py`** | Program entry, initializes WebDriver, orchestrates keyword loop, handles errors/retries, triggers daily summary. |
| **`scraper.py`** | Build Mercari search URL, use Selenium to load & parse listing tiles, create `Item` objects, deduplicate/export. |
| **`telegram.py`** | Send messages/photos with global rate-limiting and exponential back-off on HTTP 429 responses. |
| **`store.py`** | JSON persistence for *seen items* with configurable trimming (`max_seen_items`). |
| **`scheduler.py`** | Uses third-party `schedule` lib to send daily summary and clear counters. |
| **`utils.py`** | Helper such as `parse_price` (regex-based, currency-agnostic). |
| **`models.py`** | `Item` dataclass + signature helper (lower-case title + image hash). |

---

## End-to-End Execution Flow
1. **Startup**: `main()` sets up logging, loads `Settings`, and initialises a headless Chrome WebDriver.
2. **Keyword Loop** (outer `while True`):
   1. Iterate through every keyword configured in `settings.keywords`.
   2. Call `scraper.fetch_items()` which:
      * Crafts a search URL with optional price range.
      * Scrolls the page to load more listings.
      * Extracts title, price, image, URL for each tile.
      * Applies title filters + deduplication via `seen_items` dict.
   3. If new items found:
      * Send a *header* message ("Found new listings for XYZ …").
      * For each new item (subject to `max_telegram_messages_per_item`):
        * `telegram.send_photo()` posts image + caption.
      * Send a *footer* message summarising count.
   4. Sleep for `keyword_batch_delay` seconds before next keyword.
3. **End of Cycle**: Persist trimmed `seen_items` to disk, run any scheduled jobs (`schedule.run_pending()`), then sleep for `full_cycle_delay`.
4. **WebDriver Refresh**: After `CYCLES_BEFORE_RESTART` iterations (default = 10 cycles) the WebDriver is recycled to mitigate memory leaks.
5. **Graceful Shutdown**: KeyboardInterrupt or fatal error triggers cleanup + Telegram notification.

---

## Daily Summary Scheduler
The bot sends a concise 📊 *Mercari Summary* once per day at `schedule.daily_summary_time`. It lists each keyword and the number of listings forwarded that day, then resets the in-memory counters.

---

## Telegram Rate-Limiting Strategy
`telegram._rate_limited_post()` enforces:
* **Global minimum delay** between any two Telegram requests (`telegram_min_delay`, default = 1.2 s).
* **Retry & exponential back-off** when API replies with **HTTP 429**.
  * Retries up to `telegram_max_retries` (default = 3).
  * Back-off factor `telegram_backoff_factor` (default = 2.0).
* Thread-safe locking ensures even multi-threaded additions would respect the same limit.

---

## Extending / Customising
* **Add new keywords** by editing `config.yaml → keywords` (supports price & title filters).
* **Tweak delays** for faster/slower scraping in `config.yaml → delays`.
* **Change summary time** in `config.yaml → schedule.daily_summary_time`.
* **Adjust Telegram limits** (`bot_settings.telegram_*`).
* **Add new features**: Follow the existing module boundaries (scraper → business logic → telegram/store) to keep concerns separated.

---

## Maintaining This Document
Whenever you:
1. Add a new module, *briefly* document it under **Core Modules**.
2. Introduce new configuration keys, update the **Configuration** section.
3. Change runtime flow, adjust the Mermaid diagram accordingly.

Keeping this file in sync ensures newcomers (and future you) can ramp up quickly.
