# PLAN – Aggregate Telegram Messages per Scrape/Keyword

## 1. Purpose & Scope
Currently the bot sends **one Telegram photo message per Mercari item** that matches a given keyword.  
The user wants to **collapse all new items found in a single scrape for a keyword into ONE message** (per scrape × per keyword).

Scope is limited to runtime behaviour; no configuration changes are required. The change only affects how results are delivered to Telegram.

## 2. Key Files to Modify
1. `src/mercari_bot/main.py` – orchestrates scraping loop and dispatches Telegram calls.
2. `src/mercari_bot/telegram.py` – helper functions that wrap Telegram HTTP API.

_No database / model / scraper logic is touched._

## 3. Implementation Outline
1. **Add helper in `telegram.py`**
   ```python
   def send_items_summary(cfg: Settings, display_name: str, items: list[Item]) -> None:
       """Send aggregated message listing all *items* for *display_name* keyword."""
   ```
   * Build one HTML-formatted message:
     - Header: `🔍 <b>{display_name}</b> – {len(items)} new item(s)`
     - Each item on its own line: `• <a href="{url}">{title}</a> – {price}` (timestamp optional).
   * Call `_post()` with same endpoint as `send_message`.
   * Ensure total length ≤ 4096 chars; if exceeded, split into multiple messages (edge-case, unlikely for typical usage but handled defensively).

2. **Update sending logic in `main.py`**
   * Remove:
     ```python
     send_message(cfg, f"🔍 Found new listings for: <b>{display_name}</b>...")
     for item in ...:
         send_photo(...)
     send_message(cfg, "✅ Done! ...")
     ```
   * Replace with single call:
     ```python
     send_items_summary(cfg, display_name, items)
     ```
   * Maintain `daily_counts[display_name] += len(items)` and existing delays.

3. **(Optional, nice-to-have)** – Keep `send_photo` flow behind a feature flag for users who still want images.  Not implemented now; can be future work.

4. **Verification / Tests**
   * Manual run with mocked Telegram token/chat using `requests_mock` to assert:
     - Only ONE HTTP call per keyword when multiple items returned.
     - Message body contains all expected item links/titles.
   * Existing unit tests for scraper remain unaffected.

## 4. Potential Risks / Trade-offs
* **No images**: Summary message will omit item photos.  Acceptable per user request; can be revisited with `sendMediaGroup` later.
* **Message length limit (4096 chars)**: If many items or long titles, message might overflow.  We will chunk automatically if needed.
* **HTML Escaping**: Titles may contain characters that need escaping.  Re-use `html.escape` for safety.

## 5. Open Questions
1. Is omitting images acceptable, or should we explore Telegram media groups for richer summaries?
2. Preferred order of items in summary (oldest→newest vs newest→oldest).  Plan uses chronological ascending (same as current logic).

---
**Next step:** Await user approval.  No code changes will be made until the plan is accepted.
